import { CONCEPT_KEYS } from '@calyxa/curriculum'

// The §2.5 JSON output envelope (ADR-019) -- restored on /api/ai/turn's
// non-streaming path, the turn route that persists session_interactions.
// Mirrors summarise.ts's defensive-parse discipline (strip code fence,
// try/catch, never throw), but the failure mode differs: summarise.ts
// degrades to an empty list because nothing user-facing depends on it,
// while a turn's reply IS user-facing, so ANY non-conforming model output
// -- not JSON, missing "say", wrong shape -- degrades to `{ say: <the raw
// text> }` rather than an empty/blank reply. A bad envelope costs
// structure (no assessment, no annotations), never the tutor's voice.

export type Mode = 'socratic' | 'direct'

export type AssessmentOutcome = 'correct' | 'incorrect' | 'partial' | 'none'
export type AssessmentReasoningQuality = 'sound' | 'shallow' | 'none'
export type AssessmentConfidence = 'low' | 'med' | 'high'
export type AssessmentSelfConfidence = 'low' | 'med' | 'high' | 'unknown'

export type Assessment = {
  conceptKey: string | null
  outcome: AssessmentOutcome
  reasoningQuality: AssessmentReasoningQuality
  // The STUDENT's apparent certainty (PLAN §2.3 session_interactions.self_
  // confidence / ADR-016's lucky-guess sub-guard) -- distinct from
  // `confidence` below, which is the TUTOR's confidence in its own grading.
  // §2.5's original envelope schema only specified the latter; this field
  // is this sprint's addition (ADR-019) so the per-interaction FSRS write
  // path (Task 5) has the same signal the retired summariser used to infer
  // after the fact.
  selfConfidence: AssessmentSelfConfidence
  misconceptionCategory: string | null
  // Free-text description of the error, when a misconception is flagged --
  // another sprint-11 addition (ADR-019). §2.5's original schema carried
  // only the category; Sprint 09's pg_trgm fuzzy matching (ADR-017) needs a
  // description to match against (the category alone only ever exact-
  // matches), so without this field the per-turn write path would silently
  // never fuzzy-match anything.
  misconceptionDescription: string | null
  confidence: AssessmentConfidence
}

export type AnnotationTargetKind = 'selector' | 'bbox' | 'textMatch'
export type AnnotationType = 'highlight' | 'circle' | 'arrow' | 'label' | 'step-indicator'

export type AnnotationTarget = {
  kind: AnnotationTargetKind
  selector?: string
  bbox?: { x: number; y: number; w: number; h: number }
  text?: string
}

export type Annotation = {
  id: string
  type: AnnotationType
  target: AnnotationTarget
  style?: { color?: string; weight?: string }
  label?: string
  note?: string
  step?: number
  ttlMs?: number
}

// Solution progress (Sprint 14, ADR-028): the model's own read of how far
// the student is through THIS problem, 0-1. Model-emitted, client-clamped --
// parse only clamps to the valid range (defence in depth; the overlay's own
// bounded-regression/monotone-easing clamp, ADR-028, is the real contract);
// a non-numeric value is DROPPED (undefined), never defaulted to 0, so a
// malformed value reads as "no progress signal this turn" rather than "no
// progress made this turn" -- those are different claims.
function parseSolutionProgress(candidate: unknown): number | undefined {
  if (typeof candidate !== 'number' || !Number.isFinite(candidate)) {
    return undefined
  }

  return Math.max(0, Math.min(1, candidate))
}

// Session completion (Sprint 14, ADR-027): AI-signaled, client-confirmed.
// Exactly three reasons, verbatim from the ADR -- the model names WHY the
// problem is done, and the client runs the visible close (say line -> recap
// -> ring -> close) only in response to this field. `complete` must be
// exactly `true` and `reason` one of the three known literals for the field
// to survive parsing AT ALL -- a `complete: false`, a missing/invalid
// `reason`, or any non-object shape all drop the WHOLE field (never a
// partial accept, e.g. never `{ complete: true }` with a guessed reason).
// This is the ADR's "a dropped completion is a non-close, the safe failure"
// rule: the model is only ever prompted to include `session` when actually
// closing, so anything that doesn't parse cleanly as a genuine close is
// treated identically to omitting it -- the session simply stays open.
export type SessionCompletionReason = 'solved' | 'follow-up-declined' | 'follow-up-corrected'
export type SessionCompletion = { complete: true; reason: SessionCompletionReason }

