import 'server-only'
import Anthropic from '@anthropic-ai/sdk'
import { CONCEPT_KEYS } from '@calyxa/curriculum'
import { buildSystemPrompt } from './system-prompt'
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
    label: { type: 'string', description: '5 words or fewer; omit if it adds nothing new.' },
    step: { type: 'number' },
  },
  required: ['id', 'type', 'target'],
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
    },
    required: ['say', 'mode', 'solution_progress', 'assessment', 'annotations', 'profile_tags'],
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
        { id: 'a1', type: 'highlight', target: { kind: 'textMatch', text: '5t^2' } },
        { id: 'a2', type: 'highlight', target: { kind: 'textMatch', text: '8t^2' }, style: { color: 'blue' } },
      ],
      profile_tags: [],
    },
  ],
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
}: {
  messages: TurnMessage[]
  pageContext?: PageContext
  profile: LearningProfile
}): Promise<TurnEnvelope> {
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
