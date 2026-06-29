// Named tuning constants for the FSRS-flavoured update (PLAN.md §2.4). None
// are calibrated against real response data yet -- they are literature/spec
// defaults (Sprint 09 risk: "FSRS tuning constants are uncalibrated").
// Centralised, named, and cited here so they are re-tunable without
// touching the algorithm in fsrs.ts.

// --- Mastery update (Elo-style, confidence-weighted K) — §2.4 step 4 ------

// Base learning rate before the lucky-guess/slip scale and the
// confidence-weight shrink are applied ("K = BASE_K * learning_rate_scale *
// confidence_weight(observation_count)").
export const BASE_K = 0.3

// --- Lucky-guess / slip guards — §2.4 step 3 -------------------------------

// A "correct" with no/shallow reasoning or low self-confidence is credited
// at this grade instead of 1.0 — "credited, but not as true mastery".
export const LUCKY_GUESS_GRADE = 0.6

// K is scaled down this much when the lucky-guess guard fires — "updated
// cautiously".
export const LUCKY_GUESS_K_SCALE = 0.5

// A sound-but-wrong answer (a slip) is softened from grade 0.0 to this —
// "one slip doesn't tank a known concept".
export const SLIP_GRADE = 0.25

// Placeholder for the response_latency_ms sub-guard
// (`FAST_GUESS_MS(node.difficulty)`, §2.4 step 3). NOT consumed by
// updateKnowledgeNode this sprint: `response_latency_ms` has no source at
// session-end granularity, with no per-turn capture yet (ADR-016). This
// sub-guard returns with the per-turn-persistence sprint; named + kept here
// so that sprint adds no new constant.
export const FAST_GUESS_MS = 1500

// --- Stability — §2.4 step 5 ------------------------------------------------

// Success-side growth multiplier: stability grows more when recall happened
// at low retrievability and on a harder concept ("desirable difficulty").
export const STAB_GROWTH = 0.3

// Failure-side collapse multiplier — "e.g. *0.5" per §2.4.
export const STAB_PENALTY = 0.5

// Stability never collapses below this floor. Matches the DB default seed
// (`knowledge_nodes.stability` default 1.0, migration 0004).
export const MIN_STABILITY = 1.0

// --- Difficulty drift — §2.4 step 6, "slow" --------------------------------

export const DIFF_LR = 0.05
export const DIFF_MIN = 0.05
export const DIFF_MAX = 0.95

// --- Confidence band + state thresholds — §2.4 step 7 ----------------------

export const CONFIDENCE_BAND_LOW_MAX = 3 // observation_count < 3 -> 'low'
export const CONFIDENCE_BAND_MEDIUM_MAX = 8 // observation_count < 8 -> 'medium', else 'high'

export const MASTERED_THRESHOLD = 0.85
export const WEAK_THRESHOLD = 0.5

// 'forgotten' = projected retrievability one week out, applied to the new
// mastery, falls below this — "will lapse soon".
export const FORGOTTEN_PROJECTION_DAYS = 7
export const FORGOTTEN_RETRIEVABILITY_THRESHOLD = 0.3

// --- Spaced reinforcement scheduler (§2.4, "Spaced reinforcement
// scheduler") — NOT consumed by updateKnowledgeNode this sprint
// (scheduleReinforcement is deferred, ADR-016). Landed here so the
// scheduler sprint needs no new constant.
export const R_DESIRED = 0.9
