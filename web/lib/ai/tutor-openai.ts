import 'server-only'
import OpenAI from 'openai'
import { CONCEPT_KEYS } from '@calyxa/curriculum'
import {
  ENVELOPE_TOOL,
  SESSION_START_TOOL,
  OPENING_SCAN_TOOL,
  OPENING_SCAN_PLACEHOLDER_MESSAGE,
  createSayExtractor,
  isCleanOpeningQuestion,
  fallbackOpeningQuestion,
  assembleSessionStartEnvelope,
  FABRICATED_TURN_PATTERNS,
  MAX_OPENING_QUESTION_CHARS,
  type TurnMessage,
  type EnvelopeStreamEvent,
  type OpeningScanResult,
} from './claude'
import { toOpenAIFunctionTool } from './openai-schema'
import { buildSystemPrompt, type SessionStartPrompt, type PromptOpts } from './system-prompt'
import { parseEnvelope, parseEnvelopeObject, type TurnEnvelope } from './envelope'
import type { LearningProfile } from './profile'
import type { PageContext } from './page-context'

// Sprint 24 (ADR-038) — the OpenAI GPT-4o-mini implementation of the tutor
// turn, behind the same TutorProvider seam as Anthropic, re-ported onto the
// forced-tool pipeline (ENVELOPE_TOOL turns with chips/signals, the
// SESSION_START_TOOL kickoff with its retry + zero-model-text backstop, the
// OPENING_SCAN_TOOL scan with curriculum classification). Structurally mirrors
// claude.ts call-for-call so the ONLY differences are provider mechanics
// (system-as-message, function-tool shape, JSON-string tool args, stream event
// plumbing) — envelope semantics stay in the shared, provider-neutral
// parseEnvelope/parseEnvelopeObject, and the session-start backstop helpers are
// claude.ts's own exports, not copies. ADR-052: this IS the default provider;
// the Anthropic path runs only on the TUTOR_PROVIDER=anthropic flip-back.

const MODEL = 'gpt-4o-mini'
const MAX_TOKENS = 600 // PLAN.md §2.5 per-turn budget (parity with the Haiku path)
const OPENING_SCAN_MAX_TOKENS = 300 // parity with claude.ts's opening scan

// Derived ONCE from the Anthropic tools (single source of truth), flipped to
// OpenAI-strict shape (nullable-enum union + all-required). See openai-schema.ts.
const ENVELOPE_FN = toOpenAIFunctionTool(ENVELOPE_TOOL)
const SESSION_START_FN = toOpenAIFunctionTool(SESSION_START_TOOL)
const OPENING_SCAN_FN = toOpenAIFunctionTool(OPENING_SCAN_TOOL)

// Exported (like claude.ts's createClient) so the study-kit generator's opt-in
// OpenAI path (web/lib/study/generate.ts, STUDY_KIT_PROVIDER) reuses the exact
// same key-checked construction instead of copying it.
export function createClient(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is not set — the OpenAI tutor provider cannot run without it.')
  }
  return new OpenAI({ apiKey })
}

// Parity with claude.ts's CALYXA_LOG_USAGE probe, so the GPT-4o-mini path can
// be measured with cost_real.py the same way the Haiku path is. Labelled
// `gpt-*` so a mixed log is unambiguous. Exported for the study-kit generator.
export function logUsage(label: string, usage: unknown): void {
  if (process.env.CALYXA_LOG_USAGE) {
    console.log(`[gpt usage:${label}]`, JSON.stringify(usage))
  }
}

function systemMessage(content: string): OpenAI.Chat.Completions.ChatCompletionMessageParam {
  return { role: 'system', content }
}