// One labeled input in a multi-part answer (design 8d) -- see parseAnswerFields
// below. `label` is the short field name; `placeholder` an optional example.
export type AnswerField = { label: string; placeholder?: string }

// The exact sentence the prompt (system-prompt.ts's SESSION COMPLETION block)
// REQUIRES the model to end `say` with on the turn it closes the session --
// the single source of truth both the prompt and the parser reference, so the
// literal can never drift between "what the model is told to write" and "what
// the parser looks for". Kept as its own export for that import.
export const SESSION_CLOSE_SENTENCE = 'Now closing tutoring session.'

// The completion backstop's fired-close reason. The close sentence is the
// same for all three reasons, so its text alone can't say WHICH one -- and by
// far the most common (and the one that earns the section-complete bloom) is
// a solved problem, so an inferred close reads as "solved". A structured
// `session` object the model actually emitted always wins over this (see the
// backstop in parseEnvelopeObject); this only ever fills the gap where the
// model wrote the closing line but forgot the field.
const BACKSTOP_CLOSE_REASON: SessionCompletionReason = 'solved'

function isValidCompletionReason(value: unknown): value is SessionCompletionReason {
  return value === 'solved' || value === 'follow-up-declined' || value === 'follow-up-corrected'
}

/**
 * Does `say` end with the mandated close sentence? Tolerant of trailing
 * whitespace and a missing/extra final period, and case-insensitive -- the
 * point is to catch a model that wrote the closing line but dropped the
 * structured `session` field, not to demand byte-perfect punctuation. The
 * sentence is reserved by the prompt EXCLUSIVELY for a genuine close, so a
 * match here is safe to treat as a real completion signal.
 */
export function saysClosingSentence(say: string): boolean {
  const normalize = (text: string) =>
    text
      .trim()
      .toLowerCase()
      .replace(/[.!\s]+$/, '')
  const normalizedSay = normalize(say)
  const sentinel = normalize(SESSION_CLOSE_SENTENCE)
  return normalizedSay === sentinel || normalizedSay.endsWith(` ${sentinel}`)
}

function parseSessionCompletion(candidate: unknown): SessionCompletion | undefined {
  if (typeof candidate !== 'object' || candidate === null) {
    return undefined
  }

  const { complete, reason } = candidate as Record<string, unknown>

  if (complete !== true || !isValidCompletionReason(reason)) {
    return undefined
  }

  return { complete: true, reason }
}

// Answer chips (design 8a): the model's own short answer OPTIONS for the one
// question its `say` just asked -- rendered as tappable capsules under the
// tutor line; a tap commits the choice as a real student turn (the same wire
// shape as a typed answer, so the next turn grades it like any other). Free
// model text shown verbatim to the student -- unlike pins there is no fixed
// server copy to key by, because a chip IS a candidate answer to this exact
// question -- so the parse is the tight gate: strings only, trimmed,
// non-empty, bounded length (an over-long entry is DROPPED, never truncated
// -- a clipped answer is a DIFFERENT answer, and committing it as the
// student's turn would put words in their mouth), case-insensitive deduped,
// capped in count. A closing turn never carries chips (parseEnvelopeObject
// skips them once `session` is set): there is nothing left to answer.
export const MAX_ANSWER_CHIPS = 4
const MAX_CHIP_LENGTH = 80

function parseChips(candidate: unknown): string[] | undefined {
  if (!Array.isArray(candidate)) {
    return undefined
  }

  const seen = new Set<string>()
  const chips: string[] = []
  for (const entry of candidate) {
    if (typeof entry !== 'string') continue
    const text = entry.trim()
    if (text.length === 0 || text.length > MAX_CHIP_LENGTH) continue
    const key = text.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    chips.push(text)
    if (chips.length >= MAX_ANSWER_CHIPS) break
  }

  return chips.length > 0 ? chips : undefined
}

