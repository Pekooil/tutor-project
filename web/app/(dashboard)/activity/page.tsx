import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { loadDashboard } from '@/lib/learning/dashboard-read'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { ActivityChart } from '@/components/dashboard/ActivityChart'
import { TrendChart, type TrendPoint } from '@/components/dashboard/TrendChart'

// Activity view. Two trends, honestly different in nature:
//   1. Accuracy + sessions over time — REAL historical data from
//      session_interactions (loadDashboard's `activity`, aggregated by day on
//      created_at; never keyed on (session_id, turn_index), the display-order
//      note from the Sprint 11 audit). Backfilled from existing rows, so it is
//      never empty for an active user.
//   2. Mastery over time — the FORWARD-ONLY trend from mastery_snapshot (Task
//      5). There is no history to backfill (ADR-047), so it is honestly
//      empty/sparse at launch and the chart says so. Read here (not in
//      loadDashboard, which deliberately excludes the snapshot) via the
//      RLS-scoped client — mastery_snapshot_select_own scopes it to the caller.
// Server-rendered fresh per request (ADR-047: no cache).
export const dynamic = 'force-dynamic'

type SnapshotRow = { day: string; mastery: number }

// Average the per-concept snapshot rows into one overall mastery point per day,
// ascending — the honest "how am I doing overall" line. Rows arrive ordered by
// day; this preserves that order.
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

  const data = await loadDashboard(supabase)

  // Forward-only mastery trend. RLS-scoped; degrades to an empty trend (the
  // honest launch state) on any read error rather than failing the page.
  const { data: snapshotRows } = await supabase
    .from('mastery_snapshot')
    .select('day, mastery')
    .eq('user_id', user.id)
    .order('day', { ascending: true })

  const trend = aggregateTrend((snapshotRows ?? []) as SnapshotRow[])

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl leading-none font-semibold text-foreground">Activity</h1>
        <p className="text-sm text-muted-foreground">
          Your work over time — accuracy and sessions from your real history, and a mastery trend
          that builds as you practice.
        </p>
      </div>

      <Card>
        <CardHeader>
          <h2 className="text-sm leading-none font-medium text-muted-foreground">
            Accuracy &amp; sessions
          </h2>
        </CardHeader>
        <CardContent>
          <ActivityChart days={data.activity} />
        </CardContent>
      </Card>

      <Card className="bg-surface">
        <CardHeader>
          <h2 className="text-sm leading-none font-medium text-muted-foreground">Mastery trend</h2>
        </CardHeader>
        <CardContent>
          <TrendChart points={trend} />
        </CardContent>
      </Card>
    </div>
  )
}
