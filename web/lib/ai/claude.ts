import 'server-only'
import Anthropic from '@anthropic-ai/sdk'
import { CONCEPT_KEYS } from '@calyxa/curriculum'
import { buildSystemPrompt, type SessionStartPrompt } from './system-prompt'
import { parseEnvelope, parseEnvelopeObject } from './envelope'
import type { TurnEnvelope } from './envelope'
import type { LearningProfile } from './profile'
import type { PageContext } from './page-context'

export type { TurnEnvelope } from './envelope'

export type TurnMessage = {
  role: 'user' | 'assistant'
  content: string
}

const MODEL = 'claude-haiku-4-5-20251001'
const MAX_TOKENS = 600 // PLAN.md §2.5 per-turn response budget

function createClient(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY

  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY is not set — the Claude proxy cannot run without it.')
  }

  return new Anthropic({ apiKey })
}

// Sprint 14 Task 10 live-find: a real acceptance session showed the model
// (relied on, until now, to voluntarily include "assessment"/
// "solution_progress" in a freeform JSON reply per system-prompt.ts's OUTPUT
// FORMAT text) satisficing with a bare `{ "say": "..." }` on nearly every
// turn of a long, scaffolded Socratic exchange -- confirmed live and by
// direct reproduction against the running route. Prompt wording alone (a
// "BEFORE YOU ANSWER" checklist) only partially closed the gap (~50%
// compliance on live re-testing). The reliable fix is to stop ASKING for
// the shape in prose and instead FORCE it: a tool call with `strict: true`
// (Anthropic's guaranteed schema validation, not a prompt nudge) makes
// "assessment"/"solution_progress"/"annotations"/"profile_tags" required
// top-level keys the model cannot simply skip -- an empty annotations/
// profile_tags array is a valid, honest "nothing here", but omitting the
// key entirely is no longer an option. This is what unfreezes claude.ts
// for this sprint (was listed out-of-scope in the Files-in-scope section;
// amended the same day this was found -- see "What the next sprint needs
// to know").
//
// "session" is deliberately left OUTSIDE `required`: it must stay a rare,
// genuinely-absent-most-of-the-time field (ADR-027 Decision 1 -- "a dropped
// completion is a non-close, the safe failure"), and forcing the model to
// decide complete-or-not on every single turn risks nudging false closes
// where today it correctly says nothing. Same reasoning for "mode", which
// stays required (low-stakes, binary, no false-close risk).
//
// The input's keys are deliberately the same snake_case shape
// system-prompt.ts's OUTPUT FORMAT already taught the model and
// envelope.ts's parseEnvelopeObject already expects -- one shared shape,
// two entry points (this tool-forced path, and parseEnvelope's legacy
// freeform-JSON-in-text path kept for runTutorTurnStream's plain-text
// callers and as the degrade-to-text fallback below).
// A nullable-string-enum field, e.g. a concept_key constrained to the known
// curriculum keys or null. `type: ['string','null']` combined with an enum
// containing real string values is REJECTED by Anthropic's `strict: true`
// validator ("Enum value ... does not match declared type", confirmed
// empirically against the live API while building this) -- `anyOf` is the
// form that actually validates.
function nullableEnum(values: readonly string[]) {
  return { anyOf: [{ type: 'string', enum: values as string[] }, { type: 'null' }] } as const
}

const NULLABLE_STRING = { anyOf: [{ type: 'string' }, { type: 'null' }] } as const

