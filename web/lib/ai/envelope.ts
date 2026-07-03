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

export type Assessment = {
  conceptKey: string | null
  outcome: AssessmentOutcome
  reasoningQuality: AssessmentReasoningQuality
  misconceptionCategory: string | null
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
  step?: number
  ttlMs?: number
}

// annotations/mode/assessment are all optional at the type level: an
// opening turn (no prior student answer) omits assessment, a turn with
// nothing to point at omits annotations, and a degrade-to-plain-text
// result (see parseEnvelope) omits everything but `say`.
export type TurnEnvelope = {
  say: string
  annotations?: Annotation[]
  mode?: Mode
  assessment?: Assessment
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

  const { concept_key, outcome, reasoning_quality, misconception_category, confidence } =
    candidate as Record<string, unknown>

  const conceptKey =
    typeof concept_key === 'string' && CONCEPT_KEYS.includes(concept_key) ? concept_key : null

  return {
    conceptKey,
    outcome: isValidOutcome(outcome) ? outcome : 'none',
    reasoningQuality: isValidReasoningQuality(reasoning_quality) ? reasoning_quality : 'none',
    misconceptionCategory:
      typeof misconception_category === 'string' && misconception_category.length > 0
        ? misconception_category
        : null,
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

  const { id, type, target, style, label, step, ttl_ms } = candidate as Record<string, unknown>

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
  if (typeof step === 'number') annotation.step = step
  if (typeof ttl_ms === 'number') annotation.ttlMs = ttl_ms

  return annotation
}

// Defensive parse of the model's raw turn output into a TurnEnvelope. The
// one hard requirement is a string "say" -- everything else (mode,
// assessment, annotations) degrades field-by-field. If "say" itself is
// missing, or the raw text isn't JSON at all (e.g. the model ignored the
// envelope instruction and replied in plain prose), the whole raw string
// becomes `say` verbatim: the student always hears/reads a reply, it just
// loses structure on a bad turn (ADR-019).
export function parseEnvelope(raw: string): TurnEnvelope {
  try {
    const parsed = JSON.parse(stripCodeFence(raw))

    if (typeof parsed !== 'object' || parsed === null || typeof parsed.say !== 'string') {
      return { say: raw }
    }

    const envelope: TurnEnvelope = { say: parsed.say }

    if (isValidMode(parsed.mode)) {
      envelope.mode = parsed.mode
    }

    const assessment = parseAssessment(parsed.assessment)
    if (assessment) {
      envelope.assessment = assessment
    }

    if (Array.isArray(parsed.annotations)) {
      const annotations = (parsed.annotations as unknown[])
        .map(parseAnnotation)
        .filter((a): a is Annotation => a !== undefined)

      if (annotations.length > 0) {
        envelope.annotations = annotations
      }
    }

    return envelope
  } catch {
    return { say: raw }
  }
}
