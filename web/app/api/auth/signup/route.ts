import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { CONSENT_VERSION, meetsMinAge } from '@/lib/consent'

export async function POST(request: Request) {
  const { email, password, birthYear, consent, inviteCode: rawInviteCode } = await request.json()

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

  // INVITE ALLOWLIST (Sprint 19, ADR-045): the beta is invite-gated. The email
  // must be on an INVITED waitlist row, OR the request must carry a valid
  // invite_code. An uninvited attempt creates NO auth user and NO profile (the
  // same no-user discipline as the age gate) — but is ADDED to the waitlist and
  // gets a soft 200 "you're on the waitlist" state, converting a leaked-link
  // visitor into a waitlist signup rather than turning them away (ADR-045). The
  // waitlist is deny-all (Shape 3), so this read/write uses the service-role
  // admin client — the RLS client cannot see it.
  const admin = createAdminClient()
  const normEmail = typeof email === 'string' ? email.trim().toLowerCase() : ''
  const inviteCode = typeof rawInviteCode === 'string' ? rawInviteCode.trim() : ''

  let invited = false
  if (normEmail) {
    const { data } = await admin
      .from('waitlist')
      .select('id')
      .eq('email', normEmail)
      .not('invited_at', 'is', null)
      .maybeSingle()
    if (data) invited = true
  }
  if (!invited && inviteCode) {
    const { data } = await admin
      .from('waitlist')
      .select('id')
      .eq('invite_code', inviteCode)
      .not('invited_at', 'is', null)
      .maybeSingle()
    if (data) invited = true
  }
  if (!invited) {
    // Soft waitlist state: capture the email (like POST /api/waitlist), create
    // no user, and return 200 — never a hard error that leaks invite status.
    if (normEmail) {
      await admin
        .from('waitlist')
        .upsert({ email: normEmail, source: 'signup' }, { onConflict: 'email', ignoreDuplicates: true })
    }
    return NextResponse.json({ waitlisted: true }, { status: 200 })
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
