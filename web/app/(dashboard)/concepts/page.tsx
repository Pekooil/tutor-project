import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { loadDashboard } from '@/lib/learning/dashboard-read'
import { MasteryScreen } from '@/components/dashboard/premium/MasteryScreen'

// Concepts — the heart of the product. Every concept is its own workspace
// (/concepts/[conceptKey]); this is the index, the full per-concept grid grouped
// by strand, decay-adjusted (ADR-047). Reuses the MasteryScreen grid with a
// concept-framed header and /concepts links. Server-rendered fresh per request.
export const dynamic = 'force-dynamic'

export default async function ConceptsPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  const data = await loadDashboard(supabase)

  return (
    <MasteryScreen
      strands={data.strands}
      nowMs={Date.now()}
      totalConcepts={data.totalConcepts}
      hrefBase="/concepts"
      heading={{
        kicker: 'Concepts',
        title: 'Your concept library',
        subtitle: `Open any concept for its notebook, misconceptions, and practice · ${data.totalConcepts} practiced so far`,
      }}
    />
  )
}
