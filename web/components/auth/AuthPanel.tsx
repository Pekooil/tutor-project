'use client'

import { useEffect, useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { postAuthDestination } from '@/lib/auth/post-auth'
import { CONSENT_VERSION } from '@/lib/consent'
import {
  clearPreflightAnswers,
  loadPreflightAnswers,
  type PreflightAnswers,
} from '@/lib/onboarding/preflight'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { Alert, AlertDescription } from '@/components/ui/alert'

// Unified sign-in / sign-up entry (Part 1). One "Continue with Google" button
// and one email/password form — each creates an account if the email is new and
// signs in if it already exists, so there is no separate signup vs. login step.
// Birth year is NOT collected here (a returning user must not be re-asked); it
// is gathered post-auth at /complete-profile via postAuthDestination.
//
// The email/password path drives sign-in through the BROWSER Supabase client so
// onAuthStateChange fires SIGNED_IN reliably (that is what AuthBridge relays to
// the extension). Account creation for a brand-new email is delegated to
// /api/auth/continue (service-role, pre-confirmed, per-IP capped) since that
// needs privileges the browser client doesn't have.
function GoogleGlyph() {
  return (
    <svg viewBox="0 0 18 18" aria-hidden="true" className="h-4 w-4">
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

export function AuthPanel() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [consent, setConsent] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  // Carried context (unchanged from the old signup page): a referral code lands
  // as ?ref=CODE, and the /start wizard leaves grade/class/pain in
  // sessionStorage. Both are forwarded to /api/auth/continue and used ONLY when
  // creating a new account; a returning sign-in ignores them.
  const [referralCode, setReferralCode] = useState<string | null>(null)
  const [preflight, setPreflight] = useState<PreflightAnswers | null>(null)

  useEffect(() => {
    const ref = new URLSearchParams(window.location.search).get('ref')
    if (ref) setReferralCode(ref)
    setPreflight(loadPreflightAnswers())
    // Surface an OAuth round-trip failure bounced back as ?error=oauth.
    if (new URLSearchParams(window.location.search).get('error') === 'oauth') {
      setError('Google sign-in did not complete. Please try again.')
    }
  }, [])

  async function handleGoogle() {
    setError(null)
    setSubmitting(true)
    const supabase = createClient()
    const { error: oauthError } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    })
    // On success the browser has already been redirected to Google; this line
    // is only reached on a failure to even start the flow.
    if (oauthError) {
      setError(oauthError.message)
      setSubmitting(false)
    }
  }

  async function handleEmailPassword(event: FormEvent) {
    event.preventDefault()
    setError(null)
    setSubmitting(true)

    const supabase = createClient()

    // 1) Try to sign in an existing account.
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password })

    if (signInError) {
      // 2) Sign-in failed — either the email is new (create it) or the password
      // is wrong (continue returns 409). Creating requires consent (click-wrap).
      const res = await fetch('/api/auth/continue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          password,
          consent,
          referralCode: referralCode ?? undefined,
          onboarding: preflight ?? undefined,
        }),
      })

      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setError(body.error ?? 'Could not sign you in.')
        setSubmitting(false)
        return
      }

      // Account created — now sign in on the browser client so SIGNED_IN fires
      // and the extension bridge picks it up.
      const { error: retryError } = await supabase.auth.signInWithPassword({ email, password })
      if (retryError) {
        setError(retryError.message)
        setSubmitting(false)
        return
      }
    }

    // Signed in either way. Clear the carried onboarding answers and route to
    // the birth-year step (new accounts) or the guided setup (returning users).
    clearPreflightAnswers()
    const dest = await postAuthDestination(supabase)
    router.push(dest)
  }

  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-8 bg-background px-4 py-12">
      <img src="/logo.svg" alt="Calyxa" className="h-8 w-auto" />
      <Card className="w-full max-w-sm">
        <CardHeader>
          <h1 className="text-xl leading-none font-semibold">Sign in or create your account</h1>
          {referralCode && (
            <p className="mt-1 text-sm text-muted-foreground">A friend invited you to Calyxa — welcome!</p>
          )}
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <Button
            type="button"
            variant="outline"
            onClick={handleGoogle}
            disabled={submitting}
            className="w-full gap-2"
          >
            <GoogleGlyph />
            Continue with Google
          </Button>

          <div className="flex items-center gap-3">
            <span className="h-px flex-1 bg-border" />
            <span className="text-xs text-muted-foreground">or</span>
            <span className="h-px flex-1 bg-border" />
          </div>

          <form onSubmit={handleEmailPassword} noValidate className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="auth-email">Email</Label>
              <Input
                id="auth-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="auth-password">Password</Label>
              <Input
                id="auth-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={8}
                autoComplete="current-password"
              />
            </div>

            <div className="flex items-start gap-3 rounded-md border border-border-strong bg-surface p-3">
              <Checkbox
                id="auth-consent"
                checked={consent}
                onCheckedChange={(checked) => setConsent(checked === true)}
                className="mt-0.5"
              />
              <Label htmlFor="auth-consent" className="text-sm leading-snug font-normal text-foreground">
                New here? I agree to Calyxa storing my profile, processing the page context I share during
                a session, and processing real-time audio-to-text during voice sessions (the audio itself
                is never retained). Consent version {CONSENT_VERSION}. (Returning users can ignore this.)
              </Label>
            </div>

            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            <Button type="submit" disabled={submitting}>
              {submitting ? 'Continuing…' : 'Continue with email'}
            </Button>
          </form>
        </CardContent>
      </Card>
      <p className="max-w-sm text-center text-xs text-muted-foreground">
        By continuing you agree to our{' '}
        <Link href="/terms" className="underline underline-offset-4">
          Terms
        </Link>{' '}
        and{' '}
        <Link href="/privacy" className="underline underline-offset-4">
          Privacy Policy
        </Link>
        .
      </p>
    </main>
  )
}
