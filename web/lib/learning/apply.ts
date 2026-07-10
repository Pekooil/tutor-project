import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  updateKnowledgeNode,
  type FsrsObservation,
  type KnowledgeNodeUpdate,
  type Outcome,
  type ReasoningQuality,
  type SelfConfidence,
} from '@calyxa/learning-model'
import { scheduleReinforcement } from './scheduler'
import { KNOWN_CONCEPT_KEYS } from './types'

const DEFAULT_STABILITY = 1.0 // matches knowledge_nodes.stability DB default (migration 0004)
const DEFAULT_DIFFICULTY = 0.3 // matches knowledge_nodes.difficulty DB default (migration 0004)
const MS_PER_DAY = 1000 * 60 * 60 * 24
// Revised down from ADR-017's original 0.6 during Sprint 09 Task 8 manual
// acceptance: real same-error descriptions, independently narrated by the
// summariser across sessions (different specific numbers/framing each
// time), measured ~0.41 similarity at best against this hosted project's
// pg_trgm -- genuinely different errors measured ~0.18-0.27. 0.35 sits
// between those two observed clusters. The RPC's own SQL-side default
// (migration 0006) is untouched -- apply.ts always passes this value
// explicitly, so that default is dead code, not a second place to update.
const TRIGRAM_THRESHOLD = 0.35
// Exported as of Sprint 13 (ADR-026): events.ts's prospective
// misconception-resolved check must use the SAME streak length the real
// resolution below uses, or the ping could fire a turn early/late.
export const RESOLUTION_STREAK = 3
// A claim older than this is treated as abandoned (the claiming process
// likely crashed mid-work) and eligible for reconcileSession to retry.
// Comfortably longer than the handful of sequential Supabase round trips
// applyInteraction's own work takes in practice.
const STALE_CLAIM_SECONDS = 30

// The outcome union session_interactions.outcome actually allows (adds
// 'none' -- "discussed but not attempted" -- to the package's narrower,
// FSRS-gradable Outcome). Replaces the old ConceptObservation['outcome']
// this file used to import from ./types (retired with the summariser,
// ADR-019) -- reasoningQuality/selfConfidence now come straight from the
// package, the one source of truth for those two unions.
export type InteractionOutcome = Outcome | 'none'

type KnowledgeNodeRow = {
  mastery: number
  stability: number
  difficulty: number
  observation_count: number
  last_practiced_at: string | null
  // Stored state label from the last write (DB CHECK-constrained to the
  // MasteryState union) -- read so computeNodeUpdate can report the PRIOR
  // state alongside the computed next one (Sprint 13, ADR-026). The write
  // path itself never consumes it.
  state: string
}

type MisconceptionMatch = {
  id: string
  status: 'pending' | 'active' | 'resolved'
  occurrence_count: number
}

type ActiveMisconceptionRow = {
  id: string
  consecutive_correct: number
}

function daysSince(timestamp: string | null): number {
  if (!timestamp) return 0
  return Math.max(0, (Date.now() - new Date(timestamp).getTime()) / MS_PER_DAY)
}

// The shared per-interaction core (Sprint 13, ADR-026): read the concept's
// knowledge_nodes row, assemble the FSRS observation (real
// timeSinceLastDays from last_practiced_at), run the pure
// updateKnowledgeNode -- WITHOUT writing anything. Extracted from
// applyMasteryUpdate below so the turn route's prospective ping
// computation (events.ts) and the real apply run the SAME input assembly
// and the SAME pure function over the same row: whatever this returns IS
// what the apply will write, so a ping derived from it cannot drift from
// the eventual write by construction. `priorState` is 'unseen' when no
// row exists yet (the concept has never been observed).
export type NodeUpdateComputation = {
  priorState: string
  // The row's mastery BEFORE this turn's update (0 for a never-seen concept,
  // same default `node.mastery` below already uses) -- additive (Sprint 14
  // Task 5, ADR-026 amendment): events.ts's mastery-progress ping needs a
  // single-turn delta, and this is the one place that already reads the
  // row, so exposing the value it already has avoids a second query rather
  // than requiring one.
  priorMastery: number
  next: KnowledgeNodeUpdate
}

