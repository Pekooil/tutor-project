import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// Sprint 25 Task 10, the anti-rot tripwire (ADR-040 / the sprint's "fidelity
// drift, again" risk): the landing page recreates the REDESIGNED overlay,
// and the Sprint-14 vocabulary — the solution progress bar, per-bubble
// profile tags, insight strips, white-on-color annotation pills — was
// deleted end to end (Task 2 removed the scene actions, Task 3 the
// renderers, Tasks 5–9 the copy). This suite greps the marketing SOURCE so
// re-adding any of it fails CI, not a future eyeball pass.
//
// Comments are stripped before scanning: prose ABOUT the retirement ("the
// progress bar is retired, ADR-034") is documentation and allowed; code and
// user-facing strings are not.

const MARKETING_ROOT = fileURLToPath(new URL('../components/marketing', import.meta.url))

function listSourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return listSourceFiles(path)
    return /\.(tsx?|css)$/.test(name) ? [path] : []
  })
}

/** Block comments (incl. JSX {slash-star} comments) and //-to-EOL, minus URL '//'. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:"'`])\/\/[^\n]*/g, '$1')
}

const files = listSourceFiles(MARKETING_ROOT)
const sources = files.map((path) => ({
  path,
  code: stripComments(readFileSync(path, 'utf8')),
}))

describe('no retired features in the marketing tree', () => {
  it('finds the marketing sources it is guarding', () => {
    expect(files.length).toBeGreaterThan(10)
    expect(files.some((path) => path.endsWith('demo/scene.ts'))).toBe(true)
  })

  it('no file references the deleted scene actions (progress/tag/strip)', () => {
    // Matches the three places a scene action exists: a script step
    // (`do: { kind: ... }`), the SceneAction union arm (`| { kind: ... }`),
    // and the reducer branch (`case '...':`). Deliberately NOT a bare
    // `kind: '...'` scan — pingCatalog entries carry the product's
    // StatusPinKind in a `kind` field, and 'progress' is a live ping kind.
    const deletedAction = [
      /do:\s*\{\s*kind:\s*['"](progress|tag|strip)['"]/,
      /\|\s*\{\s*kind:\s*['"](progress|tag|strip)['"]/,
      /case\s+['"](progress|tag|strip)['"]/,
    ]
    for (const { path, code } of sources) {
      for (const pattern of deletedAction) {
        expect(pattern.test(code), `${path} references a deleted scene action (${pattern})`).toBe(false)
      }
    }
  })

  it('no file reads the deleted state fields or deleted types', () => {
    const deletedState = /\bstate\.(progress|strip|tags)\b/
    const deletedTypes = /\b(StripState|TagKind|AnnotColor|ColorLink)\b/
    for (const { path, code } of sources) {
      expect(deletedState.test(code), `${path} reads deleted scene state`).toBe(false)
      expect(deletedTypes.test(code), `${path} references a deleted scene type`).toBe(false)
    }
  })

  it('no user-facing retired-feature copy survives outside comments', () => {
    const retiredCopy = /progress bar|solution progress|profile tag|tag pill|insight strip|gap closed|mastery bar/i
    for (const { path, code } of sources) {
      const match = code.match(retiredCopy)
      expect(match, `${path} still says "${match?.[0]}"`).toBeNull()
    }
  })

  it('annotation label pills are tint-bg + deep-text, never white-on-color', () => {
    const raw = readFileSync(join(MARKETING_ROOT, 'demo', 'DemoAnnotations.tsx'), 'utf8')
    const code = stripComments(raw)
    // The Meadow rule (dark-on-light): the pill rect fills with the ordinal
    // tint and its text with the ordinal deep color.
    expect(code).toMatch(/fill=\{annotTint\(/)
    expect(code).toMatch(/fill=\{annotDeep\(/)
    // The old Sprint-14 treatment — white label text on the stroke color —
    // must not come back in any form.
    expect(code).not.toMatch(/fill=["'](#fff\b|#ffffff|white)["']/i)
  })
})