// Multi-part answer fields (design 8d): when the ONE question `say` just asked
// carries more than one unknown (adjacent AND hypotenuse, x AND y), the model
// emits one labeled field per value instead of chips. The overlay renders a
// textbox per field and commits every value as a single student turn, so the
// next turn grades it like any typed answer. Same tight parse discipline as
// parseChips -- objects only, `label` a trimmed non-empty bounded string
// (a field with no usable label is DROPPED, never defaulted -- an unlabeled
// box tells the student nothing), `placeholder` optional and dropped when
// absent/blank/over-long, deduped by label, capped in count. Like chips, a
// closing turn never carries fields (parseEnvelopeObject skips them once
// `session` is set), and the two are mutually exclusive there (fields win).
export const MAX_ANSWER_FIELDS = 4
const MAX_FIELD_LABEL_LENGTH = 40
const MAX_FIELD_PLACEHOLDER_LENGTH = 40

function parseAnswerFields(candidate: unknown): AnswerField[] | undefined {
  if (!Array.isArray(candidate)) {
    return undefined
  }

  const seen = new Set<string>()
  const fields: AnswerField[] = []
  for (const entry of candidate) {
    if (typeof entry !== 'object' || entry === null) continue
    const raw = entry as { label?: unknown; placeholder?: unknown }
    if (typeof raw.label !== 'string') continue
    const label = raw.label.trim()
    if (label.length === 0 || label.length > MAX_FIELD_LABEL_LENGTH) continue
    const key = label.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)

    const field: AnswerField = { label }
    if (typeof raw.placeholder === 'string') {
      const placeholder = raw.placeholder.trim()
      if (placeholder.length > 0 && placeholder.length <= MAX_FIELD_PLACEHOLDER_LENGTH) {
        field.placeholder = placeholder
      }
    }
    fields.push(field)
    if (fields.length >= MAX_ANSWER_FIELDS) break
  }

  // One box is not "multi-part" -- a single unknown is an ordinary question
  // (chips or free text), so a lone field degrades to no fields at all rather
  // than rendering a one-box panel that the chip row already covers better.
  return fields.length >= 2 ? fields : undefined
}

// Model signals (Sprint 15, ADR-034): the model's own per-turn read of what
// it just DID pedagogically and what it OBSERVED about the student --
// switched representation, re-sized the steps, adjusted guidance/difficulty/
// pace, spotted or confirmed a misconception, saw the student catch their
// own error, etc. These are the primary driver of the title-card status
// pins: the teaching/guidance/difficulty/independence categories can ONLY
// come from the model (no server math knows them), so the tool schema makes
// `signals` a REQUIRED array the model fills every turn (empty when nothing
// applies) and the prompt asks it to emit one whenever it genuinely does --
// EXPECTED, not rare. Only an allowlisted KIND ever crosses the wire; the
// student-visible copy is a fixed server-side string keyed by kind
// (turn-complete.ts), never model text -- so a signal can be wrong about
// itself, but it can never say anything the product didn't write. The
// server-computed FSRS pins (events.ts) and grounded memory pins ride ON TOP
// of these as trustworthy bonuses; the client's per-session dedupe then
// lands the whole surface at ~3-6 distinct pins per session.
export type ModelSignalKind =
  | 'prediction-confirmed'
  | 'misconception-detected'
  | 'pattern-detected'
  | 'pattern-broken'
  | 'concept-understood'
  | 'teaching-visual'
  | 'teaching-decompose'
  | 'pace-up'
  | 'guidance-up'
  | 'guidance-down'
  | 'difficulty-up'
  | 'difficulty-down'
  | 'confidence-up'
  | 'self-caught'

export const MODEL_SIGNAL_KINDS: readonly ModelSignalKind[] = [
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
]

