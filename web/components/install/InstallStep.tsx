'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { pingExtension, pushSessionToExtension } from '@/lib/auth/extension-bridge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader } from '@/components/ui/card'

// The post-signup install step — the LAST web screen of onboarding workflow 1.
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
    <main className="flex min-h-svh flex-col items-center justify-center gap-8 bg-background px-4 py-12">
      <img src="/logo.svg" alt="Calyxa" className="h-8 w-auto" />
      <Card className="w-full max-w-sm">
        <CardHeader>
          <h1 className="text-xl leading-none font-semibold">
            {connected ? 'Calyxa is ready' : 'Get the extension'}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {connected
              ? 'Your account is linked to the extension. Open any homework page and Calyxa is there.'
              : 'Calyxa tutors you on the page you’re already studying on, so it lives in Chrome rather than here.'}
          </p>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          {!connected && (
            <Button asChild>
              <a href={storeUrl} target="_blank" rel="noreferrer">
                Add Calyxa to Chrome
              </a>
            </Button>
          )}

          {/* Honest status. Never claims a connection it has not observed. */}
          <div
            aria-live="polite"
            className="flex items-start gap-3 rounded-md border border-border-strong bg-surface p-3"
          >
            <span
              aria-hidden="true"
              className={`mt-1.5 h-2 w-2 flex-none rounded-full ${
                connected ? 'bg-accent-emphasis' : 'bg-muted-foreground/40'
              }`}
            />
            <p className="text-sm leading-snug text-foreground">
              {phase === 'waiting' && (
                <>
                  Waiting for the extension… this page signs it in for you the moment it installs.{' '}
                  <span className="text-muted-foreground">You won’t need to log in again.</span>
                </>
              )}
              {phase === 'installed' && 'Extension found — signing it in…'}
              {connected && 'Signed in to the extension. No password needed there.'}
            </p>
          </div>

          {/* Always available: a student who installs later should not be
              trapped here, and the extension signs itself in whenever they next
              load calyxa.app. */}
          <Button asChild variant={connected ? 'default' : 'outline'}>
            <Link href="/dashboard">{connected ? 'Continue' : 'Skip for now'}</Link>
          </Button>
        </CardContent>
      </Card>
    </main>
  )
}
