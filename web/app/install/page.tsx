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
// A signed-out visitor is sent to /START, not /signup (2026-07-26). Anyone who
// reaches this page without a session installed straight from the Chrome Web
// Store — they have never seen the site, so dropping them on a bare login form
// skips the three questions every website-first student answers. /start runs
// those, then /signup, then /complete-profile, then back here with a session.
// A cycle only in the sense that it terminates: /signup is the one screen that
// creates the session everything else gates on.
//
// Public in proxy.ts for the same reason '/' is: the extension's install tab can
// land here signed out, and a cookie-gated 307 to /login would be the wrong door.
export const dynamic = 'force-dynamic'

export default async function InstallPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  // Dev-only preview (?preview=1), the convention the retired /welcome page
  // used. Every screen in workflow 1 is auth-gated, which is precisely how they
  // drifted out of one design without anyone noticing — a screen nobody can
  // look at is a screen that rots. NODE_ENV-gated, so it cannot exist in prod.
  const devPreview = process.env.NODE_ENV === 'development' && (await searchParams).preview === '1'

  if (!user && !devPreview) redirect('/start')

  return <InstallStep storeUrl={STORE_URL} />
}
