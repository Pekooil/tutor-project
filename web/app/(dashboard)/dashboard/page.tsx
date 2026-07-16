import { redirect } from 'next/navigation'
import { CONCEPT_KEYS } from '@calyxa/curriculum'
import { createClient } from '@/lib/supabase/server'
import { loadDashboard } from '@/lib/learning/dashboard-read'
import { loadNavUser } from '@/components/dashboard/premium/user-info'
import { loadStudyKits } from '@/components/dashboard/premium/kits-read'
import { OverviewScreen } from '@/components/dashboard/premium/OverviewScreen'

// Overview. Server-rendered fresh per request (ADR-047: dashboard reads are
// eventually consistent with the last turn's apply, so no cache). loadDashboard
// reuses loadProfile's decay math, so these numbers match the overlay's
// overview; the premium OverviewScreen shapes them into the design's layout.
export const dynamic = 'force-dynamic'

export default async function DashboardOverviewPage() {
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
  const firstName = navUser.name.split(' ')[0]

  return (
    <OverviewScreen data={data} now={new Date()} firstName={firstName} totalCurriculum={CONCEPT_KEYS.length} kits={kits} />
  )
}
