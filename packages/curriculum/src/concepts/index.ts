// The static concept graph (ADR-032, re-cut by the 11-course restructure).
// Seven content modules concatenate into one graph;
// `getConcept`/`prerequisitesOf`/`CONCEPT_KEYS` keep the exact signatures
// `concepts.ts` (now a re-export shim, kept for import-site stability) always
// had. Adding a concept is still data-only — append an entry to the right
// module; no accessor here needs to change.
//
// The modules are named for courses now, not for the old six strands, and one
// concept is authored in exactly ONE module: the earliest course that teaches
// it. Courses that share it list its key (see `../courses.ts`). That is what
// keeps mastery shared — a student who learns factoring in Integrated Math 2
// and later takes Algebra 2 is credited once, against one key, because there
// is only one `algebra.quadratics.factoring` in the graph.
//
// `CONCEPT_MODULES` is exported so `courses.ts` can answer "which course owns
// this concept" without parsing the key prefix — a prefix can't distinguish
// Calculus AB from BC, since both use `calculus.*`.
//
// Prerequisite edges cross modules where the math does (right-triangle trig ←
// similarity; derivative-as-limit ← limits & continuity ← the precalc limits
// intro; u-substitution ← chain rule + antiderivatives; conic sections ←
// circle equations; inference for slope ← residuals + the t-test).
import { ALGEBRA1_CONCEPTS } from './algebra1'
import { GEOMETRY_CONCEPTS } from './geometry'
import { ALGEBRA2_CONCEPTS } from './algebra2'
import { PRECALCULUS_CONCEPTS } from './precalculus'
import { CALCULUS_AB_CONCEPTS } from './calculus-ab'
import { CALCULUS_BC_CONCEPTS } from './calculus-bc'
import { STATISTICS_CONCEPTS } from './statistics'
import type { Concept } from './types'

export type { Concept } from './types'

export {
  ALGEBRA1_CONCEPTS,
  GEOMETRY_CONCEPTS,
  ALGEBRA2_CONCEPTS,
  PRECALCULUS_CONCEPTS,
  CALCULUS_AB_CONCEPTS,
  CALCULUS_BC_CONCEPTS,
  STATISTICS_CONCEPTS,
}

/** Each content module paired with the course key that owns it — the "home"
 *  course a concept is attributed to when the student has not told us which
 *  course they are taking. */
export const CONCEPT_MODULES: readonly { readonly courseKey: string; readonly concepts: readonly Concept[] }[] = [
  { courseKey: 'algebra-1', concepts: ALGEBRA1_CONCEPTS },
  { courseKey: 'geometry', concepts: GEOMETRY_CONCEPTS },
  { courseKey: 'algebra-2', concepts: ALGEBRA2_CONCEPTS },
  { courseKey: 'precalculus', concepts: PRECALCULUS_CONCEPTS },
  { courseKey: 'ap-calculus-ab', concepts: CALCULUS_AB_CONCEPTS },
  { courseKey: 'ap-calculus-bc', concepts: CALCULUS_BC_CONCEPTS },
  { courseKey: 'ap-statistics', concepts: STATISTICS_CONCEPTS },
]

export const CONCEPTS: readonly Concept[] = CONCEPT_MODULES.flatMap((module) => module.concepts)

const CONCEPTS_BY_KEY: ReadonlyMap<string, Concept> = new Map(CONCEPTS.map((concept) => [concept.key, concept]))

export const CONCEPT_KEYS: readonly string[] = CONCEPTS.map((concept) => concept.key)

export function getConcept(key: string): Concept | undefined {
  return CONCEPTS_BY_KEY.get(key)
}

export function prerequisitesOf(key: string): readonly string[] {
  return CONCEPTS_BY_KEY.get(key)?.prerequisites ?? []
}