// GPT-4o-mini under-triggers annotations relative to Haiku 4.5 — the exact
// heavily-tuned-envelope regression ADR-038 flagged as the top migration risk.
// Two reasons: (1) OpenAI function tools carry no `input_examples`, so the port
// drops Haiku's deliberately annotation-heavy worked example (see
// claude.ts's ENVELOPE_TOOL.input_examples, added because "annotating stayed
// under-used"); (2) GPT-4o-mini under-weights the shared prompt's "annotating
// is the EXPECTED default" prose. This OpenAI-ONLY addendum restores both: a
// hard, checkable rule + a concrete annotated example. The Anthropic path is
// untouched (it keeps its input_examples anchor and annotates fine).
//
// TUNABLE: if the annotation rate is still off, strengthen this text and
// re-measure with the eval's "annotation grounded" row
// (EVAL_LIVE=1 npx vitest run tests/tutor-eval).
// ALL OpenAI turn kinds: hard page-grounding rule. Live-find 2026-07-17: with
// a degraded capture (no extractable math) and an ambiguous student message,
// GPT-4o-mini picked up the synthetic t-example from the prompt's worked
// examples and tutored THAT instead of the student's on-screen problem —
// repro'd 8/12 on degraded pages (tests/tutor-eval/repro-leak.test.ts). The
// few-shot-as-fake-history was the main driver (removed — see
// annotationExampleBlock below); this rule closes the rest.
const OPENAI_PAGE_GROUNDING_BOOST = `═══════════════════ THE STUDENT'S PROBLEM — PAGE CONTEXT ONLY ═══════════════════
PAGE CONTEXT above IS the student's screen — a live extraction of the page they are looking at RIGHT NOW. You DO see their problem when PAGE CONTEXT contains one; never say or imply you can't see it, and never ask what they are working on when it is right there.
- If PAGE CONTEXT shows a math problem and the student says "this problem", "help me", or asks where to start, they MEAN that on-screen problem: begin tutoring it immediately — name it, then ask your first Socratic question about its first step.
- Worked examples elsewhere in this prompt (anything using the variable t, e.g. "5t^2 - 6t + 8t^2 - 8t") are SYNTHETIC ILLUSTRATIONS of reply format — they are NEVER the student's problem. Never mention, quote, annotate, or work on an example's expressions unless PAGE CONTEXT literally contains them.
- Only when PAGE CONTEXT contains no identifiable math AND the conversation has not stated the problem: ASK the student to say or show the problem. Never guess one, never substitute an example problem from this prompt, and never refer to "your expression/equation" or propose candidate steps (e.g. "combining like terms or factoring?") for a problem you have not seen — just ask for it.`

const OPENAI_ANNOTATION_BOOST = `═══════════════════ ANNOTATION — APPLY EVERY TURN ═══════════════════
Annotating is the DEFAULT, not optional and not only for special turns:
- If your "say" names, points at, works with, or reasons about ANY equation, expression, term, exponent, coefficient, number, or step that appears in PAGE CONTEXT, you MUST include at least one annotation for it THIS turn.
- Copy the referenced text EXACTLY into the annotation's target.text (kind "textMatch"), and reuse that same exact substring inside "say" so the phrase and the box share a color.
- Prefer "highlight". Use "underline" for an inline word/phrase inside prose (a hint or condition in the problem statement). Point at the SPECIFIC part, not the whole equation. Up to 3 annotations; each needs a verb-first "label" (4 words or fewer).
- Return an empty annotations array ONLY when PAGE CONTEXT is empty or your "say" genuinely references nothing on screen. Referencing something visible and returning no annotation is a mistake.
Example (annotations present, NOT empty): PAGE CONTEXT contains "5t^2 - 6t + 8t^2 - 8t" and your "say" is "Combine the two t-squared terms: $$5t^2 + 8t^2 = 13t^2$$" — then annotations MUST include {"id":"a1","type":"highlight","target":{"kind":"textMatch","text":"5t^2"},"label":"Add these like terms"} and a second one whose target.text is "8t^2".`

