import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { WelcomeWizard } from '@/components/welcome/WelcomeWizard'
import '@/components/marketing/marketing.css'

// /welcome — the guided post-signup setup wizard. The signup page redirects
// here, and the extension opens it on first install
// (chrome.runtime.onInstalled → calyxa.app/welcome?src=extension).
//
// There is NO "create your account" step on this page (2026-07-17 ask): a
// student arriving from signup is already signed in, so a signed-out visitor
// is redirected to /signup instead of being shown a step they'd have to
// read past — /signup routes back here on success. The page stays in
// proxy.ts's PUBLIC_PATHS so the extension's install tab reaches this
// redirect (a cookie-gated 307 to /login would be the wrong door).
//
// The wizard itself is one step at a time (install → find it in the toolbar
// → a guided live demo), each advancing only when the student confirms or
// completes it — see WelcomeWizard. ?src=extension starts at the find-it
// step (that visitor has, by definition, just installed).
//
// Calyxa is a desktop Chrome extension — it can't run on phones or tablets.
// We still let mobile visitors sign up (so they don't lose their spot), but
// instead of the install/toolbar/demo steps we show a "finish on your
// desktop" screen. Mobile is detected from the request User-Agent here and
// passed to the wizard; a dev-only ?device=mobile|desktop override lets both
// views be previewed from one machine.
//
// The Chrome Web Store link comes from NEXT_PUBLIC_CALYXA_STORE_URL, falling
// back to the live listing below (the extension is now published) so the
// install step always shows a real "Add to Chrome" button. Set the env var
// to override (e.g. a staging listing).
export const dynamic = 'force-dynamic'

const STORE_URL =
  process.env.NEXT_PUBLIC_CALYXA_STORE_URL ??
  'https://chromewebstore.google.com/detail/gedmlagmmllpohdkdpeocpbnmofegnbm'

// Phones and tablets can't run a desktop Chrome extension. Best-effort UA
// sniff — the goal is only to route mobile signups to the "finish on desktop"
// screen, so a false negative just shows the normal wizard.
const MOBILE_UA = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile|Silk/i

export default async function WelcomePage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const sp = await searchParams
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  // Dev-only preview bypass (?preview=1) so the wizard can be eyeballed
  // without a session; never active in production builds.
  const devPreview = process.env.NODE_ENV === 'development' && sp.preview === '1'

  if (!user && !devPreview) {
    redirect('/signup')
  }

  const fromExtension = sp.src === 'extension'

  const ua = (await headers()).get('user-agent') ?? ''
  const deviceOverride =
    process.env.NODE_ENV === 'development' && (sp.device === 'mobile' || sp.device === 'desktop')
      ? sp.device
      : null
  const isMobile = deviceOverride ? deviceOverride === 'mobile' : MOBILE_UA.test(ua)

  return (
    <WelcomeWizard
      email={user?.email ?? null}
      storeUrl={STORE_URL}
      initialStep={fromExtension ? 2 : 1}
      isMobile={isMobile}
    />
  )
}
