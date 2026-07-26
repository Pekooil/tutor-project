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

  it('terminates: /install sends a signed-out visitor to /signup, which creates the session', () => {
    // The only cycle here is /install → /signup → /complete-profile → /install,
    // and it terminates because /signup is the one screen that ESTABLISHES the
    // session the others gate on. If /install ever stopped gating on a real
    // user, or /signup stopped being the redirect target, that would be a loop.
    expect(src('../app/install/page.tsx')).toContain("redirect('/signup')")
    expect(src('../app/install/page.tsx')).toMatch(/if\s*\(!user\)/)
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

  it('promises the extension is signed in for them', () => {
    expect(html).toMatch(/won’t need to log in again/i)
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
