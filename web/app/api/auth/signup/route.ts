import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { CONSENT_VERSION, meetsMinAge } from '@/lib/consent'
import { clientIp, hashSignupIp } from '@/lib/referral/ip-hash'
import { SIGNUP_IP_ACCOUNT_LIMIT } from '@/lib/referral/referral'
import { parsePreflightAnswers } from '@/lib/onboarding/preflight'

export async function POST(request: Request) {
  const { email, password, birthYear, consent, referralCode, onboarding } = await request.json()

  // Pre-signup onboarding answers (grade / math class / pain point), carried
  // from the /start wizard. Validated at the boundary and attached to the auth
  // user's metadata below — a promotable, migration-free home for them (a
  // later migration can lift these into typed `users` columns for the mastery
  // engine). Invalid or absent → simply not attached; signup is never blocked
  // on this.
  const preflight = parsePreflightAnswers(onboarding)

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

  // Per-network account cap (ADR-053): at most SIGNUP_IP_ACCOUNT_LIMIT
  // accounts per hashed signup IP, checked BEFORE any auth user exists. Only
  // the HMAC hash is ever compared or stored (lib/referral/ip-hash.ts) — the
  // raw IP never touches the database. Fails OPEN like checkRateLimit: no
  // discernible IP, missing salt, or a query error logs and admits the signup
  // rather than locking out legitimate users on an infra hiccup. Deleted
  // accounts free their slot via the signup_ip FK cascade.
  const ipHash = hashSignupIp(clientIp(request))

  if (!ipHash) {
    console.error('signup: no ip hash (missing header or URL_HASH_SALT) — skipping per-network cap')
  } else {
    const { count: ipCount, error: ipError } = await admin
      .from('signup_ip')
      .select('id', { count: 'exact', head: true })
      .eq('ip_hash', ipHash)

    if (ipError) {
      console.error('signup: per-network cap check failed, allowing signup', ipError)
    } else if ((ipCount ?? 0) >= SIGNUP_IP_ACCOUNT_LIMIT) {
      return NextResponse.json(
        {
          error:
            'Account limit reached for this network. If you think this is a mistake, contact support@calyxa.app.',
        },
        { status: 403 }
      )
    }
  }

  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    // The onboarding answers ride in user_metadata (only when valid), tied to
    // the account from creation. No schema change; never a signup blocker.
    ...(preflight ? { user_metadata: { onboarding: preflight } } : {}),
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

  // Best-effort bookkeeping from here down (ADR-053): the account exists and
  // the signup has succeeded — a failure in the per-network ledger or referral
  // attribution logs and never fails the response.
  if (ipHash) {
    const { error: ipInsertError } = await admin
      .from('signup_ip')
      .insert({ ip_hash: ipHash, user_id: data.user.id })

    if (ipInsertError) {
      console.error('signup: signup_ip record failed', ipInsertError)
    }
  }

  // Referral attribution: resolve the shared code to its owner, then let the
  // record_referral RPC do the atomic insert-once + count + reward-grant
  // (+10 sessions per 3 referred signups, ADR-053). Self-referral and unknown
  // codes are silently ignored — the signup itself is never blocked on a bad
  // code.
  if (typeof referralCode === 'string' && referralCode.trim()) {
    const code = referralCode.trim().toUpperCase()

    const { data: referrer, error: referrerError } = await admin
      .from('users')
      .select('id')
      .eq('referral_code', code)
      .is('deleted_at', null)
      .maybeSingle()

    if (referrerError) {
      console.error('signup: referral code lookup failed', referrerError)
    } else if (referrer && referrer.id !== data.user.id) {
      const { error: recordError } = await admin.rpc('record_referral', {
        p_referrer: referrer.id,
        p_referred: data.user.id,
      })

      if (recordError) {
        console.error('signup: record_referral failed', recordError)
      }
    }
  }

  return NextResponse.json({ user: data.user })
}
