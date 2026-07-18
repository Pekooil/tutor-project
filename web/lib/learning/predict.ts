import 'server-only'
import { CONCEPTS, prerequisitesOf } from '@calyxa/curriculum'
import type { ActiveMisconception, LearningProfile } from '@/lib/ai/profile'

// The opening-scan struggle prediction (session-kickoff feature): before the
// student says anything, the kickoff card names the misconception they are
// most likely still carrying into THIS page's problem. Grounded, not
// generated -- the pick comes from the profile's own active (unresolved)
// misconceptions, the same rows the prompt's STUDENT PROFILE block renders,
// never from a model call. The same grounding discipline as profile tags
// (ADR-024): the card can only claim what the recorded history supports.
//
// Selection order:
//   1. a misconception on a page-relevant concept (topicKeys, ADR-021) --
//      the strongest "you'll probably hit this HERE" signal;
//   2. a misconception on a profile-surfaced node, in the profile's own
//      node order (topic-relevant first, then weakest-first) -- relevant to
//      what the student is generally shaky on;
//   3. the first active misconception at all -- better a real recorded gap
//      than nothing.
// null when the profile carries no active misconceptions (cold start, or
// everything resolved) -- the kickoff card then shows the detected question
// alone, no invented struggle.
export function predictLikelyStruggle(
  profile: LearningProfile,
  topicKeys: readonly string[]
): ActiveMisconception | null {
  const misconceptions = profile.activeMisconceptions
  if (misconceptions.length === 0) return null

  const topicKeySet = new Set(topicKeys)
  const pageRelevant = misconceptions.find((item) => topicKeySet.has(item.conceptKey))
  if (pageRelevant) return pageRelevant

  for (const node of profile.masteryNodes) {
    const onNode = misconceptions.find((item) => item.conceptKey === node.conceptKey)
    if (onNode) return onNode
  }

  return misconceptions[0]
}

// The concepts RELATED to one concept, for the sticking-candidate widen
// (Darcy's 2026-07-17 ask — the exact-key-only filter fired too rarely):
// the concept's prerequisites (misconceptions there bite here), its
// dependents (concepts that list it as a prerequisite — shared machinery),
// and its curriculum family (same "strand.topic" prefix). Static curriculum
// data only, computed per call over the 66-concept array — no I/O.
function relatedConceptKeys(conceptKey: string): Set<string> {
  const related = new Set<string>(prerequisitesOf(conceptKey))
  const family = conceptKey.split('.').slice(0, 2).join('.')
  for (const concept of CONCEPTS) {
    if (concept.key === conceptKey) continue
    if (concept.prerequisites.includes(conceptKey)) related.add(concept.key)
    if (concept.key.startsWith(`${family}.`)) related.add(concept.key)
  }
  related.delete(conceptKey)
  return related
}

/**
 * Up to `limit` of the student's OWN recorded misconceptions for ONE
 * concept -- the check-in's 5b sticking-point chips (design handoff
 * feature): "Where does it usually go wrong?" is answered with the
 * student's real recorded history for the topic they just confirmed, not a
 * fixed generic guess. Grounded, not generated -- filter over
 * `profile.activeMisconceptions`, no model involvement, same discipline as
 * predictLikelyStruggle above.
 *
 * Two tiers (the 2026-07-17 widen -- exact-only fired too rarely in real
 * sessions): exact-concept matches first, then misconceptions recorded on
 * RELATED concepts (prerequisites, dependents, same curriculum family --
 * relatedConceptKeys above). Both tiers preserve the profile array's own
 * frequency/recency order (loadProfile orders it; this function does no
 * sorting of its own). Still the student's real history either way -- the
 * check-in's "recorded from your recent sessions" caption stays truthful.
 * [] when nothing exact OR related is recorded -- the check-in then fills
 * from the concept's common-misconception catalog (misconception-catalog.ts
 * via the route's `commonSticking`), and only past that from the fixed
 * generic set (session-flow.ts's buildStickingChips).
 */
export function pickStickingCandidates(
  profile: LearningProfile,
  conceptKey: string,
  limit = 3
): ActiveMisconception[] {
  const exact = profile.activeMisconceptions.filter((item) => item.conceptKey === conceptKey)
  if (exact.length >= limit) return exact.slice(0, limit)

  const related = relatedConceptKeys(conceptKey)
  const nearby = profile.activeMisconceptions.filter((item) => related.has(item.conceptKey))
  return [...exact, ...nearby].slice(0, limit)
}
