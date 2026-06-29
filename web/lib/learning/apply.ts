import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { updateKnowledgeNode, type FsrsObservation, type Outcome } from '@calyxa/learning-model'
import { KNOWN_CONCEPT_KEYS, type ConceptObservation, type SessionSummary } from './types'

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
const RESOLUTION_STREAK = 3

type KnowledgeNodeRow = {
  mastery: number
  stability: number
  difficulty: number
  observation_count: number
  last_practiced_at: string | null
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

// The full §2.4 FSRS update (ADR-016), run once per concept at session end.
// Replaces the Sprint 08 minimal Elo nudge (`./update.ts`, now removed) --
// stability/difficulty are now persisted, where Sprint 08 dropped them.
async function applyMasteryUpdate(
  supabase: SupabaseClient,
  userId: string,
  conceptKey: string,
  observation: Omit<FsrsObservation, 'timeSinceLastDays'>
): Promise<void> {
  const { data: existing } = await supabase
    .from('knowledge_nodes')
    .select('mastery, stability, difficulty, observation_count, last_practiced_at')
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

function isFsrsOutcome(outcome: ConceptObservation['outcome']): outcome is Outcome {
  return outcome !== 'none'
}

// Write path for the live knowledge graph (ADR-014/ADR-015/ADR-016/ADR-017):
// the full FSRS update per observed concept, plus exact-category/trigram
// misconception matching with 2-instance promotion and 3-correct
// resolution. Every write goes through the caller's RLS-scoped client (rows
// land owner-scoped, as the signed-in user). One bad observation never
// aborts the rest -- the session-end caller treats this whole call as
// best-effort.
export async function applySessionSummary(supabase: SupabaseClient, summary: SessionSummary): Promise<void> {
  const { data: userData } = await supabase.auth.getUser()
  const userId = userData?.user?.id
  if (!userId) return

  for (const observation of summary.observations) {
    if (!KNOWN_CONCEPT_KEYS.includes(observation.conceptKey)) continue

    const { outcome } = observation
    if (isFsrsOutcome(outcome)) {
      try {
        await applyMasteryUpdate(supabase, userId, observation.conceptKey, {
          outcome,
          reasoningQuality: observation.reasoningQuality,
          selfConfidence: observation.selfConfidence,
        })
      } catch {
        // One bad observation never aborts the rest.
      }
    }

    if (observation.misconception) {
      try {
        await applyMisconceptionOccurrence(supabase, userId, observation.conceptKey, observation.misconception)
      } catch {
        // Same tolerance as above.
      }
    } else if (outcome === 'correct' && observation.reasoningQuality === 'sound') {
      try {
        await applyMisconceptionResolution(supabase, userId, observation.conceptKey)
      } catch {
        // Same tolerance as above.
      }
    }
  }
}
