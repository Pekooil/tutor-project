import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { prerequisitesOf } from '@calyxa/curriculum'
import type { ReasoningQuality } from '@calyxa/learning-model'
import { seedNodeObservation } from '@/lib/learning/apply'
import { KNOWN_CONCEPT_KEYS } from '@/lib/learning/types'
import type { AssessmentResult } from './item-bank'

// Sprint 17 / Task 3 (ADR-042): turns a completed onboarding self-check into a
// seeded knowledge graph, THROUGH the existing FSRS apply path
// (`seedNodeObservation` -> `applyMasteryUpdate`), never a parallel seeder --
// so a seeded node is byte-identical in shape to one a tutoring turn writes,
// and `loadProfile` stops returning its CALIBRATING_PROFILE fallback the moment
// any node exists. Server-only; every write is RLS-scoped to the caller's own
// rows (the route passes its authenticated, request-scoped client).
//
// Why the seeded priors are MODEST by construction (ADR-042's guarantee, with
// no seeding math of our own -- the FSRS core does it): each answer is one
// FIRST observation on a fresh node (mastery 0, observation_count 0), so the
// confidence-weighted K = BASE_K * (lucky-guess scale) * 1 keeps the mastery
// bump small. Mapping the self-check monotonically (below) lands the four
// answers at ~0.30 / 0.30 / 0.15 / 0.00 mastery -- all in the 'weak' band, none
// anywhere near MASTERED_THRESHOLD (0.85). Real tutoring then overwrites these
// through the very same path.
//
// `reasoningQuality` is DERIVED here, not carried on the wire: a self-report is
// not a tutor-verified line of reasoning, but tagging a "correct" self-report
// as `reasoningQuality: 'none'` would trip the FSRS lucky-guess guard and
// DISCOUNT it BELOW a "partial" (the guard halves K), inverting the priors. So
// a claimed correct/partial is modelled as 'sound' (no discount -> monotonic
// priors) and only an "I haven't learned this" (incorrect) is 'none'. This is a
// deliberate modelling choice, documented so it is not mistaken for a bug.
function reasoningQualityFor(outcome: AssessmentResult['outcome']): ReasoningQuality {
  return outcome === 'incorrect' ? 'none' : 'sound'
}

// A "confident-correct" (ADR-042): the only answer strong enough to imply the
// concept's prerequisites too.
function isConfidentCorrect(result: AssessmentResult): boolean {
  return result.outcome === 'correct' && result.selfConfidence === 'high'
}

export async function seedFromAssessment(
  supabase: SupabaseClient,
  userId: string,
  results: readonly AssessmentResult[]
): Promise<{ seededCount: number }> {
  // Dedupe by conceptKey (first answer wins) and drop any key outside the
  // curriculum. The bank only ever emits known keys, but the route accepts
  // client input, so this guards it -- the same posture applyInteraction takes.
  const seen = new Set<string>()
  const direct: AssessmentResult[] = []
  for (const result of results) {
    if (seen.has(result.conceptKey)) continue
    if (!KNOWN_CONCEPT_KEYS.includes(result.conceptKey)) continue
    seen.add(result.conceptKey)
    direct.push(result)
  }

  const directKeys = new Set(direct.map((r) => r.conceptKey))

  // Real nodes that already exist BEFORE seeding -- never overwritten by a
  // propagated prior (seed-if-absent). On a true cold start this is empty; the
  // read makes onboarding safe to run against a non-empty profile too (it just
  // won't clobber anything the tutor already learned).
  const { data: existingRows } = await supabase
    .from('knowledge_nodes')
    .select('concept_key')
    .eq('user_id', userId)
    .is('deleted_at', null)
  const existingKeys = new Set((existingRows ?? []).map((row) => (row as { concept_key: string }).concept_key))

  let seededCount = 0

  // 1) DIRECT items -- each self-reported answer becomes one observation through
  //    the shared FSRS write. A directly-assessed concept always keeps its own
  //    answer, even an "incorrect" one; propagation never touches it.
  for (const result of direct) {
    await seedNodeObservation(supabase, userId, result.conceptKey, {
      outcome: result.outcome,
      reasoningQuality: reasoningQualityFor(result.outcome),
      selfConfidence: result.selfConfidence,
    })
    seededCount++
  }

  // 2) PREREQUISITE PROPAGATION -- a confident-correct on C implies its DIRECT
  //    prerequisites (one level, not transitive -- ADR-042). Seed each at a
  //    modest prior, but ONLY if it isn't itself directly assessed (its own
  //    answer wins) and doesn't already have a real node (seed-if-absent).
  const propagated = new Set<string>()
  for (const result of direct) {
    if (!isConfidentCorrect(result)) continue
    for (const prereq of prerequisitesOf(result.conceptKey)) {
      if (directKeys.has(prereq)) continue
      if (existingKeys.has(prereq)) continue
      if (propagated.has(prereq)) continue
      if (!KNOWN_CONCEPT_KEYS.includes(prereq)) continue
      propagated.add(prereq)
      // "You can confidently do C, so you can probably USUALLY do its
      // prerequisites" -> the same modest prior a direct correct/med answer
      // seeds (~0.30, 'weak'), never 'mastered'.
      await seedNodeObservation(supabase, userId, prereq, {
        outcome: 'correct',
        reasoningQuality: 'sound',
        selfConfidence: 'med',
      })
      seededCount++
    }
  }

  // 3) Mark onboarding complete -- the dormant users.onboarding_completed_at
  //    (unused since 0001) finally gets written. RLS's users_update_own policy
  //    already permits this self-update (auth.uid() = id). Written even when
  //    nothing seeded (an all-skipped-but-submitted run still counts as "did
  //    onboarding"); a true SKIP never calls this route at all (the client
  //    leaves the profile empty and the tutor calibrates live).
  await supabase
    .from('users')
    .update({ onboarding_completed_at: new Date().toISOString() })
    .eq('id', userId)

  return { seededCount }
}
