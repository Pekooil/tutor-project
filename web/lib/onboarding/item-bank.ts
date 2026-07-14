// Sprint 17 / Task 3 (ADR-042): the cold-start onboarding item bank -- a PURE
// structure over @calyxa/curriculum (no server-only, no Supabase, no
// Anthropic), so it is directly unit-testable. `selectAssessmentItems()` picks
// 8-12 concepts spanning the six strands; the actual FSRS observation each
// answer produces is derived in `seed.ts`, the one module that talks to the
// apply path -- this file only decides WHICH concepts to ask and the self-check
// vocabulary to ask them with.
//
// Interpretation note (flagged for Task 7 / Task 9): the assessment is a
// concept SELF-CHECK, not an auto-graded quiz. Onboarding has no tutor in the
// loop to grade a typed answer (it is a pre-panel gate, not a turn -- ADR-042),
// and ADR-042 wants only MODEST priors anyway ("not confident mastery"), so a
// self-efficacy answer -> a modest FSRS observation is both the honest and the
// on-spec mapping. `kind: 'free'` is kept in the union for Task 7 to use (an
// open reflection), but the bank emits `choice` items today; real graded
// free/choice questions (with answer keys) are a future content addition, not a
// change to this seeding mechanism or the results contract below.
import { CONCEPTS, CONCEPT_KEYS, type Concept } from '@calyxa/curriculum'
import type { Outcome, SelfConfidence } from '@calyxa/learning-model'

export type AssessmentItemKind = 'choice' | 'free'

// One self-check answer. `outcome`/`selfConfidence` are the graded signal the
// student's choice stands for; `seed.ts` turns them into an FSRS observation.
export type AssessmentChoiceOption = {
  label: string
  outcome: Outcome
  selfConfidence: SelfConfidence
}

export type AssessmentItem = {
  conceptKey: string
  // Top-level strand id (the concept key's first dotted segment) + its label.
  strand: string
  strandLabel: string
  title: string
  prompt: string
  kind: AssessmentItemKind
  // Present for `choice` items -- the self-check scale the student answers on.
  options?: readonly AssessmentChoiceOption[]
}

// The graded result the overlay (Task 7) POSTs per answered item; a skipped
// item is simply omitted. Content-free beyond the concept key + the two enum
// signals -- no free text on the wire (the same discipline ADR-043 enforces for
// telemetry, though onboarding is a different route).
export type AssessmentResult = {
  conceptKey: string
  outcome: Outcome
  selfConfidence: SelfConfidence
}

// Selection bounds (Task 8 pins these). 8-12 is the cap, not a floor: 6 easy
// anchors (one per strand) + a few harder "reaches" land at TARGET, inside the
// bound, and prerequisite propagation (seed.ts) means these few items seed far
// more than a few nodes.
export const MIN_ASSESSMENT_ITEMS = 8
export const MAX_ASSESSMENT_ITEMS = 12
const TARGET_ASSESSMENT_ITEMS = 10

// The six top-level strands, recovered from the concept key's first dotted
// segment (algebra1's keys are `algebra.*`, prob-stats' `stats.*`, etc.). This
// is the only stable, package-exported way to recover module membership -- the
// per-module arrays (ALGEBRA1_CONCEPTS, ...) are internal to @calyxa/curriculum
// and `Concept.strand` is the finer sub-topic, not the module.
// Exported (Sprint 22 Task 4): the dashboard read groups the full per-user
// graph by these same six top-level strands, so `dashboard-read.ts` reuses
// this vocabulary rather than defining a second copy — one source of truth for
// "the six strands" across onboarding and the mastery dashboard.
export const STRAND_ORDER = ['algebra', 'geometry', 'algebra2', 'precalc', 'calculus', 'stats'] as const
export const STRAND_LABELS: Record<string, string> = {
  algebra: 'Algebra 1',
  geometry: 'Geometry',
  algebra2: 'Algebra 2',
  precalc: 'Trig & Precalculus',
  calculus: 'Calculus',
  stats: 'Probability & Statistics',
}

export function strandOf(conceptKey: string): string {
  return conceptKey.split('.')[0]
}

// The uniform self-efficacy scale. Ordering is monotonic in the prior each
// answer seeds (see seed.ts for the computed 0.30 / 0.30 / 0.15 / 0.00 values
// -- all in the 'weak' band, never 'mastered'). Only the TOP option is a
// "confident-correct" (correct + high) -- the one that triggers prerequisite
// propagation in seed.ts.
export const ONBOARDING_CHOICE_OPTIONS: readonly AssessmentChoiceOption[] = [
  { label: 'I can solve these confidently', outcome: 'correct', selfConfidence: 'high' },
  { label: 'I can usually get there', outcome: 'correct', selfConfidence: 'med' },
  { label: 'I can start but get stuck', outcome: 'partial', selfConfidence: 'low' },
  { label: "I haven't learned this yet", outcome: 'incorrect', selfConfidence: 'unknown' },
]

function lowerFirst(s: string): string {
  return s.length > 0 ? s[0].toLowerCase() + s.slice(1) : s
}

function toItem(concept: Concept): AssessmentItem {
  const strand = strandOf(concept.key)
  return {
    conceptKey: concept.key,
    strand,
    strandLabel: STRAND_LABELS[strand] ?? concept.strandLabel,
    title: concept.title,
    prompt: `How comfortable are you with ${lowerFirst(concept.title)}?`,
    kind: 'choice',
    options: ONBOARDING_CHOICE_OPTIONS,
  }
}

// Deterministic within-strand order: difficultyPrior ascending, then the
// concept's position in CONCEPT_KEYS as a stable tiebreak (so ties never depend
// on Array.sort stability or object identity -- the test can pin the output).
function byDifficultyThenKeyOrder(a: Concept, b: Concept): number {
  if (a.difficultyPrior !== b.difficultyPrior) return a.difficultyPrior - b.difficultyPrior
  return CONCEPT_KEYS.indexOf(a.key) - CONCEPT_KEYS.indexOf(b.key)
}

// Picks the assessment: one EASY ANCHOR per strand (guarantees all six strands
// are represented) plus a few REACHES -- the hardest concept in a strand that
// has prerequisites, so a confident-correct on it propagates a prior down its
// prerequisite chain (ADR-042). Deterministic and pure.
export function selectAssessmentItems(): AssessmentItem[] {
  const byStrand = new Map<string, Concept[]>()
  for (const concept of CONCEPTS) {
    const strand = strandOf(concept.key)
    if (!STRAND_LABELS[strand]) continue // skip any key outside the six known strands
    const list = byStrand.get(strand) ?? []
    list.push(concept)
    byStrand.set(strand, list)
  }

  const anchors: Concept[] = []
  const reaches: Concept[] = []

  for (const strand of STRAND_ORDER) {
    const group = (byStrand.get(strand) ?? []).slice().sort(byDifficultyThenKeyOrder)
    if (group.length === 0) continue
    const anchor = group[0] // the easiest concept in the strand
    anchors.push(anchor)
    // The hardest concept in the strand that has prerequisites (something for a
    // confident-correct to propagate to) and isn't the anchor itself.
    const reach = [...group].reverse().find((c) => c.prerequisites.length > 0 && c.key !== anchor.key)
    if (reach) reaches.push(reach)
  }

  const reachCount = Math.max(0, Math.min(reaches.length, TARGET_ASSESSMENT_ITEMS - anchors.length))
  return [...anchors, ...reaches.slice(0, reachCount)].map(toItem)
}
