import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { renderToString } from 'react-dom/server'
import { createElement } from 'react'
import { describe, expect, it } from 'vitest'
import { InstallStep } from '../components/install/InstallStep'
import { COMPLETE_PROFILE_PATH, POST_AUTH_DEFAULT } from '../lib/auth/post-auth'

// Onboarding is exactly TWO workflows (2026-07-25):
//   1. sign up on the WEB   — /start → /signup → /complete-profile → /install
//   2. learn it IN the extension — the scripted pill lesson, opened by the
//      background worker once the auth bridge lands.
//
// These tests pin the property that actually broke in the wild: a student who
// had ALREADY signed up was sent back to a sign-in form by both the extension's
// install tab and its popup, while nothing pushed the session across — so the
// site said "you're signed in", the extension said "sign in on the site", and
// neither ever budged. Nothing below tests styling; it tests that no post-signup
// surface asks for credentials, and that the redirect chain terminates.

const src = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')

describe('onboarding workflow 1 — the web signup chain', () => {
  it('ends at /install, the get-the-extension step', () => {
    expect(POST_AUTH_DEFAULT).toBe('/install')
    expect(COMPLETE_PROFILE_PATH).toBe('/complete-profile')
  })

  it('terminates: a signed-out visitor to /install gets the three questions first', () => {
    // /install → /start → /signup → /complete-profile → /install. A cycle only
    // in the sense that it terminates, because /signup is the one screen that
    // ESTABLISHES the session the others gate on.
    //
    // /start, not /signup: anyone reaching /install without a session installed
    // straight from the Chrome Web Store and has never seen the site, so a bare
    // login form would skip the onboarding every website-first student gets.
    expect(src('../app/install/page.tsx')).toContain("redirect('/start')")
    expect(src('../app/install/page.tsx')).toMatch(/if\s*\(!user\b/)
  })

  it('the /install design preview cannot exist in production', () => {
    // ?preview=1 exists so this auth-gated screen can be eyeballed — that it
    // COULDN'T be is how it drifted out of the shared design in the first place.
    // It must stay behind a NODE_ENV check, which Next inlines and eliminates
    // from a production build.
    const page = src('../app/install/page.tsx')
    expect(page).toContain("process.env.NODE_ENV === 'development'")
    // The guard and the bypass must be on the same expression, not two
    // independent conditions one of which could be edited away.
    expect(page).toMatch(/const devPreview =\s*process\.env\.NODE_ENV === 'development' &&/)
  })

  it('/install is public — the extension opens it and that tab can be signed out', () => {
    const proxy = src('../proxy.ts')
    const list = proxy.slice(proxy.indexOf('const PUBLIC_PATHS'), proxy.indexOf('function isPublicPath'))
    expect(list).toContain("'/install'")
    expect(list).toContain("'/signup'")
  })
})

describe('the install step never asks for credentials', () => {
  const html = renderToString(createElement(InstallStep, { storeUrl: 'https://example.test/cws' }))

  it('offers the extension, not a login form', () => {
    expect(html).toContain('Get the extension')
    expect(html).toContain('https://example.test/cws')
  })

  it('renders no credential input and no route back to an auth screen', () => {
    // Controls, not words — the copy deliberately SAYS "you won't need to log in
    // again", which is the opposite of an auth prompt.
    expect(html).not.toMatch(/type="password"/)
    expect(html).not.toMatch(/type="email"/)
    expect(html).not.toMatch(/<form/)
    expect(html).not.toMatch(/href="\/(signup|login)"/)
  })

  it('promises the extension is signed in for them, with no second login', () => {
    expect(html).toMatch(/signs it in for you/i)
    expect(html).toMatch(/no second login/i)
  })
})

describe('every screen in workflow 1 shares one interface (locked)', () => {
  // /start -> /signup -> /complete-profile -> /install. These four screens are
  // ONE run. They drifted apart twice: the auth screen and then the install and
  // birth-year screens stayed as bare shadcn Cards on flat white while /start
  // moved to the green ground, which read to the user as "the old interface
  // keeps coming back". This pins them together.
  const SCREENS: Record<string, string> = {
    '/start': '../components/onboarding/PreflightWizard.tsx',
    '/signup + /login': '../components/auth/AuthPanel.tsx',
    '/complete-profile': '../app/complete-profile/page.tsx',
    '/install': '../components/install/InstallStep.tsx',
  }

  for (const [screen, file] of Object.entries(SCREENS)) {
    it(`${screen} renders on the shared onboarding ground`, () => {
      const code = src(file)
      expect(code).toContain('mkt ob-ground')
      expect(code).toContain('ob-blob')
    })

    it(`${screen} does not fall back to the generic shadcn card shell`, () => {
      const code = src(file)
      // The specific regression: `Card`/`CardHeader` + `bg-background` was the
      // old look. Importing them here means this screen has drifted back out.
      expect(code).not.toMatch(/from '@\/components\/ui\/card'/)
      expect(code).not.toMatch(/className="[^"]*\bbg-background\b/)
    })
  }

  it('the retired "Sign in or create your account" heading is never rendered again', () => {
    // It may still appear in prose explaining the history — that is why this
    // checks for it inside JSX text, not anywhere in the file.
    for (const file of Object.values(SCREENS)) {
      expect(src(file)).not.toMatch(/>\s*Sign in or create your account/)
    }
  })

  it('sign-up and sign-in are distinct modes, both reachable', () => {
    const panel = src('../components/auth/AuthPanel.tsx')
    expect(panel).toContain('Create your account')
    expect(panel).toContain('Welcome back')
    expect(panel).toContain('Sign in here')
    expect(panel).toContain('Create a free account')
    // The fields Darcy specified, in the signup form.
    for (const label of ['First name', 'Last name', 'Your email', 'Password']) {
      expect(panel).toContain(label)
    }
  })
})

describe('the in-extension lesson is offered, never imposed', () => {
  // Step 7 of the spec: once the bridge signs the extension in, the pill just
  // works — nothing seizes focus. Step 8: the lesson is still one click away.
  it('nothing opens the lesson automatically on sign-in', () => {
    const bg = src('../../extension/src/background/index.ts')
    const bridged = bg.slice(bg.indexOf('async function handleBridgedSignIn'))
    expect(bridged.slice(0, 400)).not.toMatch(/openOnboarding\(/)
    // The only way in is the explicit request relayed from the website.
    expect(bg).toContain("case 'OPEN_ONBOARDING'")
  })

  it('/install offers it beside Continue once connected', () => {
    const step = src('../components/install/InstallStep.tsx')
    expect(step).toContain('openExtensionOnboarding')
    expect(step).toContain('Show me how it works')
    expect(step).toContain('Continue to my dashboard')
  })

  it('the popup keeps it reachable later', () => {
    expect(src('../../extension/src/popup/main.tsx')).toContain('Show me how it works')
  })
})

describe('the extension points students at /install, never at a sign-in form', () => {
  // Both of these sent students to /signup before 2026-07-25 — the two halves of
  // the loop. /install is the page that re-pushes the existing session instead.
  it('the first-install tab opens /install', () => {
    const bg = src('../../extension/src/background/index.ts')
    expect(bg).toContain('/install?src=extension')
    expect(bg).not.toContain('/signup?src=extension')
  })

  it('the signed-out popup offers to connect, not to sign up again', () => {
    const popup = src('../../extension/src/popup/main.tsx')
    expect(popup).toContain('/install?src=extension')
    expect(popup).not.toContain('/signup?src=extension')
    // The popup is never an auth surface (locked ADR).
    expect(popup).not.toMatch(/type="password"/)
  })
})
