// Session-summary shapes (ADR-015): the structured output of the
// end-of-session summariser (`/web/lib/ai/summarise.ts`) that
// `applySessionSummary` (./apply.ts) writes to the live knowledge graph.

export type ConceptObservation = {
  conceptKey: string
  outcome: 'correct' | 'partial' | 'incorrect' | 'none'
  // FSRS inputs (ADR-016): graded by the same summariser call, defaulted
  // defensively by its parser ('none'/'unknown') when the model omits them
  // or returns something unexpected.
  reasoningQuality: 'sound' | 'shallow' | 'none'
  selfConfidence: 'low' | 'med' | 'high' | 'unknown'
  misconception?: { category: string; description?: string }
}

export type SessionSummary = {
  observations: ConceptObservation[]
}

// Concept keys now come from the real curriculum graph (ADR-016), replacing
// the inline KNOWN_CONCEPT_KEYS stopgap (ADR-014). Re-exported under the old
// name so existing importers (e.g. apply.ts) keep compiling unchanged.
export { CONCEPT_KEYS as KNOWN_CONCEPT_KEYS } from '@calyxa/curriculum'