// Regular mid-conversation turns only: session-close discipline. GPT-4o-mini
// offers an open-ended "want to keep going?" after a correct final answer
// instead of closing, so the app's congratulation + end-summary screen (driven
// by the `session` object) never fires. Anthropic follows the shared SESSION
// COMPLETION block without this; GPT needs it restated as a hard directive.
const OPENAI_SESSION_CLOSE_BOOST = `═══════════════════ CLOSING THE SESSION ═══════════════════
When the student produces the CORRECT final answer to the problem, that IS the "solved" close condition — act on it:
- Set "session": { "complete": true, "reason": "solved" }.
- End "say" with this EXACT final sentence: "Now closing tutoring session."
- Do NOT instead ask an open-ended "do you want to keep working on this / are you all set?" after a correct final answer. Closing is the correct move — the app then shows the congratulations + summary from the "session" object.
- NEVER offer additional problems — no "want to try another one?", "shall we do more questions?", "would you like more practice?", or inventing a new exercise. Not at the close and not mid-session: this session covers the ONE on-screen problem, and the app itself handles follow-up practice after the close (generated study materials).
Leave "session" null ONLY while the problem is NOT yet solved. Never close speculatively mid-problem.`

// Regular turns only: GPT-4o-mini under-offers answer chips relative to Haiku
// (Darcy live-find 2026-07-17) — the shared ANSWER CHIPS contract already says
// "offer chips whenever the turn ends in one small-answer-set question", but
// GPT leaves chips empty on most such turns. Restated as a hard default, the
// same treatment as the annotation boost.
const OPENAI_CHIPS_BOOST = `═══════════════════ ANSWER CHIPS — OFFER THEM BY DEFAULT ═══════════════════
If your "say" ends in ONE question whose expected answer is SHORT and comes from a small set — a value ("13x^2"), a pair ("-2 and -3"), a sign, a rule or method choice, the name of the next step, or a yes/no fork — you MUST fill "chips" THIS turn. Leaving chips empty on a small-answer question is a mistake.
- 2 to 4 options, each 6 words or fewer, plain calculator notation (x^2, sqrt(x)) — never LaTeX, never $$.
- EXACTLY ONE is correct. Wrong options must be PLAUSIBLE distractors — ideally this student's own active misconceptions (see STUDENT PROFILE), so a wrong tap tells you which error fired.
- Usually end with "Not sure" as the honest opt-out.
- "say" must stand alone and never mention the options or say "tap one".
- Leave chips empty ONLY for genuinely open-ended questions ("walk me through it", "why do you think that"), multi-part questions (those take "answer_fields"), or a closing turn.`

// Opening scan only: GPT-4o-mini is over-conservative about committing to a
// problem it can see — under the forced OPENING_SCAN_TOOL that surfaces as
// problem_found:false (or a found:true with an empty say), which suppresses
// the extension's check-in card entirely. Push GPT to commit when a problem
// is clearly present, and to classify it against the curriculum enum.
const OPENAI_OPENING_SCAN_BOOST = `═══════════════════ NAME THE PROBLEM ═══════════════════
PAGE CONTEXT below usually shows a concrete math problem. If you can see a specific problem in it, set problem_found to true, NAME IT confidently in one line in "say" ("Looks like you're working on ..."), and fill concept_key (or topic_title when no curriculum key fits). Do not hedge and do not return problem_found:false merely because you are unsure. Return problem_found:false ONLY when PAGE CONTEXT genuinely contains no identifiable math problem at all.`

// The system message for every envelope-producing OpenAI turn: the shared
// prompt + the OpenAI-only booster(s) appropriate to the turn kind.
// Renders the grounding boost with the page's own extracted equations quoted
// INLINE. Prose rules alone ("engage with the PAGE CONTEXT problem") moved
// GPT-4o-mini to only ~1/3 first-turn engagement vs Haiku's 2/2 — restating
// the actual math right inside the instruction is the structural fix: the
// model can't claim not to see it. On the FIRST student turn of a session it
// additionally gets a hard first-reply rule (engage + annotate NOW), the
// Haiku-parity behavior Darcy asked for (2026-07-17).
function pageGroundingBoost(pageContext: PageContext | undefined, firstStudentTurn: boolean): string {
  const equations = (pageContext?.equations ?? [])
    .slice(0, 3)
    .map((e) => e.text?.trim() || e.latex?.trim())
    .filter((t): t is string => !!t)
  const problemLine = equations.length
    ? `\nThe student's screen RIGHT NOW contains this math (verbatim from PAGE CONTEXT): ${equations
        .map((t) => `"${t}"`)
        .join('  |  ')}`
    : ''
  const firstReply =
    firstStudentTurn && equations.length
      ? `\nFIRST REPLY RULE: this is your first reply of the session and the problem is already on screen (quoted above). Do NOT ask what the student is working on. Your reply MUST (1) name that on-screen problem, (2) ask your first Socratic question about its first step, and (3) include at least one annotation whose target.text is copied EXACTLY from the on-screen math above.`
      : ''
  return `${OPENAI_PAGE_GROUNDING_BOOST}${problemLine}${firstReply}`
}

