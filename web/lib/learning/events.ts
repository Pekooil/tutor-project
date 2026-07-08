import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getConcept } from '@calyxa/curriculum'
import type { Assessment } from '@/lib/ai/envelope'
import { computeNodeUpdate, RESOLUTION_STREAK } from './apply'
import { KNOWN_CONCEPT_KEYS } from './types'

// Turn-time status pins (Sprint 13's event pings, ADR-026; loosened Sprint 14
// Task 5; generalized Sprint 15, ADR-034 -- the unified transient-signal
// surface): facts about what THIS turn's FSRS apply will do, computed
// prospectively so they can ride the turn response -- the only delivery that
// is "immediately after the answer" -- while the real apply still runs off
// the critical path (after(), ADR-019). The LLM plays no part in the pins
// THIS module computes: no envelope field, no prompt work, no grounding
// gate. (The model-declared "tutor move" pins and the memory pins derived
// from grounded profile tags are assembled in turn-complete.ts -- one wire
// array, three signal sources, each honest about its provenance.)
// Drift-proofing is structural, not hopeful: this module runs the SAME
// computeNodeUpdate (same row read, same input assembly, same pure
// updateKnowledgeNode) the apply itself runs seconds later, and turns are
// serialized by the extension's background worker, so the inputs read here
// are the inputs the apply will read.
//
// The learning-event kinds, by contract (ADR-026 + the ADR-034 renames):
//   concept-understood    -- (was mastery-up) the update crosses one of the
//                            model's own named upward MasteryState
//                            boundaries, INCLUDING first contact that lands
//                            at a real level (unseen->learning /
//                            unseen->mastered)
//   progress              -- (was mastery-progress) an in-state
//                            (learning|mastered) single-turn mastery gain
//                            >= MASTERY_PROGRESS_THRESHOLD
//   pattern-broken        -- (was misconception-resolved) this correct
//                            answer completes an active misconception's
//                            RESOLUTION_STREAK
//   streak-progress       -- this correct answer brings an active
//                            misconception to RESOLUTION_STREAK - 1, one
//                            away from breaking -- superseded by
//                            pattern-broken on the completing turn: the two
//                            thresholds (STREAK-1 and STREAK) can never both
//                            match the same consecutive_correct value, so
//                            this is structural, not a runtime check
//   prediction-confirmed  -- (new, ADR-034) this turn's flagged
//                            misconception matches one ALREADY RECORDED as
//                            active -- the profile predicted this exact
//                            failure mode and it just recurred
//   confidence-up         -- (new, ADR-034) the student's apparent
//                            certainty on this concept rose since their
//                            last recorded interaction with it, on a
//                            correct answer
// Still explicitly silent: confidence_band upticks (the band rises
// mechanically with observation count -- pinning it would fire on a
// schedule, not on merit), and NEWLY DETECTED misconceptions (persisted
// quietly by the apply exactly as before; they surface only in the
// session-end recap -- celebrating progress mid-session helps, announcing
// "new gap detected" mid-struggle does the opposite; reaffirmed in the
// ADR-034 design review). prediction-confirmed deliberately does NOT
// violate that rule: it only ever names a misconception the profile already
// carries, never a brand-new one.

// The full pin vocabulary (ADR-034), shared across the three signal sources:
// this module's deterministic learning events, turn-complete.ts's
// model-declared moves + tag-derived memory pins, and the extension's ONE
// client-derived kind ('final-step', from the solution-progress signal --
// never emitted server-side, listed here so the wire type names the whole
// catalog in one place).
export type StatusPinCategory =
  | 'prediction'
  | 'progress'
  | 'teaching'
  | 'guidance'
  | 'difficulty'
  | 'memory'
  | 'confidence'
  | 'independence'

export type StatusPinKind =
  | 'prediction-confirmed'
  | 'misconception-detected'
  | 'pattern-detected'
  | 'pattern-broken'
  | 'streak-progress'
  | 'concept-understood'
  | 'progress'
  | 'final-step'
  | 'teaching-visual'
  | 'teaching-decompose'
  | 'pace-up'
  | 'guidance-up'
  | 'guidance-down'
  | 'difficulty-up'
  | 'difficulty-down'
  | 'callback'
  | 'due-review'
  | 'confidence-up'
  | 'self-caught'

// Display-ready (ADR-024's server-rendered-display rule): `label` is the
// full pin copy -- QUALITATIVE, no mastery numbers, so even a theoretical
// prospective/actual divergence can never show a wrong figure. For
// model-declared moves the label is a FIXED string keyed by kind
// (turn-complete.ts), never model text. `conceptKey` is null for pins that
// aren't about one concept (the moves).
export type StatusPin = {
  category: StatusPinCategory
  kind: StatusPinKind
  conceptKey: string | null
  label: string
}

