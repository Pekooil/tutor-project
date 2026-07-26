import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// Sprint 22 Task 8 (ADR-048): the token-discipline gate. ADR-048's rule is
// "nothing hard-codes a hex" — every dashboard chart color must resolve through
// a named `--chart-*` token defined in `@calyxa/ui` theme.css (Task 2), reached
// via the single mapping home `strand-color.ts` (Task 6) or a direct
// `var(--chart-*)` reference in a chart component. This suite greps the
// dashboard component SOURCE so re-introducing a raw hex — or referencing a
// chart token that theme.css never defines — fails CI, not a future eyeball
// pass (the same anti-rot pattern as no-retired-features.test.ts).
//
// Comments are stripped before scanning: prose ABOUT a color ("reuses the brand
// accent green") is documentation and allowed; code is not.
//
// Scope (Sprint 23): the premium dashboard reskin
// (components/dashboard/premium/*) is a deliberate pixel reproduction of the
// design handoff and uses the handoff's raw hex palette BY DESIGN — its own
// theme.ts documents this ("the exact hexes / rgba values from the design rather
// than the token system"). Those are surface/chrome colors (ink, muted, mint),
// not the `--chart-*` DATA-VIZ palette ADR-048 governs, so premium/ is out of
// scope (excluded in listSourceFiles).
//
// SCOPE MOVED (Notebook Studio cleanup): this gate used to guard the non-premium
// `components/dashboard/*` tree — ActivityChart / TrendChart / strand-color and
// friends. Those were the pre-studio analytics dashboard, and the Notebook Studio
// replaced every route that rendered them, so they were deleted as dead code.
// ADR-048's rule outlives its first subject, so rather than retire the gate the
// scan now covers `components/studio/*` — the tree that IS the post-login UI and
// is token-based by construction. The theme.css assertions are unchanged and
// still guarantee the `--chart-*` palette exists for whenever data-viz returns.
//
// Note: the studio currently renders NO charts, so the `--chart-*` reference
// checks below have no call sites to verify today. They are kept live (not
// deleted) so the first chart added to the studio is checked automatically; the
// hex ban is what carries the weight in the meantime.

const SCAN_ROOTS = [
  fileURLToPath(new URL('../components/studio', import.meta.url)),
  fileURLToPath(new URL('../components/dashboard', import.meta.url)),
]
const THEME_CSS = fileURLToPath(new URL('../../packages/ui/src/theme.css', import.meta.url))

// premium/ is intentionally raw-hex (see the scope note). Nothing else needs
// excluding: the studio's preview harness lives under app/, outside these roots,
// so its mock strand-colour literals are never scanned.
const EXCLUDED_DIRS = new Set(['premium'])

function listSourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) {
      return EXCLUDED_DIRS.has(name) ? [] : listSourceFiles(path)
    }
    return /\.(tsx?|css)$/.test(name) ? [path] : []
  })
}

/** Block comments (incl. JSX {slash-star} comments) and //-to-EOL, minus URL '//'. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:"'`])\/\/[^\n]*/g, '$1')
}

const files = SCAN_ROOTS.flatMap(listSourceFiles)
const sources = files.map((path) => ({
  path,
  code: stripComments(readFileSync(path, 'utf8')),
}))

// The set of `--chart-*` tokens actually defined in @calyxa/ui theme.css. A
// component that references a token NOT in this set would render an undefined
// (invalid) color — the exact kind of typo this gate must catch.
const definedChartTokens = new Set(
  [...readFileSync(THEME_CSS, 'utf8').matchAll(/(--chart-[\w-]+)\s*:/g)].map((m) => m[1])
)

describe('dashboard chart-token discipline', () => {
  it('finds the components it is guarding', () => {
    expect(files.length).toBeGreaterThanOrEqual(8)
    // The studio's token module is the single colour home the way strand-color.ts
    // was for the retired analytics dashboard.
    expect(files.some((path) => path.endsWith(join('studio', 'tokens.ts')))).toBe(true)
  })

  it('theme.css actually defines the chart palette this gate checks against', () => {
    // Sanity: the six strand tokens + the state + accuracy tokens exist, so an
    // empty `definedChartTokens` (e.g. a moved theme.css) never makes the
    // subset check below vacuously pass.
    for (const token of ['--chart-1', '--chart-6', '--chart-state-mastered', '--chart-correct']) {
      expect(definedChartTokens.has(token)).toBe(true)
    }
  })

  it('no scanned component hard-codes a hex color', () => {
    // Hex color literals (#rgb / #rrggbb / #rrggbbaa). Chart colors must come
    // from tokens, never a hex baked into a component.
    const hex = /#[0-9a-fA-F]{3,8}\b/
    for (const { path, code } of sources) {
      const match = code.match(hex)
      expect(match, `${path} hard-codes a hex color (${match?.[0]})`).toBeNull()
    }
  })

  it('every --chart-* token a component references is defined in theme.css', () => {
    for (const { path, code } of sources) {
      for (const m of code.matchAll(/var\((--chart-[\w-]+)\)/g)) {
        const token = m[1]
        expect(
          definedChartTokens.has(token),
          `${path} references ${token}, which theme.css does not define`
        ).toBe(true)
      }
    }
  })

  it('theme.css still defines the full strand + state + accuracy palette', () => {
    // The components that consumed these were retired with the pre-studio
    // dashboard, so nothing references them right now. Assert the palette itself
    // survives: ADR-048's tokens are the contract, and losing them silently would
    // mean the next chart quietly reaches for a hex instead.
    for (let i = 1; i <= 6; i++) {
      expect(definedChartTokens.has(`--chart-${i}`), `theme.css lost --chart-${i}`).toBe(true)
    }
    for (const state of ['unseen', 'learning', 'weak', 'mastered', 'forgotten']) {
      expect(definedChartTokens.has(`--chart-state-${state}`), `theme.css lost --chart-state-${state}`).toBe(true)
    }
    for (const kind of ['correct', 'partial', 'incorrect']) {
      expect(definedChartTokens.has(`--chart-${kind}`), `theme.css lost --chart-${kind}`).toBe(true)
    }
  })

  it('the studio resolves its colours through tokens, not literals', () => {
    const tokens = sources.find((s) => s.path.endsWith(join('studio', 'tokens.ts')))!
    // Every colour the studio uses is a var() into @calyxa/ui — the property this
    // gate exists to protect, now on the tree that actually renders.
    //
    // `--color-accent-fill`, NOT `--color-accent`: globals.css re-targets the
    // latter to shadcn's hover-tint "accent", so the studio's filled CTA reads
    // the collision-proof alias that globals.css's own header points at. Pinned
    // so a well-meaning "simplification" back to --color-accent fails here
    // rather than quietly turning every button into a near-white pill.
    expect(tokens.code).toContain('var(--color-accent-fill)')
    expect(tokens.code).toContain('var(--calyxa-annot-1)')
    expect(tokens.code).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
  })
})
