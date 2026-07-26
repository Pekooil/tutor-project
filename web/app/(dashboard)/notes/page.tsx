import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { loadDashboard } from '@/lib/learning/dashboard-read'
import { buildStudioCatalog } from '@/components/studio/catalog-read'
import { LibraryScreen } from '@/components/studio/LibraryScreen'

// `/notes` — the library: every subject and concept Calyxa has tutored.
//
// This route used to be a bare REDIRECT to whichever concept the student last
// touched, which meant the rail item you would instinctively click to FIND a
// concept instead teleported you to one, and the only real index was buried at
// the bottom of the dashboard. It is the index now; `/notes/[conceptKey]` is
// still the document.
//
// Same read the dashboard used for the browser — RLS-scoped, per-request-fresh.
export const dynamic = 'force-dynamic'

export default async function NotesIndexPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  const now = new Date()
  const data = await loadDashboard(supabase)
  const subjects = await buildStudioCatalog(supabase, data, now)

  return <LibraryScreen subjects={subjects} now={now} />
}
