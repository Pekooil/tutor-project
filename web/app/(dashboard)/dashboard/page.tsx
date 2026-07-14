import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { loadDashboard } from '@/lib/learning/dashboard-read'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { MasteryByStrand } from '@/components/dashboard/MasteryByStrand'
import { StateDistribution } from '@/components/dashboard/StateDistribution'
import { EmptyState } from '@/components/dashboard/EmptyState'

// Overview. Server-rendered fresh per request (ADR-047: dashboard reads are
// eventually consistent with the last turn's apply, so no cache — force-dynamic
// makes that explicit alongside the cookie-scoped read). loadDashboard reuses
// loadProfile's decay math, so these numbers match the overlay's overview.
export const dynamic = 'force-dynamic'

export default async function DashboardOverviewPage() {
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
        <h1 className="text-xl leading-none font-semibold text-foreground">Overview</h1>
        <p className="text-sm text-muted-foreground">
          What Calyxa has learned about how you learn, across every session.
        </p>
      </div>

      {data.isEmpty ? (
        <Card>
          <CardContent className="pt-6">
            <EmptyState title="Your dashboard is ready and waiting">
              Start a tutoring session with the Calyxa extension and your mastery, misconceptions,
              and review schedule will start showing up here.
            </EmptyState>
          </CardContent>
        </Card>
      ) : (
        <>
          <Card>
            <CardHeader>
              <h2 className="text-sm leading-none font-medium text-muted-foreground">Mastery by strand</h2>
            </CardHeader>
            <CardContent>
              <MasteryByStrand strands={data.strands} />
            </CardContent>
          </Card>

          <Card className="bg-surface">
            <CardHeader>
              <h2 className="text-sm leading-none font-medium text-muted-foreground">
                Where your concepts stand
              </h2>
            </CardHeader>
            <CardContent>
              <StateDistribution counts={data.stateCounts} />
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}
