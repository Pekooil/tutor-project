import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { loadRecentSessions } from '@/lib/learning/activity-read'
import { loadStudyKits } from '@/components/dashboard/premium/kits-read'
import { SessionsScreen } from '@/components/dashboard/premium/SessionsScreen'

// Sessions — chronological tutoring history from the sessions table, each tagged
// with the study kit it produced. RLS-scoped, server-rendered fresh per request.
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

  return <SessionsScreen sessions={sessions} />
}
