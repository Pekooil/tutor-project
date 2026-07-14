import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { loadDashboard } from '@/lib/learning/dashboard-read'
import { Card, CardContent } from '@/components/ui/card'
import { MasteryGrid } from '@/components/dashboard/MasteryGrid'

// Mastery view: the full per-concept grid grouped by strand, decay-adjusted,
// titles resolved. Server-rendered fresh per request (ADR-047).
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

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl leading-none font-semibold text-foreground">Mastery</h1>
        <p className="text-sm text-muted-foreground">
          Every concept you&apos;ve practiced, grouped by strand — weakest first, so the work that
          matters is on top.
        </p>
      </div>

      <Card>
        <CardContent className="pt-6">
          <MasteryGrid strands={data.strands} />
        </CardContent>
      </Card>
    </div>
  )
}