export async function computeNodeUpdate(
  supabase: SupabaseClient,
  userId: string,
  conceptKey: string,
  observation: Omit<FsrsObservation, 'timeSinceLastDays'>
): Promise<NodeUpdateComputation> {
  const { data: existing } = await supabase
    .from('knowledge_nodes')
    .select('mastery, stability, difficulty, observation_count, last_practiced_at, state')
    .eq('user_id', userId)
    .eq('concept_key', conceptKey)
    .is('deleted_at', null)
    .maybeSingle()

  const row = existing as KnowledgeNodeRow | null

  const node = {
    mastery: row?.mastery ?? 0,
    stability: row?.stability ?? DEFAULT_STABILITY,
    difficulty: row?.difficulty ?? DEFAULT_DIFFICULTY,
    observationCount: row?.observation_count ?? 0,
  }

  const next = updateKnowledgeNode(node, {
    ...observation,
    timeSinceLastDays: daysSince(row?.last_practiced_at ?? null),
  })

  return { priorState: row?.state ?? 'unseen', priorMastery: node.mastery, next }
}

// The full §2.4 FSRS update, now run once per INTERACTION (ADR-019 revises
// ADR-016's session-end granularity). Returns the post-update node so the
// caller can feed it straight into scheduleReinforcement (PLAN §2.4 calls
// scheduleReinforcement(node) with the just-updated node, not the prior
// one). As of Sprint 13 the read+compute half lives in computeNodeUpdate
// above (shared with events.ts, ADR-026); this function is that plus the
// one upsert -- the write payload is unchanged.
async function applyMasteryUpdate(
  supabase: SupabaseClient,
  userId: string,
  conceptKey: string,
  observation: Omit<FsrsObservation, 'timeSinceLastDays'>
): Promise<{ stability: number; state: string }> {
  const { next } = await computeNodeUpdate(supabase, userId, conceptKey, observation)

  await supabase.from('knowledge_nodes').upsert(
    {
      user_id: userId,
      concept_key: conceptKey,
      mastery: next.mastery,
      stability: next.stability,
      difficulty: next.difficulty,
      state: next.state,
      confidence_band: next.confidenceBand,
      observation_count: next.observationCount,
      last_practiced_at: new Date().toISOString(),
    },
    { onConflict: 'user_id,concept_key' }
  )

  return { stability: next.stability, state: next.state }
}

// Sprint 17 seeding entry point (ADR-042). Onboarding (`web/lib/onboarding/
// seed.ts`) seeds knowledge_nodes through the SAME FSRS write a tutoring turn
// uses -- applyMasteryUpdate -- rather than a parallel seeder, so a seeded node
// is byte-identical in shape to a tutored one and `loadProfile` reads it with
// zero special-casing. It deliberately runs ONLY the node write: NOT the
// misconception + scheduleReinforcement steps applyInteraction adds around it,
// and NOT applyInteraction's session_interactions claim -- onboarding is a
// pre-panel gate, not a turn (ADR-042), and has no interaction row to claim.
// The caller owns the seed-if-absent / prerequisite-propagation policy; this
// is just the shared write. The observation is assembled by the caller exactly
// as any other apply-path caller does (Omit<FsrsObservation, timeSinceLastDays>
// -- the read-derived time-since is filled in by computeNodeUpdate).
export async function seedNodeObservation(
  supabase: SupabaseClient,
  userId: string,
  conceptKey: string,
  observation: Omit<FsrsObservation, 'timeSinceLastDays'>
): Promise<void> {
  await applyMasteryUpdate(supabase, userId, conceptKey, observation)
}

// Exact-category match first; else `pg_trgm` trigram similarity > 0.6 on
// `description` via the `match_misconception_trigram` RPC (0006,
// ADR-017) -- PostgREST has no filterable similarity() operator, so the
// fuzzy half of the match runs server-side through a SECURITY INVOKER
// function instead. Mirrors the exact-match query's lack of a `status`
// filter: a resolved row can still be matched (reactivation is
// unspecified/deferred, same as it already was for exact-category).
async function findMisconceptionMatch(
  supabase: SupabaseClient,
  userId: string,
  conceptKey: string,
  category: string,
  description: string | undefined
): Promise<MisconceptionMatch | null> {
  const { data: exact } = await supabase
    .from('misconceptions')
    .select('id, status, occurrence_count')
    .eq('user_id', userId)
    .eq('concept_key', conceptKey)
    .eq('category', category)
    .is('deleted_at', null)
    .maybeSingle()

  if (exact) return exact as MisconceptionMatch

  if (!description) return null

  const { data: fuzzy, error } = await supabase.rpc('match_misconception_trigram', {
    p_concept_key: conceptKey,
    p_description: description,
    p_threshold: TRIGRAM_THRESHOLD,
  })

  if (error || !Array.isArray(fuzzy) || fuzzy.length === 0) return null

  return fuzzy[0] as MisconceptionMatch
}

