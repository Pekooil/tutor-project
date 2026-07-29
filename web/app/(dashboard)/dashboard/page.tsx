import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { loadDashboard } from '@/lib/learning/dashboard-read'
import { loadSessionQuota } from '@/lib/learning/activity-read'
import { todaysReview } from '@/components/dashboard/premium/derive'
import { DashboardScreen } from '@/components/studio/DashboardScreen'
import { reviewSchedule } from '@/components/studio/schedule'
import { comparisonLine, loadHomeworkDashboard, loadHomeworkHistory } from '@/lib/learning/homework-read'

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
  // The v4 homework reads (ADR-057) ride the same parallel fetch as the rest —
  // they must never serialize behind the profile read on the critical path.
  const [data, quota, homeworkDash, homeworkHistory] = await Promise.all([
    loadDashboard(supabase),
    loadSessionQuota(supabase),
    loadHomeworkDashboard(supabase),
    loadHomeworkHistory(supabase, 20),
  ])

  const schedule = reviewSchedule(data.dueQueue, data.activity, now)

  return (
    <DashboardScreen
      now={now}
      quota={quota}
      due={todaysReview(data, now)}
      schedule={schedule}
      isEmpty={data.isEmpty}
      homework={{
        paused: homeworkDash.paused,
        latest: homeworkDash.latest,
        // Self-comparison is always against the student's OWN history, never
        // other students, and only against a set of comparable size.
        latestComparison: homeworkDash.latest ? comparisonLine(homeworkDash.latest, homeworkHistory) : '',
        // Only claimed when the set actually opened a tutoring session, since
        // that is the only case a kit exists to link to.
        latestKitHref: homeworkDash.latest?.tutoringSessionId ? '/library' : null,
      }}
    />
  )
}
