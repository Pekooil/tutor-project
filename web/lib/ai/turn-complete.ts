import { after } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getConcept } from '@calyxa/curriculum'
import type { TurnEnvelope } from './claude'
import type { Assessment, ModelSignalKind, ProfileTag } from './envelope'
import type { LearningProfile } from './profile'
import { applyInteraction } from '@/lib/learning/apply'
import { computeStatusPins, type StatusPin, type StatusPinCategory } from '@/lib/learning/events'

// The shared "complete the turn" tail (Sprint 15 voice follow-on): once a
// TurnEnvelope exists -- whether produced by the non-streaming runTutorTurn
// (/api/ai/turn) or the streamed runTutorTurnEnvelopeStream
// (/api/ai/turn/stream) -- the persistence + grounding + pin work is
// IDENTICAL, so it lives here as one source of truth. Extracted verbatim from
// app/api/ai/turn/route.ts (ADR-019/024/026); the existing ai-turn.test.ts is
// the regression guard for this move. Sprint 15 (ADR-034) replaces the
// response's separate `profileTags`/`pings` fields with ONE `pins` array --
// the title-card status-pin surface -- assembled from three sources here:
// the deterministic FSRS learning events (computeStatusPins), the model's
// per-turn `signals` array (the primary volume driver -- fixed copy keyed by
// kind, below), and the grounded profile tags' memory kinds (callback /
// due-review).

// Model-authored tag labels (known-gap / callback keep them) are clipped
// hard; concept-anchored labels are replaced with the curriculum title below.
const MAX_TAG_LABEL_LENGTH = 30

// Folds case, whitespace, AND separator characters misconception categories
// use (dotted.snake / hyphen-case) to spaces -- the model writes "sign
// errors" while the stored category is "sign-errors"/"algebra.sign_errors";
// without separator folding the containment check never fires (found by the
// Task 4 gate test, not hypothetical).
function normalizeTagText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[-_.]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function tagTextOverlaps(a: string, b: string): boolean {
  const na = normalizeTagText(a)
  const nb = normalizeTagText(b)
  return na.length > 0 && nb.length > 0 && (na.includes(nb) || nb.includes(na))
}

// The grounding gate (ADR-024): every structurally-valid profile tag is
// verified against the EXACT LearningProfile this request rendered into the
// prompt -- the model cannot surface a "memory" the profile read didn't
// contain. An ungrounded tag is dropped (never rendered, never an error);
// grounded concept-anchored tags get their label replaced by the curriculum
// title; known-gap/callback keep the model's label (truncated).
export function groundProfileTags(tags: ProfileTag[] | undefined, profile: LearningProfile): ProfileTag[] {
  if (!tags || tags.length === 0) return []

  const grounded: ProfileTag[] = []

  for (const tag of tags) {
    let isGrounded = false

    switch (tag.kind) {
      case 'reviewing':
      case 'strength':
        isGrounded =
          tag.conceptKey !== null &&
          profile.masteryNodes.some((n) => n.conceptKey === tag.conceptKey)
        break
      case 'known-gap':
        isGrounded = profile.activeMisconceptions.some(
          (m) =>
            (tag.conceptKey !== null && m.conceptKey === tag.conceptKey) ||
            tagTextOverlaps(tag.label, m.category) ||
            tagTextOverlaps(tag.label, m.description)
        )
        break
      case 'due-review':
        isGrounded =
          tag.conceptKey !== null &&
          (profile.dueForReview ?? []).some((d) => d.conceptKey === tag.conceptKey)
        break
      case 'callback':
        isGrounded =
          tag.conceptKey !== null &&
          (profile.priorWork ?? []).some((p) => p.conceptKey === tag.conceptKey)
        break
    }

    if (!isGrounded) {
      console.debug('[ai/turn] profile tag dropped: not grounded in the injected profile', {
        kind: tag.kind,
        conceptKey: tag.conceptKey,
        label: tag.label,
      })
      continue
    }

    const conceptTitle =
      tag.conceptKey !== null && (tag.kind === 'reviewing' || tag.kind === 'strength' || tag.kind === 'due-review')
        ? getConcept(tag.conceptKey)?.title
        : undefined

    grounded.push({
      kind: tag.kind,
      conceptKey: tag.conceptKey,
      label: conceptTitle ?? tag.label.slice(0, MAX_TAG_LABEL_LENGTH),
    })
  }

  return grounded
}

