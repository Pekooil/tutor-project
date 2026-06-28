// Session-summary shapes (ADR-015): the structured output of the
// end-of-session summariser (`/web/lib/ai/summarise.ts`) that
// `applySessionSummary` (./apply.ts) writes to the live knowledge graph.

export type ConceptObservation = {
  conceptKey: string
  outcome: 'correct' | 'partial' | 'incorrect' | 'none'
  misconception?: { category: string; description?: string }
}

export type SessionSummary = {
  observations: ConceptObservation[]
}

// Inline stand-in for the `/packages/curriculum` graph (ADR-014): with no
// curriculum package yet, the summariser would otherwise emit free-form
// concept keys that drift between sessions (e.g. "algebra.factoring" vs
// "quadratics.factoring"), which would silently break the "session 2
// reflects session 1" acceptance. The summariser is constrained to ONLY
// these keys, and the live read (`/web/lib/learning/profile-read.ts`)
// reads back whatever was written under them — so keys stay stable across
// sessions until `/packages/curriculum` replaces this list wholesale.
export const KNOWN_CONCEPT_KEYS: readonly string[] = [
  'algebra.linear-equations.one-variable',
  'algebra.linear-equations.two-variable',
  'algebra.quadratics.factoring',
  'algebra.quadratics.formula',
  'algebra.exponents.product-rule',
  'algebra.exponents.power-rule',
  'algebra.polynomials.expanding',
  'algebra.inequalities.linear',
]
