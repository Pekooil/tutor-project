// Sprint 09 / Task 7: pure, offline unit tests for the full §2.4
// `updateKnowledgeNode` (PLAN §2.10 "learning model built & unit-tested in
// isolation"). No I/O, no Supabase, no Anthropic -- every test below is
// deterministic from its inputs.
//
// Two recurring techniques pin down what would otherwise be a multi-variable
// coupled system:
// - A huge `observationCount` drives confidence-weighted K to ~0, so
//   `mastery` after the call is (within float noise) just the node's input
//   `mastery` decayed by the elapsed time -- letting tests target a specific
//   post-update mastery without hand-solving the update equation.
// - `timeSinceLastDays: 0` makes `decay` exactly 1, which zeroes out
//   stability's growth term (it scales by `1 - decay`) -- so `stability`
//   after the call equals the input `stability` exactly, regardless of
//   grade.
// Both let assertions stay expressed in terms of the package's own exported
// constants/thresholds, so they don't need updating if the (explicitly
// "uncalibrated") tuning constants are retuned later.

import { describe, it, expect } from 'vitest'
import { updateKnowledgeNode, retrievability, type KnowledgeNode, type FsrsObservation } from './fsrs'
import {
  MIN_STABILITY,
  DIFF_MIN,
  DIFF_MAX,
  MASTERED_THRESHOLD,
  WEAK_THRESHOLD,
  FORGOTTEN_PROJECTION_DAYS,
  FORGOTTEN_RETRIEVABILITY_THRESHOLD,
} from './constants'

const PIN_OBSERVATION_COUNT = 1_000_000 // drives K to ~0 (see file header)

function node(overrides: Partial<KnowledgeNode> = {}): KnowledgeNode {
  return { mastery: 0, stability: MIN_STABILITY, difficulty: 0.3, observationCount: 0, ...overrides }
}

function observation(overrides: Partial<FsrsObservation> = {}): FsrsObservation {
  return {
    outcome: 'correct',
    reasoningQuality: 'sound',
    selfConfidence: 'high',
    timeSinceLastDays: 0,
    ...overrides,
  }
}

describe('retrievability (read-time decay)', () => {
  it('is 1 at zero elapsed days, and strictly decreasing as days grows', () => {
    expect(retrievability(5, 0)).toBe(1)

    const samples = [0, 1, 3, 7, 14, 30, 90].map((days) => retrievability(5, days))
    for (let i = 1; i < samples.length; i++) {
      expect(samples[i]).toBeLessThan(samples[i - 1])
    }
  })

  it('is strictly increasing in stability for a fixed, nonzero elapsed time', () => {
    const stabilities = [0.5, 1, 2, 5, 20, 100]
    const samples = stabilities.map((s) => retrievability(s, 14))
    for (let i = 1; i < samples.length; i++) {
      expect(samples[i]).toBeGreaterThan(samples[i - 1])
    }
  })
})

describe('bounds and monotonicity', () => {
  it('keeps mastery in [0, 1] under a long run of successes, and under a long run of failures', () => {
    let success = node({ mastery: 0 })
    let failure = node({ mastery: 1, stability: 50 })

    for (let i = 0; i < 50; i++) {
      success = { ...success, ...updateKnowledgeNode(success, observation({ outcome: 'correct' })) }
      expect(success.mastery).toBeGreaterThanOrEqual(0)
      expect(success.mastery).toBeLessThanOrEqual(1)

      failure = { ...failure, ...updateKnowledgeNode(failure, observation({ outcome: 'incorrect', reasoningQuality: 'none' })) }
      expect(failure.mastery).toBeGreaterThanOrEqual(0)
      expect(failure.mastery).toBeLessThanOrEqual(1)
    }
  })

  it('never collapses stability below MIN_STABILITY under a long run of failures', () => {
    let current = node({ stability: 10 })

    for (let i = 0; i < 20; i++) {
      const result = updateKnowledgeNode(current, observation({ outcome: 'incorrect', reasoningQuality: 'none' }))
      expect(result.stability).toBeGreaterThanOrEqual(MIN_STABILITY)
      current = { ...current, ...result }
    }
  })

  it('keeps difficulty within [DIFF_MIN, DIFF_MAX] under runs of all-correct and all-incorrect', () => {
    let easy = node({ difficulty: 0.3 })
    let hard = node({ difficulty: 0.3 })

    for (let i = 0; i < 50; i++) {
      easy = { ...easy, ...updateKnowledgeNode(easy, observation({ outcome: 'correct' })) }
      hard = { ...hard, ...updateKnowledgeNode(hard, observation({ outcome: 'incorrect', reasoningQuality: 'none' })) }
      expect(easy.difficulty).toBeGreaterThanOrEqual(DIFF_MIN)
      expect(easy.difficulty).toBeLessThanOrEqual(DIFF_MAX)
      expect(hard.difficulty).toBeGreaterThanOrEqual(DIFF_MIN)
      expect(hard.difficulty).toBeLessThanOrEqual(DIFF_MAX)
    }
  })

  it('a correct answer raises mastery and an incorrect answer lowers it, from the same starting node', () => {
    const start = node({ mastery: 0.5, stability: 3, observationCount: 5 })

    const afterCorrect = updateKnowledgeNode(start, observation({ outcome: 'correct' }))
    const afterIncorrect = updateKnowledgeNode(start, observation({ outcome: 'incorrect', reasoningQuality: 'none' }))

    expect(afterCorrect.mastery).toBeGreaterThan(start.mastery)
    expect(afterIncorrect.mastery).toBeLessThan(start.mastery)
  })

  it('shrinks the effective update (K) as observationCount grows', () => {
    const start = node({ mastery: 0.5, stability: 3 })
    const counts = [0, 1, 5, 20, 100]

    const deltas = counts.map((observationCount) => {
      const result = updateKnowledgeNode({ ...start, observationCount }, observation({ outcome: 'correct' }))
      return result.mastery - start.mastery // decay is 1 at timeSinceLastDays: 0, so effectiveMastery === start.mastery
    })

    for (let i = 1; i < deltas.length; i++) {
      expect(deltas[i]).toBeLessThan(deltas[i - 1])
    }
  })
})