const ASSESSMENT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  description:
    'Your grading of the STUDENT\'s last message. Required on every turn -- including a short, ' +
    'partial, or yes/no answer, which is still something to grade. Only on the very first turn of ' +
    'a brand-new conversation (nothing yet to assess) should this read as a placeholder: ' +
    'concept_key null, outcome "none", reasoning_quality "none", confidence "low".',
  properties: {
    concept_key: { ...nullableEnum(CONCEPT_KEYS), description: 'One of the known curriculum keys, or null if none fits clearly.' },
    outcome: { type: 'string', enum: ['correct', 'incorrect', 'partial', 'none'] },
    reasoning_quality: { type: 'string', enum: ['sound', 'shallow', 'none'] },
    self_confidence: {
      type: 'string',
      enum: ['low', 'med', 'high', 'unknown'],
      description: "The STUDENT's apparent certainty (not your own).",
    },
    misconception_category: NULLABLE_STRING,
    misconception_description: NULLABLE_STRING,
    confidence: { type: 'string', enum: ['low', 'med', 'high'], description: 'YOUR confidence in this assessment.' },
  },
  required: [
    'concept_key',
    'outcome',
    'reasoning_quality',
    'self_confidence',
    'misconception_category',
    'misconception_description',
    'confidence',
  ],
} as const

const ANNOTATION_ITEM_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'string' },
    type: { type: 'string', enum: ['highlight', 'circle', 'arrow', 'label', 'step-indicator'] },
    target: {
      type: 'object',
      additionalProperties: false,
      properties: {
        kind: { type: 'string', enum: ['selector', 'bbox', 'textMatch'] },
        text: {
          type: 'string',
          description: 'Copied EXACTLY (same characters, same spacing) from PAGE CONTEXT. Never invented.',
        },
      },
      required: ['kind', 'text'],
    },
    style: {
      type: 'object',
      additionalProperties: false,
      properties: { color: { type: 'string', enum: ['amber', 'blue', 'green', 'red'] } },
      required: ['color'],
    },
    label: {
      type: 'string',
      description:
        'REQUIRED on every annotation -- no naked shapes. Verb-first, 4 words or fewer, naming WHAT ' +
        'the mark points at (e.g. "Split this term", "Same factor, twice").',
    },
    note: {
      type: 'string',
      description:
        'Optional why-note shown under the label: answers WHY this mark matters, 90 characters or ' +
        'fewer (e.g. "Both groups share (x - 3) -- that is the signal that grouping worked."). ' +
        'Include one whenever there is a genuine why; if you cannot say why the mark matters, ' +
        'reconsider the mark.',
    },
    step: { type: 'number' },
  },
  required: ['id', 'type', 'target', 'label'],
} as const

const PROFILE_TAG_ITEM_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    kind: { type: 'string', enum: ['reviewing', 'known-gap', 'due-review', 'strength', 'callback'] },
    concept_key: nullableEnum(CONCEPT_KEYS),
    label: { type: 'string', description: '4 words or fewer, student-friendly.' },
  },
  required: ['kind', 'concept_key', 'label'],
} as const

const ENVELOPE_TOOL_NAME = 'submit_tutor_turn'

