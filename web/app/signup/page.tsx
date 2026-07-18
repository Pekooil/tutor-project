'use client'

import { useEffect, useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { CONSENT_VERSION } from '@/lib/consent'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { Alert, AlertDescription } from '@/components/ui/alert'

export default function SignupPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [birthYear, setBirthYear] = useState('')
  const [consent, setConsent] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  // Referral attribution (ADR-053): a shared link lands here as
  // /signup?ref=CODE. Read via window.location in an effect (not
  // useSearchParams, which would force a Suspense boundary on this page) and
  // passed through to the signup API, which validates it server-side; a bad
  // or missing code changes nothing about signup itself.
  const [referralCode, setReferralCode] = useState<string | null>(null)

  useEffect(() => {
    const ref = new URLSearchParams(window.location.search).get('ref')
    if (ref) setReferralCode(ref)
  }, [])

  const currentYear = new Date().getFullYear()
  const looksUnder13 = birthYear !== '' && currentYear - Number(birthYear) < 13

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    setSubmitting(true)

    const res = await fetch('/api/auth/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email,
        password,
        birthYear: Number(birthYear),
        consent,
        referralCode: referralCode ?? undefined,
      }),
    })

    setSubmitting(false)

    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      // Server is authoritative (ADR-004); this just surfaces its message,
      // including the 403 COPPA rejection, verbatim.
      setError(body.error ?? 'Signup failed.')
      return
    }

    // Land new accounts on the guided setup (install the extension, sign in,
    // first session) rather than the bare account page.
    router.push('/welcome')
  }

  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-8 bg-background px-4 py-12">
      <img src="/logo.svg" alt="Calyxa" className="h-8 w-auto" />
      <Card className="w-full max-w-sm">
        <CardHeader>
          <h1 className="text-xl leading-none font-semibold">Sign up</h1>
          {referralCode && (
            <p className="mt-1 text-sm text-muted-foreground">
              A friend invited you to Calyxa — welcome!
            </p>
          )}
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-6">
            <fieldset className="m-0 flex flex-col gap-4 border-0 p-0">
              <legend className="mb-1 p-0 text-xs font-medium tracking-wide text-muted-foreground uppercase">
                Account
              </legend>
              <div className="flex flex-col gap-2">
                <Label htmlFor="signup-email">Email</Label>
                <Input
                  id="signup-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoComplete="email"
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="signup-password">Password</Label>
                <Input
                  id="signup-password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={8}
                  autoComplete="new-password"
                />
              </div>
            </fieldset>

            <fieldset className="m-0 flex flex-col gap-4 border-0 p-0">
              <legend className="mb-1 p-0 text-xs font-medium tracking-wide text-muted-foreground uppercase">
                Eligibility &amp; consent
              </legend>
              <div className="flex flex-col gap-2">
                <Label htmlFor="signup-birth-year">Birth year</Label>
                <Input
                  id="signup-birth-year"
                  type="number"
                  inputMode="numeric"
                  value={birthYear}
                  onChange={(e) => setBirthYear(e.target.value)}
                  required
                />
              </div>
              {looksUnder13 && (
                <Alert>
                  <AlertDescription>You must be 13 or older to create a Calyxa account.</AlertDescription>
                </Alert>
              )}
              <div className="flex items-start gap-3 rounded-md border border-border-strong bg-surface p-3">
                <Checkbox
                  id="signup-consent"
                  checked={consent}
                  onCheckedChange={(checked) => setConsent(checked === true)}
                  className="mt-0.5"
                />
                <Label htmlFor="signup-consent" className="text-sm leading-snug font-normal text-foreground">
                  I agree to Calyxa storing my profile, processing the page context I share during a
                  session, and processing real-time audio-to-text during voice sessions (the audio
                  itself is never retained). Consent version {CONSENT_VERSION}.
                </Label>
              </div>
            </fieldset>

            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            <div className="flex flex-col gap-2">
              <Button type="submit" disabled={!consent || submitting}>
                {submitting ? 'Creating account…' : 'Sign up'}
              </Button>
              {!consent && !submitting && (
                <p className="text-xs text-muted-foreground">Check the box above to continue.</p>
              )}
            </div>
          </form>
        </CardContent>
      </Card>
      <p className="text-sm text-muted-foreground">
        Already have an account?{' '}
        <Link href="/login" className="font-medium text-accent-emphasis underline-offset-4 hover:underline">
          Log in
        </Link>
      </p>
    </main>
  )
}