function envelopeSystem(
  profile: LearningProfile,
  pageContext: PageContext | undefined,
  opts: PromptOpts,
  firstStudentTurn = false
): string {
  const boosts = [OPENAI_ANNOTATION_BOOST]
  if (opts.opening) boosts.push(OPENAI_OPENING_SCAN_BOOST)
  else if (!opts.sessionStart) {
    boosts.push(annotationExampleBlock()) // regular mid-conversation turns
    boosts.push(OPENAI_CHIPS_BOOST)
    boosts.push(OPENAI_SESSION_CLOSE_BOOST)
  }
  // Grounding + the pre-submit checklist LAST: GPT-4o-mini weights the tail
  // of a long system prompt hardest — the grounding rule keeps it on the
  // student's actual problem (the wrong-problem live-find), and the checklist
  // is what actually moves compliance on chips/close (the mid-prompt prose
  // versions of the same rules were measurably ignored).
  boosts.push(pageGroundingBoost(pageContext, firstStudentTurn))
  if (!opts.opening && !opts.sessionStart) boosts.push(OPENAI_FINAL_CHECKLIST)
  return `${buildSystemPrompt(profile, pageContext, opts)}\n\n${boosts.join('\n\n')}`
}

// Regular turns: the last thing GPT reads before composing the tool call.
// Each line is a mechanical yes/no check on a field it is about to emit —
// restating (not replacing) the ANNOTATION / CHIPS / CLOSING boosts above,
// because GPT-4o-mini follows a tail-position checklist far more reliably
// than the same rules stated mid-prompt (live-measured 2026-07-17: chips
// went 0/3 → re-test after adding this).
const OPENAI_FINAL_CHECKLIST = `═══════════════════ BEFORE YOU SUBMIT — CHECK EVERY LINE ═══════════════════
1. Does "say" name or work with anything visible in PAGE CONTEXT? → "annotations" must include it (target.text copied exactly).
2. Does "say" end in ONE question whose answer is a short value, pair, sign, rule/method choice, next step, or yes/no? → "chips" MUST contain 2–4 options (exactly one correct, plausible distractors, usually "Not sure" last). Submitting empty chips on such a question is an ERROR.
3. Did the student just give the CORRECT final answer? → set "session": {"complete": true, "reason": "solved"} and end "say" with "Now closing tutoring session."
4. "say" must NEVER offer another problem, more questions, or extra practice — not mid-session, not at the close.`

// The trailing per-turn reminder — an OpenAI system message appended AFTER
// the conversation, immediately before the model composes the tool call.
// GPT-4o-mini ignored both the mid-prompt chips boost AND the tail-of-system-
// prompt checklist (live-measured 0/3 twice, 2026-07-17); instructions
// adjacent to the generation point are the reliable lever. Honest (a labelled
// system reminder), unlike the removed fake-history few-shot. The grading
// line exists because GPT rejected a CORRECT final derivative 3/3 while Haiku
// accepted it 2/2 — it must recompute before judging, not pattern-match.
const OPENAI_TURN_REMINDER = `Reminders for THIS reply (submit_tutor_turn):
- If your question's answer is a short value, pair, sign, rule choice, next step, or yes/no → fill "chips" with 2–4 options (one correct, plausible distractors, "Not sure" last). Empty chips there is an error.
- Judging the student's answer: recompute it yourself term by term FIRST, then compare LITERALLY, symbol by symbol, against what the student wrote. You may only claim an error if you can quote a term the student wrote AND your differing computed value for that same term — if every term matches, the answer is CORRECT (never say "almost" or "check the coefficient" about a matching term). Stating a correct answer yourself and then telling the student — whose answer is the SAME — that they made a mistake is a forbidden contradiction. A correct final answer → also set "session": {"complete": true, "reason": "solved"} and end "say" with "Now closing tutoring session."
- Never offer another problem, more questions, or extra practice.
- Anything from PAGE CONTEXT that "say" mentions must be annotated (target.text copied exactly).`

