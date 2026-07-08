import type { RecapConcept, SessionRecap, StickingCandidate } from '../types/messages';

// The check-in -> recap flow's pure logic (design handoff states 05/06b/07,
// Sprint 15; the 6a pre-session plan was removed in a later pass -- the
// check-in confirms straight into tutoring). Everything here is display
// copy + deterministic derivation with no React/chrome.* dependency, in its
// own module (the voice-timing.ts precedent) so session-flow.test.ts can
// pin it directly.
//
// The check-in's two answers ({ topic, stickingPoint }) feed the tutor
// prompt via buildSessionStartMessage, a REAL student turn through the
// normal pipeline (the session-kickoff discipline: never a side channel),
// so the model hears the student's own framing and the existing assessment
// machinery grades everything that follows.

// The sticking-point chips. The opt-out is a sentinel the builders below
// branch on -- "not sure" must never be echoed back as if it were a named
// weakness.
export const NOT_SURE_CHIP = 'Honestly, not sure';

// The generic fallback pool (design copy, fixed): used to fill whichever of
// the top-3 slots the student's own recorded misconception history doesn't
// cover -- a cold start on this topic (or a fully resolved history) falls
// all the way back to these three, byte-identical to the design board's
// original static set.
const GENERIC_STICKING_CHIPS = ['Setting up the equation', 'Choosing a method', 'The algebra steps'] as const;

export type StickingChip = {
  // What onPickSticking receives and what ends up in `stickingPoint` state
  // -- also what buildSessionStartMessage embeds mid-sentence via casual()
  // below, so this is deliberately the lowercase-leaning raw text, not the
  // capitalized display form.
  value: string;
  // The chip button's display text -- `value`, capitalized.
  label: string;
  // 1/2/3 for the ranked slots (personalized or generic-filled alike --
  // Darcy's ask: label EVERY one of the top 3, not just the grounded
  // ones), null for the trailing not-sure chip.
  rank: 1 | 2 | 3 | null;
  // True only when this slot's value came from a REAL recorded
  // misconception -- drives the personalized-history styling/caption so
  // the UI never claims "based on your sessions" for a generic guess.
  personalized: boolean;
};

function capitalize(text: string): string {
  return text.length > 0 ? text.charAt(0).toUpperCase() + text.slice(1) : text;
}

/**
 * A recorded misconception's short display text: its own free-text
 * description when one was logged, else its humanized category -- the same
 * "prefer description, fall back to category" precedent the deleted
 * KickoffCard's humanizePredictionDetail established for the struggle
 * prediction (Sprint 15). Lowercase-leaning by convention (matches how
 * these are actually stored, e.g. "drops the negative sign when
 * distributing") -- buildStickingChips capitalizes it for display; the
 * sentence-builders' casual() below is a no-op on text that's already
 * lowercase.
 */
export function humanizeMisconceptionLabel(candidate: StickingCandidate): string {
  const description = candidate.description.trim();
  if (description) return description;
  return humanizeCategory(candidate.category);
}

/**
 * The 5b sticking-point chips, personalized (design handoff feature, on top
 * of the original static design): the top up to 3 of the student's OWN
 * recorded misconceptions for the check-in's CONFIRMED topic -- already
 * ranked most-relevant-first by the caller (predict.ts's
 * pickStickingCandidates, fed by loadProfile's occurrence/recency-ordered
 * read) -- each labeled "Top N possible misconception" so the ranking
 * itself is visible on screen, not just implied. Fewer than 3 recorded ->
 * the remaining slots fill from the fixed generic pool (skipping any
 * exact-text duplicate of a personalized one already shown, case-
 * insensitive). The 4th slot is ALWAYS the honest opt-out -- never counted
 * toward the ranked 3, never personalized, never dropped even when all 3
 * ranked slots are real. `candidates` is trusted pre-capped-at-3 by the
 * caller but sliced again here defensively.
 */
export function buildStickingChips(candidates: readonly StickingCandidate[]): StickingChip[] {
  const personalizedLabels = candidates.slice(0, 3).map(humanizeMisconceptionLabel);
  const usedLabels = new Set(personalizedLabels.map((label) => label.toLowerCase()));
  const fallback = GENERIC_STICKING_CHIPS.filter((label) => !usedLabels.has(label.toLowerCase()));

  const values = [...personalizedLabels];
  for (let index = 0; values.length < 3 && index < fallback.length; index++) {
    values.push(fallback[index]);
  }

  const chips: StickingChip[] = values.map((value, index) => ({
    value,
    label: capitalize(value),
    rank: (index + 1) as 1 | 2 | 3,
    personalized: index < personalizedLabels.length,
  }));

  chips.push({ value: NOT_SURE_CHIP, label: NOT_SURE_CHIP, rank: null, personalized: false });
  return chips;
}