const ENVELOPE_TOOL: Anthropic.Tool = {
  name: ENVELOPE_TOOL_NAME,
  description:
    'Submit your structured response for this tutoring turn. This is the ONLY way to reply -- always call it, exactly once, every turn.',
  strict: true,
  input_schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      say: {
        type: 'string',
        description:
          'The spoken/written response -- plain, natural sentences, no markdown, no LaTeX read-aloud ' +
          'gibberish; verbalize math naturally (e.g. "x squared plus three x").',
      },
      mode: { type: 'string', enum: ['socratic', 'direct'], description: 'Which mode THIS turn used.' },
      solution_progress: {
        type: 'number',
        description:
          'Your current best estimate of how far through THIS problem the student has progressed, 0 ' +
          '(just started) to 1 (fully solved) -- re-estimate fresh each turn from the whole conversation ' +
          'so far, per the SOLUTION PROGRESS rubric. Required every turn -- repeat your last estimate when ' +
          'truly nothing changed (e.g. you just asked a question); never invent movement that did not happen. ' +
          'Clamped server-side to [0,1] regardless (schema numeric bounds are not enforceable here).',
      },
      assessment: ASSESSMENT_SCHEMA,
      annotations: {
        type: 'array',
        items: ANNOTATION_ITEM_SCHEMA,
        description:
          'Zero or more annotations (at most 3 -- schema array-length bounds are not enforceable here, so ' +
          'this is a prompt-side cap only, per ANNOTATION GUIDANCE below). Use an empty array when there is ' +
          'nothing on screen worth pointing at this turn -- but annotating is the EXPECTED default whenever ' +
          '"say" names something visible in PAGE CONTEXT, not an occasional flourish.',
      },
      profile_tags: {
        type: 'array',
        items: PROFILE_TAG_ITEM_SCHEMA,
        description: 'Zero to two profile tags (see PROFILE TAGS GUIDANCE below). Empty on most turns.',
      },
      session: {
        type: 'object',
        additionalProperties: false,
        description:
          'Include this KEY ONLY on the turn that actually closes the session -- one of the three named ' +
          'end-conditions in SESSION COMPLETION below. Omit the "session" key entirely on every other turn; ' +
          'there is no "still open" value to send.',
        properties: {
          complete: { type: 'boolean', enum: [true] },
          reason: { type: 'string', enum: ['solved', 'follow-up-declined', 'follow-up-corrected'] },
        },
        required: ['complete', 'reason'],
      },
      chips: {
        type: 'array',
        items: { type: 'string' },
        description:
          'Answer chips (see ANSWER CHIPS below): 2-4 SHORT tappable answer options for the ONE question ' +
          '"say" just asked -- each 6 words or fewer, exactly one of them correct, the wrong ones plausible ' +
          'distractors (ideally the very error this student is prone to), usually "Not sure" last. The ' +
          'student taps one and it becomes their answer verbatim. Use [] when the question is open-ended ' +
          'or the turn asks no question -- never force options onto a question that deserves their own words.',
      },
      signals: {
        type: 'array',
        items: {
          type: 'string',
          enum: [
            'prediction-confirmed',
            'misconception-detected',
            'pattern-detected',
            'pattern-broken',
            'concept-understood',
            'teaching-visual',
            'teaching-decompose',
            'pace-up',
            'guidance-up',
            'guidance-down',
            'difficulty-up',
            'difficulty-down',
            'confidence-up',
            'self-caught',
          ],
        },
        description:
          'The status signals for THIS turn (see SIGNALS below) -- the student sees each as a brief pin in ' +
          'the panel header. Emit a kind WHENEVER it genuinely happened this turn: you switched to a ' +
          'visual/concrete example (teaching-visual), broke the work into smaller steps ' +
          '(teaching-decompose), picked up the pace (pace-up), stepped in with more guidance (guidance-up) ' +
          'or deliberately pulled back (guidance-down), raised or lowered difficulty ' +
          '(difficulty-up/difficulty-down); or you OBSERVED something: you spotted a NEW misconception ' +
          '(misconception-detected), confirmed one the student has shown before (prediction-confirmed), ' +
          'noticed a recurring error pattern (pattern-detected) or saw them stop making one (pattern-broken), ' +
          'saw a key concept click (concept-understood), saw their confidence rise (confidence-up), or the ' +
          'student caught their OWN mistake before you pointed it out (self-caught). Most turns carry one or ' +
          'two; use [] only when truly none apply. Never emit a kind that did not actually happen.',
      },
    },
    required: ['say', 'mode', 'solution_progress', 'assessment', 'annotations', 'profile_tags', 'signals', 'chips'],
  },
  // Deliberately a turn WITH a real annotation, not an empty-array one --
  // Sprint 14 Task 10 live-find: annotating stayed under-used even after
  // this tool-forced schema fixed assessment/solution_progress compliance,
  // and a worked example showing an empty array risks anchoring the model
  // toward that as the safe default. This example's `say` also reuses its
  // annotation's `target.text` verbatim ("the t squared terms" doesn't
  // appear here -- the exact substring "5t^2" does), demonstrating the
  // color-link discipline (ADR-029) in the same example.
  input_examples: [
    {
      say: 'Look at the two t-squared terms — 5t^2 and 8t^2. Can you add them together?',
      mode: 'socratic',
      solution_progress: 0.2,
      assessment: {
        concept_key: 'algebra.polynomials.expanding',
        outcome: 'none',
        reasoning_quality: 'none',
        self_confidence: 'unknown',
        misconception_category: null,
        misconception_description: null,
        confidence: 'low',
      },
      annotations: [
        {
          id: 'a1',
          type: 'highlight',
          target: { kind: 'textMatch', text: '5t^2' },
          label: 'Add these like terms',
          note: 'Both are t² terms, so their coefficients (5 and 8) add directly.',
        },
        { id: 'a2', type: 'highlight', target: { kind: 'textMatch', text: '8t^2' }, style: { color: 'blue' }, label: 'Same power here' },
      ],
      profile_tags: [],
      signals: ['concept-understood'],
      // A question with a small, short answer set carries chips (design 8a):
      // one correct, one distractor aimed at a real misconception (13t^4 =
      // "add the exponents too"), and the honest opt-out last.
      chips: ['13t^2', '13t^4', 'Not sure'],
    },
  ],
}