// A "first student turn" = no assistant reply in the history yet — the session
// has page context but the tutor hasn't spoken. Only regular/stream turns use
// this; session-start and the opening scan have their own kickoff contracts.
function isFirstStudentTurn(messages: TurnMessage[]): boolean {
  return !messages.some((m) => m.role === 'assistant')
}

// Annotated worked example (regular turns) — the strongest lever for
// GPT-4o-mini's under-annotation: a DEMONSTRATED tool call WITH annotations,
// reusing ENVELOPE_TOOL's own annotated worked example (the anchor Haiku
// carries as input_examples, which OpenAI function tools can't). Prose alone
// (OPENAI_ANNOTATION_BOOST) under-moved GPT; a shown example moves it more.
//
// ⚠️ Deliberately a SYSTEM-PROMPT block, NOT fake conversation history: the
// original few-shot injected this as a user/assistant/tool exchange, and on
// degraded pages GPT continued tutoring the example's t-problem as if it were
// the real conversation (the 2026-07-17 wrong-problem live-find; repro in
// tests/tutor-eval/repro-leak.test.ts). A labelled system-prompt example keeps
// the annotation anchor without impersonating history.
// TUNABLE: remove this if it ever hurts; measure via the eval.
function annotationExampleBlock(): string {
  const example = (ENVELOPE_TOOL as { input_examples?: Record<string, unknown>[] }).input_examples?.[0]
  if (!example) return ''
  return `═══════════════════ FORMAT EXAMPLE (SYNTHETIC — NOT THE STUDENT'S PROBLEM) ═══════════════════
For a hypothetical page showing "5t^2 - 6t + 8t^2 - 8t" where the student answered "13t^2", a correct submit_tutor_turn call looks like:
${JSON.stringify(example)}
This example only demonstrates the reply format and annotation discipline. The student's ACTUAL problem is in PAGE CONTEXT above — never reuse this example's expressions.`
}

// Parses the first tool call's JSON-string arguments, or undefined. The OpenAI
// analog of claude.ts's `toolUse.input` object access — the one wire-format
// difference (JSON string vs parsed object) is absorbed here. Exported for the
// study-kit generator's OpenAI path.
export function toolCallInput(
  response: OpenAI.Chat.Completions.ChatCompletion,
  name: string
): Record<string, unknown> | undefined {
  const call = response.choices[0]?.message?.tool_calls?.find(
    (c): c is OpenAI.Chat.Completions.ChatCompletionMessageFunctionToolCall =>
      c.type === 'function' && c.function.name === name
  )
  if (!call?.function.arguments) return undefined
  try {
    const parsed = JSON.parse(call.function.arguments) as unknown
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : undefined
  } catch {
    return undefined
  }
}

// Regular mid-conversation turn — forced ENVELOPE function call, JSON-string
// args parsed then handed to the SAME parseEnvelopeObject the Anthropic path
// uses. Text-content fallback (parseEnvelope) mirrors claude.ts so a turn is
// never blanked (ADR-019).
async function runRegularTurn(
  messages: TurnMessage[],
  pageContext: PageContext | undefined,
  profile: LearningProfile
): Promise<TurnEnvelope> {
  const response = await createClient().chat.completions.create({
    model: MODEL,
    max_completion_tokens: MAX_TOKENS,
    messages: [
      systemMessage(envelopeSystem(profile, pageContext, { format: 'envelope' }, isFirstStudentTurn(messages))),
      ...messages,
      systemMessage(OPENAI_TURN_REMINDER),
    ],
    tools: [ENVELOPE_FN],
    tool_choice: { type: 'function', function: { name: ENVELOPE_TOOL.name } },
  })

  logUsage('turn', response.usage)

  const input = toolCallInput(response, ENVELOPE_TOOL.name)
  if (input) {
    const envelope = parseEnvelopeObject(input)
    if (envelope) return envelope
  }

  return parseEnvelope(response.choices[0]?.message?.content ?? '')
}

