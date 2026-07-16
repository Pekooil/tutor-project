import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { loadDashboard } from '@/lib/learning/dashboard-read'
import { MasteryScreen } from '@/components/dashboard/premium/MasteryScreen'

// Mastery view: the full per-concept grid grouped by strand, decay-adjusted,
// titles resolved (ADR-047). Server-rendered fresh per request; the premium
// MasteryScreen is a client island only so its weakest/strongest/recent sort
// toggle can reorder nodes without a round-trip.
export const dynamic = 'force-dynamic'

export default async function MasteryPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  const data = await loadDashboard(supabase)

  return <MasteryScreen strands={data.strands} nowMs={Date.now()} totalConcepts={data.totalConcepts} />
}
