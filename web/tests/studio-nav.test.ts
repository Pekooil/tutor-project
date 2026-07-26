import { describe, expect, it } from 'vitest'
import { NAV_ITEMS, isStudioView } from '@/components/studio/nav'

// The studio's destinations are rendered by THREE surfaces — the icon
// rail, the floating bottom-left bubble bar, and the mobile tab bar — all reading
// this one list. These tests pin the two things that would silently break the
// chrome if the list drifted: which route lights up which item, and where the
// per-concept views link when no concept is open.
//
// Worth pinning here rather than in a browser check: every real route is
// auth-gated, and the design harness sits on /studio-preview, which deliberately
// matches nothing — so the active state cannot be observed in the preview.

const byLabel = (label: string) => {
  const item = NAV_ITEMS.find((i) => i.label === label)
  if (!item) throw new Error(`no nav item labelled ${label}`)
  return item
}

describe('studio nav', () => {
  it('has the four expected destinations, in rail order', () => {
    // Quiz and flashcards are NOT here: they are panel states inside Notes, not
    // destinations of their own. Progress is (the whole-account reading), and it
    // sits between Notes and History.
    expect(NAV_ITEMS.map((i) => i.label)).toEqual(['Dashboard', 'Notes', 'Progress', 'Session history'])
  })

  it('lights up exactly one item per studio route', () => {
    const activeOn = (pathname: string) => NAV_ITEMS.filter((i) => i.match(pathname)).map((i) => i.label)

    expect(activeOn('/dashboard')).toEqual(['Dashboard'])
    expect(activeOn('/notes/algebra.quadratics.factoring')).toEqual(['Notes'])
    expect(activeOn('/sessions')).toEqual(['Session history'])
    expect(activeOn('/sessions/abc-123')).toEqual(['Session history'])
    expect(activeOn('/data')).toEqual(['Progress'])
    // The retired quiz/flashcard routes redirect into notes, so Notes owns them.
    expect(activeOn('/quiz/algebra.quadratics.factoring')).toEqual(['Notes'])
    expect(activeOn('/flashcards/algebra.quadratics.factoring')).toEqual(['Notes'])
  })

  it('maps the kept sibling routes onto a sensible item', () => {
    // /library and /kits no longer map to a nav item — nothing in the studio links
    // to them, and Notes owning them would light the wrong tab.
    expect(NAV_ITEMS.filter((i) => i.match('/library'))).toHaveLength(0)
    expect(NAV_ITEMS.filter((i) => i.match('/kits/session-1'))).toHaveLength(0)
    // A misconception detail page is part of the notes story.
    expect(NAV_ITEMS.filter((i) => i.match('/misconceptions/m1')).map((i) => i.label)).toEqual(['Notes'])
  })

  it('matches nothing on the design harness, so no item falsely reads as active', () => {
    expect(NAV_ITEMS.filter((i) => i.match('/studio-preview'))).toHaveLength(0)
  })

  it('sends every rail item to a destination, never to the open concept', () => {
    // Notes used to deep-link to whatever concept was open, which meant that
    // while READING a concept you could not reach the library from the rail —
    // the one place you would go to find a different one. /notes is a real index
    // now, so every item ignores the concept key.
    for (const key of [null, 'algebra.quadratics.factoring', 'a b/c']) {
      expect(byLabel('Notes').href(key)).toBe('/notes')
    }
    expect(byLabel('Dashboard').href(null)).toBe('/dashboard')
    expect(byLabel('Session history').href(null)).toBe('/sessions')
    expect(byLabel('Progress').href(null)).toBe('/data')
  })
})

// The shell pins non-studio routes to the LIGHT token set, because the pre-studio
// screens are built on hardcoded light hexes over near-opaque white glass cards —
// in dark mode their inherited text went near-white on white and vanished (the
// account page's field values and its Log out button both disappeared).
//
// Pinned by test rather than by eye: every one of these routes is auth-gated, so
// the classification cannot be observed in the browser without a session.
describe('studio vs legacy chrome', () => {
  it('treats the token-based studio views as studio chrome', () => {
    for (const p of [
      '/dashboard',
      '/notes/algebra.quadratics.factoring',
      // The History tab, rebuilt on tokens (studio/HistoryScreen).
      '/sessions',
      '/sessions/abc-123',
      '/account',
      '/billing',
      '/misconceptions/m1',
      '/studio-preview',
    ]) {
      expect(isStudioView(p), `${p} should be studio chrome`).toBe(true)
    }
  })

  it('treats every remaining pre-studio screen as legacy chrome, so it renders light', () => {
    // What is LEFT after the 2026-07-25 sweep. /account, /billing,
    // /misconceptions/[id] and /sessions/[id] used to be here — they were the
    // four the studio actually linked to, so following any of them from the dark
    // studio landed on a white page. All four are studio views now; these three
    // survive only because nothing in the studio links to them.
    for (const p of ['/referral', '/library', '/kits/session-1']) {
      expect(isStudioView(p), `${p} should be legacy chrome`).toBe(false)
    }
  })

  it('treats the rebuilt settings and drill-down screens as studio chrome', () => {
    for (const p of ['/account', '/billing', '/misconceptions/m1', '/sessions/abc-123']) {
      expect(isStudioView(p), `${p} should be studio chrome`).toBe(true)
    }
  })
})
