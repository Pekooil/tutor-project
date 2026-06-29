// Sprint 09 / Task 7: pure, offline unit tests for the curriculum graph
// (PLAN §2.10). Guards the two things ADR-016 flagged as risk: the package
// must keep resolving the eight keys Sprint 08's inline `KNOWN_CONCEPT_KEYS`
// stopgap used (so the existing read/write round-trip doesn't break), and
// the prerequisite edges it ships must not contain a cycle.

import { describe, it, expect } from 'vitest'
import { CONCEPT_KEYS, prerequisitesOf } from './concepts'

// The exact eight keys Sprint 08's inline stopgap used (Task 3 acceptance).
const SPRINT_08_KEYS = [
  'algebra.linear-equations.one-variable',
  'algebra.linear-equations.two-variable',
  'algebra.exponents.product-rule',
  'algebra.exponents.power-rule',
  'algebra.polynomials.expanding',
  'algebra.quadratics.factoring',
  'algebra.quadratics.formula',
  'algebra.inequalities.linear',
]

describe('CONCEPT_KEYS', () => {
  it('is a non-empty, duplicate-free list that includes every Sprint 08 key', () => {
    expect(CONCEPT_KEYS.length).toBeGreaterThan(0)
    expect(new Set(CONCEPT_KEYS).size).toBe(CONCEPT_KEYS.length)

    for (const key of SPRINT_08_KEYS) {
      expect(CONCEPT_KEYS).toContain(key)
    }
  })
})

describe('prerequisitesOf', () => {
  it('is acyclic for every shipped concept', () => {
    function hasCycle(key: string, stack: Set<string>, visited: Set<string>): boolean {
      if (stack.has(key)) return true
      if (visited.has(key)) return false
      visited.add(key)
      stack.add(key)
      for (const prereq of prerequisitesOf(key)) {
        if (hasCycle(prereq, stack, visited)) return true
      }
      stack.delete(key)
      return false
    }

    const visited = new Set<string>()
    for (const key of CONCEPT_KEYS) {
      expect(hasCycle(key, new Set(), visited)).toBe(false)
    }
  })

  it('returns an empty list for a key with no prerequisites', () => {
    expect(prerequisitesOf('algebra.linear-equations.one-variable')).toEqual([])
  })
})