// The session-start kickoff's OWN forced tool (live-find, this sprint):
// ENVELOPE_TOOL's `say` is a single open string, and `strict: true` only
// guarantees the ENVELOPE's SHAPE (assessment/annotations/etc. exist) --
// nothing constrains the WORDING inside `say` itself. A live session-start
// call reproduced exactly that gap: the model, asked in prose (SESSION START
// MODE) to compose one `say` string that both puts the problem up and asks a
// question without greeting or echoing the confirmation, instead wrote BOTH
// a greeting line (mirroring OPENING SCAN MODE's own worked example) AND a
// paraphrase of the confirmed sticking point recast in the student's voice
// -- a fabricated-sounding turn baked into one `say` string, invisible to
// ENVELOPE_TOOL's schema since `say` validates as long as it's a string.
// Sprint 14 Task 10's own precedent (prose nudges alone plateaued at ~50%
// compliance) says the reliable fix is the same one used there: stop asking
// for the right WORDING in prose and instead narrow the SLOT so there's
// nowhere for the wrong wording to hide. `board_text` can only be the bare
// math (a greeting sentence looks obviously wrong sitting in a field
// described as "no sentence, no punctuation but the math"); `opening_question`
// can only be the tutor's own next question (there is no field shaped like
// "what the student said" for an echoed confirmation to land in). The server
// assembles the displayed `say` deterministically from the two -- the model
// never gets to hand back one free-form paragraph for this turn.
const SESSION_START_TOOL_NAME = 'submit_session_start_turn'

const SESSION_START_TOOL: Anthropic.Tool = {
  name: SESSION_START_TOOL_NAME,
  description:
    'Submit your response for this SESSION START turn -- the first turn after the student confirmed ' +
    'the detected problem and sticking point on the check-in card (no student message exists yet). ' +
    'This is the ONLY way to reply -- always call it, exactly once.',
  strict: true,
  input_schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      board_text: {
        type: 'string',
        description:
          'ONLY the problem restated in plain calculator notation (e.g. "20 - 6 + 4k = 2 - 2k"). No ' +
          'sentence, no greeting, no question, no punctuation beyond the math itself -- the server wraps ' +
          'this in the $$ ... $$ board display, so do not add your own $$ delimiters or any surrounding ' +
          'words here.',
      },
      opening_question: {
        type: 'string',
        description:
          'The ONE Socratic question or micro-step YOU, the tutor, ask this turn -- in your own voice, ' +
          'addressed TO the student, aimed straight at the confirmed sticking point. Never a greeting or ' +
          're-confirmation ("Looks like you\'re working on... is that what you need help with?" -- that ' +
          'already happened on the check-in card, do not repeat it here). Never a restatement of the ' +
          'confirmation AS IF the student said it (e.g. "I\'m working on... the part that trips me up ' +
          'is..." -- the student never typed or said those words, they tapped a button; writing them in ' +
          'first person here fabricates a line they never spoke). Just your next question, nothing else.',
      },
      annotations: {
        type: 'array',
        items: ANNOTATION_ITEM_SCHEMA,
        description:
          'Zero or more annotations framing the problem on the page (at most 3, per ANNOTATION GUIDANCE ' +
          'above). Use an empty array when PAGE CONTEXT has nothing to point at.',
      },
    },
    required: ['board_text', 'opening_question', 'annotations'],
  },
  input_examples: [
    {
      board_text: 'F = m*a',
      opening_question: 'The mass is in grams -- what does it need to be in first?',
      annotations: [
        {
          id: 'a1',
          type: 'highlight',
          target: { kind: 'textMatch', text: 'F = ma' },
          label: 'Start with units',
          note: 'Every quantity must be in SI units before you plug in.',
        },
      ],
    },
  ],
}