// Records one misconception occurrence: a new row (pending, 1 instance), or
// a bump on an existing match -- promoting pending -> active at 2 instances
// (ADR-014, unchanged) and resetting the resolution streak on any
// recurrence (PLAN §2.4 processMisconception).
async function applyMisconceptionOccurrence(
  supabase: SupabaseClient,
  userId: string,
  conceptKey: string,
  misconception: { category: string; description?: string }
): Promise<void> {
  const match = await findMisconceptionMatch(
    supabase,
    userId,
    conceptKey,
    misconception.category,
    misconception.description
  )

  if (!match) {
    await supabase.from('misconceptions').insert({
      user_id: userId,
      concept_key: conceptKey,
      category: misconception.category,
      description: misconception.description ?? null,
    })
    return
  }

  const occurrenceCount = match.occurrence_count + 1
  const status = match.status === 'pending' && occurrenceCount >= 2 ? 'active' : match.status

  await supabase
    .from('misconceptions')
    .update({
      occurrence_count: occurrenceCount,
      last_seen_at: new Date().toISOString(),
      status,
      consecutive_correct: 0,
    })
    .eq('id', match.id)
}

// Resolution (PLAN §2.4 processMisconception, ADR-017): a sound correct
// answer on this concept advances every active misconception's streak;
// 3 in a row flips it to resolved.
async function applyMisconceptionResolution(supabase: SupabaseClient, userId: string, conceptKey: string): Promise<void> {
  const { data } = await supabase
    .from('misconceptions')
    .select('id, consecutive_correct')
    .eq('user_id', userId)
    .eq('concept_key', conceptKey)
    .eq('status', 'active')
    .is('deleted_at', null)

  const activeRows = (data ?? []) as ActiveMisconceptionRow[]

  for (const row of activeRows) {
    const consecutiveCorrect = row.consecutive_correct + 1
    const resolved = consecutiveCorrect >= RESOLUTION_STREAK

    await supabase
      .from('misconceptions')
      .update({
        consecutive_correct: consecutiveCorrect,
        ...(resolved ? { status: 'resolved', resolved_at: new Date().toISOString() } : {}),
      })
      .eq('id', row.id)
  }
}

// Whether this concept currently has any 'active' misconception -- feeds
// scheduleReinforcement's priority boost (ADR-020). Queried AFTER the
// misconception occurrence/resolution calls below so it reflects this
// interaction's own effect (e.g. a resolution that just fired no longer
// counts).
async function hasActiveMisconception(supabase: SupabaseClient, userId: string, conceptKey: string): Promise<boolean> {
  const { count } = await supabase
    .from('misconceptions')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('concept_key', conceptKey)
    .eq('status', 'active')
    .is('deleted_at', null)

  return (count ?? 0) > 0
}

function isFsrsOutcome(outcome: InteractionOutcome): outcome is Outcome {
  return outcome !== 'none'
}

// The shape route.ts (ADR-019) inserts into session_interactions and both
// the per-turn after() hook and reconcileSession (below) pass back in here.
export type InteractionRecord = {
  id: string
  conceptKey: string | null
  outcome: InteractionOutcome
  reasoningQuality: ReasoningQuality
  selfConfidence: SelfConfidence
  misconceptionCategory: string | null
  // Free-text description of the flagged error, when present -- feeds
  // findMisconceptionMatch's pg_trgm fallback (ADR-017); without it, a
  // flagged misconception can only ever exact-category match.
  misconceptionDescription: string | null
  responseLatencyMs: number | null
}