// Lowercases a leading capital for mid-sentence use ("Quadratic equations"
// -> "quadratic equations") -- but only when the second character is
// lowercase, so an acronym-led title ("SOH-CAH-TOA review") survives intact.
function casual(text: string): string {
  return /^[A-Z][a-z]/.test(text) ? text[0].toLowerCase() + text.slice(1) : text;
}

/**
 * The student turn the confirm button sends -- the check-in's two answers
 * (the scanned topic + the selected sticking point) in the student's own
 * voice, so the tutor prompt (which sees the transcript) gets both without
 * any new wire field. The not-sure branch asks the tutor to find the weak
 * spot rather than claiming one.
 */
export function buildSessionStartMessage(topic: string, stickingPoint: string): string {
  const topicPhrase = casual(topic);
  if (stickingPoint === NOT_SURE_CHIP) {
    return `I'm working on ${topicPhrase} today. Honestly, I'm not sure where it usually goes wrong — can you help me find the weak spot as we work through it?`;
  }
  return `I'm working on ${topicPhrase} today, and the part that usually trips me up is ${casual(stickingPoint)}. Can we start there?`;
}

// ---- The post-session recap (6b) ----

export type OutcomeKind = 'solid' | 'mostly' | 'revisit';

/**
 * Maps a recap concept's recorded counts onto the design's three outcome
 * rows: a clean run reads "solid" (filled check), a majority-right run
 * reads "N of M right" (filled check), anything else reads "worth one more
 * pass" (empty circle). Derived from the same rows the mastery write used
 * (recap.ts builds AFTER the reconcile), so the row can never disagree with
 * the profile.
 */
export function conceptOutcome(
  concept: Pick<RecapConcept, 'title' | 'correct' | 'incorrect'>,
): { kind: OutcomeKind; line: string } {
  const total = concept.correct + concept.incorrect;
  if (concept.incorrect === 0 && concept.correct > 0) {
    return { kind: 'solid', line: `${concept.title} — solid` };
  }
  if (concept.correct > concept.incorrect) {
    return { kind: 'mostly', line: `${concept.title} — ${concept.correct} of ${total} right` };
  }
  return { kind: 'revisit', line: `${concept.title} — worth one more pass` };
}

// "sign_error.distribution" -> "sign error distribution" -- the same
// de-casing rule the server's ping copy uses (events.ts's humanizeCategory),
// for the one recap field that arrives as a raw category.
export function humanizeCategory(category: string): string {
  return category.replace(/[-_.]/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * The "Worth keeping" callout body -- process praise, never smarts praise
 * (the design's explicit ask). Grounded in what the session actually
 * recorded: a resolved misconception first (the strongest "you fixed it
 * yourself" evidence), a trend line second; null hides the callout -- most
 * sessions earn neither, by design.
 */
export function pickRecapInsight(recap: SessionRecap): string | null {
  const resolved = recap.misconceptionsResolved[0];
  if (resolved) {
    return `You worked through ${humanizeCategory(resolved.category)} and closed it out yourself. That habit is the whole game.`;
  }
  const trend = recap.trends[0];
  if (trend) {
    return `${trend.title}: ${trend.line} — that climb is yours. Keep it going.`;
  }
  return null;
}

/**
 * The recap header's muted meta ("18 min · 5 problems"). Problems = the
 * session's gradable answers (correct + incorrect across concepts) -- the
 * honest count the recap rows themselves sum to. Duration is client-timed
 * from the first committed student turn (elapsedMs); null (e.g. the recap
 * arrived from another tab's session) drops the minutes segment rather
 * than inventing one.
 */
export function formatRecapMeta(recap: SessionRecap, elapsedMs: number | null): string {
  const problems = recap.concepts.reduce((sum, concept) => sum + concept.correct + concept.incorrect, 0);
  const parts: string[] = [];
  if (elapsedMs !== null && elapsedMs >= 0) {
    parts.push(`${Math.max(1, Math.round(elapsedMs / 60000))} min`);
  }
  parts.push(`${problems} ${problems === 1 ? 'problem' : 'problems'}`);
  return parts.join(' · ');
}

/**
 * The section-complete card's subtitle ("Choosing a method · every step was
 * yours"): names the sticking point the student themselves picked, falling
 * back to the topic, then to the bare line -- never the not-sure sentinel.
 */
export function bloomLine(topic: string | null, stickingPoint: string | null): string {
  const focus = stickingPoint && stickingPoint !== NOT_SURE_CHIP ? stickingPoint : topic;
  return focus ? `${focus} · every step was yours` : 'Every step was yours';
}
