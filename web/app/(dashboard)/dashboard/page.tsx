import { redirect } from 'next/navigation'
import { CONCEPT_KEYS } from '@calyxa/curriculum'
import { createClient } from '@/lib/supabase/server'
import { loadDashboard } from '@/lib/learning/dashboard-read'
import { loadRecentSessions } from '@/lib/learning/activity-read'
import { loadNavUser } from '@/components/dashboard/premium/user-info'
import { loadStudyKits } from '@/components/dashboard/premium/kits-read'
import { ContinueLearningScreen } from '@/components/dashboard/premium/ContinueLearningScreen'

// The post-login home — reframed as "Continue learning" (what to review next),
// not an analytics overview. Server-rendered fresh per request (ADR-047: reads
// are eventually consistent with the last turn's apply, so no cache).
// loadDashboard reuses loadProfile's decay math so these numbers match the
// overlay's; the adaptive review queue is driven by reinforcement_schedule.
export const dynamic = 'force-dynamic'

export default async function DashboardPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  const [data, navUser, kits] = await Promise.all([
    loadDashboard(supabase),
    loadNavUser(supabase),
    loadStudyKits(supabase),
  ])
  // Kit hrefs are session ids (or artifact ids for session-less kits) — the set
  // tags which recent sessions produced a kit.
  const recentSessions = await loadRecentSessions(supabase, new Set(kits.map((k) => k.href)))
  const firstName = navUser.name.split(' ')[0]

  return (
    <ContinueLearningScreen
      data={data}
      now={new Date()}
      firstName={firstName}
      totalCurriculum={CONCEPT_KEYS.length}
      kits={kits}
      recentSessions={recentSessions}
    />
  )
}
