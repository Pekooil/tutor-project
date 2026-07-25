import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { loadRecentSessions } from '@/lib/learning/activity-read'
import { loadStudyKits } from '@/components/dashboard/premium/kits-read'
import { HistoryScreen } from '@/components/studio/HistoryScreen'

// Sessions — chronological tutoring history from the sessions table, each tagged
// with the study kit it produced. RLS-scoped, server-rendered fresh per request.
//
// Rendered by the token-based `HistoryScreen`, not the pre-studio
// `SessionsScreen`: History is one of the five nav destinations, and the old
// component's hardcoded light hexes made it a washed-out white slab inside the
// dark studio shell while the other four tabs were themed.
export const dynamic = 'force-dynamic'

export default async function SessionsPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  const kits = await loadStudyKits(supabase)
  const sessions = await loadRecentSessions(supabase, new Set(kits.map((k) => k.href)))

  return <HistoryScreen sessions={sessions} now={new Date()} />
}