// Defence in depth alongside the prompt's own "at most a couple per turn"
// framing (and the overlay's ≤2-shown-per-turn cap): parse keeps the first
// few unique valid kinds and discards the rest.
const MAX_MODEL_SIGNALS = 3

function isValidModelSignalKind(value: unknown): value is ModelSignalKind {
  return typeof value === 'string' && (MODEL_SIGNAL_KINDS as readonly string[]).includes(value)
}

// Profile tags (Sprint 13, ADR-024/026): the tutor's structured references
// to the student's OWN profile, rendered as visible pills in the transcript
// (e.g. [reviewing: Factoring quadratics], [known gap: sign errors]). Unlike
// assessment (persisted) and annotations (drawn), a tag is a student-facing
// CLAIM about what the tutor remembers about them -- so beyond this
// structural parse, the turn route grounds every tag against the exact
// profile it injected into that turn's prompt and drops anything the
// profile didn't actually contain (drop-don't-invent). `callback` is the
// cross-session kind: "this connects to a prior session" -- grounded
// against the priorWork digest, and prompted to at most one per session.
export type ProfileTagKind = 'reviewing' | 'known-gap' | 'due-review' | 'strength' | 'callback'

export type ProfileTag = {
  kind: ProfileTagKind
  conceptKey: string | null
  label: string
}

// Defence in depth alongside the prompt's "at most 2 per turn" instruction
// (and the overlay's own client-side cap): parse keeps the first two valid
// entries and silently discards the rest.
const MAX_PROFILE_TAGS = 2

// annotations/mode/assessment/profileTags/solutionProgress/session are all
// optional at the type level: an opening turn (no prior student answer)
// omits assessment, a turn with nothing to point at omits annotations, most
// turns carry no profile tags, most turns carry no session completion (only
// the turn that actually closes the problem does), and a degrade-to-
// plain-text result (see parseEnvelope) omits everything but `say`.
export type TurnEnvelope = {
  say: string
  annotations?: Annotation[]
  mode?: Mode
  assessment?: Assessment
  profileTags?: ProfileTag[]
  solutionProgress?: number
  session?: SessionCompletion
  signals?: ModelSignalKind[]
  chips?: string[]
  answerFields?: AnswerField[]
}

// Same fence-stripping regex as summarise.ts -- duplicated rather than
// shared, matching this codebase's existing convention of small pure
// per-call-site helpers (e.g. daysSince in both apply.ts and
// profile-read.ts) over a premature shared-utils module.
function stripCodeFence(raw: string): string {
  const trimmed = raw.trim()
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/)
  return fenced ? fenced[1] : trimmed
}

// The candidate JSON slices tried, in order, before degrading to plain
// text. Found during Task 9's live acceptance (Sprint 11): the real model
// sometimes prefixes conversational prose BEFORE the fenced envelope
// ("Excellent reasoning! ...\n```json\n{...}\n```"), which the
// start-anchored stripCodeFence can't see -- without this, that turn's
// entire raw output (JSON block included) leaked into the student-visible
// reply via the degrade path, and its assessment was silently dropped.
// Order matters: the whole (fence-stripped) text first -- the §2.5 happy
// path -- then a fenced block ANYWHERE in the text, then the outermost
// brace span as a last resort (harmless when it isn't JSON: the parse
// fails and the next candidate / final degrade takes over; a candidate
// only WINS if it parses to an object carrying a string "say").
function envelopeCandidates(raw: string): string[] {
  const candidates = [stripCodeFence(raw)]

  const fencedAnywhere = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/)
  if (fencedAnywhere) {
    candidates.push(fencedAnywhere[1])
  }

  const firstBrace = raw.indexOf('{')
  const lastBrace = raw.lastIndexOf('}')
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    candidates.push(raw.slice(firstBrace, lastBrace + 1))
  }

  return candidates
}

function isValidMode(value: unknown): value is Mode {
  return value === 'socratic' || value === 'direct'
}

function isValidOutcome(value: unknown): value is AssessmentOutcome {
  return value === 'correct' || value === 'incorrect' || value === 'partial' || value === 'none'
}

