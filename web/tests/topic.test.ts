import { describe, it, expect, vi } from 'vitest'

// topic.ts carries `import 'server-only'` as a defensive marker (ADR-021)
// even though detectTopicKeys itself is pure (no I/O) — real Next.js builds
// enforce the guard via bundler analysis, not this runtime throw, which only
// fires outside RSC bundling (i.e. exactly here, under vitest). Mocking the
// marker package is the standard way to unit-test pure logic behind it
// without spawning a dev server (unlike apply.ts/events.ts, which do real
// I/O and are exercised via a spawned server in learning-events.test.ts).
vi.mock('server-only', () => ({}))

import { detectTopicKeys } from '../lib/learning/topic'
import { CONCEPTS, CONCEPT_KEYS } from '@calyxa/curriculum'

// Mirrors topic.ts's private MAX_TOPIC_KEYS — kept here only as a named
// constant for test readability, not imported (topic.ts doesn't export it).
const MAX_TOPIC_KEYS = 4

function fromMessage(content: string) {
  return detectTopicKeys(undefined, [{ role: 'user' as const, content }])
}

describe('detectTopicKeys — contract (ADR-021, unchanged by ADR-032)', () => {
  it('returns [] with no page context and no messages', () => {
    expect(detectTopicKeys(undefined, [])).toEqual([])
  })

  it('returns [] when nothing in the haystack matches any alias', () => {
    expect(fromMessage('what is the weather like today')).toEqual([])
  })

  it('is deterministic — same input, same output', () => {
    const input = 'can you help me with the chain rule and also u-sub'
    expect(fromMessage(input)).toEqual(fromMessage(input))
  })

  it('never returns more than MAX_TOPIC_KEYS', () => {
    // One alias per concept, joined — guaranteed to score far more than 4
    // distinct concepts.
    const everything = CONCEPTS.map((c) => c.aliases[0]).join(' ')
    expect(fromMessage(everything).length).toBeLessThanOrEqual(MAX_TOPIC_KEYS)
  })

  it('ranks a concept with more alias hits above one with fewer', () => {
    // "chain rule" hits calculus.differentiation.chain-rule once;
    // "vectors" + "vector addition" hits precalc.vectors.operations twice.
    const result = fromMessage('chain rule, vectors, vector addition')
    const chainIndex = result.indexOf('calculus.differentiation.chain-rule')
    const vectorIndex = result.indexOf('precalc.vectors.operations')
    expect(chainIndex).toBeGreaterThanOrEqual(0)
    expect(vectorIndex).toBeGreaterThanOrEqual(0)
    expect(vectorIndex).toBeLessThan(chainIndex)
  })

  it('only ever returns real curriculum keys', () => {
    const result = fromMessage(CONCEPTS.flatMap((c) => c.aliases).join(' '))
    for (const key of result) {
      expect(CONCEPT_KEYS).toContain(key)
    }
  })
})

describe('every-concept-reachable (the Sprint 11 audit drift guard, ADR-032)', () => {
  // Replaces the old "no unknown keys leak" guard: with the hand-maintained
  // alias table deleted, the risk isn't an unknown key leaking (structurally
  // impossible now — the table IS the curriculum) but a concept silently
  // going unreachable because topic.ts's derivation missed it. This test
  // fails the moment that happens, for every concept, not just a sample.
  it('surfaces every single concept from its own aliases, with zero hand-map edits', () => {
    const unreachable: string[] = []

    for (const concept of CONCEPTS) {
      const haystack = concept.aliases.join(' ')
      const result = fromMessage(haystack)
      if (!result.includes(concept.key)) unreachable.push(concept.key)
    }

    expect(unreachable).toEqual([])
  })

  it('a page mentioning "chain rule" biases the calculus key', () => {
    const result = fromMessage("I'm stuck on this problem, I think it needs the chain rule")
    expect(result).toContain('calculus.differentiation.chain-rule')
  })

  it('a page mentioning "u-sub" biases the u-substitution key', () => {
    const result = fromMessage('my teacher says to use u-sub here')
    expect(result).toContain('calculus.integration.u-substitution')
  })

  it('a page mentioning "unit circle" biases the precalc key', () => {
    const result = fromMessage('where is this angle on the unit circle')
    expect(result).toContain('precalc.unit-circle.radians')
  })

  it('a page mentioning "SOH CAH TOA" biases the right-triangle trig key', () => {
    const result = fromMessage('use SOH CAH TOA to find the missing side')
    expect(result).toContain('geometry.trig.right-triangle')
  })
})
