import { notFound, redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { loadConceptDetail } from '@/components/dashboard/premium/detail-read'
import { ReviewFlow } from '@/components/dashboard/premium/ReviewFlow'

// The guided review for one concept ("Start review"). Loads the concept's study
// material (loadConceptDetail → kit) and hands it to the client ReviewFlow. If
// the concept has no reviewable material yet, fall back to its workspace.
// Server-rendered fresh per request, RLS-scoped.
export const dynamic = 'force-dynamic'

export default async function ReviewPage({ params }: { params: Promise<{ conceptKey: string }> }) {
  const { conceptKey } = await params
  const key = decodeURIComponent(conceptKey)
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  const detail = await loadConceptDetail(supabase, key)
  if (!detail) {
    notFound()
  }

  // Nothing to review with yet → send them to the workspace instead of an
  // empty review.
  if (!detail.kit || detail.kit.empty) {
    redirect(`/concepts/${key}`)
  }

  return (
    <ReviewFlow
      conceptKey={detail.conceptKey}
      title={detail.title}
      strandLabel={detail.strandLabel}
      strandColor={detail.strandColor}
      notes={detail.kit.notes}
      flashcards={detail.kit.flashcards}
      problems={detail.kit.problems}
    />
  )
}
