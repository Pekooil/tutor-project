import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { R_DESIRED } from '@calyxa/learning-model'

// PLAN.md §2.4 "Spaced reinforcement scheduler" (ADR-020): inverts the same
// FSRS power-decay retrievability curve updateKnowledgeNode already uses
// for read-time decay -- R = (1 + t/(9S))^-1 -- solved for t at the desired
// retention R_DESIRED (0.90): t = 9S(1/R - 1). Called once per gradable
// interaction, immediately after the FSRS update, off the ones already-
// persisted stability/state (Sprint 09's discipline: no model change, this
// sprint just reads what Sprint 09 started writing).

const MIN_INTERVAL_DAYS = 0.5
const MAX_INTERVAL_DAYS = 365
// Weak/forgotten concepts are pulled forward -- reviewed sooner than the
// raw retention-interval math alone would schedule them.
const URGENCY_INTERVAL_SCALE = 0.5

const BASE_PRIORITY = 0.5
const MISCONCEPTION_PRIORITY_BOOST = 0.3
const URGENCY_PRIORITY_BOOST = 0.2

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

type ScheduleInputNode = {
  stability: number
  state: string
}

type ExistingScheduleRow = {
  lapses: number
}

// Upserts one reinforcement_schedule row for (user, concept) -- PLAN §2.3's
// unique(user_id, concept_key) makes this a pure upsert, never an insert +
// a separate update path. Tolerates its own failure silently (matches
// apply.ts's per-observation discipline): a scheduling failure never blocks
// the FSRS update or the interaction's applied_to_profile flip.
export async function scheduleReinforcement(
  supabase: SupabaseClient,
  userId: string,
  conceptKey: string,
  node: ScheduleInputNode,
  { hasActiveMisconception, lastOutcomeFailed }: { hasActiveMisconception: boolean; lastOutcomeFailed: boolean }
): Promise<void> {
  const isUrgent = node.state === 'weak' || node.state === 'forgotten'

  let intervalDays = 9 * node.stability * (1 / R_DESIRED - 1)
  if (isUrgent) {
    intervalDays *= URGENCY_INTERVAL_SCALE
  }
  intervalDays = clamp(intervalDays, MIN_INTERVAL_DAYS, MAX_INTERVAL_DAYS)

  const priority =
    BASE_PRIORITY +
    (hasActiveMisconception ? MISCONCEPTION_PRIORITY_BOOST : 0) +
    (isUrgent ? URGENCY_PRIORITY_BOOST : 0)

  const now = new Date()
  const dueAt = new Date(now.getTime() + intervalDays * 24 * 60 * 60 * 1000)

  const { data: existing } = await supabase
    .from('reinforcement_schedule')
    .select('lapses')
    .eq('user_id', userId)
    .eq('concept_key', conceptKey)
    .is('deleted_at', null)
    .maybeSingle()

  const priorLapses = (existing as ExistingScheduleRow | null)?.lapses ?? 0
  const lapses = priorLapses + (lastOutcomeFailed ? 1 : 0)

  await supabase.from('reinforcement_schedule').upsert(
    {
      user_id: userId,
      concept_key: conceptKey,
      due_at: dueAt.toISOString(),
      interval_days: intervalDays,
      priority,
      lapses,
      last_review_at: now.toISOString(),
    },
    { onConflict: 'user_id,concept_key' }
  )
}
