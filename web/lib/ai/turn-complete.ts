import { after } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getConcept } from '@calyxa/curriculum'
import type { TurnEnvelope } from './claude'
import type { ProfileTag } from './envelope'
import type { LearningProfile } from './profile'
import { applyInteraction } from '@/lib/learning/apply'
import { computeTurnPings, type TurnPing } from '@/lib/learning/events'

// The shared "complete the turn" tail (Sprint 15 voice follow-on): once a
// TurnEnvelope exists -- whether produced by the non-streaming runTutorTurn
// (/api/ai/turn) or the streamed runTutorTurnEnvelopeStream
// (/api/ai/turn/stream) -- the persistence + grounding + ping work is
// IDENTICAL, so it lives here as one source of truth. Extracted verbatim from
// app/api/ai/turn/route.ts (ADR-019/024/026); the existing ai-turn.test.ts is
// the regression guard for this move.

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
// the ping computation predicts what the apply will write, so a turn whose
// apply never got scheduled must suppress its pings.
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

// The response payload a completed tutor turn returns -- serialized as JSON by
// /api/ai/turn and as the terminal SSE `envelope` event by /api/ai/turn/stream.
// Additive-omission discipline (ADR-023/024/027): a field is OMITTED (not
// null, not []) when the envelope carried none, so a bare turn is byte-
// identical to Sprint 11's `{ reply }`.
export type TurnResponsePayload = {
  reply: string
  annotations?: NonNullable<TurnEnvelope['annotations']>
  profileTags?: ProfileTag[]
  pings?: TurnPing[]
  solutionProgress?: number
  session?: NonNullable<TurnEnvelope['session']>
}

// Runs the shared persistence + grounding + ping tail and assembles the
// response payload. Identical semantics to /api/ai/turn's POST tail: persist
// and ping computation run IN PARALLEL (disjoint tables); a ping only rides
// the response when its apply was actually scheduled (ADR-026); tags are
// grounded against the injected profile; annotations/progress/session thread
// through additively.
export async function completeTurn(
  supabase: SupabaseClient,
  userId: string,
  sessionId: string | undefined,
  lastUserMessage: string,
  envelope: TurnEnvelope,
  responseLatencyMs: number | undefined,
  profile: LearningProfile
): Promise<TurnResponsePayload> {
  const [persisted, prospectivePings] = await Promise.all([
    persistInteraction(supabase, userId, sessionId, lastUserMessage, envelope, responseLatencyMs),
    envelope.assessment
      ? computeTurnPings(supabase, userId, envelope.assessment, responseLatencyMs ?? null)
      : Promise.resolve<TurnPing[]>([]),
  ])

  const pings = persisted ? prospectivePings : []
  const annotations = envelope.annotations
  const profileTags = groundProfileTags(envelope.profileTags, profile)

  return {
    reply: envelope.say,
    ...(annotations && annotations.length > 0 ? { annotations } : {}),
    ...(profileTags.length > 0 ? { profileTags } : {}),
    ...(pings.length > 0 ? { pings } : {}),
    ...(envelope.solutionProgress !== undefined ? { solutionProgress: envelope.solutionProgress } : {}),
    ...(envelope.session ? { session: envelope.session } : {}),
  }
}
