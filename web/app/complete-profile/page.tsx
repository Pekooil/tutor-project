'use client'

import { useEffect, useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { POST_AUTH_DEFAULT } from '@/lib/auth/post-auth'
import Link from 'next/link'
import { CalyxaMark } from '@calyxa/ui'
import { CONSENT_VERSION } from '@/lib/consent'
import '@/components/onboarding/onboarding.css'
import '@/components/auth/auth.css'

// One-field "complete your profile" step (Part 1, the birth-date gotcha).
//
// Restyled 2026-07-26 onto the shared onboarding ground (.ob-ground /
// .auth-card / .ob-cta), the last of the four screens in workflow 1 to still be
// a bare shadcn Card on flat white. The run is /start -> /signup ->
// /complete-profile -> /install; three of those looking alike and one not was
// read as "the old interface coming back".
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
      <main className="mkt ob-ground flex min-h-svh items-center justify-center px-4">
        <p className="text-[14.5px] text-(--mkt-strip-text)" aria-live="polite">
          Loading…
        </p>
      </main>
    )
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
          <h1 className="mkt-display text-[27px] leading-[1.1] tracking-[-0.02em] text-foreground sm:text-[31px]">
            One quick thing
          </h1>
          <p className="mt-1.5 text-[14.5px] leading-relaxed text-(--mkt-strip-text)">
            We need your birth year to confirm you&rsquo;re old enough to use Calyxa.
          </p>

          <form onSubmit={handleSubmit} noValidate className="mt-6 flex flex-col gap-4">
            <div>
              <label htmlFor="complete-birth-year" className="auth-label">
                Birth year
              </label>
              <input
                id="complete-birth-year"
                type="number"
                inputMode="numeric"
                className="auth-input"
                placeholder="2009"
                value={birthYear}
                onChange={(e) => setBirthYear(e.target.value)}
                required
              />
            </div>

            {looksUnder13 && (
              <p role="alert" className="auth-error">
                You must be 13 or older to create a Calyxa account.
              </p>
            )}

            {needsConsent && (
              <label htmlFor="complete-consent" className="auth-consent cursor-pointer">
                <input
                  id="complete-consent"
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
              disabled={submitting || (needsConsent && !consent)}
              className="ob-cta mt-1 w-full px-5 py-3 text-[15px] disabled:cursor-not-allowed disabled:opacity-55"
            >
              {submitting ? 'Saving…' : 'Continue'}
            </button>
          </form>
        </div>

        <p className="mt-6 max-w-[27rem] text-center text-[12px] leading-relaxed text-(--mkt-strip-text)">
          Consent version {CONSENT_VERSION}.
        </p>
      </div>
    </main>
  )
}
