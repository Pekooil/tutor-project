import { notFound, redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { loadStudioNotes } from '@/components/studio/notes-read'
import { NotesScreen } from '@/components/studio/NotesScreen'
import { StudioTitle } from '@/components/studio/StudioShell'

// Screen 2 — a concept's personal notebook beside the Ask Calyxa panel.
// Server-rendered, RLS-scoped, per-request-fresh (ADR-047).
export const dynamic = 'force-dynamic'

export default async function NotesPage({ params }: { params: Promise<{ conceptKey: string }> }) {
  const { conceptKey } = await params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  const data = await loadStudioNotes(supabase, decodeURIComponent(conceptKey))
  if (!data) {
    notFound()
  }

  return (
    <>
      <StudioTitle concept={data.title} subject={data.subjectLabel} conceptKey={data.conceptKey} />
      <NotesScreen data={data} />
    </>
  )
}
