'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { CalyxaMark } from '@calyxa/ui'
import { createClient } from '@/lib/supabase/client'
import { pingExtension, pushSessionToExtension } from '@/lib/auth/extension-bridge'
import '@/components/onboarding/onboarding.css'
import '@/components/auth/auth.css'

// The post-signup install step — the LAST web screen of onboarding workflow 1.
//
// Styled to match /start and /signup (2026-07-26): the same .ob-ground gradient,
// the same .auth-card and .ob-cta. Before this it was a bare shadcn Card on flat
// white, which made the three-screen run read as three different products —
// questions, then a stock form, then another stock form.
//
// There is deliberately NO sign-in control here. The visitor reached this page
// by signing up moments ago, so they are already authenticated on calyxa.app;
// asking again is the exact loop this page was built to kill (the extension used
// to open /signup on install, which showed a "Sign in or create your account"
// form to someone who had just done precisely that, and the extension stayed
// signed out because nothing ever pushed it a session).
//
// What this page does instead:
//   1. sends them to the Chrome Web Store,
//   2. keeps PUSHING the live session at the extension and polling EXT_PING, so
//      the moment the install completes the extension is signed in — no second
//      credential entry, ever,
//   3. reports honestly which of those has actually happened.
//
// The push-on-a-loop matters: AuthBridge (root layout) pushes on Supabase auth
// EVENTS, and the only event here already fired during signup — before the
// extension existed. Without re-pushing, a student who installs while this page
// is open would sit at "installed, not connected" until they happened to reload
// calyxa.app. Polling is cheap (one in-process Chrome message, no network) and
// stops as soon as it succeeds.
const POLL_MS = 1500

type Phase = 'waiting' | 'installed' | 'connected'

export function InstallStep({ storeUrl }: { storeUrl: string }) {
  const [phase, setPhase] = useState<Phase>('waiting')
  const doneRef = useRef(false)

  // One probe: ask the extension where it stands, and if it is installed but
  // has no session yet, hand it the one this browser already holds.
  const probe = useCallback(async () => {
    if (doneRef.current) return
    const status = await pingExtension()
    if (!status.installed) {
      setPhase('waiting')
      return
    }
    if (status.signedIn) {
      doneRef.current = true
      setPhase('connected')
      return
    }
    // Installed but signed out — this is the case AuthBridge structurally
    // cannot cover, so push the current session directly.
    setPhase('installed')
    const supabase = createClient()
    const {
      data: { session },
    } = await supabase.auth.getSession()
    if (session) pushSessionToExtension(session)
  }, [])

  useEffect(() => {
    void probe()
    const timer = setInterval(() => void probe(), POLL_MS)
    // A student leaves this tab to install, then comes back — probe on return
    // so the confirmation is immediate rather than up to POLL_MS late.
    const onFocus = () => void probe()
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onFocus)
    return () => {
      clearInterval(timer)
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onFocus)
    }
  }, [probe])

  const connected = phase === 'connected'

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
            {connected ? 'Calyxa is ready' : 'Get the extension'}
          </h1>
          <p className="mt-1.5 text-[14.5px] leading-relaxed text-(--mkt-strip-text)">
            {connected
              ? 'Your account is linked. Open any homework page and Calyxa is there.'
              : 'Calyxa tutors you on the page you’re already studying on, so it lives in Chrome — not here.'}
          </p>

          {!connected && (
            <a href={storeUrl} target="_blank" rel="noreferrer" className="ob-cta mt-6 w-full px-5 py-3 text-[15px]">
              Add Calyxa to Chrome
            </a>
          )}

          {/* Honest status — never claims a connection it has not observed. */}
          <div aria-live="polite" className="auth-consent mt-4 items-center">
            <span
              aria-hidden="true"
              className={`h-2 w-2 flex-none rounded-full ${
                connected ? 'bg-(--color-accent-emphasis)' : 'auth-pulse bg-(--mkt-strip-text)'
              }`}
            />
            <span className="text-[13px] leading-snug text-foreground">
              {phase === 'waiting' && (
                <>
                  Waiting for the extension — this page signs it in for you the moment it installs.{' '}
                  <span className="text-(--mkt-strip-text)">No second login.</span>
                </>
              )}
              {phase === 'installed' && 'Extension found — signing it in…'}
              {connected && 'Signed in to the extension. No password needed there.'}
            </span>
          </div>

          {connected && (
            <Link href="/dashboard" className="ob-cta mt-5 w-full px-5 py-3 text-[15px]">
              Continue
            </Link>
          )}
        </div>

        {/* A student who installs later must not be trapped here — the extension
            signs itself in whenever they next load calyxa.app. */}
        {!connected && (
          <p className="mt-5 text-[14px] text-(--mkt-strip-text)">
            <Link
              href="/dashboard"
              className="font-semibold text-(--color-accent-emphasis) underline underline-offset-4 hover:text-foreground"
            >
              Skip for now
            </Link>{' '}
            — you can install it any time.
          </p>
        )}
      </div>
    </main>
  )
}
