import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

// Rotates the extension's token pair (ADR-006). A 401 here means the
// refresh token itself is no longer valid; the extension treats that as
// "signed out" and clears its stored tokens rather than retrying.
export async function POST(request: Request) {
  const { refresh_token } = await request.json()

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )

  const { data, error } = await supabase.auth.refreshSession({ refresh_token })

  if (error || !data.session) {
    return NextResponse.json({ error: error?.message ?? 'Refresh failed.' }, { status: 401 })
  }

  const { access_token, refresh_token: newRefreshToken, expires_at } = data.session

  return NextResponse.json({ access_token, refresh_token: newRefreshToken, expires_at })
}
