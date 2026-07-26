import type { SupabaseClient } from '@supabase/supabase-js'
import { loadDashboard } from '@/lib/learning/dashboard-read'
import { loadMasteryTrend } from '@/lib/learning/analytics-read'
import { progressScore, type SignalKey } from '@/components/studio/analytics'

// The end-of-session "what changed" summary.
//
// The /data progress score is a composite — mastery 50, accuracy 30,
// consistency 20 — and telling a student what one session moved needs a reading
// from before it. None of the three could supply one after the fact:
//   · mastery comes from the daily mastery_snapshot cron and does not move
//     within a day, while knowledge_nodes holds current state only;
//   · accuracy and consistency are computed over a rolling window of activity
//     days, so the moment this session's interactions land the "before" is gone.
//
// So the whole score is snapshotted when the session OPENS (migration 0028's
// sessions.score_at_start) and diffed when it ends. Both ends run OFF the
// critical path — a snapshot is never worth slowing a session start or end for,
// and a missing one degrades to "no summary", never to an error.

/** The four numbers worth keeping. Any may be null before a student has the
 *  history to unlock that signal. */
export type ScoreSnapshot = {
  score: number | null
  mastery: number | null
  accuracy: number | null
  consistency: number | null
}

export type SignalDelta = {
  key: SignalKey
  label: string
  before: number | null
  after: number | null
  /** after - before, only when BOTH are numbers. A signal that just unlocked
   *  has no delta — "+62" would read as a leap rather than a first reading. */
  change: number | null
}

export type ScoreChange = {
  before: number | null
  after: number | null
  change: number | null
  signals: SignalDelta[]
}

const LABEL: Record<SignalKey, string> = {
  mastery: 'Mastery',
  accuracy: 'Accuracy',
  consistency: 'Consistency',
}

/**
 * Compute the caller's progress score right now. Two RLS-scoped reads (the
 * dashboard graph + the mastery trend), so callers should keep it off any
 * latency-sensitive path. Resolves null if either read throws — every caller
 * treats "no snapshot" as a non-event.
 */
export async function readScoreSnapshot(supabase: SupabaseClient): Promise<ScoreSnapshot | null> {
  try {
    // Both reads resolve the user from the client's own session, so the caller
    // passes no id — and both are RLS-scoped, so they can only ever see the
    // caller's own graph.
    const [dashboard, trend] = await Promise.all([loadDashboard(supabase), loadMasteryTrend(supabase)])
    const score = progressScore({ dashboard, trend, nowIso: new Date().toISOString() })
    const valueOf = (key: SignalKey) => score.signals.find((s) => s.key === key)?.value ?? null
    return {
      score: score.score,
      mastery: valueOf('mastery'),
      accuracy: valueOf('accuracy'),
      consistency: valueOf('consistency'),
    }
  } catch (err) {
    console.error('score-snapshot: read failed', err)
    return null
  }
}

/** Narrow an unknown jsonb column back to a snapshot. Anything unexpected —
 *  a pre-0028 session, a partial write, hand-edited data — reads as absent. */
export function parseScoreSnapshot(raw: unknown): ScoreSnapshot | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
  const snap: ScoreSnapshot = {
    score: num(r.score),
    mastery: num(r.mastery),
    accuracy: num(r.accuracy),
    consistency: num(r.consistency),
  }
  // All-null carries no information — treat it as no snapshot at all.
  return snap.score === null && snap.mastery === null && snap.accuracy === null && snap.consistency === null
    ? null
    : snap
}

/**
 * Diff two snapshots into the shape the recap renders. Returns null when there
 * is nothing worth saying: no "before", or every signal sat still. A summary
 * that says "nothing changed" after a real session is worse than no summary —
 * it reads as the app failing to notice.
 */
export function diffScore(before: ScoreSnapshot | null, after: ScoreSnapshot | null): ScoreChange | null {
  if (!before || !after) return null

  const signals: SignalDelta[] = (Object.keys(LABEL) as SignalKey[]).map((key) => {
    const b = before[key]
    const a = after[key]
    return {
      key,
      label: LABEL[key],
      before: b,
      after: a,
      change: typeof b === 'number' && typeof a === 'number' ? a - b : null,
    }
  })

  const moved = signals.some((s) => s.change !== null && s.change !== 0)
  const scoreChange =
    typeof before.score === 'number' && typeof after.score === 'number' ? after.score - before.score : null
  if (!moved && (scoreChange === null || scoreChange === 0)) return null

  return { before: before.score, after: after.score, change: scoreChange, signals }
}
