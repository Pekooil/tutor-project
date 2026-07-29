import { notFound, redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { comparisonLine, loadHomeworkHistory, loadHomeworkSession } from '@/lib/learning/homework-read'
import { HomeworkSummaryScreen } from '@/components/studio/HomeworkSummaryScreen'
import { StudioTitle } from '@/components/studio/StudioShell'

// The session-summary detail (ADR-057) — one homework set, reached from the
// dashboard's "Full summary" or a History homework row.
//
// Server-rendered fresh per request (ADR-047: no cache). RLS is the scoping
// guarantee — `loadHomeworkSession` reads through the caller's own client, so a
// set that isn't theirs simply comes back null and 404s.
export const dynamic = 'force-dynamic'

export default async function HomeworkSummaryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  const [row, history] = await Promise.all([
    loadHomeworkSession(supabase, id),
    loadHomeworkHistory(supabase, 20),
  ])

  if (!row) notFound()

  return (
    <>
      <StudioTitle concept={row.concept} subject={row.title} conceptKey={null} />
      <HomeworkSummaryScreen
        row={row}
        comparison={comparisonLine(row, history)}
        kitHref={row.tutoringSessionId ? '/library' : null}
      />
    </>
  )
}
