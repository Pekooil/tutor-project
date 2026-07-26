import { notFound, redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { loadSessionDetail } from '@/components/dashboard/premium/snapshots-read'
import { SessionDetailScreen } from '@/components/studio/DetailScreens'

// One tutoring session's detail (ADR-055, brief §3): its ordered timeline of
// worked-problem snapshots. Server-rendered fresh per request, RLS-scoped via
// loadSessionDetail (a foreign/unknown id resolves to null → notFound).
export const dynamic = 'force-dynamic'

export default async function SessionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  const detail = await loadSessionDetail(supabase, id)
  if (!detail) {
    notFound()
  }

  return <SessionDetailScreen detail={detail} />
}