function isValidReasoningQuality(value: unknown): value is AssessmentReasoningQuality {
  return value === 'sound' || value === 'shallow' || value === 'none'
}

function isValidConfidence(value: unknown): value is AssessmentConfidence {
  return value === 'low' || value === 'med' || value === 'high'
}

function isValidSelfConfidence(value: unknown): value is AssessmentSelfConfidence {
  return value === 'low' || value === 'med' || value === 'high' || value === 'unknown'
}

function isValidProfileTagKind(value: unknown): value is ProfileTagKind {
  return (
    value === 'reviewing' ||
    value === 'known-gap' ||
    value === 'due-review' ||
    value === 'strength' ||
    value === 'callback'
  )
}

function isValidAnnotationType(value: unknown): value is AnnotationType {
  return (
    value === 'highlight' ||
    value === 'circle' ||
    value === 'arrow' ||
    value === 'label' ||
    value === 'step-indicator'
  )
}

function isValidTargetKind(value: unknown): value is AnnotationTargetKind {
  return value === 'selector' || value === 'bbox' || value === 'textMatch'
}

function isValidBbox(value: unknown): value is { x: number; y: number; w: number; h: number } {
  if (typeof value !== 'object' || value === null) return false
  const { x, y, w, h } = value as Record<string, unknown>
  return typeof x === 'number' && typeof y === 'number' && typeof w === 'number' && typeof h === 'number'
}

// Parses one candidate assessment object. Unlike parseAnnotation below,
// this never returns undefined for an object-shaped input -- unrecognised
// or missing sub-fields default to the same safe values summarise.ts's
// parseSummary already established (ADR-015 discipline: outcome/quality
// default to 'none', confidence defaults to the conservative 'low'), so a
// partially-malformed assessment still carries whatever signal it does
// have rather than being discarded wholesale. `concept_key` is the one
// field constrained against the curriculum's known keys (ADR-019/ADR-021)
// -- anything else becomes null rather than an untaggable string leaking
// into knowledge_nodes.
function parseAssessment(candidate: unknown): Assessment | undefined {
  if (typeof candidate !== 'object' || candidate === null) {
    return undefined
  }

  const {
    concept_key,
    outcome,
    reasoning_quality,
    self_confidence,
    misconception_category,
    misconception_description,
    confidence,
  } = candidate as Record<string, unknown>

  const conceptKey =
    typeof concept_key === 'string' && CONCEPT_KEYS.includes(concept_key) ? concept_key : null

  return {
    conceptKey,
    outcome: isValidOutcome(outcome) ? outcome : 'none',
    reasoningQuality: isValidReasoningQuality(reasoning_quality) ? reasoning_quality : 'none',
    selfConfidence: isValidSelfConfidence(self_confidence) ? self_confidence : 'unknown',
    misconceptionCategory:
      typeof misconception_category === 'string' && misconception_category.length > 0
        ? misconception_category
        : null,
    misconceptionDescription: typeof misconception_description === 'string' ? misconception_description : null,
    confidence: isValidConfidence(confidence) ? confidence : 'low',
  }
}

