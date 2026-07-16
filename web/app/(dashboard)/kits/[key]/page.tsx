import { notFound, redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { loadStudyKit } from '@/components/dashboard/premium/kit-read'
import { KitViewer } from '@/components/dashboard/premium/KitViewer'

// Study-kit viewer: renders the real notes / practice-problems / flashcards of
// one kit (RLS-scoped, server-rendered fresh). `key` is the session id (or the
// artifact id for a session-less kit).
export const dynamic = 'force-dynamic'

export default async function KitPage({ params }: { params: Promise<{ key: string }> }) {
  const { key } = await params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  const kit = await loadStudyKit(supabase, key)
  if (!kit) {
    notFound()
  }

  return <KitViewer kit={kit} />
}
