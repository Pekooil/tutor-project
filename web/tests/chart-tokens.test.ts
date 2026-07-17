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
// not the `--chart-*` DATA-VIZ palette ADR-048 governs. This gate therefore
// applies to the chart components — ActivityChart / TrendChart / strand-color and
// the other non-premium dashboard files, all token-based and still checked below
// — and the premium/ subtree is out of its scope (excluded in listSourceFiles).

const DASHBOARD_ROOT = fileURLToPath(new URL('../components/dashboard', import.meta.url))
const THEME_CSS = fileURLToPath(new URL('../../packages/ui/src/theme.css', import.meta.url))

// See the scope note above: the premium/ design-system reskin is intentionally
// raw-hex and is not the --chart-* palette this gate enforces.
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

const files = listSourceFiles(DASHBOARD_ROOT)
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
  it('finds the dashboard components it is guarding', () => {
    expect(files.length).toBeGreaterThanOrEqual(10)
    expect(files.some((path) => path.endsWith('strand-color.ts'))).toBe(true)
  })

  it('theme.css actually defines the chart palette this gate checks against', () => {
    // Sanity: the six strand tokens + the state + accuracy tokens exist, so an
    // empty `definedChartTokens` (e.g. a moved theme.css) never makes the
    // subset check below vacuously pass.
    for (const token of ['--chart-1', '--chart-6', '--chart-state-mastered', '--chart-correct']) {
      expect(definedChartTokens.has(token)).toBe(true)
    }
  })

  it('no dashboard component hard-codes a hex color', () => {
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

  it('strand-color.ts is the single mapping home: it names the strand + state chart tokens', () => {
    const strandColor = sources.find((s) => s.path.endsWith('strand-color.ts'))!
    // The six strand tokens and the five state tokens are all referenced here.
    for (let i = 1; i <= 6; i++) {
      expect(strandColor.code).toContain(`var(--chart-${i})`)
    }
    for (const state of ['unseen', 'learning', 'weak', 'mastered', 'forgotten']) {
      expect(strandColor.code).toContain(`var(--chart-state-${state})`)
    }
  })

  it('the trend + activity charts draw their marks from chart tokens', () => {
    const activity = sources.find((s) => s.path.endsWith('ActivityChart.tsx'))!
    // The accuracy segments come from the three accuracy tokens.
    for (const token of ['--chart-correct', '--chart-partial', '--chart-incorrect']) {
      expect(activity.code).toContain(`var(${token})`)
    }
    const trend = sources.find((s) => s.path.endsWith('TrendChart.tsx'))!
    expect(trend.code).toContain('var(--chart-state-mastered)')
  })
})
