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

// A reinforcement_schedule item that is due (PLAN §2.3 query 2, ADR-020/021):
// `reason` is the human-readable "why now" the prompt renders under
// "Fading / due for review" (e.g. "weak, overdue by 2d").
export type DueForReviewItem = {
  conceptKey: string
  reason: string
}

// A prior-session digest entry (Sprint 13, ADR-026): the real-history
// material behind the tutor's cross-session callbacks ("this connects to
// something you worked through a few sessions ago"). `outcomeLine` is
// derived MECHANICALLY from that session's recorded outcomes — one of a
// bounded set of phrasings computed in profile-read.ts, never free text —
// so the digest can state what happened but can never editorialize beyond
// what the rows support.
export type PriorWorkItem = {
  conceptKey: string
  sessionsAgo: number
  daysAgo: number
  outcomeLine: string
}

export type LearningProfile = {
  masteryNodes: MasteryNode[]
  activeMisconceptions: ActiveMisconception[]
  confidenceNote: string
  // Present only when the scheduler queue has due items (ADR-021) — a
  // profile with none reads exactly as it did before Sprint 11.
  dueForReview?: DueForReviewItem[]
  // Present only when the student has prior ENDED sessions touching
  // currently-relevant concepts (Sprint 13, ADR-026) — cold start and
  // first-session profiles read exactly as before.
  priorWork?: PriorWorkItem[]
}
