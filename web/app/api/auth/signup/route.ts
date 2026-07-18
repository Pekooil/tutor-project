import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { CONSENT_VERSION, meetsMinAge } from '@/lib/consent'

export async function POST(request: Request) {
  const { email, password, birthYear, consent } = await request.json()

  // Age gate FIRST (ADR-004), authoritative and server-side: an under-13
  // attempt creates no auth user, no profile row, and retains no email.
  if (typeof birthYear !== 'number' || !meetsMinAge(birthYear)) {
    return NextResponse.json(
      { error: 'You must be 13 or older to create a Calyxa account.' },
      { status: 403 }
    )
  }

  if (consent !== true) {
    return NextResponse.json(
      { error: 'Consent is required to create an account.' },
      { status: 400 }
    )
  }

  // OPEN SIGNUP (public launch, 2026-07-17): the Sprint 19 invite-allowlist
  // gate (ADR-045) is retired — any consenting, age-passing email may create an
  // account directly. The waitlist table and /api/invite/claim remain in place
  // for history/idempotency but no longer gate account creation.
  //
  // The user is created via the service-role admin API with the email
  // PRE-CONFIRMED, not `supabase.auth.signUp` (2026-07-17 launch fix): with
  // the project's "Confirm email" setting on, signUp sends a verification
  // email through Supabase's built-in SMTP, whose ~2/hour cap 429'd real
  // signups with "email rate limit exceeded" and left no session for the
  // profile finalization below. Launch has no email-verification step — this
  // path sends NO email at all, so it works regardless of the dashboard
  // toggle. (If verified email is wanted later, that's custom SMTP + a
  // confirm flow, not a one-line revert.)
  const admin = createAdminClient()
  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  })

  if (createError || !created.user) {
    const message = createError?.message ?? 'Signup failed.'
    const exists = /already|registered|exists/i.test(message)
    return NextResponse.json(
      { error: exists ? 'An account with this email already exists — log in instead.' : message },
      { status: 400 }
    )
  }

  // Establish the cookie session for the just-created user — this is what
  // signUp used to provide, and what the RLS profile update below (and the
  // /welcome redirect after it) rely on.
  const supabase = await createClient()
  const { data, error } = await supabase.auth.signInWithPassword({ email, password })

  if (error || !data.user) {
    return NextResponse.json({ error: error?.message ?? 'Signup failed.' }, { status: 400 })
  }

  // Finalize on the request-scoped (RLS) client, under the session signUp
  // just established, so the users_update_own policy (auth.uid() = id)
  // applies. Never the service role for this.
  const { error: profileError } = await supabase
    .from('users')
    .update({
      birth_year: birthYear,
      age_verified: true,
      gdpr_consent_at: new Date().toISOString(),
      gdpr_consent_version: CONSENT_VERSION,
    })
    .eq('id', data.user.id)

  if (profileError) {
    return NextResponse.json({ error: profileError.message }, { status: 400 })
  }

  return NextResponse.json({ user: data.user })
}
