import 'server-only'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'

// Service-role client — bypasses RLS entirely (ADR-003). Reserved for the
// few privileged server paths that legitimately need it. The `server-only`
// import turns any accidental import from a Client Component into a build
// error instead of a leaked key.
export function createAdminClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    }
  )
}
