import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { loadDashboard } from '@/lib/learning/dashboard-read'
import { Card, CardContent } from '@/components/ui/card'
import { DueQueue } from '@/components/dashboard/DueQueue'

// Review view: the reinforcement schedule — what's coming back and when
// (priority DESC, due_at ASC; overdue and upcoming). Server-rendered fresh per
// request (ADR-047).
export const dynamic = 'force-dynamic'

export default async function ReviewPage() {
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
        <h1 className="text-xl leading-none font-semibold text-foreground">Review</h1>
        <p className="text-sm text-muted-foreground">
          Spaced repetition, scheduled for you — the concepts due to come back, most important
          first.
        </p>
      </div>

      <Card>
        <CardContent className="pt-6">
          <DueQueue items={data.dueQueue} />
        </CardContent>
      </Card>
    </div>
  )
}