// Session-start kickoff — the OpenAI mirror of claude.ts's runSessionStartTool,
// reusing the exact same exported anti-fabrication backstop + zero-model-text
// fallback (isCleanOpeningQuestion / fallbackOpeningQuestion /
// assembleSessionStartEnvelope). Only the provider call in the loop differs.
async function runSessionStart(
  messages: TurnMessage[],
  pageContext: PageContext | undefined,
  profile: LearningProfile,
  sessionStart: SessionStartPrompt
): Promise<TurnEnvelope> {
  const system = envelopeSystem(profile, pageContext, { format: 'envelope', sessionStart })

  const call = () =>
    createClient().chat.completions.create({
      model: MODEL,
      max_completion_tokens: MAX_TOKENS,
      messages: [systemMessage(system), ...messages],
      tools: [SESSION_START_FN],
      tool_choice: { type: 'function', function: { name: SESSION_START_TOOL.name } },
    })

  let boardText = ''
  let openingQuestion = ''
  let annotations: unknown = []
  let answerFields: unknown = undefined

  for (let attempt = 0; attempt < 2 && !isCleanOpeningQuestion(openingQuestion); attempt++) {
    const response = await call()
    logUsage('session-start', response.usage)
    const input = toolCallInput(response, SESSION_START_TOOL.name)
    if (!input) break
    boardText = typeof input.board_text === 'string' ? input.board_text.trim() : ''
    openingQuestion = typeof input.opening_question === 'string' ? input.opening_question.trim() : ''
    annotations = input.annotations
    answerFields = input.answer_fields
  }

  if (!isCleanOpeningQuestion(openingQuestion)) {
    openingQuestion = fallbackOpeningQuestion(sessionStart)
    if (boardText.length > MAX_OPENING_QUESTION_CHARS || FABRICATED_TURN_PATTERNS.some((p) => p.test(boardText))) {
      boardText = ''
    }
    annotations = []
    answerFields = undefined
  }

  return (
    assembleSessionStartEnvelope(boardText, openingQuestion, annotations, answerFields) ?? {
      say: fallbackOpeningQuestion(sessionStart),
    }
  )
}

export async function runTurnOpenAI({
  messages,
  pageContext,
  profile,
  sessionStart,
}: {
  messages: TurnMessage[]
  pageContext?: PageContext
  profile: LearningProfile
  sessionStart?: SessionStartPrompt
}): Promise<TurnEnvelope> {
  if (sessionStart) {
    return runSessionStart(messages, pageContext, profile, sessionStart)
  }
  return runRegularTurn(messages, pageContext, profile)
}