// Parses one candidate annotation. Returns undefined (dropped, not
// defaulted) for a structurally invalid entry -- unlike an assessment, a
// half-formed annotation has no safe default target to draw, so an
// individual bad entry is simply excluded rather than rendered wrong; the
// rest of the array is unaffected. No surface renders annotations yet
// (that is the later annotation-rendering sprint) -- this parser exists so
// the field round-trips validated now, with nothing further to build here.
function parseAnnotation(candidate: unknown): Annotation | undefined {
  if (typeof candidate !== 'object' || candidate === null) {
    return undefined
  }

  const { id, type, target, style, label, note, step, ttl_ms } = candidate as Record<string, unknown>

  if (typeof id !== 'string' || id.length === 0) return undefined
  if (!isValidAnnotationType(type)) return undefined
  if (typeof target !== 'object' || target === null) return undefined

  const { kind, selector, bbox, text } = target as Record<string, unknown>
  if (!isValidTargetKind(kind)) return undefined

  const parsedTarget: AnnotationTarget = { kind }
  if (typeof selector === 'string') parsedTarget.selector = selector
  if (isValidBbox(bbox)) parsedTarget.bbox = bbox
  if (typeof text === 'string') parsedTarget.text = text

  const annotation: Annotation = { id, type, target: parsedTarget }

  if (typeof style === 'object' && style !== null) {
    const { color, weight } = style as Record<string, unknown>
    annotation.style = {
      ...(typeof color === 'string' ? { color } : {}),
      ...(typeof weight === 'string' ? { weight } : {}),
    }
  }
  if (typeof label === 'string') annotation.label = label
  if (typeof note === 'string' && note.trim().length > 0) annotation.note = note.trim()
  if (typeof step === 'number') annotation.step = step
  if (typeof ttl_ms === 'number') annotation.ttlMs = ttl_ms

  return annotation
}

// Parses one candidate profile tag. Follows parseAnnotation's discipline
// (drop, not default) for the fields that make a tag meaningless when
// absent -- an unknown kind or an empty label leaves nothing safe to
// render, so the entry is excluded and the rest of the array is
// unaffected. concept_key follows parseAssessment's discipline instead:
// an unknown key nulls the FIELD but keeps the entry, because the route's
// grounding gate (the real authority on whether this tag may render --
// ADR-024) still has the kind + label to check against the injected
// profile. Structural validity here is necessary, never sufficient: every
// surviving tag is re-checked against the actual profile server-side.
function parseProfileTag(candidate: unknown): ProfileTag | undefined {
  if (typeof candidate !== 'object' || candidate === null) {
    return undefined
  }

  const { kind, concept_key, label } = candidate as Record<string, unknown>

  if (!isValidProfileTagKind(kind)) return undefined
  if (typeof label !== 'string' || label.trim().length === 0) return undefined

  const conceptKey =
    typeof concept_key === 'string' && CONCEPT_KEYS.includes(concept_key) ? concept_key : null

  return { kind, conceptKey, label: label.trim() }
}

