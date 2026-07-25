import 'server-only'
import { createClient } from '@/lib/supabase/server'
import { loadDashboard } from '@/lib/learning/dashboard-read'
import { buildStudioCatalog, defaultConceptKey } from './catalog-read'

// The rail's Notes / Quizzes / Flashcards buttons point at a concept, but before
// one has been opened there is nothing in the URL to point at. These bare index
// routes resolve the entry concept — the most recently practiced one — and
// redirect; a student with nothing tutored yet lands back on the dashboard,
// which is where the "start a session" guidance lives.

export async function studioEntryRedirect(view: 'notes' | 'quiz' | 'flashcards'): Promise<string> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return '/login'

  const subjects = await buildStudioCatalog(supabase, await loadDashboard(supabase), new Date())
  const key = defaultConceptKey(subjects)
  return key ? `/${view}/${encodeURIComponent(key)}` : '/dashboard'
}
