import { describe, it, expect, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import { CONCEPT_KEYS } from '@calyxa/curriculum'
import { commonMisconceptionsFor } from '../lib/learning/misconception-catalog'

// The common-misconception catalog (2026-07-17): the cold-start replacement
// for the check-in's fixed generic sticking chips. Coverage is the load-
// bearing invariant -- a curriculum concept with no entries silently falls
// back to "Setting up the equation", the exact behavior this replaces.

describe('commonMisconceptionsFor — the cold-start sticking-chip catalog', () => {
  it('covers EVERY curriculum concept (directly or by family borrow)', () => {
    for (const key of CONCEPT_KEYS) {
      expect(commonMisconceptionsFor(key).length, `no common misconceptions for ${key}`).toBeGreaterThan(0)
    }
  })

  it('returns chip-ready phrases: short, lowercase-leaning, capped at 3', () => {
    for (const key of CONCEPT_KEYS) {
      const entries = commonMisconceptionsFor(key)
      expect(entries.length).toBeLessThanOrEqual(3)
      for (const entry of entries) {
        expect(entry.trim()).toBe(entry)
        expect(entry.length).toBeGreaterThan(0)
        expect(entry.length, `catalog phrase too long for a chip: "${entry}"`).toBeLessThanOrEqual(60)
      }
    }
  })

  it('respects the limit parameter', () => {
    expect(commonMisconceptionsFor('algebra.quadratics.factoring', 1)).toHaveLength(1)
  })

  it('degrades to same-family entries for a curriculum key the catalog predates, and [] for a non-curriculum key', () => {
    // A fake same-family key: not in the catalog, not in the curriculum ->
    // fails the getConcept gate -> [].
    expect(commonMisconceptionsFor('algebra.quadratics.not-a-real-concept')).toEqual([])
    expect(commonMisconceptionsFor('not.a.key')).toEqual([])
  })

  it('names a real concept-specific misconception, not the old generic default', () => {
    const factoring = commonMisconceptionsFor('algebra.quadratics.factoring')
    expect(factoring[0]).toBe('sign errors in the factor pair')
    expect(factoring).not.toContain('Setting up the equation')
  })
})
