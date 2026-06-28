import type { ConfidenceBand, MasteryState } from '@/lib/ai/profile'
import type { ConceptObservation } from './types'

export type MasteryUpdate = {
  mastery: number
  state: MasteryState
  observationCount: number
  confidenceBand: ConfidenceBand
}

// A small, fixed learning-rate constant for the minimal nudge below. NOT
// tuned -- the FSRS package (PLAN §2.4; ADR-014) replaces this constant
// with the full confidence-weighted, observation-count-shrinking K.
const K = 0.2

const GRADE: Record<ConceptObservation['outcome'], number | null> = {
  correct: 1,
  partial: 0.5,
  incorrect: 0,
  none: null, // discussed, not attempted -- no mastery signal (apply.ts skips these entirely)
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value))
}

function deriveState(mastery: number, confidenceBand: ConfidenceBand): MasteryState {
  if (mastery >= 0.85 && confidenceBand !== 'low') return 'mastered'
  if (mastery < 0.5) return 'weak'
  return 'learning'
}

function deriveConfidenceBand(observationCount: number): ConfidenceBand {
  if (observationCount < 3) return 'low'
  if (observationCount < 8) return 'medium'
  return 'high'
}

// Minimal Elo-style mastery nudge (ADR-014) -- a seed for, not a
// replacement of, the future `/packages/learning-model` FSRS model.
// Deliberately omits: decay/retrievability over time, `stability` and
// `difficulty` drift, and lucky-guess/false-mastery discounting. Pure, no
// I/O -- `apply.ts` supplies `prev` from the DB and writes the result back.
export function updateMasteryNode(
  prev: { mastery: number; observationCount: number },
  observation: ConceptObservation
): MasteryUpdate {
  const grade = GRADE[observation.outcome]

  if (grade === null) {
    const confidenceBand = deriveConfidenceBand(prev.observationCount)
    return {
      mastery: prev.mastery,
      state: deriveState(prev.mastery, confidenceBand),
      observationCount: prev.observationCount,
      confidenceBand,
    }
  }

  const mastery = clamp01(prev.mastery + K * (grade - prev.mastery))
  const observationCount = prev.observationCount + 1
  const confidenceBand = deriveConfidenceBand(observationCount)

  return {
    mastery,
    state: deriveState(mastery, confidenceBand),
    observationCount,
    confidenceBand,
  }
}
