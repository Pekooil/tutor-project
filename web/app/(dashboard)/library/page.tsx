import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { loadStudyKits } from '@/components/dashboard/premium/kits-read'
import { KitsScreen } from '@/components/dashboard/premium/KitsScreen'

// Library — every generated resource (notes, practice problems, flashcards)
// grouped by the session/concept that produced it (Sprint 21, study_artifact).
// RLS-scoped, server-rendered fresh per request.
export const dynamic = 'force-dynamic'

export default async function LibraryPage() {
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