describe('lucky-guess discount and slip softening', () => {
  it('a correct with no reasoning moves mastery less than a correct with sound reasoning', () => {
    const start = node({ mastery: 0, observationCount: 0 })

    const guessed = updateKnowledgeNode(start, observation({ outcome: 'correct', reasoningQuality: 'none' }))
    const sound = updateKnowledgeNode(start, observation({ outcome: 'correct', reasoningQuality: 'sound' }))

    expect(guessed.mastery).toBeLessThan(sound.mastery)
  })

  it('a correct with low self-confidence is discounted even when the reasoning was sound (the guard is an OR)', () => {
    const start = node({ mastery: 0, observationCount: 0 })

    const lowConfidence = updateKnowledgeNode(
      start,
      observation({ outcome: 'correct', reasoningQuality: 'sound', selfConfidence: 'low' })
    )
    const highConfidence = updateKnowledgeNode(
      start,
      observation({ outcome: 'correct', reasoningQuality: 'sound', selfConfidence: 'high' })
    )

    expect(lowConfidence.mastery).toBeLessThan(highConfidence.mastery)
  })

  it('a sound-but-wrong answer (a slip) is softened relative to an unreasoned wrong answer', () => {
    const start = node({ mastery: 0.5, observationCount: 0 })

    const slip = updateKnowledgeNode(start, observation({ outcome: 'incorrect', reasoningQuality: 'sound' }))
    const plainWrong = updateKnowledgeNode(start, observation({ outcome: 'incorrect', reasoningQuality: 'none' }))

    expect(slip.mastery).toBeGreaterThan(plainWrong.mastery)
  })
})

describe('state derivation', () => {
  it('"mastered" when mastery clears the threshold and the confidence band is not low', () => {
    const start = node({
      mastery: Math.min(MASTERED_THRESHOLD + 0.01, 1),
      stability: 10,
      observationCount: PIN_OBSERVATION_COUNT, // pins mastery (K≈0) and yields a non-'low' band
    })

    const result = updateKnowledgeNode(start, observation())

    expect(result.state).toBe('mastered')
  })

  it('"weak" when mastery is below the weak threshold', () => {
    const start = node({
      mastery: Math.max(WEAK_THRESHOLD - 0.01, 0),
      stability: 10,
      observationCount: PIN_OBSERVATION_COUNT,
    })

    const result = updateKnowledgeNode(start, observation())

    expect(result.state).toBe('weak')
  })

  it('"learning" when mastery is mid-band and stability is high enough that the forgotten projection doesn\'t fire', () => {
    const start = node({
      mastery: (WEAK_THRESHOLD + MASTERED_THRESHOLD) / 2,
      stability: 1000, // projected retrievability ~1 at this stability -- well clear of the forgotten threshold
      observationCount: PIN_OBSERVATION_COUNT,
    })

    const result = updateKnowledgeNode(start, observation())

    expect(result.state).toBe('learning')
  })

  it('"forgotten" when projected one-week retrievability undercuts the threshold, even with mid-band mastery', () => {
    const stability = MIN_STABILITY
    const projected = retrievability(stability, FORGOTTEN_PROJECTION_DAYS)
    // Solve mastery * projected < FORGOTTEN_RETRIEVABILITY_THRESHOLD for mastery, staying just
    // inside the weak/mastered band so this isn't actually caught by an earlier branch.
    const mastery = Math.min(FORGOTTEN_RETRIEVABILITY_THRESHOLD / projected - 0.001, MASTERED_THRESHOLD - 0.001)
    expect(mastery).toBeGreaterThanOrEqual(WEAK_THRESHOLD) // sanity: still mid-band, not 'weak'

    const result = updateKnowledgeNode(
      node({ mastery, stability, observationCount: PIN_OBSERVATION_COUNT }),
      observation()
    )

    expect(result.state).toBe('forgotten')
  })
})
