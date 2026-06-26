import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
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

  const supabase = await createClient()

  const { data, error } = await supabase.auth.signUp({ email, password })

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
