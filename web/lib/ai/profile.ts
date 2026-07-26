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
  // Sprint 15 fix pass round 2: when this node was last practiced (ISO
  // string, straight from knowledge_nodes.last_practiced_at) -- the overlay
  // overview card sorts by it to show the most recently updated topics.
  // Optional so the many test fixtures (and any older construction site)
  // that build profiles by hand stay valid; the prompt renderer ignores it.
  lastPracticedAt?: string | null
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
  // The `@calyxa/curriculum` course the student picked at signup (11-course
  // restructure). It rides the profile because the profile is the one object
  // that already reaches every prompt builder and provider path — a separate
  // parameter would have to be threaded through all of them.
  //
  // Absent for accounts that never answered onboarding and for "something
  // else"; every consumer must treat it as optional. It sets the tutor's
  // PITCH and breaks ties in topic detection — it never scopes what the tutor
  // will help with.
  courseKey?: string | null
}
