// Public surface of @calyxa/curriculum (pure — no server-only, no Supabase,
// no Anthropic). The concept graph replacing the inline KNOWN_CONCEPT_KEYS
// stopgap (ADR-016). `CONCEPTS` (full objects, incl. `aliases` — ADR-032) is
// exported alongside `CONCEPT_KEYS` so `topic.ts` can derive its detection
// table from the curriculum at import time instead of hand-maintaining one.
export { CONCEPTS, CONCEPT_KEYS, getConcept, prerequisitesOf } from './concepts'
export type { Concept } from './concepts'
