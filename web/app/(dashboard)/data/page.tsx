import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { loadDashboard } from '@/lib/learning/dashboard-read'
import { loadMasteryTrend } from '@/lib/learning/analytics-read'
import { DataScreen } from '@/components/studio/DataScreen'

// Progress — "where you stand". Two reads, both RLS-scoped and server-rendered
// fresh per request (ADR-047: a read is eventually consistent with the last
// turn's apply, so there is no cache to serve a stale chart from):
//
//   · loadDashboard    — current state: strands, misconceptions, the review
//                        queue, and real per-day accuracy from
//                        session_interactions.
//   · loadMasteryTrend — the ONLY source of mastery HISTORY. knowledge_nodes is
//                        current-state only, so the score's trend line comes
//                        from the forward-only mastery_snapshot cron and is
//                        honestly short until it has accrued.
//
// `now` is stamped here and threaded through every derivation, so the page's
// UTC-day windows are computed once against one clock rather than re-read.
export const dynamic = 'force-dynamic'

export default async function DataPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  const [dashboard, trend] = await Promise.all([loadDashboard(supabase), loadMasteryTrend(supabase)])

  return <DataScreen input={{ dashboard, trend, nowIso: new Date().toISOString() }} />
}