// Write path for a SINGLE interaction (ADR-019 -- supersedes the Sprint 09
// per-summary applySessionSummary, retired below): the full FSRS update
// (now with a real response_latency_ms, restoring the third lucky-guess
// sub-guard ADR-016 had to omit) + scheduleReinforcement (ADR-020) + the
// same exact-category/trigram misconception matching and 3-correct
// resolution Sprint 09 already proved, applied per interaction instead of
// per session-end summary. Tolerates partial failure exactly as the old
// per-observation loop did -- one failed step never blocks the others.
//
// CLAIMS the row first via `claimed_at` (a separate marker from
// `applied_to_profile`), before doing any FSRS/misconception work. This is
// a genuine correctness requirement, not defensive padding: the turn
// route's off-critical-path after() hook and a session-end reconcile sweep
// can both reach the SAME unclaimed row. Marking `applied_to_profile` true
// at claim time (a single boolean, the first version of this function)
// stops the double-apply, but then that column no longer reliably means
// "the write landed" -- only "someone started it" -- so a reconcile sweep
// racing an in-flight after() would see "already applied" and skip a row
// whose FSRS/misconception writes hadn't actually landed yet (confirmed
// during Task 5 verification: a real double-counted occurrence_count with
// the single-flag version, and a real "missing write" with the naive
// two-caller read). `claimed_at` set now + `applied_to_profile` set only
// once genuinely done keeps both properties: no double-apply, and
// reconcileSession (below) can tell "someone else has this, still
// working" apart from "abandoned, needs a retry."
export async function applyInteraction(
  supabase: SupabaseClient,
  userId: string,
  sessionId: string,
  interaction: InteractionRecord
): Promise<void> {
  const staleThreshold = new Date(Date.now() - STALE_CLAIM_SECONDS * 1000).toISOString()

  const { data: claimed } = await supabase
    .from('session_interactions')
    .update({ claimed_at: new Date().toISOString() })
    .eq('id', interaction.id)
    .eq('user_id', userId)
    .eq('session_id', sessionId)
    .eq('applied_to_profile', false)
    .or(`claimed_at.is.null,claimed_at.lt.${staleThreshold}`)
    .select('id')

  if (!claimed || claimed.length === 0) {
    // Already applied, or already claimed recently enough that whoever
    // holds it is presumably still working -- nothing left to do here.
    return
  }

  const {
    conceptKey,
    outcome,
    reasoningQuality,
    selfConfidence,
    misconceptionCategory,
    misconceptionDescription,
    responseLatencyMs,
  } = interaction

  if (conceptKey && KNOWN_CONCEPT_KEYS.includes(conceptKey)) {
    if (isFsrsOutcome(outcome)) {
      try {
        const node = await applyMasteryUpdate(supabase, userId, conceptKey, {
          outcome,
          reasoningQuality,
          selfConfidence,
          ...(responseLatencyMs !== null ? { responseLatencyMs } : {}),
        })

        if (misconceptionCategory) {
          await applyMisconceptionOccurrence(supabase, userId, conceptKey, {
            category: misconceptionCategory,
            ...(misconceptionDescription ? { description: misconceptionDescription } : {}),
          })
        } else if (outcome === 'correct' && reasoningQuality === 'sound') {
          await applyMisconceptionResolution(supabase, userId, conceptKey)
        }

        const misconceptionActive = await hasActiveMisconception(supabase, userId, conceptKey)
        await scheduleReinforcement(supabase, userId, conceptKey, node, {
          hasActiveMisconception: misconceptionActive,
          lastOutcomeFailed: outcome === 'incorrect',
        })
      } catch {
        // One failed step never blocks the rest of applyInteraction, and
        // never blocks marking the row applied below -- a mechanically-
        // failing concept is marked done rather than retried forever by
        // the reconcile sweep. Same best-effort posture the old
        // summary-based write held.
      }
    } else if (misconceptionCategory) {
      // outcome 'none' still lets a flagged misconception register --
      // matches the old per-observation loop's independence between the
      // FSRS branch and the misconception branch.
      try {
        await applyMisconceptionOccurrence(supabase, userId, conceptKey, {
          category: misconceptionCategory,
          ...(misconceptionDescription ? { description: misconceptionDescription } : {}),
        })
      } catch {
        // Same tolerance as above.
      }
    }
  }

  // Set only once the work above has actually run (successfully or not) --
  // this is what lets reconcileSession's staleness check (below) tell an
  // in-flight claim apart from one that's truly finished.
  await supabase
    .from('session_interactions')
    .update({ applied_to_profile: true })
    .eq('id', interaction.id)
    .eq('user_id', userId)
    .eq('session_id', sessionId)
}

