// The static concept graph (PLAN §2.4/§2.10). Each concept's `prerequisites`
// lists the concept_keys a student is expected to have practiced first;
// `difficultyPrior` seeds knowledge_nodes.difficulty (DB default 0.3,
// migration 0004) ahead of any real observation. Adding a concept is
// data-only — append an entry below, the graph accessors need no changes.
//
// Prerequisite edges are NOT consumed this sprint — they exist for the
// onboarding sprint's prior propagation (PLAN §2.4 cold start: seed
// knowledge_nodes from an 8-12 item assessment by walking these edges,
// per ADR-016 "what the next sprint needs to know").
//
// Seeded with the eight keys Sprint 08's inline `KNOWN_CONCEPT_KEYS`
// stopgap used, so the existing read/write round-trip keeps resolving
// under the same keys (Task 3 acceptance; ADR-016 risk "concept-key
// drift").

export type Concept = {
  key: string
  strand: string
  prerequisites: readonly string[]
  difficultyPrior: number
}

const CONCEPTS: readonly Concept[] = [
  {
    key: 'algebra.linear-equations.one-variable',
    strand: 'linear-equations',
    prerequisites: [],
    difficultyPrior: 0.2,
  },
  {
    key: 'algebra.linear-equations.two-variable',
    strand: 'linear-equations',
    prerequisites: ['algebra.linear-equations.one-variable'],
    difficultyPrior: 0.35,
  },
  {
    key: 'algebra.exponents.product-rule',
    strand: 'exponents',
    prerequisites: [],
    difficultyPrior: 0.25,
  },
  {
    key: 'algebra.exponents.power-rule',
    strand: 'exponents',
    prerequisites: ['algebra.exponents.product-rule'],
    difficultyPrior: 0.35,
  },
  {
    key: 'algebra.polynomials.expanding',
    strand: 'polynomials',
    prerequisites: ['algebra.exponents.product-rule'],
    difficultyPrior: 0.35,
  },
  {
    key: 'algebra.quadratics.factoring',
    strand: 'quadratics',
    prerequisites: ['algebra.polynomials.expanding', 'algebra.linear-equations.one-variable'],
    difficultyPrior: 0.5,
  },
  {
    key: 'algebra.quadratics.formula',
    strand: 'quadratics',
    prerequisites: ['algebra.quadratics.factoring'],
    difficultyPrior: 0.55,
  },
  {
    key: 'algebra.inequalities.linear',
    strand: 'inequalities',
    prerequisites: ['algebra.linear-equations.one-variable'],
    difficultyPrior: 0.3,
  },
]

const CONCEPTS_BY_KEY: ReadonlyMap<string, Concept> = new Map(CONCEPTS.map((concept) => [concept.key, concept]))

export const CONCEPT_KEYS: readonly string[] = CONCEPTS.map((concept) => concept.key)

export function getConcept(key: string): Concept | undefined {
  return CONCEPTS_BY_KEY.get(key)
}

export function prerequisitesOf(key: string): readonly string[] {
  return CONCEPTS_BY_KEY.get(key)?.prerequisites ?? []
}
