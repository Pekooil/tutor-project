// Typed seam for the learning profile (ADR-009). The shape mirrors what
// PLAN.md §2.3 query 1 + the §2.5 summariser will eventually produce from
// `knowledge_nodes` / `misconceptions`. The learning-connect sprint swaps
// HARDCODED_PROFILE for a live query result of this same type — prompt
// assembly in system-prompt.ts does not change.

export type ConfidenceBand = 'low' | 'medium' | 'high'

export type MasteryState = 'unseen' | 'learning' | 'weak' | 'mastered' | 'forgotten'

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

// A small, realistic dummy profile (ADR-009). The live profile system
// replaces this instance — not the LearningProfile type — once query 1 and
// the §2.5 summariser exist.
export const HARDCODED_PROFILE: LearningProfile = {
  // Weakest first, matching the §2.5 query 1 ordering (`mastery ASC`).
  masteryNodes: [
    {
      conceptKey: 'algebra.quadratics.factoring',
      mastery: 0.35,
      state: 'weak',
      confidenceBand: 'low',
    },
    {
      conceptKey: 'algebra.exponents.product-rule',
      mastery: 0.58,
      state: 'learning',
      confidenceBand: 'low',
    },
    {
      conceptKey: 'algebra.linear-equations.one-variable',
      mastery: 0.82,
      state: 'mastered',
      confidenceBand: 'medium',
    },
  ],
  activeMisconceptions: [
    {
      conceptKey: 'algebra.quadratics.factoring',
      category: 'sign_error.distribution',
      description: 'Drops or flips the sign when distributing a negative across a binomial.',
    },
  ],
  confidenceNote: 'Calibrating — early estimate (band mostly low).',
}
