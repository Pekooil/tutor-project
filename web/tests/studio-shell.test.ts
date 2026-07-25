import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Regression tests for the shell chrome. Both behaviours here were reported as
// bugs and neither can be checked in a browser, because every route the shell
// wraps except the design harness is auth-gated:
//
//   1. The theme flipped as the student moved between tabs. The light pinning for
//      the pre-studio screens was applied to the WHOLE shell, so navigating
//      dashboard → account → dashboard swung the rail and top bar light→dark.
//      The pinning now lives on the content area only.
//   2. The bottom-left nav bar was missing from the real app — it had been
//      deleted, leaving it only on the preview harness.

const { pathnameMock } = vi.hoisted(() => ({ pathnameMock: vi.fn() }))

vi.mock('server-only', () => ({}))
vi.mock('next/navigation', () => ({ usePathname: pathnameMock }))
// next/link renders an <a>; the real component needs a router context we don't have.
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children?: unknown }) =>
    createElement('a', { href, ...rest }, children as never),
}))
vi.mock('@calyxa/ui', () => ({ CalyxaMark: () => createElement('svg') }))

const { StudioShell } = await import('@/components/studio/StudioShell')

function render(pathname: string): string {
  pathnameMock.mockReturnValue(pathname)
  return renderToStaticMarkup(
    createElement(StudioShell, {
      initials: 'AL',
      name: 'Ada Lovelace',
      children: createElement('p', null, 'content'),
    })
  )
}

const rootThemeOf = (html: string) => html.match(/class="cx-app cx-studio"[^>]*?data-theme="(\w+)"/)?.[1] ?? null

beforeEach(() => pathnameMock.mockReset())
afterEach(() => vi.clearAllMocks())

describe('shell chrome does not flip theme between routes', () => {
  const STUDIO = '/dashboard'
  const LEGACY = '/account'

  it('renders the same chrome theme on a studio route and a legacy route', () => {
    const studio = rootThemeOf(render(STUDIO))
    const legacy = rootThemeOf(render(LEGACY))
    expect(studio).toBe('dark')
    // The bug: this used to come back 'light', so the rail and top bar swung
    // theme on every navigation into /account, /billing, /sessions, …
    expect(legacy).toBe('dark')
    expect(legacy).toBe(studio)
  })

  it('never puts the legacy class on the shell root', () => {
    // It belongs on the content area; on the root it repainted the whole chrome.
    expect(render(LEGACY)).not.toContain('cx-studio cx-studio-legacy')
  })

  it('marks only the legacy route’s content area as light', () => {
    expect(render(LEGACY)).toContain('cx-studio-main cx-legacy')
    expect(render(STUDIO)).not.toContain('cx-legacy')
  })

  it('keeps the theme toggle on every route', () => {
    // It drives the chrome, which is present everywhere, so it is never dead.
    for (const p of [STUDIO, LEGACY]) {
      expect(render(p), `toggle missing on ${p}`).toContain('Switch to light theme')
    }
  })
})

// A History row used to link to `kitHref ?? /sessions/[id]` — both pre-studio
// light screens, so clicking a session dropped the student out of the studio.
// It now opens the concept's notes, which is the durable artefact of a session.
describe('history rows link into the studio, not the old transcript page', () => {
  const base = {
    startedAt: '2026-07-22T15:00:00.000Z',
    endedAt: '2026-07-22T15:24:00.000Z',
    mode: 'text',
  }

  async function renderHistory(sessions: unknown[]): Promise<string> {
    const { HistoryScreen } = await import('@/components/studio/HistoryScreen')
    return renderToStaticMarkup(
      createElement(HistoryScreen, {
        sessions: sessions as never,
        now: new Date('2026-07-22T18:00:00.000Z'),
      })
    )
  }

  it('opens the concept notes, even when the session produced a study kit', async () => {
    const html = await renderHistory([
      {
        ...base,
        id: 's1',
        hasKit: true,
        kitHref: '/kits/s1',
        conceptKey: 'algebra.quadratics.factoring',
        conceptTitle: 'Quadratic Equations & Factoring',
      },
    ])
    expect(html).toContain('href="/notes/algebra.quadratics.factoring"')
    // The kit viewer and the transcript page are both pre-studio screens.
    expect(html).not.toContain('/kits/s1')
    expect(html).not.toContain('/sessions/s1')
  })

  it('leads with the concept name so a row is identifiable', async () => {
    const html = await renderHistory([
      { ...base, id: 's1', hasKit: false, kitHref: null, conceptKey: 'x.y', conceptTitle: 'Similar Triangles' },
    ])
    expect(html).toContain('Similar Triangles')
  })

  it('renders a session with no concept as an inert row, not a dead link', async () => {
    const html = await renderHistory([
      { ...base, id: 's9', hasKit: false, kitHref: null, conceptKey: null, conceptTitle: null },
    ])
    expect(html).toContain('no concept recorded')
    expect(html).not.toContain('href="/sessions/s9"')
    expect(html).not.toContain('href="/notes/')
  })
})

describe('bottom-left nav bar', () => {
  it('renders on real routes, naming all three destinations', () => {
    const html = render('/dashboard')
    expect(html).toContain('cx-navbar')
    for (const label of ['Dashboard', 'Notes', 'History']) {
      expect(html, `${label} missing from the nav bar`).toContain(`>${label}<`)
    }
  })

  it('renders on the legacy routes too', () => {
    expect(render('/account')).toContain('cx-navbar')
  })

  it('is suppressed on the design harness, which has its own switcher there', () => {
    expect(render('/studio-preview')).not.toContain('cx-navbar')
  })

  it('marks the current route active and leaves the others hoverable', () => {
    const html = render('/dashboard')
    // Active items drop the hover class; exactly two of three keep it.
    expect([...html.matchAll(/cx-navbar-item/g)]).toHaveLength(2)
  })
})
