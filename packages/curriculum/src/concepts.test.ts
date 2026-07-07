// Curriculum graph invariants at launch scale (ADR-032, Task 2/8). Guards:
// the eight Sprint 08/13 keys stay byte-identical; every concept has a
// unique key, a valid (existing) prerequisite set, a nonempty title +
// strandLabel, ≥2 aliases (the Sprint 11 audit's alias-drift flag, closed
// structurally — a concept literally cannot ship without aliases), and a
// difficultyPrior in FSRS's valid range; the full prerequisite graph is
// acyclic.

import { describe, it, expect } from 'vitest'
import { CONCEPTS, CONCEPT_KEYS, getConcept, prerequisitesOf } from './concepts'

// Mirrors packages/learning-model/src/constants.ts's DIFF_MIN/DIFF_MAX. Not
// imported directly — @calyxa/curriculum stays a pure, dependency-free
// package (see index.ts) — so this is duplicated on purpose, not derived.
const DIFF_MIN = 0.05
const DIFF_MAX = 0.95

// The exact eight keys Sprint 08's inline stopgap used, now Sprint 13's
// display contract, now frozen by ADR-032: no existing key, strand, title,
// strandLabel, prerequisite set, or difficultyPrior may change as the graph
// grows past them — live knowledge_nodes/misconceptions/reinforcement_schedule
// rows reference these by key.
const FROZEN_SPRINT_13_CONCEPTS = [
  {
    key: 'algebra.linear-equations.one-variable',
    strand: 'linear-equations',
    title: 'One-variable linear equations',
    strandLabel: 'Linear equations',
    prerequisites: [],
    difficultyPrior: 0.2,
  },
  {
    key: 'algebra.linear-equations.two-variable',
    strand: 'linear-equations',
    title: 'Two-variable linear equations',
    strandLabel: 'Linear equations',
    prerequisites: ['algebra.linear-equations.one-variable'],
    difficultyPrior: 0.35,
  },
  {
    key: 'algebra.exponents.product-rule',
    strand: 'exponents',
    title: 'The product rule for exponents',
    strandLabel: 'Exponents',
    prerequisites: [],
    difficultyPrior: 0.25,
  },
  {
    key: 'algebra.exponents.power-rule',
    strand: 'exponents',
    title: 'The power rule for exponents',
    strandLabel: 'Exponents',
    prerequisites: ['algebra.exponents.product-rule'],
    difficultyPrior: 0.35,
  },
  {
    key: 'algebra.polynomials.expanding',
    strand: 'polynomials',
    title: 'Expanding polynomials',
    strandLabel: 'Polynomials',
    prerequisites: ['algebra.exponents.product-rule'],
    difficultyPrior: 0.35,
  },
  {
    key: 'algebra.quadratics.factoring',
    strand: 'quadratics',
    title: 'Factoring quadratics',
    strandLabel: 'Quadratics',
    prerequisites: ['algebra.polynomials.expanding', 'algebra.linear-equations.one-variable'],
    difficultyPrior: 0.5,
  },
  {
    key: 'algebra.quadratics.formula',
    strand: 'quadratics',
    title: 'The quadratic formula',
    strandLabel: 'Quadratics',
    prerequisites: ['algebra.quadratics.factoring'],
    difficultyPrior: 0.55,
  },
  {
    key: 'algebra.inequalities.linear',
    strand: 'inequalities',
    title: 'Linear inequalities',
    strandLabel: 'Inequalities',
    prerequisites: ['algebra.linear-equations.one-variable'],
    difficultyPrior: 0.3,
  },
] as const

describe('the frozen eight (Sprint 13)', () => {
  it('are present, byte-identical on every pre-existing field', () => {
    for (const frozen of FROZEN_SPRINT_13_CONCEPTS) {
      const concept = getConcept(frozen.key)
      expect(concept).toBeDefined()
      expect(concept?.strand).toBe(frozen.strand)
      expect(concept?.title).toBe(frozen.title)
      expect(concept?.strandLabel).toBe(frozen.strandLabel)
      expect(concept?.prerequisites).toEqual(frozen.prerequisites)
      expect(concept?.difficultyPrior).toBe(frozen.difficultyPrior)
    }
  })
})

describe('CONCEPT_KEYS at launch scale', () => {
  it('is a large, duplicate-free key list including every frozen key', () => {
    expect(new Set(CONCEPT_KEYS).size).toBe(CONCEPT_KEYS.length)
    // ~70-concept target (ADR-032); a hard floor guards against an
    // accidental strand import getting dropped from concepts/index.ts.
    expect(CONCEPT_KEYS.length).toBeGreaterThanOrEqual(60)

    for (const frozen of FROZEN_SPRINT_13_CONCEPTS) {
      expect(CONCEPT_KEYS).toContain(frozen.key)
    }
  })

  it('covers all six strand-file prefixes', () => {
    const prefixes = new Set(CONCEPT_KEYS.map((key) => key.split('.')[0]))
    for (const expected of ['algebra', 'geometry', 'algebra2', 'precalc', 'calculus', 'stats']) {
      expect(prefixes).toContain(expected)
    }
  })
})

describe('every concept', () => {
  it('has a unique key', () => {
    const seen = new Set<string>()
    for (const concept of CONCEPTS) {
      expect(seen.has(concept.key)).toBe(false)
      seen.add(concept.key)
    }
  })

  it('has a nonempty title and strandLabel', () => {
    for (const concept of CONCEPTS) {
      expect(concept.title.length).toBeGreaterThan(0)
      expect(concept.strandLabel.length).toBeGreaterThan(0)
    }
  })

  it('has at least 2 aliases', () => {
    for (const concept of CONCEPTS) {
      expect(concept.aliases.length).toBeGreaterThanOrEqual(2)
    }
  })

  it('has a difficultyPrior within the FSRS-valid range', () => {
    for (const concept of CONCEPTS) {
      expect(concept.difficultyPrior).toBeGreaterThanOrEqual(DIFF_MIN)
      expect(concept.difficultyPrior).toBeLessThanOrEqual(DIFF_MAX)
    }
  })

  it('only lists prerequisites that are real concept keys', () => {
    for (const concept of CONCEPTS) {
      for (const prereq of concept.prerequisites) {
        expect(CONCEPT_KEYS).toContain(prereq)
      }
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

  it('crosses strands where the math does', () => {
    // Named examples from the sprint plan: right-triangle trig ← similarity;
    // derivative-as-limit ← limits & continuity ← the precalc limits intro;
    // u-substitution ← chain rule + antiderivatives.
    expect(prerequisitesOf('geometry.trig.right-triangle')).toContain('geometry.triangles.similarity')
    expect(prerequisitesOf('calculus.limits.formal')).toContain('precalc.limits.intuitive')
    expect(prerequisitesOf('calculus.integration.u-substitution')).toEqual(
      expect.arrayContaining(['calculus.differentiation.chain-rule', 'calculus.integration.antiderivatives'])
    )
  })
})
