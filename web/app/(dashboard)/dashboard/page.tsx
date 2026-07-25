import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { loadDashboard } from '@/lib/learning/dashboard-read'
import { loadSessionQuota } from '@/lib/learning/activity-read'
import { loadNavUser } from '@/components/dashboard/premium/user-info'
import { todaysReview } from '@/components/dashboard/premium/derive'
import { buildStudioCatalog } from '@/components/studio/catalog-read'
import { DashboardScreen } from '@/components/studio/DashboardScreen'

// The post-login home — the Notebook Studio dashboard: today's review first,
// then the browser over every subject and concept that has been tutored.
// Server-rendered fresh per request (ADR-047: reads are eventually consistent
// with the last turn's apply, so no cache). loadDashboard reuses loadProfile's
// decay math so these numbers match the overlay's; the review queue is driven by
// reinforcement_schedule, and buildStudioCatalog adds the per-concept study-kit
// counts on top of the same read.
export const dynamic = 'force-dynamic'

export default async function DashboardPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  const now = new Date()
  const [data, navUser, quota] = await Promise.all([
    loadDashboard(supabase),
    loadNavUser(supabase),
    loadSessionQuota(supabase),
  ])
  const subjects = await buildStudioCatalog(supabase, data, now)

  return (
    <DashboardScreen
      firstName={navUser.name.split(' ')[0]}
      now={now}
      quota={quota}
      due={todaysReview(data, now)}
      subjects={subjects}
      isEmpty={data.isEmpty}
    />
  )
}
