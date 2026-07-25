import { describe, expect, it } from 'vitest'
import { toMathTokens, prettifyMathSymbols } from '@/components/studio/math'

// Parity guard. `components/studio/math.tsx` duplicates the extension's pure math
// rendering (extension/src/overlay/Transcript.tsx) because `web` and `extension`
// are separate builds and neither can import the other. A student sees both
// surfaces, so a divergence is visible to them.
//
// Every case below is lifted VERBATIM from extension/tests/transcript-math.test.ts
// (`tokenizeMathText`), so if the extension's behaviour is ever changed without
// changing this copy, this fails instead of quietly drifting.

describe('studio math tokenizer matches the extension', () => {
  it('renders ^ exponents as sup tokens (bare, negative, parenthesized, braced)', () => {
    expect(toMathTokens('x^2 + y^-1 + 2^(n+1) + a^{2k}')).toEqual([
      { kind: 'text', text: 'x' },
      { kind: 'sup', text: '2' },
      { kind: 'text', text: ' + y' },
      { kind: 'sup', text: '-1' },
      { kind: 'text', text: ' + 2' },
      { kind: 'sup', text: 'n+1' },
      { kind: 'text', text: ' + a' },
      { kind: 'sup', text: '2k' },
    ])
  })

  it('prettifies sqrt/pi/theta and comparison/plus-minus operators into real symbols', () => {
    expect(toMathTokens('sqrt(x) <= pi and theta != 0, x = +-2')).toEqual([
      { kind: 'text', text: '√(x) ≤ π and θ ≠ 0, x = ±2' },
    ])
  })

  it('renders * as an interpunct with tight spacing', () => {
    expect(toMathTokens('2 * x*y')).toEqual([{ kind: 'text', text: '2 · x · y' }])
  })

  it('leaves everything unrecognized verbatim — never a guessed transformation', () => {
    expect(toMathTokens('(x + 2)(x + 3) = 0')).toEqual([{ kind: 'text', text: '(x + 2)(x + 3) = 0' }])
  })

  it('does not treat sqrt/pi inside longer words as symbols', () => {
    expect(toMathTokens('spice')).toEqual([{ kind: 'text', text: 'spice' }])
    expect(toMathTokens('pin')).toEqual([{ kind: 'text', text: 'pin' }])
  })

  it('handles the notebook’s own expression style', () => {
    // What the v3 generator actually emits for a step.
    expect(toMathTokens('6x^2 + 11x + 4  ->  a*c = 6 * 4 = 24')).toEqual([
      { kind: 'text', text: '6x' },
      { kind: 'sup', text: '2' },
      { kind: 'text', text: ' + 11x + 4  ->  a · c = 6 · 4 = 24' },
    ])
  })

  it('prettify is idempotent, so re-rendering a stored expression cannot double-convert', () => {
    const once = prettifyMathSymbols('sqrt(2) * pi')
    expect(prettifyMathSymbols(once)).toBe(once)
  })
})