// The in-state mastery gain that earns a pin on its own (Sprint 14 Task 5).
// A named constant, not a magic number, per the sprint's tuning discipline
// -- beta feedback on threshold tightness is a constants edit here, not a
// redesign.
const MASTERY_PROGRESS_THRESHOLD = 0.1

// The named upward state transitions (deriveState's own thresholds --
// @calyxa/learning-model constants, not new magic numbers). Sprint 14 Task 5
// widens this with the two first-contact transitions (ADR-026 amendment):
// unseen->learning and unseen->mastered now celebrate too -- Sprint 13 kept
// first contact silent on purpose, and live use showed that under-fires
// when a student's very first turn on a concept already lands solidly.
const MASTERY_UP_TRANSITIONS: ReadonlySet<string> = new Set([
  'weak->learning',
  'forgotten->learning',
  'learning->mastered',
  'weak->mastered',
  'forgotten->mastered',
  'unseen->learning',
  'unseen->mastered',
])

// States eligible for the in-state progress pin -- deliberately narrower
// than "every state": a first-touch 'unseen' node has no meaningful prior
// mastery to gain from (that's concept-understood's job above, widened
// Sprint 14), and 'weak'/'forgotten' in-state ticks stay silent exactly as
// ADR-026 originally specified (routine adjustment, not a celebration-worthy
// gain).
const MASTERY_PROGRESS_STATES: ReadonlySet<string> = new Set(['learning', 'mastered'])

// The self-confidence ladder for the confidence-up pin: a pin fires when the
// student's apparent certainty climbed at least one rung since their last
// recorded interaction on this concept ('unknown' never participates on
// either side -- no honest trend exists through an unknown).
const SELF_CONFIDENCE_RANK: Record<string, number> = { low: 0, med: 1, high: 2 }

type ActiveMisconceptionStreakRow = {
  id: string
  category: string
  consecutive_correct: number
}

// "sign-errors" / "algebra.sign_errors" -> "sign errors" for pin copy.
function humanizeCategory(category: string): string {
  return category.replace(/[-_.]/g, ' ').replace(/\s+/g, ' ').trim()
}

// The same case/separator folding turn-complete.ts's tag grounding uses
// (normalizeTagText there): the model writes "sign errors" while the stored
// category is "sign-errors"/"algebra.sign_errors", so prediction-confirmed's
// recurrence match needs containment over normalized text, not equality.
function categoryOverlaps(a: string, b: string): boolean {
  const na = humanizeCategory(a).toLowerCase()
  const nb = humanizeCategory(b).toLowerCase()
  return na.length > 0 && nb.length > 0 && (na.includes(nb) || nb.includes(na))
}

