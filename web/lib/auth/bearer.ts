import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js'
import { createClient as createCookieClient } from '@/lib/supabase/server'

export type BearerResult = { error: 401 } | { supabase: SupabaseClient; user: User }

// Bearer-token analogue of /web/lib/supabase/server.ts, for the extension
// (ADR-006). The extension is not a cookie context for our origin, so it
// sends `Authorization: Bearer <access_token>` instead. We rebuild a
// request-scoped client carrying that token as the client's Authorization
// header (verified against installed @supabase/supabase-js@2.108.2:
// `global.headers` and `auth.{autoRefreshToken,persistSession}` are the
// correct option names) so both `getUser()` and every later RLS-evaluated
// query run as that user, not the anon role.
export async function clientFromBearer(request: Request): Promise<BearerResult> {
  const authHeader = request.headers.get('Authorization')

  if (!authHeader?.startsWith('Bearer ')) {
    return { error: 401 }
  }

  const token = authHeader.slice('Bearer '.length).trim()

  if (!token) {
    return { error: 401 }
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { autoRefreshToken: false, persistSession: false },
    }
  )

  const { data, error } = await supabase.auth.getUser()

  if (error || !data.user) {
    return { error: 401 }
  }

  return { supabase, user: data.user }
}

// Sprint 16 / Task 5 (ADR-035): the account export/delete routes are the
// first to be reachable from either surface — the web dashboard's account
// page (cookie session, the actual caller today) or, should the extension
// ever grow an account-management UI, the bearer token above. Tries an
// Authorization header first (extension shape); falls back to the cookie
// session (web dashboard shape) when none is present, so either caller
// works with no route-level branching. The cookie client is
// request-scoped via Next's ambient cookies() (web/lib/supabase/server.ts)
// exactly like every other cookie-authed route in this codebase.
export async function clientFromBearerOrCookie(request: Request): Promise<BearerResult> {
  if (request.headers.get('Authorization')) {
    return clientFromBearer(request)
  }

  const supabase = await createCookieClient()
  const { data, error } = await supabase.auth.getUser()

  if (error || !data.user) {
    return { error: 401 }
  }

  return { supabase, user: data.user }
}