type InsertedInteraction = { id: string }

// Resolves whether `sessionId` is a real, non-deleted session this caller
// owns, and if so the turn_index the next inserted row should carry. Returns
// null on any ownership failure. Runs both reads in parallel (this await sits
// on the turn's critical path).
export async function resolveOwnedTurnIndex(
  supabase: SupabaseClient,
  userId: string,
  sessionId: string
): Promise<number | null> {
  const [{ data: sessionRow }, { count }] = await Promise.all([
    supabase
      .from('sessions')
      .select('id')
      .eq('id', sessionId)
      .eq('user_id', userId)
      .is('deleted_at', null)
      .maybeSingle(),
    supabase
      .from('session_interactions')
      .select('id', { count: 'exact', head: true })
      .eq('session_id', sessionId)
      .is('deleted_at', null),
  ])

  if (!sessionRow) {
    return null
  }

  return (count ?? 0) + 1
}

// Persists one session_interactions row for a gradable turn and kicks the
// per-interaction learning-model apply off the critical path via after()
// (ADR-019). Best-effort and silent throughout: a missing/foreign sessionId,
// a missing assessment, or any query failure all degrade to "no persistence
// this turn." Returns whether the apply was actually SCHEDULED (ADR-026) --
// the pin computation predicts what the apply will write, so a turn whose
// apply never got scheduled must suppress its learning-event pins.
export async function persistInteraction(
  supabase: SupabaseClient,
  userId: string,
  sessionId: string | undefined,
  lastUserMessage: string,
  envelope: TurnEnvelope,
  responseLatencyMs: number | undefined
): Promise<boolean> {
  if (!sessionId || !envelope.assessment) {
    console.warn(
      '[ai/turn] persistInteraction skipped:',
      !sessionId
        ? 'no sessionId on the request'
        : `envelope carried no assessment (say: "${envelope.say.slice(0, 120)}")`
    )
    return false
  }

  try {
    const turnIndex = await resolveOwnedTurnIndex(supabase, userId, sessionId)

    if (turnIndex === null) {
      console.warn('[ai/turn] persistInteraction skipped: sessionId does not resolve to a session this caller owns', {
        sessionId,
      })
      return false
    }

    const { assessment } = envelope

    const { data: inserted, error } = await supabase
      .from('session_interactions')
      .insert({
        session_id: sessionId,
        user_id: userId,
        turn_index: turnIndex,
        concept_key: assessment.conceptKey,
        student_transcript: lastUserMessage,
        tutor_response: envelope.say,
        outcome: assessment.outcome,
        self_confidence: assessment.selfConfidence,
        reasoning_quality: assessment.reasoningQuality,
        response_latency_ms: responseLatencyMs ?? null,
        misconception_category: assessment.misconceptionCategory,
        misconception_description: assessment.misconceptionDescription,
        applied_to_profile: false,
      })
      .select('id')
      .single()

    if (error || !inserted) {
      console.warn('[ai/turn] persistInteraction skipped: session_interactions insert failed', {
        sessionId,
        error: error?.message,
      })
      return false
    }

    const insertedId = (inserted as InsertedInteraction).id

    after(() =>
      applyInteraction(supabase, userId, sessionId, {
        id: insertedId,
        conceptKey: assessment.conceptKey,
        outcome: assessment.outcome,
        reasoningQuality: assessment.reasoningQuality,
        selfConfidence: assessment.selfConfidence,
        misconceptionCategory: assessment.misconceptionCategory,
        misconceptionDescription: assessment.misconceptionDescription,
        responseLatencyMs: responseLatencyMs ?? null,
      })
    )

    return true
  } catch (err) {
    console.error('[ai/turn] persistInteraction threw', { sessionId }, err)
    return false
  }
}

