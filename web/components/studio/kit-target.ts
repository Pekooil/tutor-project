import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { loadPrimaryConcepts } from '@/lib/learning/activity-read'

// Resolves what `/kits/[key]` should actually show.
//
// That route is the one URL the SHIPPED extension deep-links to — the recap card
// renders `${API_BASE}/kits/${sessionId}` ("Open it in your dashboard"). It landed
// on the bare pre-studio kit viewer, which is now the weakest destination we have:
// the concept's notes carry the notebook, the revision changelog, the annotations,
// the misconceptions AND the quiz + flashcards in the panel.
//
// Fixing it HERE rather than in the extension is deliberate. Chrome pushes
// extension updates on its own schedule, so a build already installed keeps
// emitting the old URL indefinitely — you can stop new builds using it, but you
// cannot retract the ones already out there. A server-side redirect fixes every
// installed copy immediately and stays correct even after the extension changes.
//
// `key` is either a SESSION id or, for a session-less kit, a `study_artifact` id
// (see kits-read's grouping rule), so both are resolved. When neither yields a
// concept the caller falls back to the kit viewer — the route must never 404 a
// link that is out in the wild.

/** The concept `/kits/[key]` should redirect to, or null to fall back. */
export async function resolveKitConcept(
  supabase: SupabaseClient,
  userId: string,
  key: string
): Promise<string | null> {
  // Session id first — that is what the extension sends, and loadStudyKit
  // resolves by session_id first for the same reason.
  const bySession = await loadPrimaryConcepts(supabase, userId, [key])
  const fromSession = bySession.get(key)
  if (fromSession) return fromSession

  // Otherwise treat it as an artifact id. A session-less kit carries its concepts
  // on the row itself; take the first, which is the concept the kit was built
  // around (generate-and-persist puts the session's practised concepts first).
  const { data, error } = await supabase
    .from('study_artifact')
    .select('concept_keys')
    .eq('user_id', userId)
    .eq('id', key)
    .maybeSingle()

  if (error || !data) return null

  const keys = (data as { concept_keys: string[] | null }).concept_keys
  return keys?.find((k) => k.trim().length > 0) ?? null
}
