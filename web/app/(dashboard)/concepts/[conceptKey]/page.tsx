import { permanentRedirect } from 'next/navigation'

// RETIRED — superseded by the Notebook Studio's notes view, which shows the same
// concept with its notebook, its misconceptions and its study material in one
// place. Kept as a redirect rather than deleted so existing bookmarks and any
// link already in the wild still land somewhere correct.
export const dynamic = 'force-dynamic'

export default async function ConceptWorkspaceRedirect({
  params,
}: {
  params: Promise<{ conceptKey: string }>
}) {
  const { conceptKey } = await params
  // `conceptKey` arrives still URL-encoded; re-encoding would double-escape the
  // dots and separators in a concept key.
  permanentRedirect(`/notes/${conceptKey}`)
}
