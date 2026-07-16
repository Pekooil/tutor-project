import { notFound, redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { loadMisconceptionDetail } from '@/components/dashboard/premium/detail-read'
import { MisconceptionDetailScreen } from '@/components/dashboard/premium/MisconceptionDetailScreen'

// Misconception drill-down: description, resolution progress, history, the
// related concept, and a link to practice with its study kit. Server-rendered
// fresh per request (ADR-047), RLS-scoped via loadDashboard.
export const dynamic = 'force-dynamic'

export default async function MisconceptionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  const detail = await loadMisconceptionDetail(supabase, id)
  if (!detail) {
    notFound()
  }

  return <MisconceptionDetailScreen detail={detail} />
}
