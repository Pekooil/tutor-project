import { permanentRedirect } from 'next/navigation'

// RETIRED — superseded by the Notebook Studio's quiz runner, which practises the
// same generated problems AND records the completion through the same
// /api/review/complete call this flow made, so mastery and the next review date
// still move when a review is finished. Kept as a redirect so existing "Start
// review" links keep working.
export const dynamic = 'force-dynamic'

export default async function ReviewRedirect({ params }: { params: Promise<{ conceptKey: string }> }) {
  const { conceptKey } = await params
  permanentRedirect(`/notes/${conceptKey}`)
}
