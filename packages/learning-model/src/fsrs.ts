// The full §2.4 FSRS-flavoured knowledge-graph update (PLAN.md §2.4
// "Knowledge graph update algorithm"), replacing the Sprint 08 minimal Elo
// nudge (`/web/lib/learning/update.ts`, ADR-014/ADR-016). Pure — no clock,
// no I/O, no `scheduleReinforcement` call (the reinforcement scheduler is
// deferred, ADR-016).
//
// Run once per concept at session end (ADR-016) rather than per
// interaction: `FsrsObservation.timeSinceLastDays` stands in for §2.4's
// per-turn `time_since_last`, derived by the caller (`apply.ts`, Task 6)
// from the stored `last_practiced_at`.

import {
  BASE_K,
  CONFIDENCE_BAND_LOW_MAX,
  CONFIDENCE_BAND_MEDIUM_MAX,
  DIFF_LR,
  DIFF_MAX,
  DIFF_MIN,
  FORGOTTEN_PROJECTION_DAYS,
  FORGOTTEN_RETRIEVABILITY_THRESHOLD,
  LUCKY_GUESS_GRADE,
  LUCKY_GUESS_K_SCALE,
  MASTERED_THRESHOLD,
  MIN_STABILITY,
  SLIP_GRADE,
  STAB_GROWTH,
  STAB_PENALTY,
  WEAK_THRESHOLD,
} from './constants'

export type ConfidenceBand = 'low' | 'medium' | 'high'
export type MasteryState = 'unseen' | 'learning' | 'weak' | 'mastered' | 'forgotten'

export type Outcome = 'correct' | 'partial' | 'incorrect'
export type ReasoningQuality = 'sound' | 'shallow' | 'none'
export type SelfConfidence = 'low' | 'med' | 'high' | 'unknown'

export type KnowledgeNode = {
  mastery: number
  stability: number
  difficulty: number
  observationCount: number
}

export type FsrsObservation = {
  outcome: Outcome
  reasoningQuality: ReasoningQuality
  selfConfidence: SelfConfidence
  timeSinceLastDays: number
}

export type KnowledgeNodeUpdate = {
  mastery: number
  stability: number
  difficulty: number
  observationCount: number
  confidenceBand: ConfidenceBand
  state: MasteryState
}

const GRADE_MAP: Record<Outcome, number> = {
  correct: 1,
  partial: 0.5,
  incorrect: 0,
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

// FSRS power-decay retrievability (§2.4): R = (1 + t/(9*S))^-1.
// Monotonically decreasing in `days` (forgetting over time); monotonically
// increasing in `stability` (a more stable memory decays slower). Exported
// for read-time decay (`profile-read.ts`, Task 6) as well as the
// forgotten-state projection below.
export function retrievability(stability: number, days: number): number {
  return Math.pow(1 + days / (9 * stability), -1)
}

// K shrinks as observation_count grows so estimates stabilise over time
// (§2.4 step 4). 1/(1+n): full weight on the first observation, halved by
// the second, asymptotically approaching (never reaching) zero so an
// established node's mastery can still move.
function confidenceWeight(observationCount: number): number {
  return 1 / (1 + observationCount)
}

function deriveConfidenceBand(observationCount: number): ConfidenceBand {
  if (observationCount < CONFIDENCE_BAND_LOW_MAX) return 'low'
  if (observationCount < CONFIDENCE_BAND_MEDIUM_MAX) return 'medium'
  return 'high'
}

function deriveState(mastery: number, confidenceBand: ConfidenceBand, stability: number): MasteryState {
  if (mastery >= MASTERED_THRESHOLD && confidenceBand !== 'low') return 'mastered'
  if (mastery < WEAK_THRESHOLD) return 'weak'
  if (mastery * retrievability(stability, FORGOTTEN_PROJECTION_DAYS) < FORGOTTEN_RETRIEVABILITY_THRESHOLD) {
    return 'forgotten'
  }
  return 'learning'
}

export function updateKnowledgeNode(node: KnowledgeNode, observation: FsrsObservation): KnowledgeNodeUpdate {
  // 1. Decay: apply forgetting since last practice.
  const decay = retrievability(node.stability, observation.timeSinceLastDays)
  const effectiveMastery = node.mastery * decay

  // 2. Grade: map outcome to a target in [0,1].
  let grade = GRADE_MAP[observation.outcome]
  let learningRateScale = 1

  // 3. Lucky-guess / false-mastery guard: a "correct" with no/shallow
  // reasoning or low self-confidence is discounted toward a partial -- we
  // don't reward guessing. The response_latency_ms sub-guard is
  // intentionally omitted here (see FAST_GUESS_MS in constants.ts) -- the
  // other two sub-guards still fire.
  const isLuckyGuess =
    grade === 1 &&
    (observation.reasoningQuality === 'none' ||
      observation.reasoningQuality === 'shallow' ||
      observation.selfConfidence === 'low')

  if (isLuckyGuess) {
    grade = LUCKY_GUESS_GRADE
    learningRateScale = LUCKY_GUESS_K_SCALE
  } else if (grade === 0 && observation.reasoningQuality === 'sound') {
    // Symmetric guard: a wrong answer with sound reasoning (a slip) is
    // softened so one slip doesn't tank a known concept.
    grade = SLIP_GRADE
  }

  // 4. Update mastery (Elo-style, confidence-weighted K).
  const K = BASE_K * learningRateScale * confidenceWeight(node.observationCount)
  const mastery = clamp(effectiveMastery + K * (grade - effectiveMastery), 0, 1)

  // 5. Update stability: memory strengthens on success (more so when
  // recall happened at low retrievability on a harder concept --
  // "desirable difficulty"), collapses toward the floor on failure.
  const stability =
    grade >= 0.6
      ? node.stability * (1 + STAB_GROWTH * (1 - decay) * (1 - node.difficulty))
      : Math.max(MIN_STABILITY, node.stability * STAB_PENALTY)

  // 6. Difficulty drift (slow).
  const difficulty = clamp(node.difficulty + DIFF_LR * ((1 - grade) - node.difficulty), DIFF_MIN, DIFF_MAX)

  // 7. Confidence band + state label. The band uses the PRE-update
  // observation_count, per §2.4 ("band = ... node.observation_count")
  // ahead of "persist(..., observation_count += 1)"; the returned
  // observationCount below is post-increment.
  const confidenceBand = deriveConfidenceBand(node.observationCount)
  const state = deriveState(mastery, confidenceBand, stability)

  return {
    mastery,
    stability,
    difficulty,
    observationCount: node.observationCount + 1,
    confidenceBand,
    state,
  }
}
