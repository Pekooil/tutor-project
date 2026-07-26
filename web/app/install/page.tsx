import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { InstallStep } from '@/components/install/InstallStep'
import { STORE_URL } from '@/lib/store-url'

// /install — the last web step of onboarding workflow 1, and the door the
// extension opens on first install.
//
// Two arrivals, one page:
//   · straight from signup (postAuthDestination → here): they are signed in, so
//     they get the store link and the live "we'll sign the extension in for you"
//     status.
//   · from the extension's own onInstalled tab (?src=extension): the whole point
//     is that loading ANY calyxa.app page with a session makes AuthBridge push
//     that session to the now-installed extension. This page is where that
//     happens on purpose rather than by luck.
//
// A signed-out visitor is sent to /signup, which routes back through
// /complete-profile to here — a cycle only in the sense that it terminates:
// /signup is the one screen that creates the session everything else needs. The
// page it replaced (the old extension install tab → /signup) was the real loop,
// because it showed a login form to someone already logged in and never pushed
// a session either way.
//
// Public in proxy.ts for the same reason '/' is: the extension's install tab can
// land here signed out, and a cookie-gated 307 to /login would be the wrong door.
export const dynamic = 'force-dynamic'

export default async function InstallPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/signup')

  return <InstallStep storeUrl={STORE_URL} />
}
