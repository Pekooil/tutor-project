import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { loadDashboard } from '@/lib/learning/dashboard-read'
import { MisconceptionsScreen } from '@/components/dashboard/premium/MisconceptionsScreen'

// Misconceptions view: active error patterns vs. resolved, with occurrence and
// the consecutive-correct streak per concept (ADR-047). Server-rendered fresh
// per request.
export const dynamic = 'force-dynamic'

export default async function MisconceptionsPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  const data = await loadDashboard(supabase)

  return <MisconceptionsScreen data={data} />
}