// Prospectively derives this turn's learning-event pins from the assessed
// concept's current rows. Gradable assessments only; three small indexed
// reads for the ONE concept, in parallel; any failure degrades to no pins --
// a lost pin, never a failed or slowed turn.
export async function computeStatusPins(
  supabase: SupabaseClient,
  userId: string,
  assessment: Assessment,
  responseLatencyMs: number | null
): Promise<StatusPin[]> {
  const { conceptKey, outcome, reasoningQuality, selfConfidence, misconceptionCategory } = assessment

  if (!conceptKey || !KNOWN_CONCEPT_KEYS.includes(conceptKey)) return []
  if (outcome === 'none') return []

  try {
    const [nodeComputation, misconceptionsResult, priorConfidenceResult] = await Promise.all([
      computeNodeUpdate(supabase, userId, conceptKey, {
        outcome,
        reasoningQuality,
        selfConfidence,
        ...(responseLatencyMs !== null ? { responseLatencyMs } : {}),
      }),
      supabase
        .from('misconceptions')
        .select('id, category, consecutive_correct')
        .eq('user_id', userId)
        .eq('concept_key', conceptKey)
        .eq('status', 'active')
        .is('deleted_at', null),
      // The confidence-up baseline: the student's last recorded interaction
      // on this concept. Runs in parallel with persistInteraction's insert
      // of THIS turn's row (completeTurn's Promise.all) -- if the insert
      // happens to win that race, this reads the current turn's own
      // self_confidence, the trend reads flat, and the pin just doesn't
      // fire: a missed pin, never a wrong one.
      supabase
        .from('session_interactions')
        .select('self_confidence')
        .eq('user_id', userId)
        .eq('concept_key', conceptKey)
        .is('deleted_at', null)
        .order('created_at', { ascending: false })
        .limit(1),
    ])

    const title = getConcept(conceptKey)?.title ?? conceptKey
    const pins: StatusPin[] = []
    const activeRows = (misconceptionsResult.data ?? []) as ActiveMisconceptionStreakRow[]

    // Mirrors applyInteraction's resolution branch EXACTLY: it only runs
    // when no misconception was flagged this turn AND the answer was a
    // sound correct -- and a row resolves when its streak reaches
    // RESOLUTION_STREAK with this answer counted. streak-progress (Sprint 14
    // Task 5) reuses the SAME guard and the SAME rows, one turn earlier:
    // RESOLUTION_STREAK - 1 instead of >= RESOLUTION_STREAK. The two never
    // fire on the same row for the same turn -- a row's post-turn streak is
    // one specific number, and STREAK-1 != STREAK -- so "superseded on the
    // completing turn" holds structurally, not via an extra runtime check.
    if (!misconceptionCategory && outcome === 'correct' && reasoningQuality === 'sound') {
      const resolving = activeRows.find((row) => row.consecutive_correct + 1 >= RESOLUTION_STREAK)
      const almostResolving = activeRows.find((row) => row.consecutive_correct + 1 === RESOLUTION_STREAK - 1)

      if (resolving) {
        pins.push({
          category: 'progress',
          kind: 'pattern-broken',
          conceptKey,
          label: `Pattern broken: ${humanizeCategory(resolving.category)}`,
        })
      } else if (almostResolving) {
        pins.push({
          category: 'progress',
          kind: 'streak-progress',
          conceptKey,
          label: `Almost broken: ${humanizeCategory(almostResolving.category)} (${RESOLUTION_STREAK - 1} of ${RESOLUTION_STREAK})`,
        })
      }
    }

    // prediction-confirmed (ADR-034): the flagged misconception matches one
    // the profile ALREADY carries as active -- the recorded pattern just
    // recurred, exactly as the profile predicted. Never fires on a
    // first-occurrence misconception (that stays recap-only, the ADR-026
    // don't-announce-new-gaps rule).
    if (misconceptionCategory) {
      const recurring = activeRows.find((row) => categoryOverlaps(row.category, misconceptionCategory))
      if (recurring) {
        pins.push({
          category: 'prediction',
          kind: 'prediction-confirmed',
          conceptKey,
          label: `Misconception confirmed: ${humanizeCategory(recurring.category)}`,
        })
      }
    }

    const transition = `${nodeComputation.priorState}->${nodeComputation.next.state}`
    const masteryDelta = nodeComputation.next.mastery - nodeComputation.priorMastery

    if (MASTERY_UP_TRANSITIONS.has(transition)) {
      pins.push({
        category: 'progress',
        kind: 'concept-understood',
        conceptKey,
        label:
          nodeComputation.next.state === 'mastered' ? `Mastered: ${title}` : `Key concept understood: ${title}`,
      })
    } else if (
      MASTERY_PROGRESS_STATES.has(nodeComputation.priorState) &&
      nodeComputation.priorState === nodeComputation.next.state &&
      masteryDelta >= MASTERY_PROGRESS_THRESHOLD
    ) {
      // In-state only (Sprint 14 Task 5): a boundary-crossing turn already
      // got its (bigger) celebration above via concept-understood -- this is
      // the "same state, but a real jump" case Sprint 13 left silent.
      pins.push({
        category: 'progress',
        kind: 'progress',
        conceptKey,
        label: `Progress: ${title}`,
      })
    }

    // confidence-up (ADR-034): the student's own apparent certainty climbed
    // since their last recorded interaction on this concept, and the answer
    // was correct -- rising confidence on a wrong answer is not a
    // celebration. 'unknown' on either side means no honest trend exists.
    const priorConfidence = (priorConfidenceResult.data ?? [])[0]?.self_confidence as string | undefined
    if (
      outcome === 'correct' &&
      priorConfidence !== undefined &&
      priorConfidence in SELF_CONFIDENCE_RANK &&
      selfConfidence in SELF_CONFIDENCE_RANK &&
      SELF_CONFIDENCE_RANK[selfConfidence] > SELF_CONFIDENCE_RANK[priorConfidence]
    ) {
      pins.push({
        category: 'confidence',
        kind: 'confidence-up',
        conceptKey,
        label: 'Confidence rising',
      })
    }

    return pins
  } catch (err) {
    console.debug('[learning/events] computeStatusPins degraded to no pins', err)
    return []
  }
}
