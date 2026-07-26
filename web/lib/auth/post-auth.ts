import type { SupabaseClient } from '@supabase/supabase-js'

// Where a just-authenticated user is sent next. Shared by BOTH auth methods
// (email/password and Google OAuth) so the birth-year gate is enforced once,
// regardless of how the user got in.
//
// The unified sign-in flow no longer collects birth year on the entry form (a
// returning user must not be re-asked for it), so it is collected post-auth at
// COMPLETE_PROFILE_PATH for anyone who has none on file yet — new email/password
// accounts AND every Google account (OAuth won't reliably hand us a birth date).
export const COMPLETE_PROFILE_PATH = '/complete-profile'
// Two-workflow onboarding (2026-07-25): the last WEB step is /install — get the
// extension, and let this browser hand it the session it already has. The old
// /welcome wizard (install → find-it-in-the-toolbar → an interactive demo of the
// pill) is gone: it taught, on the website, the very thing the in-extension
// lesson teaches better with the real pill. What survives from it is only the
// install hand-off, minus any second sign-in — /install never asks for
// credentials, because whoever reaches it just entered them.
export const POST_AUTH_DEFAULT = '/install'

/**
 * Resolves the post-auth destination for the currently-signed-in user: the
 * single-field birth-year step when `birth_year` is still null, otherwise the
 * guided setup. Reads the caller's OWN row, so it works on either the SSR
 * (cookie) client or the browser client — RLS scopes it to `auth.uid()`.
 * Falls back to /login if there is somehow no user (defensive; callers only
 * invoke this right after a successful sign-in).
 */
export async function postAuthDestination(supabase: SupabaseClient): Promise<string> {
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return '/login'

  const { data } = await supabase
    .from('users')
    .select('birth_year')
    .eq('id', user.id)
    .maybeSingle()

  return data && data.birth_year != null ? POST_AUTH_DEFAULT : COMPLETE_PROFILE_PATH
}