// The opening scan's row (ADR-030): a genuine session_interactions row, same
// schema, but assessment-less by design -- written every time ownership
// resolves ("found the problem" and "found nothing" both produce a row).
// Never schedules applyInteraction and never computes pings.
export async function persistOpeningInteraction(
  supabase: SupabaseClient,
  userId: string,
  sessionId: string | undefined,
  envelope: TurnEnvelope
): Promise<void> {
  if (!sessionId) {
    console.warn('[ai/turn] opening scan: no sessionId on the request, nothing persisted')
    return
  }

  try {
    const turnIndex = await resolveOwnedTurnIndex(supabase, userId, sessionId)

    if (turnIndex === null) {
      console.warn('[ai/turn] opening scan: sessionId does not resolve to a session this caller owns', { sessionId })
      return
    }

    const { error } = await supabase.from('session_interactions').insert({
      session_id: sessionId,
      user_id: userId,
      turn_index: turnIndex,
      concept_key: null,
      student_transcript: null,
      tutor_response: envelope.say,
      outcome: 'none',
      self_confidence: 'unknown',
      reasoning_quality: 'none',
      response_latency_ms: null,
      misconception_category: null,
      misconception_description: null,
      applied_to_profile: false,
    })

    if (error) {
      console.warn('[ai/turn] opening scan: session_interactions insert failed', { sessionId, error: error.message })
    }
  } catch (err) {
    console.error('[ai/turn] opening scan: persistOpeningInteraction threw', { sessionId }, err)
  }
}

// The fixed, product-written copy + category for each model-emitted signal
// (ADR-034): only the KIND ever comes from the model (envelope.ts's
// allowlist), so a signal pin can be wrong about the tutoring, but it can
// never SAY anything the product didn't write -- the same
// server-rendered-display rule as every other pin label (ADR-024). A few
// kinds get their base copy ENRICHED server-side from the turn's own
// assessment (the misconception category it flagged, the concept title it
// tagged) in modelSignalPins below -- still product-authored text, just
// parameterized by a grounded field.
const SIGNAL_PINS: Record<ModelSignalKind, { category: StatusPinCategory; label: string }> = {
  'prediction-confirmed': { category: 'prediction', label: 'Misconception confirmed' },
  'misconception-detected': { category: 'prediction', label: 'New misconception spotted' },
  'pattern-detected': { category: 'prediction', label: 'Pattern spotted' },
  'pattern-broken': { category: 'progress', label: 'Pattern broken' },
  'concept-understood': { category: 'progress', label: 'Key concept understood' },
  'teaching-visual': { category: 'teaching', label: 'Switching to visual examples' },
  'teaching-decompose': { category: 'teaching', label: 'Breaking it into smaller steps' },
  'pace-up': { category: 'teaching', label: 'Picking up the pace' },
  'guidance-up': { category: 'guidance', label: 'Stepping in with more guidance' },
  'guidance-down': { category: 'guidance', label: 'Pulling back — you’ve got this' },
  'difficulty-up': { category: 'difficulty', label: 'Leveling up' },
  'difficulty-down': { category: 'difficulty', label: 'Easing off' },
  'confidence-up': { category: 'confidence', label: 'Confidence rising' },
  'self-caught': { category: 'independence', label: 'You caught that yourself' },
}

// "sign-errors" / "algebra.sign_errors" -> "sign errors" for enriched copy.
function humanizeCategory(category: string): string {
  return category.replace(/[-_.]/g, ' ').replace(/\s+/g, ' ').trim()
}

// The model-emitted signals (ADR-034) become pins with fixed product copy,
// enriched from the turn's assessment where a grounded field sharpens the
// label (the flagged misconception category on the three misconception
// kinds; the tagged concept title on concept-understood). conceptKey rides
// from the assessment so the client's kind:concept dedupe treats the
// model's concept-understood and the server's FSRS-computed one as the same
// pin (whichever lands first wins).
function modelSignalPins(signals: readonly ModelSignalKind[], assessment: Assessment | undefined): StatusPin[] {
  const conceptKey = assessment?.conceptKey ?? null
  const category = assessment?.misconceptionCategory ? humanizeCategory(assessment.misconceptionCategory) : null
  const title = assessment?.conceptKey ? getConcept(assessment.conceptKey)?.title : undefined

  return signals.map((kind) => {
    const base = SIGNAL_PINS[kind]
    let label = base.label
    if (category && (kind === 'prediction-confirmed' || kind === 'misconception-detected' || kind === 'pattern-broken')) {
      label = `${base.label}: ${category}`
    } else if (title && kind === 'concept-understood') {
      label = `${base.label}: ${title}`
    }
    return { category: base.category, kind, conceptKey, label }
  })
}