type UnappliedInteractionRow = {
  id: string
  user_id: string
  concept_key: string | null
  outcome: InteractionOutcome
  reasoning_quality: ReasoningQuality
  self_confidence: SelfConfidence
  misconception_category: string | null
  misconception_description: string | null
  response_latency_ms: number | null
}

type UnappliedUserRow = UnappliedInteractionRow & { session_id: string }

// Caps a single sweep -- a pathological backlog is worked off across
// successive session starts rather than stalling any one of them.
const USER_SWEEP_LIMIT = 50

// Reconciliation sweep (ADR-019): attempts every session_interactions row
// still marked applied_to_profile=false -- a safety net, NOT the primary
// write path (that's the per-turn after() hook, which in the common case
// has already applied every row by the time a session ends). applyInteraction's
// own claimed_at check (above) decides whether each row is actually still
// unclaimed/stale (do the work) or recently claimed by an in-flight after()
// (skip -- it's presumably about to finish on its own), so this sweep never
// needs to reason about that itself. Ordered by turn_index so a concept's
// updates apply in the order they actually happened, matching how the old
// summary's observation list applied in order.
export async function reconcileSession(supabase: SupabaseClient, sessionId: string): Promise<void> {
  const { data } = await supabase
    .from('session_interactions')
    .select(
      'id, user_id, concept_key, outcome, reasoning_quality, self_confidence, misconception_category, misconception_description, response_latency_ms'
    )
    .eq('session_id', sessionId)
    .eq('applied_to_profile', false)
    .is('deleted_at', null)
    .order('turn_index', { ascending: true })

  const rows = (data ?? []) as UnappliedInteractionRow[]

  for (const row of rows) {
    try {
      await applyInteraction(supabase, row.user_id, sessionId, {
        id: row.id,
        conceptKey: row.concept_key,
        outcome: row.outcome,
        reasoningQuality: row.reasoning_quality,
        selfConfidence: row.self_confidence,
        misconceptionCategory: row.misconception_category,
        misconceptionDescription: row.misconception_description,
        responseLatencyMs: row.response_latency_ms,
      })
    } catch {
      // One bad row never blocks the rest -- same tolerance
      // applyInteraction already applies internally, one layer up.
    }
  }
}

// Cross-session safety net (Sprint 11 audit follow-up to ADR-019):
// reconcileSession above only runs when /api/session/end is actually
// reached, so a session the client abandoned -- browser crash, closed
// laptop, network loss -- strands its unapplied rows forever: in the DB,
// but never folded into knowledge_nodes or the reinforcement queue, and
// invisible to the tutor and (later) the dashboard alike. Swept here at
// the next session START instead (idx_si_user_applied is exactly this
// query's index): the new session's own rows don't exist yet, so the sweep
// can only ever touch leftovers, and applyInteraction's claimed_at lease
// already arbitrates against any in-flight after() hook from a session
// still open elsewhere. Ordered by created_at -- turn_index only orders
// within one session, and this sweep crosses sessions.
export async function reconcileUnappliedForUser(supabase: SupabaseClient, userId: string): Promise<void> {
  const { data } = await supabase
    .from('session_interactions')
    .select(
      'id, session_id, user_id, concept_key, outcome, reasoning_quality, self_confidence, misconception_category, misconception_description, response_latency_ms'
    )
    .eq('user_id', userId)
    .eq('applied_to_profile', false)
    .is('deleted_at', null)
    .order('created_at', { ascending: true })
    .limit(USER_SWEEP_LIMIT)

  const rows = (data ?? []) as UnappliedUserRow[]

  for (const row of rows) {
    try {
      await applyInteraction(supabase, userId, row.session_id, {
        id: row.id,
        conceptKey: row.concept_key,
        outcome: row.outcome,
        reasoningQuality: row.reasoning_quality,
        selfConfidence: row.self_confidence,
        misconceptionCategory: row.misconception_category,
        misconceptionDescription: row.misconception_description,
        responseLatencyMs: row.response_latency_ms,
      })
    } catch {
      // Same one-bad-row tolerance as reconcileSession above.
    }
  }
}
