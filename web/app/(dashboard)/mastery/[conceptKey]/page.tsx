import { notFound, redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { loadConceptDetail } from '@/components/dashboard/premium/detail-read'
import { ConceptDetailScreen } from '@/components/dashboard/premium/ConceptDetailScreen'

// Concept drill-down: mastery, prerequisites, dependents, misconceptions here,
// and a link to practice with the concept's study kit. Server-rendered fresh
// per request (ADR-047), RLS-scoped via loadDashboard.
export const dynamic = 'force-dynamic'

export default async function ConceptDetailPage({ params }: { params: Promise<{ conceptKey: string }> }) {
  const { conceptKey } = await params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  const detail = await loadConceptDetail(supabase, decodeURIComponent(conceptKey))
  if (!detail) {
    notFound()
  }

  return <ConceptDetailScreen detail={detail} />
}