// Deterministic backstop for the session-start kickoff's `opening_question`
// (2nd live-find, same failure family): the board_text/opening_question
// split narrows WHERE a fabricated turn or a greeting can hide, but neither
// field has a length or shape limit, so a still-misbehaving model can write
// an entire multi-paragraph fake dialogue -- greeting, echoed "student"
// reply, AND a follow-up tutor reply -- all inside the one opening_question
// string, which then sails through the schema untouched (it's still just a
// valid string). A live re-test reproduced exactly this: three paragraphs,
// one crammed into what should have been a single question. There is no
// reliable PROMPT-ONLY fix for an unconstrained free-text field (this
// codebase's own Sprint 14 Task 10 precedent), so this is the actual
// backstop: reject on sight, retry once, and if the retry ALSO fails, swap
// in text built entirely from the confirmed sessionStart data -- zero model
// text -- so a session start can never again put more than one clean
// question on screen, no matter how badly the model misbehaves.
const FABRICATED_TURN_PATTERNS = [
  /\bis that what you need help with\b/i,
  /\blooks like you'?re working on\b/i,
  /\bi'?m working on\b/i,
  /\btrips? me up\b/i,
  /\bcan we start there\b/i,
]
const MAX_OPENING_QUESTION_CHARS = 320 // generous slack over PEDAGOGY's ~60-word/3-sentence bound

function isCleanOpeningQuestion(text: string): boolean {
  if (text.length === 0 || text.length > MAX_OPENING_QUESTION_CHARS) return false
  if (FABRICATED_TURN_PATTERNS.some((pattern) => pattern.test(text))) return false
  // A blank line between paragraphs, or more than a few sentence-ending
  // marks, is the actual shape of a multi-turn dialogue rather than the
  // required single question/micro-step -- catches the failure shape even
  // if the wording doesn't match one of the known phrases above.
  if (/\n\s*\n/.test(text)) return false
  const terminalPunctuation = text.match(/[.?!]/g) ?? []
  if (terminalPunctuation.length > 3) return false
  return true
}

// The zero-model-text fallback: grounded ONLY in what the student actually
// confirmed on the check-in card (the same data SESSION START MODE renders),
// never a guess and never anything that could itself read as fabricated.
function fallbackOpeningQuestion(start: SessionStartPrompt): string {
  return start.stickingPoint
    ? `Let's start right at "${start.stickingPoint}" -- walk me through your first step there.`
    : `Let's start with the first step -- walk me through how you'd begin.`
}

