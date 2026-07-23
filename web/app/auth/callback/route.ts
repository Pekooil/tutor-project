import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { postAuthDestination } from '@/lib/auth/post-auth'

// Google OAuth (PKCE) callback (Part 1). Supabase redirects here with a `code`
// after the provider round-trip; we exchange it for a cookie session, then send
// the user to the birth-year step (first Google sign-in) or the guided setup.
//
// Reachable signed-out (no session exists until the exchange), so /auth/callback
// is in proxy.ts PUBLIC_PATHS. Identity linking is handled by Supabase itself:
// because every existing Calyxa email is confirmed, a Google sign-in on a
// matching email lands in the EXISTING account rather than creating a duplicate.
export async function GET(request: Request) {
  const url = new URL(request.url)
  const code = url.searchParams.get('code')
  const oauthError = url.searchParams.get('error')

  // The provider denied/aborted, or Supabase bounced an error back.
  if (oauthError || !code) {
    return NextResponse.redirect(new URL('/login?error=oauth', url.origin))
  }

  const supabase = await createClient()
  const { error } = await supabase.auth.exchangeCodeForSession(code)
  if (error) {
    return NextResponse.redirect(new URL('/login?error=oauth', url.origin))
  }

  const destination = await postAuthDestination(supabase)
  return NextResponse.redirect(new URL(destination, url.origin))
}
