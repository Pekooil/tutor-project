import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { loadDashboard } from '@/lib/learning/dashboard-read'
import { Card, CardContent } from '@/components/ui/card'
import { MisconceptionList } from '@/components/dashboard/MisconceptionList'

// Misconceptions view: active error patterns vs. resolved, with occurrence and
// the consecutive-correct streak per concept. Server-rendered fresh per request
// (ADR-047).
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

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl leading-none font-semibold text-foreground">Misconceptions</h1>
        <p className="text-sm text-muted-foreground">
          Specific error patterns Calyxa has noticed more than once — and the ones you&apos;ve
          since worked past.
        </p>
      </div>

      <Card>
        <CardContent className="pt-6">
          <MisconceptionList misconceptions={data.misconceptions} />
        </CardContent>
      </Card>
    </div>
  )
}
