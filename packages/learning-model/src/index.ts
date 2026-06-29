// Public surface of @calyxa/learning-model (pure — no server-only, no
// Supabase, no Anthropic). The full §2.4 FSRS update, replacing the
// Sprint 08 minimal Elo nudge (ADR-016).
export { updateKnowledgeNode, retrievability } from './fsrs'
export type {
  ConfidenceBand,
  MasteryState,
  Outcome,
  ReasoningQuality,
  SelfConfidence,
  KnowledgeNode,
  FsrsObservation,
  KnowledgeNodeUpdate,
} from './fsrs'
export * from './constants'
