// The end-of-session summariser (`/web/lib/ai/summarise.ts`) and its
// SessionSummary/ConceptObservation shapes (ADR-015) were retired in
// Sprint 11 (ADR-019): the tutor now emits a per-turn assessment inline
// (the §2.5 envelope), persisted per interaction and applied by
// `applyInteraction`/`reconcileSession` (./apply.ts) -- there is no
// end-of-session summary object anymore. `InteractionRecord` (./apply.ts)
// is the shape that replaced ConceptObservation.

// Concept keys come from the real curriculum graph (ADR-016), replacing the
// inline KNOWN_CONCEPT_KEYS stopgap (ADR-014). Re-exported under the old
// name so existing importers (e.g. apply.ts) keep compiling unchanged.
export { CONCEPT_KEYS as KNOWN_CONCEPT_KEYS } from '@calyxa/curriculum'