// Assembles a SESSION_START_TOOL call into the same TurnEnvelope shape every
// other turn kind produces, so completeTurn/persistence downstream never
// needs to know this turn used a different tool. `say` is built HERE,
// server-side, by concatenating the two narrow fields -- never taken as a
// single string from the model -- which is the actual fix (narrowing the
// slot, not just asking nicer): there is no field left for a greeting or an
// echoed confirmation to hide in. `opening_question` additionally passes
// through the isCleanOpeningQuestion backstop above before it ever gets
// here (runSessionStartTool, below) -- by the time this function sees it,
// it's already been validated or replaced. The rest of the envelope is the
// fixed very-first-turn placeholder SESSION START MODE already specifies
// (nothing to grade or signal yet), reused via parseEnvelopeObject so
// annotations get the exact same defensive validation (allowlisted target
// kinds, the 3-cap) every other turn's annotations get. Returns undefined
// only when `opening_question` (post-validation) is somehow still blank --
// the one field a session-start reply cannot do without.
function assembleSessionStartEnvelope(boardText: string, openingQuestion: string, rawAnnotations: unknown): TurnEnvelope | undefined {
  if (!openingQuestion) {
    return undefined
  }

  return parseEnvelopeObject({
    say: boardText ? `$$${boardText}$$ ${openingQuestion}` : openingQuestion,
    mode: 'socratic',
    solution_progress: 0,
    assessment: {
      concept_key: null,
      outcome: 'none',
      reasoning_quality: 'none',
      self_confidence: 'unknown',
      misconception_category: null,
      misconception_description: null,
      confidence: 'low',
    },
    annotations: rawAnnotations,
    profile_tags: [],
    signals: [],
  })
}

// Runs the session-start kickoff's forced tool call, with the retry +
// deterministic-fallback backstop described above. Isolated from
// runTutorTurn's main body (below) because it owns its own retry loop --
// the only turn kind that does, since it's the only one with a zero-model-
// text fallback to reach for.
async function runSessionStartTool({
  messages,
  pageContext,
  profile,
  sessionStart,
}: {
  messages: TurnMessage[]
  pageContext?: PageContext
  profile: LearningProfile
  sessionStart: SessionStartPrompt
}): Promise<TurnEnvelope> {
  const system = buildSystemPrompt(profile, pageContext, { format: 'envelope', sessionStart })

  const call = () =>
    createClient().messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system,
      messages,
      tools: [SESSION_START_TOOL],
      tool_choice: { type: 'tool', name: SESSION_START_TOOL_NAME },
    })

  let boardText = ''
  let openingQuestion = ''
  let annotations: unknown = []

  for (let attempt = 0; attempt < 2 && !isCleanOpeningQuestion(openingQuestion); attempt++) {
    const response = await call()
    const toolUse = response.content.find(
      (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use' && block.name === SESSION_START_TOOL_NAME
    )
    if (!toolUse || typeof toolUse.input !== 'object' || toolUse.input === null) break

    const input = toolUse.input as Record<string, unknown>
    boardText = typeof input.board_text === 'string' ? input.board_text.trim() : ''
    openingQuestion = typeof input.opening_question === 'string' ? input.opening_question.trim() : ''
    annotations = input.annotations
  }

  if (!isCleanOpeningQuestion(openingQuestion)) {
    openingQuestion = fallbackOpeningQuestion(sessionStart)
    // A board_text that arrived alongside a rejected opening_question is
    // still independently useful (it's validated separately, just for
    // length/pattern here too, out of the same abundance of caution) -- but
    // never invent one when the model gave nothing at all.
    if (boardText.length > MAX_OPENING_QUESTION_CHARS || FABRICATED_TURN_PATTERNS.some((p) => p.test(boardText))) {
      boardText = ''
    }
    annotations = []
  }

  return assembleSessionStartEnvelope(boardText, openingQuestion, annotations) ?? { say: fallbackOpeningQuestion(sessionStart) }
}

