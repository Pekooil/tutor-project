import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'

// The Data tab's one extra read. Everything else the analytics console shows is
// already inside `loadDashboard`'s return (strands / misconceptions / dueQueue /
// activity) — the one thing it deliberately does NOT carry is mastery HISTORY,
// because `knowledge_nodes` is current-state only. `mastery_snapshot` (0020) is
// the forward-only trend source the daily cron accrues, and nothing has read it
// for display since the pre-studio dashboard was retired.
//
// Same discipline as `dashboard-read.ts`: server-only, RLS-scoped (the table's
// policy is select-own; the explicit `eq('user_id', …)` is defense-in-depth),
// fresh per request, and NEVER throws — an errored read degrades to an empty
// trend, which the console then treats as "not enough history yet" rather than
// as a broken panel.
//
// Honesty note (ADR-047): snapshots are written the day they are true and are
// never backfilled. A trend that starts three days ago IS three days long. The
// console renders the real length and hides the trend entirely below its
// threshold — it must never interpolate a curve backwards.

const MS_PER_DAY = 86_400_000

// One row per (user, concept, day). A student practising ~40 concepts accrues
// ~40 rows/day, so 90 days of history is ~3.6k rows — this cap keeps the
// per-request read bounded while covering the longest window the console
// offers. Rows are read NEWEST-first, so a capped read loses the oldest days
// (a shorter trend), never a wrong recent number.
const LIMIT_SNAPSHOT_SCAN = 6000

/** The window the console can chart. Also the cap on how far back we read. */
export const TREND_WINDOW_DAYS = 90

type SnapshotRow = {
  concept_key: string
  day: string
  mastery: number
  state: string
}

/** One UTC calendar day of the mastery trend. */
export type MasteryTrendDay = {
  /** UTC calendar day, `YYYY-MM-DD` — the same bucket key `activity` uses. */
  day: string
  /** Mean decay-adjusted mastery across every concept snapshotted that day, [0,1]. */
  mastery: number
  /** How many concepts that mean is over — the console shows it so a one-concept
   *  day is never mistaken for a whole-graph reading. */
  concepts: number
  /** Concepts in the `mastered` state that day. */
  mastered: number
}

function utcDayStr(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

/**
 * The per-day mastery trend for the signed-in user, ascending by day, covering
 * at most the last `windowDays` UTC days. Days with no snapshot are ABSENT from
 * the array rather than zero-filled — a gap is a day the cron did not run, not a
 * day the student knew nothing, and zero-filling would draw a cliff that never
 * happened.
 */
export async function loadMasteryTrend(
  supabase: SupabaseClient,
  windowDays: number = TREND_WINDOW_DAYS
): Promise<MasteryTrendDay[]> {
  const { data: userData, error: userError } = await supabase.auth.getUser()
  const userId = userData?.user?.id
  if (userError || !userId) return []

  const since = utcDayStr(Date.now() - windowDays * MS_PER_DAY)

  const { data, error } = await supabase
    .from('mastery_snapshot')
    .select('concept_key, day, mastery, state')
    .eq('user_id', userId)
    .gte('day', since)
    .order('day', { ascending: false })
    .limit(LIMIT_SNAPSHOT_SCAN)

  if (error || !data) return []

  const byDay = new Map<string, { sum: number; concepts: number; mastered: number }>()
  for (const row of data as SnapshotRow[]) {
    let bucket = byDay.get(row.day)
    if (!bucket) {
      bucket = { sum: 0, concepts: 0, mastered: 0 }
      byDay.set(row.day, bucket)
    }
    bucket.sum += row.mastery
    bucket.concepts += 1
    if (row.state === 'mastered') bucket.mastered += 1
  }

  return [...byDay.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([day, b]) => ({
      day,
      mastery: b.concepts > 0 ? b.sum / b.concepts : 0,
      concepts: b.concepts,
      mastered: b.mastered,
    }))
}
