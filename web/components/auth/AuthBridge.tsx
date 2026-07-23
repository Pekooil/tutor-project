'use client'

import { useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { pushSessionToExtension, pushSignOutToExtension } from '@/lib/auth/extension-bridge'

// Mounted once in the root layout. Listens to Supabase auth changes on the
// browser client and mirrors them to the Calyxa extension (Part 2), so however
// a student authenticates on the website — email/password or Google — the
// extension ends up signed in too, with zero extra action from them.
//
// Events pushed:
//   SIGNED_IN / INITIAL_SESSION (with a session) / TOKEN_REFRESHED → AUTH_SESSION
//   SIGNED_OUT                                                     → AUTH_SIGNED_OUT
//
// INITIAL_SESSION is the re-hydration path: because the extension stores tokens
// in chrome.storage.session (memory-only, cleared on browser close — the locked
// ADR), a returning user who reopens their browser is signed out of the
// extension until they next load calyxa.app, at which point this fires and
// re-pushes. Renders nothing.
export function AuthBridge() {
  useEffect(() => {
    const supabase = createClient()
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT') {
        pushSignOutToExtension()
        return
      }
      // Every other event that carries a session means "the extension should
      // hold these tokens now" — a fresh sign-in, the session already present
      // on load, or a silent token rotation.
      if (session) {
        pushSessionToExtension(session)
      }
    })

    return () => subscription.unsubscribe()
  }, [])

  return null
}
