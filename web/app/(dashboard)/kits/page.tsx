import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { loadStudyKits } from '@/components/dashboard/premium/kits-read'
import { KitsScreen } from '@/components/dashboard/premium/KitsScreen'

// Study kits view (Sprint 21, study_artifact): the list of notes/practice-
// problems/flashcards kits a session leaves behind. RLS-scoped, server-rendered
// fresh per request.
export const dynamic = 'force-dynamic'

export default async function KitsPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  const kits = await loadStudyKits(supabase)

  return <KitsScreen kits={kits} />
}