// The memory pins (ADR-034): derived from the GROUNDED profile tags' two
// cross-session kinds -- the grounding gate above already verified each one
// against the exact profile this turn's prompt carried, so a memory pin is
// a claim about real recorded history, never a model invention. due-review's
// tag label is already the curriculum title (groundProfileTags replaces it);
// callback gets fixed copy -- the model's own callback phrasing belongs in
// `say`, not the pin. The other three tag kinds (reviewing / strength /
// known-gap) are grounding-only signals now: with the transcript's tag pills
// retired (ADR-034 supersedes that ADR-024 surface), nothing renders them.
function memoryPins(tags: ProfileTag[]): StatusPin[] {
  const pins: StatusPin[] = []
  for (const tag of tags) {
    if (tag.kind === 'callback') {
      pins.push({ category: 'memory', kind: 'callback', conceptKey: tag.conceptKey, label: 'Building on a previous session' })
    } else if (tag.kind === 'due-review') {
      pins.push({ category: 'memory', kind: 'due-review', conceptKey: tag.conceptKey, label: `Reviewing: ${tag.label}` })
    }
  }
  return pins
}

// The response payload a completed tutor turn returns -- serialized as JSON by
// /api/ai/turn and as the terminal SSE `envelope` event by /api/ai/turn/stream.
// Additive-omission discipline (ADR-023/024/027): a field is OMITTED (not
// null, not []) when the envelope carried none, so a bare turn is byte-
// identical to Sprint 11's `{ reply }`. `pins` (ADR-034) REPLACES the old
// `profileTags` + `pings` pair -- the extension and this route ship together,
// so this is a clean rename, not a deprecation dance.
export type TurnResponsePayload = {
  reply: string
  annotations?: NonNullable<TurnEnvelope['annotations']>
  pins?: StatusPin[]
  solutionProgress?: number
  session?: NonNullable<TurnEnvelope['session']>
  // Answer chips (design 8a): the envelope's validated options, threaded as-is
  // -- parse already trimmed/deduped/capped them and dropped them from any
  // closing turn (envelope.ts), so past that gate they are display-ready.
  chips?: string[]
  // Multi-part answer fields (design 8d): the envelope's validated per-unknown
  // textbox spec, threaded as-is (same gate as chips, and never present
  // alongside chips -- envelope.ts sends at most one of the two).
  answerFields?: NonNullable<TurnEnvelope['answerFields']>
}

// Runs the shared persistence + grounding + pin tail and assembles the
// response payload. Identical semantics to /api/ai/turn's POST tail: persist
// and pin computation run IN PARALLEL (disjoint tables); a learning-event
// pin only rides the response when its apply was actually scheduled
// (ADR-026) -- the model's signal pins (its own per-turn claims) and the
// memory pins (grounded against the injected profile) ride regardless;
// annotations/progress/session thread through additively.
export async function completeTurn(
  supabase: SupabaseClient,
  userId: string,
  sessionId: string | undefined,
  lastUserMessage: string,
  envelope: TurnEnvelope,
  responseLatencyMs: number | undefined,
  profile: LearningProfile
): Promise<TurnResponsePayload> {
  const [persisted, prospectivePins] = await Promise.all([
    persistInteraction(supabase, userId, sessionId, lastUserMessage, envelope, responseLatencyMs),
    envelope.assessment
      ? computeStatusPins(supabase, userId, envelope.assessment, responseLatencyMs ?? null)
      : Promise.resolve<StatusPin[]>([]),
  ])

  const annotations = envelope.annotations
  const profileTags = groundProfileTags(envelope.profileTags, profile)
  // Merge order matters for the client's kind:concept dedupe (first wins):
  // the FSRS-grounded learning pins lead (so their exact math-backed label
  // beats the model's guess for the same kind+concept), then the model's
  // per-turn signals (the volume driver), then the grounded memory pins.
  const pins: StatusPin[] = [
    ...(persisted ? prospectivePins : []),
    ...modelSignalPins(envelope.signals ?? [], envelope.assessment),
    ...memoryPins(profileTags),
  ]

  return {
    reply: envelope.say,
    ...(annotations && annotations.length > 0 ? { annotations } : {}),
    ...(pins.length > 0 ? { pins } : {}),
    ...(envelope.solutionProgress !== undefined ? { solutionProgress: envelope.solutionProgress } : {}),
    ...(envelope.session ? { session: envelope.session } : {}),
    ...(envelope.chips && envelope.chips.length > 0 ? { chips: envelope.chips } : {}),
    ...(envelope.answerFields && envelope.answerFields.length > 0 ? { answerFields: envelope.answerFields } : {}),
  }
}
