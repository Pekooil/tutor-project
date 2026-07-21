import { notFound, redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { loadNotebook, isNotebookSubject } from '@/components/dashboard/premium/notebook-read'
import { NotebookShell } from '@/components/dashboard/premium/notebook/NotebookShell'

// One subject's notebook (redesign) — the persistent Subject→Chapter→Concept
// sidebar plus the continuous concept document. Server-rendered fresh per request
// (ADR-047), RLS-scoped via loadNotebook (which composes loadDashboard + the
// notebook/kit/snapshot reads).
export const dynamic = 'force-dynamic'

export default async function NotebookSubjectPage({ params }: { params: Promise<{ subject: string }> }) {
  const { subject } = await params
  if (!isNotebookSubject(subject)) notFound()

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const data = await loadNotebook(supabase, subject)
  if (!data) notFound()

  return <NotebookShell data={data} />
}