// Opening scan — the OpenAI mirror of claude.ts's runOpeningScanTool: same
// forced OPENING_SCAN_TOOL (converted), same placeholder message, and the SAME
// result normalization (problem_found gate, CONCEPT_KEYS allowlist check on
// concept_key, 60-char topic_title trim, empty-say envelope on found-nothing).
export async function runOpeningScanToolOpenAI({
  pageContext,
  profile,
}: {
  pageContext: PageContext
  profile: LearningProfile
}): Promise<OpeningScanResult> {
  const response = await createClient().chat.completions.create({
    model: MODEL,
    max_completion_tokens: OPENING_SCAN_MAX_TOKENS,
    messages: [
      systemMessage(envelopeSystem(profile, pageContext, { format: 'envelope', opening: true })),
      OPENING_SCAN_PLACEHOLDER_MESSAGE,
    ],
    tools: [OPENING_SCAN_FN],
    tool_choice: { type: 'function', function: { name: OPENING_SCAN_TOOL.name } },
  })

  logUsage('opening-scan', response.usage)

  const input = toolCallInput(response, OPENING_SCAN_TOOL.name)
  if (input) {
    const problemFound = input.problem_found === true && typeof input.say === 'string' && input.say.trim().length > 0

    const envelope = parseEnvelopeObject({
      say: problemFound ? (input.say as string) : '',
      annotations: problemFound ? input.annotations : [],
      profile_tags: [],
      signals: [],
    })

    if (envelope) {
      const conceptKey =
        problemFound && typeof input.concept_key === 'string' && (CONCEPT_KEYS as readonly string[]).includes(input.concept_key)
          ? input.concept_key
          : null
      const topicTitle =
        problemFound && typeof input.topic_title === 'string' && input.topic_title.trim().length > 0
          ? input.topic_title.trim().slice(0, 60)
          : null
      return { envelope, conceptKey, topicTitle }
    }
  }

  // Degrade path: no (or unusable) tool call — fall back to any text content
  // through the legacy freeform parse, exactly as runOpeningScanTool does.
  return { envelope: parseEnvelope(response.choices[0]?.message?.content ?? ''), conceptKey: null, topicTitle: null }
}

// Streamed-envelope turn (voice path): forced ENVELOPE function call over a
// stream. createSayExtractor is provider-neutral (it scans raw JSON fragments),
// so it is reused verbatim on OpenAI's tool-arg deltas; `say` is the FIRST
// ENVELOPE property so it streams before the structured fields. The complete
// argument string is accumulated and handed to parseEnvelopeObject at the end,
// exactly like the Anthropic finalMessage() path.
export async function* runTurnEnvelopeStreamOpenAI({
  messages,
  pageContext,
  profile,
}: {
  messages: TurnMessage[]
  pageContext?: PageContext
  profile: LearningProfile
}): AsyncGenerator<EnvelopeStreamEvent> {
  const stream = await createClient().chat.completions.create({
    model: MODEL,
    max_completion_tokens: MAX_TOKENS,
    messages: [
      systemMessage(envelopeSystem(profile, pageContext, { format: 'envelope' }, isFirstStudentTurn(messages))),
      ...messages,
      systemMessage(OPENAI_TURN_REMINDER),
    ],
    tools: [ENVELOPE_FN],
    tool_choice: { type: 'function', function: { name: ENVELOPE_TOOL.name } },
    stream: true,
    stream_options: { include_usage: true },
  })

  const extractor = createSayExtractor()
  let argBuffer = ''
  let usage: unknown = undefined
  let content = ''

  for await (const chunk of stream) {
    if (chunk.usage) usage = chunk.usage
    const delta = chunk.choices[0]?.delta
    if (!delta) continue
    if (delta.content) content += delta.content
    const fragment = delta.tool_calls?.[0]?.function?.arguments
    if (fragment) {
      argBuffer += fragment
      const sayDelta = extractor.push(fragment)
      if (sayDelta) yield { type: 'sayDelta', text: sayDelta }
    }
  }

  logUsage('voice-stream', usage)

  let envelope: TurnEnvelope | null = null
  if (argBuffer) {
    try {
      envelope = parseEnvelopeObject(JSON.parse(argBuffer) as Record<string, unknown>) ?? null
    } catch {
      envelope = null
    }
  }
  if (!envelope) envelope = parseEnvelope(content)

  yield { type: 'envelope', envelope }
}

// Plain-text streaming turn (parity with runTutorTurnStream) — no tools, yields
// content deltas as they arrive.
export async function* runTurnStreamOpenAI({
  messages,
  pageContext,
  profile,
}: {
  messages: TurnMessage[]
  pageContext?: PageContext
  profile: LearningProfile
}): AsyncGenerator<string> {
  const stream = await createClient().chat.completions.create({
    model: MODEL,
    max_completion_tokens: MAX_TOKENS,
    messages: [systemMessage(buildSystemPrompt(profile, pageContext)), ...messages],
    stream: true,
  })

  for await (const chunk of stream) {
    const text = chunk.choices[0]?.delta?.content
    if (text) yield text
  }
}
