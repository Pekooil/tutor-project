import { permanentRedirect } from 'next/navigation'

// RETIRED — the per-subject two-pane notebook is superseded by the Notebook
// Studio: the dashboard's subject → concept browser is the index this used to
// be, and /notes/[conceptKey] is the document. Kept as a redirect for bookmarks.
export const dynamic = 'force-dynamic'

export default async function NotebookIndexRedirect() {
  permanentRedirect('/dashboard')
}
