import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { loadDashboard } from '@/lib/learning/dashboard-read'
import { loadSessionQuota, loadRecentSessions } from '@/lib/learning/activity-read'
import { loadStudyKits } from '@/components/dashboard/premium/kits-read'
import type { TrendPoint } from '@/components/dashboard/TrendChart'
import { ActivityScreen } from '@/components/dashboard/premium/ActivityScreen'

// Activity view. Real historical accuracy/sessions from session_interactions
// (loadDashboard's `activity`) drive the heatmap + answer bars + sessions/week;
// the forward-only mastery trend reads mastery_snapshot (Task 5) — honestly
// empty/sparse at launch (ADR-047). Server-rendered fresh per request.
export const dynamic = 'force-dynamic'

type SnapshotRow = { day: string; mastery: number }

// Average the per-concept snapshot rows into one overall mastery point per day,
// ascending — the honest "how am I doing overall" line.
function aggregateTrend(rows: SnapshotRow[]): TrendPoint[] {
  const byDay = new Map<string, { sum: number; count: number }>()
  for (const row of rows) {
    const bucket = byDay.get(row.day)
    if (bucket) {
      bucket.sum += row.mastery
      bucket.count += 1
    } else {
      byDay.set(row.day, { sum: row.mastery, count: 1 })
    }
  }
  return [...byDay.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([day, { sum, count }]) => ({ day, mastery: count > 0 ? sum / count : 0 }))
}

export default async function ActivityPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  const [data, quota, kits] = await Promise.all([
    loadDashboard(supabase),
    loadSessionQuota(supabase),
    loadStudyKits(supabase),
  ])

  // A kit's href is its session id (or an artifact id for a session-less kit,
  // which simply won't match any session), so this set tags each recent
  // session with whether it produced a kit.
  const kitSessionIds = new Set(kits.map((k) => k.href))
  const sessions = await loadRecentSessions(supabase, kitSessionIds)

  const { data: snapshotRows } = await supabase
    .from('mastery_snapshot')
    .select('day, mastery')
    .eq('user_id', user.id)
    .order('day', { ascending: true })

  const trend = aggregateTrend((snapshotRows ?? []) as SnapshotRow[])

  return <ActivityScreen data={data} trend={trend} quota={quota} sessions={sessions} />
}