// The shared field-by-field extraction, factored out (Sprint 14 Task 10
// live-find) so both parse entry points below run the exact same defensive
// logic: parseEnvelope's candidate-JSON-in-text path (the ADR-019 degrade
// discipline, kept for back-compat and for runTutorTurnStream's plain-text
// callers) and claude.ts's tool-use path (Anthropic's `strict` tool
// validation already guarantees required keys exist and enum values are
// valid, but this defensive pass -- concept_key allowlisting, bbox shape,
// array caps -- still applies identically either way; a schema guarantees
// SHAPE, not the same semantic checks this file already does). Returns
// undefined only when `say` isn't a string -- the one hard requirement.
export function parseEnvelopeObject(parsed: Record<string, unknown>): TurnEnvelope | undefined {
  if (typeof parsed.say !== 'string') {
    return undefined
  }

  const envelopeSource = parsed as {
    say: string
    mode?: unknown
    assessment?: unknown
    annotations?: unknown
    profile_tags?: unknown
    solution_progress?: unknown
    session?: unknown
    signals?: unknown
    chips?: unknown
    answer_fields?: unknown
  }
  const envelope: TurnEnvelope = { say: envelopeSource.say }

  if (isValidMode(envelopeSource.mode)) {
    envelope.mode = envelopeSource.mode
  }

  // Drop-don't-guess, per entry: unrecognised kinds are filtered out
  // (never defaulted), duplicates within a turn collapse, and the array is
  // capped -- a malformed or over-long signals list degrades to whatever
  // valid kinds it did carry, never to a wrong one.
  if (Array.isArray(envelopeSource.signals)) {
    const seen = new Set<string>()
    const signals = (envelopeSource.signals as unknown[]).filter((kind): kind is ModelSignalKind => {
      if (!isValidModelSignalKind(kind) || seen.has(kind)) return false
      seen.add(kind)
      return true
    })
    if (signals.length > 0) {
      envelope.signals = signals.slice(0, MAX_MODEL_SIGNALS)
    }
  }

  const assessment = parseAssessment(envelopeSource.assessment)
  if (assessment) {
    envelope.assessment = assessment
  }

  const solutionProgress = parseSolutionProgress(envelopeSource.solution_progress)
  if (solutionProgress !== undefined) {
    envelope.solutionProgress = solutionProgress
  }

  const session = parseSessionCompletion(envelopeSource.session)
  if (session) {
    envelope.session = session
  } else if (saysClosingSentence(envelope.say)) {
    // Completion backstop (fixes the section-complete bloom + recap never
    // firing when the tutor "solves" the problem): the model wrote the
    // mandated close sentence but omitted -- or malformed -- the structured
    // `session` field, so the client never saw a completion and the terminal
    // screens never played. `session` is deliberately OPTIONAL in the forced
    // tool schema (claude.ts -- so the model isn't nudged into false closes
    // every turn), which is exactly why it can be dropped on the one turn it
    // matters. Because the close sentence is reserved by the prompt for a
    // genuine close, its presence IS the signal -- infer the field the model
    // meant to send. A well-formed `session` the model actually emitted still
    // wins (the `if` branch above); this only fills the gap.
    envelope.session = { complete: true, reason: BACKSTOP_CLOSE_REASON }
  }

  // Answer inputs (chips OR multi-part fields) ride only on a turn that is
  // still OPEN -- a closing turn (structured `session` or the backstop-inferred
  // one alike, hence checked AFTER the session block above) has nothing left to
  // answer, so anything the model sent with it is dropped, never rendered next
  // to a goodbye. Fields and chips are mutually exclusive: a multi-part
  // question wants labeled boxes, not a chip row, so when the model emits valid
  // fields they WIN and chips are skipped for the turn (design 8d "swaps the
  // chip row for one labeled textbox per value").
  if (!envelope.session) {
    const answerFields = parseAnswerFields(envelopeSource.answer_fields)
    if (answerFields) {
      envelope.answerFields = answerFields
    } else {
      const chips = parseChips(envelopeSource.chips)
      if (chips) {
        envelope.chips = chips
      }
    }
  }

  if (Array.isArray(envelopeSource.annotations)) {
    const annotations = (envelopeSource.annotations as unknown[])
      .map(parseAnnotation)
      .filter((a): a is Annotation => a !== undefined)

    if (annotations.length > 0) {
      envelope.annotations = annotations
    }
  }

  if (Array.isArray(envelopeSource.profile_tags)) {
    const profileTags = (envelopeSource.profile_tags as unknown[])
      .map(parseProfileTag)
      .filter((t): t is ProfileTag => t !== undefined)
      .slice(0, MAX_PROFILE_TAGS)

    if (profileTags.length > 0) {
      envelope.profileTags = profileTags
    }
  }

  return envelope
}

// Defensive parse of the model's raw turn output into a TurnEnvelope. The
// one hard requirement is a string "say" -- everything else (mode,
// assessment, annotations) degrades field-by-field. Each candidate slice
// (whole text, fenced block anywhere, outermost brace span -- see
// envelopeCandidates) is tried in order; the first that parses to an
// object with a string "say" wins, so prose-wrapped envelopes recover
// instead of leaking raw JSON to the student. If no candidate qualifies
// (e.g. the model ignored the envelope instruction and replied in plain
// prose), the whole raw string becomes `say` verbatim: the student always
// hears/reads a reply, it just loses structure on a bad turn (ADR-019).
export function parseEnvelope(raw: string): TurnEnvelope {
  for (const candidate of envelopeCandidates(raw)) {
    let parsed: unknown
    try {
      parsed = JSON.parse(candidate)
    } catch {
      continue
    }

    if (typeof parsed !== 'object' || parsed === null) {
      continue
    }

    const envelope = parseEnvelopeObject(parsed as Record<string, unknown>)
    if (envelope) {
      return envelope
    }
  }

  return { say: raw }
}