// Non-streaming turn — used by /api/ai/turn (the live overlay path) and
// voice synthesis where the full reply is needed before TTS can start.
// Forces the model to reply through ENVELOPE_TOOL (`strict: true` --
// Anthropic-guaranteed schema validation, Sprint 14 Task 10 live-find,
// replacing the freeform "return a single JSON object" text contract for
// this call site). parseEnvelopeObject re-runs the same semantic checks
// (concept_key allowlist, bbox shape, array caps) the schema doesn't cover.
// A missing tool_use block (a refusal, a network/SDK edge case) falls back
// to any text block through the legacy parseEnvelope degrade path, so a
// turn is never blanked (ADR-019) even in that unlikely case.
export async function runTutorTurn({
  messages,
  pageContext,
  profile,
  sessionStart,
}: {
  messages: TurnMessage[]
  pageContext?: PageContext
  profile: LearningProfile
  // The session-start kickoff's confirmed check-in data (the route parses
  // it from the request's structured sessionStart field): threads into the
  // prompt as the SESSION START MODE block. On that turn `messages` is the
  // route-built placeholder -- there is no student message.
  sessionStart?: SessionStartPrompt
}): Promise<TurnEnvelope> {
  // The session-start kickoff calls its OWN forced tool AND its own retry +
  // deterministic-fallback backstop (see runSessionStartTool above) --
  // ENVELOPE_TOOL's open `say` string, and an unvalidated opening_question,
  // are exactly the two live-finds traced the fabricated-turn bug to, so
  // this turn kind never gets access to either.
  if (sessionStart) {
    return runSessionStartTool({ messages, pageContext, profile, sessionStart })
  }

  const response = await createClient().messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: buildSystemPrompt(profile, pageContext, { format: 'envelope' }),
    messages,
    tools: [ENVELOPE_TOOL],
    tool_choice: { type: 'tool', name: ENVELOPE_TOOL_NAME },
  })

  const toolUse = response.content.find(
    (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use' && block.name === ENVELOPE_TOOL_NAME
  )

  if (toolUse && typeof toolUse.input === 'object' && toolUse.input !== null) {
    const envelope = parseEnvelopeObject(toolUse.input as Record<string, unknown>)
    if (envelope) {
      return envelope
    }
  }

  const textBlock = response.content.find((block) => block.type === 'text')
  const raw = textBlock?.type === 'text' ? textBlock.text : ''

  return parseEnvelope(raw)
}

// --- Streamed-envelope turn (Sprint 15 voice follow-on, ADR-033 amendment) ---
// The voice path needs BOTH the spoken text incrementally (to start per-
// sentence TTS before the turn finishes -- the ~4-5s leg the latency probe
// found) AND the full validated envelope (assessment/annotations/tags for
// persistence). We get both from ONE forced-tool call by streaming its
// `input_json_delta`: because `say` is the FIRST property in
// ENVELOPE_TOOL.input_schema, its value streams before the structured fields,
// so we can extract the growing `say` string as it arrives and hand the
// COMPLETE tool input (via finalMessage()) to parseEnvelopeObject at the end.
// This is the "streaming envelope" the plan repeatedly deferred; it does NOT
// revert to freeform text (Sprint 14 Task 10 proved that drops the
// assessment) -- the strict tool schema still guarantees the shape.

/**
 * Incrementally extracts the value of the FIRST-emitted `say` string field
 * from a forced-tool call's streamed `input_json_delta` fragments. Pure and
 * escape-aware: `push(fragment)` returns the NEWLY-decoded characters of `say`
 * (a possibly-empty delta), never re-emitting what a prior call already
 * returned. An incomplete trailing escape (`\` or a half-written `\uXXXX`) at a
 * fragment boundary yields '' and is completed on the next fragment rather than
 * corrupting the output. Returns '' forever once the closing quote is seen.
 *
 * Exported for unit testing (voice follow-on) against recorded fragment
 * sequences; not exported as a class so the test pins behavior, not shape.
 */
