import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { isStudioView } from '@/components/studio/nav'

// The anti-regression gate for "no post-login link drops the student onto a
// pre-studio screen".
//
// The studio renders dark by default. The pre-studio screens
// (`components/dashboard/premium/*`) are built on hardcoded LIGHT hexes over
// near-opaque white cards and cannot render dark, so `StudioShell` pins their
// content area to the light token set. That pinning is a survival mechanism, not
// a design: following such a link from the dark studio flashes the student onto
// a white page mid-flow. It happened on the two most-travelled links in the
// product — the rail avatar (/account) and the dashboard's quota pill
// (/billing) — and neither was caught, because both pages render perfectly well
// in isolation and every route that would show the seam is auth-gated.
//
// So it is asserted statically instead: every href a studio component can emit
// must resolve to a route `isStudioView()` accepts. A new link to a legacy
// screen fails here rather than at a customer.

const STUDIO_ROOT = fileURLToPath(new URL('../components/studio', import.meta.url))

/** Deliberate exits from the studio, each with the reason it is allowed.
 *
 *  These are NOT legacy screens — they are outside the signed-in shell entirely,
 *  so the studio's chrome does not apply and there is no white-flash seam. */
const ALLOWED_EXITS: Record<string, string> = {
  '/login': 'signed-out redirect target',
  '/': 'the public landing page',
}

// NOTE on coverage: collectHrefs() below only sees LITERAL hrefs, and skips
// anything not starting with '/'. The empty states' `href={STORE_URL}` (the
// Chrome Web Store, which replaced the retired /welcome exit) is therefore
// invisible to this guard on both counts — correctly so, since an absolute
// external URL cannot land on a pre-studio screen.

function listSources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return listSources(path)
    return /\.tsx?$/.test(name) ? [path] : []
  })
}

/** Block comments and //-to-EOL, minus URL '//' — a route named in prose is
 *  documentation, not a link. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:"'`])\/\/[^\n]*/g, '$1')
}

const files = listSources(STUDIO_ROOT)

/** Every literal href in the studio tree, template holes collapsed to a sample
 *  segment so `/notes/${key}` is checked as a real path. */
function collectHrefs(): { path: string; href: string }[] {
  const found: { path: string; href: string }[] = []
  for (const path of files) {
    const code = stripComments(readFileSync(path, 'utf8'))
    for (const m of code.matchAll(/href=(?:"([^"]+)"|\{`([^`]+)`\})/g)) {
      const raw = m[1] ?? m[2]
      if (!raw.startsWith('/')) continue // external or mailto — not our chrome
      // `${encodeURIComponent(x)}` and friends become a concrete segment.
      found.push({ path, href: raw.replace(/\$\{[^}]*\}/g, 'sample-key') })
    }
  }
  return found
}

const hrefs = collectHrefs()

describe('studio links never leave the studio', () => {
  it('finds the tree it is guarding', () => {
    expect(files.length).toBeGreaterThanOrEqual(8)
    expect(hrefs.length).toBeGreaterThanOrEqual(5)
  })

  it('every link target is a studio view, or a disclosed exit', () => {
    const offenders = hrefs
      .filter(({ href }) => {
        // API routes are downloads/actions, not navigations into the shell.
        if (href.startsWith('/api/')) return false
        if (href in ALLOWED_EXITS) return false
        return !isStudioView(href)
      })
      .map(({ path, href }) => `${path.split('/components/')[1]} → ${href}`)

    expect(offenders, `these links land on a pre-studio screen:\n${offenders.join('\n')}`).toEqual([])
  })

  it('the retired kit viewer is not linked from anywhere in the studio', () => {
    // /kits/[key] was superseded by the notes panel, which hosts the quiz and
    // flashcards. The misconception detail screen used to send "practice" there.
    expect(hrefs.filter(({ href }) => href.startsWith('/kits'))).toEqual([])
  })
})

describe('the routes the studio links to are classified as studio views', () => {
  // Pinned individually so a future edit to isStudioView that drops one of these
  // fails with a readable name rather than only through the sweep above.
  it.each([
    ['/dashboard'],
    ['/data'],
    ['/account'],
    ['/billing'],
    ['/notes/algebra.quadratics.factoring'],
    ['/sessions'],
    ['/sessions/abc-123'],
    ['/misconceptions/m1'],
  ])('%s renders in studio chrome', (route) => {
    expect(isStudioView(route)).toBe(true)
  })
})
