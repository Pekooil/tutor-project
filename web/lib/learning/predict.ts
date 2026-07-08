import 'server-only'
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

/**
 * Up to `limit` of the student's OWN recorded misconceptions for ONE
 * concept -- the check-in's 5b sticking-point chips (design handoff
 * feature): "Where does it usually go wrong?" is answered with the
 * student's real recorded history for the topic they just confirmed, not a
 * fixed generic guess. Grounded, not generated -- straight filter over
 * `profile.activeMisconceptions`, no model involvement, same discipline as
 * predictLikelyStruggle above. Already in the caller's desired rank order
 * (most frequent / most recent first) because loadProfile's own query
 * orders the whole array that way (profile-read.ts) -- this function only
 * narrows it to one concept and caps the count; it does no sorting of its
 * own. [] when the profile carries nothing for this concept (cold start on
 * this topic, or every past misconception here has been resolved) -- the
 * check-in then fills its chips from the fixed generic set
 * (session-flow.ts's buildStickingChips).
 */
export function pickStickingCandidates(
  profile: LearningProfile,
  conceptKey: string,
  limit = 3
): ActiveMisconception[] {
  return profile.activeMisconceptions.filter((item) => item.conceptKey === conceptKey).slice(0, limit)
}
