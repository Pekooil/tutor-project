import { permanentRedirect } from 'next/navigation'

// RETIRED as a standalone route. The quiz and flashcards now run INSIDE the notes
// view's Ask Calyxa panel, so practising a concept no longer means leaving the
// notes it came from. Kept as a redirect so existing links land on the notes,
// where the runner lives.
export const dynamic = 'force-dynamic'

export default async function Redirect({ params }: { params: Promise<{ conceptKey: string }> }) {
  const { conceptKey } = await params
  permanentRedirect(`/notes/${conceptKey}`)
}
