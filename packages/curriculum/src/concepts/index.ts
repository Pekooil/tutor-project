// The static concept graph at launch scale (ADR-032; supersedes the Sprint
// 09 single-strand stopgap). Six per-strand modules concatenate into one
// graph; `getConcept`/`prerequisitesOf`/`CONCEPT_KEYS` keep the exact
// signatures `concepts.ts` (now a re-export shim, kept for import-site
// stability) always had. Adding a concept is still data-only — append an
// entry to the right strand file; no accessor here needs to change.
//
// Prerequisite edges cross strands where the math does (e.g. right-triangle
// trig ← similarity; derivative-as-limit ← limits & continuity ← the
// precalc limits intro; u-substitution ← chain rule + antiderivatives) —
// consumed by the onboarding sprint's prior propagation (PLAN §2.4 cold
// start), not this sprint.
import { ALGEBRA1_CONCEPTS } from './algebra1'
import { GEOMETRY_CONCEPTS } from './geometry'
import { ALGEBRA2_CONCEPTS } from './algebra2'
import { TRIG_PRECALC_CONCEPTS } from './trig-precalc'
import { CALCULUS_CONCEPTS } from './calculus'
import { PROB_STATS_CONCEPTS } from './prob-stats'
import type { Concept } from './types'

export type { Concept } from './types'

export const CONCEPTS: readonly Concept[] = [
  ...ALGEBRA1_CONCEPTS,
  ...GEOMETRY_CONCEPTS,
  ...ALGEBRA2_CONCEPTS,
  ...TRIG_PRECALC_CONCEPTS,
  ...CALCULUS_CONCEPTS,
  ...PROB_STATS_CONCEPTS,
]

const CONCEPTS_BY_KEY: ReadonlyMap<string, Concept> = new Map(CONCEPTS.map((concept) => [concept.key, concept]))

export const CONCEPT_KEYS: readonly string[] = CONCEPTS.map((concept) => concept.key)

export function getConcept(key: string): Concept | undefined {
  return CONCEPTS_BY_KEY.get(key)
}

export function prerequisitesOf(key: string): readonly string[] {
  return CONCEPTS_BY_KEY.get(key)?.prerequisites ?? []
}
