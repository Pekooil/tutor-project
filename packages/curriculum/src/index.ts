// Public surface of @calyxa/curriculum (pure — no server-only, no Supabase,
// no Anthropic). The concept graph replacing the inline KNOWN_CONCEPT_KEYS
// stopgap (ADR-016).
export { CONCEPT_KEYS, getConcept, prerequisitesOf } from './concepts'
export type { Concept } from './concepts'