export function createSayExtractor(): { push: (fragment: string) => string } {
  let buffer = ''
  let started = false
  let valueStart = -1
  let emitted = ''
  let complete = false

  return {
    push(fragment: string): string {
      buffer += fragment
      if (complete) return ''

      if (!started) {
        const match = buffer.match(/"say"\s*:\s*"/)
        if (!match || match.index === undefined) return ''
        started = true
        valueStart = match.index + match[0].length
      }

      let raw = ''
      let closed = false
      for (let i = valueStart; i < buffer.length; i++) {
        const ch = buffer[i]
        if (ch === '\\') {
          if (i + 1 < buffer.length) {
            raw += ch + buffer[i + 1]
            i++
            continue
          }
          break // lone trailing backslash -- wait for the escaped char
        }
        if (ch === '"') {
          closed = true
          break
        }
        raw += ch
      }

      let decoded: string
      try {
        decoded = JSON.parse('"' + raw + '"') as string
      } catch {
        return '' // trailing incomplete \uXXXX etc -- wait for the next fragment
      }

      if (closed) complete = true
      if (decoded.length <= emitted.length) return ''
      const delta = decoded.slice(emitted.length)
      emitted = decoded
      return delta
    },
  }
}

export type EnvelopeStreamEvent =
  | { type: 'sayDelta'; text: string }
  | { type: 'envelope'; envelope: TurnEnvelope }

/**
 * Streaming sibling of runTutorTurn: same forced-tool ENVELOPE_TOOL call, but
 * via messages.stream(). Yields `sayDelta` events as the spoken text streams,
 * then exactly one terminal `envelope` event carrying the full validated
 * TurnEnvelope assembled from the complete tool input (parseEnvelopeObject on
 * finalMessage()). Falls back to the legacy text degrade (parseEnvelope) if the
 * tool block is absent/unparseable, so a turn is never blanked (ADR-019). The
 * caller (the /api/ai/turn/stream route) reuses completeTurn on the terminal
 * envelope, so persistence/pings/grounding are identical to /api/ai/turn.
 */
export async function* runTutorTurnEnvelopeStream({
  messages,
  pageContext,
  profile,
}: {
  messages: TurnMessage[]
  pageContext?: PageContext
  profile: LearningProfile
}): AsyncGenerator<EnvelopeStreamEvent> {
  const stream = createClient().messages.stream({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: buildSystemPrompt(profile, pageContext, { format: 'envelope' }),
    messages,
    tools: [ENVELOPE_TOOL],
    tool_choice: { type: 'tool', name: ENVELOPE_TOOL_NAME },
  })

  const extractor = createSayExtractor()

  for await (const event of stream) {
    if (event.type === 'content_block_delta' && event.delta.type === 'input_json_delta') {
      const delta = extractor.push(event.delta.partial_json)
      if (delta) yield { type: 'sayDelta', text: delta }
    }
  }

  const final = await stream.finalMessage()

  const toolUse = final.content.find(
    (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use' && block.name === ENVELOPE_TOOL_NAME
  )

  let envelope: TurnEnvelope | null = null
  if (toolUse && typeof toolUse.input === 'object' && toolUse.input !== null) {
    envelope = parseEnvelopeObject(toolUse.input as Record<string, unknown>) ?? null
  }

  if (!envelope) {
    const textBlock = final.content.find((block) => block.type === 'text')
    const raw = textBlock?.type === 'text' ? textBlock.text : ''
    envelope = parseEnvelope(raw)
  }

  yield { type: 'envelope', envelope }
}

// Streaming turn — used by /api/ai/stream. Yields text deltas as they
// arrive from the Anthropic streaming API so the client can render
// word-by-word. The full reply is assembled by the caller.
export async function* runTutorTurnStream({
  messages,
  pageContext,
  profile,
}: {
  messages: TurnMessage[]
  pageContext?: PageContext
  profile: LearningProfile
}): AsyncGenerator<string> {
  const stream = createClient().messages.stream({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: buildSystemPrompt(profile, pageContext),
    messages,
  })

  for await (const event of stream) {
    if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
      yield event.delta.text
    }
  }
}
