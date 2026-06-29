// Typed seam for the learning profile (ADR-009). The shape mirrors what
// PLAN.md §2.3 query 1 + the §2.5 summariser produce from `knowledge_nodes`
// / `misconceptions`. The live source is `/web/lib/learning/profile-read.ts`
// (`loadProfile`, ADR-014) — this sprint retired the HARDCODED_PROFILE dummy
// instance; prompt assembly in system-prompt.ts did not change.

// ConfidenceBand/MasteryState now come from the FSRS package (ADR-016) --
// one source of truth shared with knowledge_nodes.confidence_band/state
// (DB CHECK constraints, migration 0004).
import type { ConfidenceBand, MasteryState } from '@calyxa/learning-model'

export type { ConfidenceBand, MasteryState }

export type MasteryNode = {
  conceptKey: string
  mastery: number // 0–1, decay-adjusted
  state: MasteryState
  confidenceBand: ConfidenceBand
}

export type ActiveMisconception = {
  conceptKey: string
  category: string
  description: string
}

export type LearningProfile = {
  masteryNodes: MasteryNode[]
  activeMisconceptions: ActiveMisconception[]
  confidenceNote: string
}
