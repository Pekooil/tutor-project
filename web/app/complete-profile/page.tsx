'use client'

import { useEffect, useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { POST_AUTH_DEFAULT } from '@/lib/auth/post-auth'
import { CONSENT_VERSION } from '@/lib/consent'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { Alert, AlertDescription } from '@/components/ui/alert'

// One-field "complete your profile" step (Part 1, the birth-date gotcha).
// Reached post-auth by anyone with a null birth_year — new email/password
// accounts and every Google account. Collects birth year (+ consent only for
// Google users, who never saw the entry-form checkbox) and hands off to the
// server age gate. A protected route: the proxy already requires a session.
export default function CompleteProfilePage() {
  const router = useRouter()
  const [birthYear, setBirthYear] = useState('')
  const [consent, setConsent] = useState(false)
  const [needsConsent, setNeedsConsent] = useState(false)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    const supabase = createClient()
    void (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!user) {
        router.replace('/login')
        return
      }
      const { data } = await supabase
        .from('users')
        .select('birth_year, gdpr_consent_at')
        .eq('id', user.id)
        .maybeSingle()
      // Already complete (e.g. navigated here directly) — skip to the app.
      if (data && data.birth_year != null) {
        router.replace(POST_AUTH_DEFAULT)
        return
      }
      setNeedsConsent(!data?.gdpr_consent_at)
      setReady(true)
    })()
  }, [router])

  const currentYear = new Date().getFullYear()
  const looksUnder13 = birthYear !== '' && currentYear - Number(birthYear) < 13

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    setSubmitting(true)

    const res = await fetch('/api/auth/complete-profile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ birthYear: Number(birthYear), consent }),
    })

    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      setSubmitting(false)
      // 403 = under-13: the server deleted the account and signed us out.
      if (res.status === 403) {
        setError(body.error ?? 'You must be 13 or older to use Calyxa.')
        return
      }
      setError(body.error ?? 'Could not save your profile.')
      return
    }

    router.push(POST_AUTH_DEFAULT)
  }

  if (!ready) {
    return (
      <main className="flex min-h-svh items-center justify-center bg-background px-4 py-12">
        <p className="text-sm text-muted-foreground" aria-live="polite">
          Loading…
        </p>
      </main>
    )
  }

  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-8 bg-background px-4 py-12">
      <img src="/logo.svg" alt="Calyxa" className="h-8 w-auto" />
      <Card className="w-full max-w-sm">
        <CardHeader>
          <h1 className="text-xl leading-none font-semibold">One quick thing</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            We need your birth year to confirm you&rsquo;re old enough to use Calyxa.
          </p>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="complete-birth-year">Birth year</Label>
              <Input
                id="complete-birth-year"
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

            {needsConsent && (
              <div className="flex items-start gap-3 rounded-md border border-border-strong bg-surface p-3">
                <Checkbox
                  id="complete-consent"
                  checked={consent}
                  onCheckedChange={(checked) => setConsent(checked === true)}
                  className="mt-0.5"
                />
                <Label htmlFor="complete-consent" className="text-sm leading-snug font-normal text-foreground">
                  I agree to Calyxa storing my profile, processing the page context I share during a
                  session, and processing real-time audio-to-text during voice sessions (the audio itself
                  is never retained). Consent version {CONSENT_VERSION}.
                </Label>
              </div>
            )}

            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            <Button type="submit" disabled={submitting || (needsConsent && !consent)}>
              {submitting ? 'Saving…' : 'Continue'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  )
}
