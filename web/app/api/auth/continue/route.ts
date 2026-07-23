import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { CONSENT_VERSION } from '@/lib/consent'
import { clientIp, hashSignupIp } from '@/lib/referral/ip-hash'
import { SIGNUP_IP_ACCOUNT_LIMIT } from '@/lib/referral/referral'
import { parsePreflightAnswers } from '@/lib/onboarding/preflight'

// Unified-auth account creator (Part 1). Called by AuthPanel ONLY after a
// browser-client signInWithPassword failed — meaning the email is either new
// (create it) or the password is wrong (409). It does the privileged half that
// the browser client can't: a pre-confirmed service-role user create, the
// per-network account cap, referral attribution, and click-wrap consent.
//
// It deliberately does NOT sign the user in or set cookies — AuthPanel re-runs
// signInWithPassword on the browser client after a 200 so SIGNED_IN fires and
// the extension bridge (AuthBridge) picks it up. Birth year + age gate happen
// afterward at /api/auth/complete-profile.
//
// This mirrors the account-creation half of /api/auth/signup (open signup,
// email pre-confirmed — no verification email, which Supabase's built-in SMTP
// rate-limited at launch). Kept as a separate route so the old signup form's
// contract is untouched.
export async function POST(request: Request) {
  const { email, password, consent, referralCode, onboarding } = await request.json()

  if (typeof email !== 'string' || typeof password !== 'string' || !email || !password) {
    return NextResponse.json({ error: 'Email and password are required.' }, { status: 400 })
  }

  // Consent gates ACCOUNT CREATION only (this route is only ever a create
  // attempt). A returning user with the right password never reaches here, so
  // they are never asked to re-consent. Checked before createUser so we never
  // create an account without recorded consent.
  if (consent !== true) {
    return NextResponse.json(
      { error: 'Check the consent box to create your account.' },
      { status: 400 }
    )
  }

  const preflight = parsePreflightAnswers(onboarding)
  const admin = createAdminClient()

  // Per-network account cap (ADR-053), same as /api/auth/signup: at most
  // SIGNUP_IP_ACCOUNT_LIMIT accounts per hashed IP. Fails OPEN on any infra
  // hiccup rather than locking out legitimate users.
  const ipHash = hashSignupIp(clientIp(request))
  if (!ipHash) {
    console.error('continue: no ip hash (missing header or URL_HASH_SALT) — skipping per-network cap')
  } else {
    const { count: ipCount, error: ipError } = await admin
      .from('signup_ip')
      .select('id', { count: 'exact', head: true })
      .eq('ip_hash', ipHash)

    if (ipError) {
      console.error('continue: per-network cap check failed, allowing signup', ipError)
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
    ...(preflight ? { user_metadata: { onboarding: preflight } } : {}),
  })

  if (createError || !created.user) {
    const message = createError?.message ?? ''
    // An existing email reaching this route means the browser-client sign-in
    // failed on a WRONG PASSWORD — surface an auth error, never "email exists"
    // (which would confirm the account and enable enumeration).
    if (/already|registered|exists/i.test(message)) {
      return NextResponse.json({ error: 'Incorrect email or password.' }, { status: 409 })
    }
    return NextResponse.json({ error: message || 'Could not create your account.' }, { status: 400 })
  }

  const userId = created.user.id

  // Record click-wrap consent now (we have it). Birth year + age gate are
  // finalized at /complete-profile; recording consent here means an
  // email/password user isn't asked to consent a second time there. Admin
  // client (no session yet); best-effort — the account already exists, so a
  // ledger hiccup logs and never fails the create.
  const { error: consentError } = await admin
    .from('users')
    .update({ gdpr_consent_at: new Date().toISOString(), gdpr_consent_version: CONSENT_VERSION })
    .eq('id', userId)
  if (consentError) {
    console.error('continue: consent record failed', consentError)
  }

  // Best-effort bookkeeping (ADR-053), same as /api/auth/signup.
  if (ipHash) {
    const { error: ipInsertError } = await admin
      .from('signup_ip')
      .insert({ ip_hash: ipHash, user_id: userId })
    if (ipInsertError) {
      console.error('continue: signup_ip record failed', ipInsertError)
    }
  }

  if (typeof referralCode === 'string' && referralCode.trim()) {
    const code = referralCode.trim().toUpperCase()
    const { data: referrer, error: referrerError } = await admin
      .from('users')
      .select('id')
      .eq('referral_code', code)
      .is('deleted_at', null)
      .maybeSingle()

    if (referrerError) {
      console.error('continue: referral code lookup failed', referrerError)
    } else if (referrer && referrer.id !== userId) {
      const { error: recordError } = await admin.rpc('record_referral', {
        p_referrer: referrer.id,
        p_referred: userId,
      })
      if (recordError) {
        console.error('continue: record_referral failed', recordError)
      }
    }
  }

  return NextResponse.json({ created: true })
}
