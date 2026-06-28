import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { updateMasteryNode } from './update'
import { KNOWN_CONCEPT_KEYS, type ConceptObservation, type SessionSummary } from './types'

type KnowledgeNodeRow = {
  mastery: number
  observation_count: number
}

type MisconceptionRow = {
  id: string
  status: 'pending' | 'active' | 'resolved'
  occurrence_count: number
}

async function applyMasteryUpdate(
  supabase: SupabaseClient,
  userId: string,
  observation: ConceptObservation
): Promise<void> {
  const { data: existing } = await supabase
    .from('knowledge_nodes')
    .select('mastery, observation_count')
    .eq('user_id', userId)
    .eq('concept_key', observation.conceptKey)
    .is('deleted_at', null)
    .maybeSingle()

  const row = existing as KnowledgeNodeRow | null
  const prev = { mastery: row?.mastery ?? 0.0, observationCount: row?.observation_count ?? 0 }
  const next = updateMasteryNode(prev, observation)

  await supabase.from('knowledge_nodes').upsert(
    {
      user_id: userId,
      concept_key: observation.conceptKey,
      mastery: next.mastery,
      state: next.state,
      confidence_band: next.confidenceBand,
      observation_count: next.observationCount,
      last_practiced_at: new Date().toISOString(),
    },
    { onConflict: 'user_id,concept_key' }
  )
}

// Exact-category match + 2-instance pending->active promotion only (ADR-014).
// No fuzzy/`pgvector` matching and no 3-correct resolution streak this sprint.
async function applyMisconception(
  supabase: SupabaseClient,
  userId: string,
  conceptKey: string,
  misconception: { category: string; description?: string }
): Promise<void> {
  const { data: existing } = await supabase
    .from('misconceptions')
    .select('id, status, occurrence_count')
    .eq('user_id', userId)
    .eq('concept_key', conceptKey)
    .eq('category', misconception.category)
    .is('deleted_at', null)
    .maybeSingle()

  const row = existing as MisconceptionRow | null

  if (!row) {
    await supabase.from('misconceptions').insert({
      user_id: userId,
      concept_key: conceptKey,
      category: misconception.category,
      description: misconception.description ?? null,
    })
    return
  }

  const occurrenceCount = row.occurrence_count + 1
  const status = row.status === 'pending' && occurrenceCount >= 2 ? 'active' : row.status

  await supabase
    .from('misconceptions')
    .update({ occurrence_count: occurrenceCount, last_seen_at: new Date().toISOString(), status })
    .eq('id', row.id)
}

// Minimal write path for the live knowledge graph (ADR-014/ADR-015): one
// upsert per observed concept (mastery nudge via updateMasteryNode) plus an
// exact-category/2-instance misconception promotion. Every write goes
// through the caller's RLS-scoped client (rows land owner-scoped, as the
// signed-in user). One bad observation never aborts the rest -- the
// session-end caller (Task 5) treats this whole call as best-effort.
export async function applySessionSummary(supabase: SupabaseClient, summary: SessionSummary): Promise<void> {
  const { data: userData } = await supabase.auth.getUser()
  const userId = userData?.user?.id
  if (!userId) return

  for (const observation of summary.observations) {
    if (!KNOWN_CONCEPT_KEYS.includes(observation.conceptKey)) continue
    if (observation.outcome === 'none') continue // discussed, not attempted -- no signal to record

    try {
      await applyMasteryUpdate(supabase, userId, observation)
    } catch {
      // One bad observation never aborts the rest.
    }

    if (observation.misconception) {
      try {
        await applyMisconception(supabase, userId, observation.conceptKey, observation.misconception)
      } catch {
        // Same tolerance as above.
      }
    }
  }
}
