import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js'

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
