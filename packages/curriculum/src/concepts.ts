// Re-export shim (ADR-032 Task 2): the concept graph moved to
// `./concepts/*` (six per-strand modules, concatenated in
// `./concepts/index.ts`). This file exists only so every pre-existing
// import site — `./concepts` (this package's own tests) and `@calyxa/
// curriculum` via `index.ts` below — keeps resolving with zero changes.
export { CONCEPTS, CONCEPT_KEYS, getConcept, prerequisitesOf } from './concepts/index'
export type { Concept } from './concepts/index'
