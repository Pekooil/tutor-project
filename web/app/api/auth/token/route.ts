import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

// Extension sign-in entry point (ADR-006). Plain anon-key client with no
// cookie binding: tokens are returned in the body for the background worker
// to store in chrome.storage.session itself. The web app's cookie-setting
// /api/auth/login is untouched.
export async function POST(request: Request) {
  const { email, password } = await request.json()

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )

  const { data, error } = await supabase.auth.signInWithPassword({ email, password })

  if (error || !data.session) {
    return NextResponse.json({ error: error?.message ?? 'Sign-in failed.' }, { status: 401 })
  }

  const { access_token, refresh_token, expires_at, user } = data.session

  return NextResponse.json({ access_token, refresh_token, expires_at, user })
}
