'use client'

import { useEffect, useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { CalyxaMark } from '@calyxa/ui'
import { createClient } from '@/lib/supabase/client'
import { postAuthDestination } from '@/lib/auth/post-auth'
import { CONSENT_VERSION } from '@/lib/consent'
import {
  clearPreflightAnswers,
  loadPreflightAnswers,
  type PreflightAnswers,
} from '@/lib/onboarding/preflight'
import '@/components/onboarding/onboarding.css'
import './auth.css'

// The auth screen for /signup and /login.
//
// 2026-07-25 redesign. Two things changed, one visual and one behavioural.
//
// Visual: it now sits on the SAME ground as the /start wizard (.ob-ground plus
// the drifting blobs, reused from onboarding.css). Auth is the middle beat of
// one run — three questions → create the account → get the extension — and it
// was the only screen in that run that looked like a different product.
//
// Behavioural: sign-up and sign-in are now EXPLICIT modes instead of one
// "continue" button that guessed. Sign-up is the emphasised default; sign-in is
// a link beneath it. Signing up also collects a first and last name, which ride
// into Supabase `user_metadata` (no migration — the same channel the /start
// answers already use).
//
// What did NOT change: the extension bridge still keys off the BROWSER client's
// SIGNED_IN event, so both paths finish by calling signInWithPassword on the
// browser client rather than trusting the server route to establish the session.
// Account creation still goes through /api/auth/continue, which holds the
// privileged half (service-role create, per-network cap, referral, consent).

type Mode = 'signup' | 'signin'

function GoogleGlyph() {
  return (
    <svg viewBox="0 0 18 18" aria-hidden="true" className="h-[18px] w-[18px]">
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62Z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.02-3.7H.92v2.33A9 9 0 0 0 9 18Z"
      />
      <path
        fill="#FBBC05"
        d="M3.98 10.72a5.4 5.4 0 0 1 0-3.44V4.95H.92a9 9 0 0 0 0 8.1l3.06-2.33Z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.9 11.42 0 9 0A9 9 0 0 0 .92 4.95l3.06 2.33C4.68 5.16 6.66 3.58 9 3.58Z"
      />
    </svg>
  )
}

export function AuthPanel({ initialMode = 'signup' }: { initialMode?: Mode }) {
  const router = useRouter()
  const [mode, setMode] = useState<Mode>(initialMode)

  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [consent, setConsent] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  // Carried context (unchanged): a referral code lands as ?ref=CODE, and the
  // /start wizard leaves grade/class/pain in sessionStorage. Both are forwarded
  // to /api/auth/continue and used ONLY when creating a new account.
  const [referralCode, setReferralCode] = useState<string | null>(null)
  const [preflight, setPreflight] = useState<PreflightAnswers | null>(null)

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const ref = params.get('ref')
    if (ref) setReferralCode(ref)
    setPreflight(loadPreflightAnswers())
    if (params.get('error') === 'oauth') {
      setError('Google sign-in did not complete. Please try again.')
    }
  }, [])

  const isSignup = mode === 'signup'

  function switchMode(next: Mode) {
    setMode(next)
    setError(null)
  }

  async function handleGoogle() {
    setError(null)
    setSubmitting(true)
    const supabase = createClient()
    const { error: oauthError } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    })
    // On success the browser has already been redirected to Google; this line
    // is only reached if the flow failed to even start.
    if (oauthError) {
      setError(oauthError.message)
      setSubmitting(false)
    }
  }

  /** Shared tail: both modes end signed in on the BROWSER client, which is what
   *  fires SIGNED_IN for AuthBridge → the extension. */
  async function finish(supabase: ReturnType<typeof createClient>) {
    clearPreflightAnswers()
    router.push(await postAuthDestination(supabase))
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    setSubmitting(true)
    const supabase = createClient()

    if (!isSignup) {
      const { error: signInError } = await supabase.auth.signInWithPassword({ email, password })
      if (signInError) {
        setError('Incorrect email or password.')
        setSubmitting(false)
        return
      }
      await finish(supabase)
      return
    }

    // ---- Sign-up ----
    const res = await fetch('/api/auth/continue', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email,
        password,
        consent,
        firstName,
        lastName,
        referralCode: referralCode ?? undefined,
        onboarding: preflight ?? undefined,
      }),
    })

    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      // 409 = the email already exists. Rather than confirm that outright (which
      // would make this form an account-enumeration oracle), try the credentials
      // they just typed: a returning user who used the wrong form simply gets
      // signed in, and anyone else sees the same ambiguous message.
      if (res.status === 409) {
        const { error: retry } = await supabase.auth.signInWithPassword({ email, password })
        if (!retry) {
          await finish(supabase)
          return
        }
        setError('Incorrect email or password. If you already have an account, sign in instead.')
        setSubmitting(false)
        return
      }
      setError(body.error ?? 'Could not create your account.')
      setSubmitting(false)
      return
    }

    // Created — now sign in on the browser client so SIGNED_IN fires and the
    // extension bridge picks it up.
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password })
    if (signInError) {
      setError(signInError.message)
      setSubmitting(false)
      return
    }
    await finish(supabase)
  }

  return (
    <main className="mkt ob-ground flex min-h-svh flex-col overflow-hidden">
      <span aria-hidden="true" className="ob-blob ob-blob-a left-[-14rem] top-[-12rem] h-[34rem] w-[34rem]" />
      <span aria-hidden="true" className="ob-blob ob-blob-b right-[-16rem] bottom-[-14rem] h-[38rem] w-[38rem]" />

      <div className="flex flex-1 flex-col items-center justify-center px-4 py-10 sm:py-14">
        <Link href="/" className="mb-7 inline-flex items-center gap-2">
          <CalyxaMark className="h-6 w-6" />
          <span className="text-[17px] font-semibold tracking-[-0.01em] text-foreground">calyxa</span>
        </Link>

        <div className="auth-card w-full max-w-[27rem] px-6 py-7 sm:px-8 sm:py-8">
          <div key={mode} className="auth-swap">
            <h1 className="mkt-display text-[27px] leading-[1.1] tracking-[-0.02em] text-foreground sm:text-[31px]">
              {isSignup ? 'Create your account' : 'Welcome back'}
            </h1>
            <p className="mt-1.5 text-[14.5px] leading-relaxed text-(--mkt-strip-text)">
              {isSignup ? (
                <>
                  Free to start — no card needed.{' '}
                  {referralCode && <span className="text-(--color-accent-emphasis)">A friend invited you.</span>}
                </>
              ) : (
                'Sign in to pick up where you left off.'
              )}
            </p>

            <button
              type="button"
              onClick={handleGoogle}
              disabled={submitting}
              className="auth-google mt-6 disabled:opacity-60"
            >
              <GoogleGlyph />
              Continue with Google
            </button>

            <div className="auth-rule my-5">or</div>

            <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
              {isSignup && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label htmlFor="auth-first" className="auth-label">
                      First name
                    </label>
                    <input
                      id="auth-first"
                      className="auth-input"
                      value={firstName}
                      onChange={(e) => setFirstName(e.target.value)}
                      required
                      autoComplete="given-name"
                    />
                  </div>
                  <div>
                    <label htmlFor="auth-last" className="auth-label">
                      Last name
                    </label>
                    <input
                      id="auth-last"
                      className="auth-input"
                      value={lastName}
                      onChange={(e) => setLastName(e.target.value)}
                      required
                      autoComplete="family-name"
                    />
                  </div>
                </div>
              )}

              <div>
                <label htmlFor="auth-email" className="auth-label">
                  Your email
                </label>
                <input
                  id="auth-email"
                  type="email"
                  className="auth-input"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoComplete="email"
                />
              </div>

              <div>
                <label htmlFor="auth-password" className="auth-label">
                  Password
                </label>
                <input
                  id="auth-password"
                  type="password"
                  className="auth-input"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={8}
                  autoComplete={isSignup ? 'new-password' : 'current-password'}
                />
                {isSignup && (
                  <p className="mt-1.5 text-[12.5px] text-(--mkt-strip-text)">At least 8 characters.</p>
                )}
              </div>

              {isSignup && (
                <label htmlFor="auth-consent" className="auth-consent cursor-pointer">
                  <input
                    id="auth-consent"
                    type="checkbox"
                    className="auth-check"
                    checked={consent}
                    onChange={(e) => setConsent(e.target.checked)}
                  />
                  <span className="text-[13px] leading-snug text-foreground">
                    I agree to Calyxa storing my profile and processing what I share during a session.
                    Voice is transcribed live and the audio is never kept.{' '}
                    <Link href="/privacy" className="underline underline-offset-2 hover:text-(--color-accent-emphasis)">
                      Details
                    </Link>
                    .
                  </span>
                </label>
              )}

              {error && (
                <p role="alert" className="auth-error">
                  {error}
                </p>
              )}

              <button
                type="submit"
                disabled={submitting || (isSignup && !consent)}
                className="ob-cta mt-1 w-full px-5 py-3 text-[15px] disabled:cursor-not-allowed disabled:opacity-55"
              >
                {submitting
                  ? isSignup
                    ? 'Creating your account…'
                    : 'Signing you in…'
                  : isSignup
                    ? 'Create account'
                    : 'Sign in'}
              </button>
            </form>
          </div>
        </div>

        <p className="mt-5 text-[14px] text-(--mkt-strip-text)">
          {isSignup ? 'Already have an account? ' : 'New to Calyxa? '}
          <button
            type="button"
            onClick={() => switchMode(isSignup ? 'signin' : 'signup')}
            className="font-semibold text-(--color-accent-emphasis) underline underline-offset-4 hover:text-foreground"
          >
            {isSignup ? 'Sign in here' : 'Create a free account'}
          </button>
        </p>

        <p className="mt-6 max-w-[27rem] text-center text-[12px] leading-relaxed text-(--mkt-strip-text)">
          By continuing you agree to our{' '}
          <Link href="/terms" className="underline underline-offset-2">
            Terms
          </Link>{' '}
          and{' '}
          <Link href="/privacy" className="underline underline-offset-2">
            Privacy Policy
          </Link>
          . Consent version {CONSENT_VERSION}.
        </p>
      </div>
    </main>
  )
}
