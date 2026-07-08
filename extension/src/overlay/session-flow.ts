import type { RecapConcept, SessionRecap } from '../types/messages';

// The check-in -> plan -> recap flow's pure logic (design handoff states
// 05/06/07, Sprint 15). Everything here is display copy + deterministic
// derivation with no React/chrome.* dependency, in its own module (the
// voice-timing.ts precedent) so session-flow.test.ts can pin it directly.
//
// The check-in's two answers ({ topic, stickingPoint }, the design's own
// state shape) feed BOTH the pre-session plan (buildSessionPlan) and the
// tutor prompt -- the latter via buildSessionStartMessage, a REAL student
// turn through the normal pipeline (the session-kickoff discipline: never
// a side channel), so the model hears the student's own framing and the
// existing assessment machinery grades everything that follows.

// The 5b sticking-point chips (design copy, fixed): four ways a math topic
// usually goes wrong, plus the honest opt-out. The opt-out is a sentinel
// the builders below branch on -- "not sure" must never be echoed back as
// if it were a named weakness.
export const NOT_SURE_CHIP = 'Honestly, not sure';
export const STICKING_CHIPS = [
  'Setting up the equation',
  'Choosing a method',
  'The algebra steps',
  NOT_SURE_CHIP,
] as const;

// The 5a fallback chips (design copy, fixed) shown under the page-detected
// suggestion card. Any chip advances to 5b exactly like the card does --
// "two taps, not a form".
export const TOPIC_FALLBACK_CHIPS = ['Homework set', 'Exam prep', 'Something else'] as const;

// Chip labels -> how the start message says them mid-sentence. Detected
// topics (curriculum titles) fall through to `casual` below instead.
const TOPIC_CHIP_PHRASES: Record<string, string> = {
  'Homework set': 'my homework set',
  'Exam prep': 'exam prep',
  'Something else': "something else -- I'll explain as we go",
};

// Lowercases a leading capital for mid-sentence use ("Quadratic equations"
// -> "quadratic equations") -- but only when the second character is
// lowercase, so an acronym-led title ("SOH-CAH-TOA review") survives intact.
function casual(text: string): string {
  return /^[A-Z][a-z]/.test(text) ? text[0].toLowerCase() + text.slice(1) : text;
}

/**
 * The student turn the plan's Start button sends -- the check-in answers in
 * the student's own voice, so the tutor prompt (which sees the transcript)
 * gets both without any new wire field. The not-sure branch asks the tutor
 * to find the weak spot rather than claiming one.
 */
export function buildSessionStartMessage(topic: string, stickingPoint: string): string {
  const topicPhrase = TOPIC_CHIP_PHRASES[topic] ?? casual(topic);
  if (stickingPoint === NOT_SURE_CHIP) {
    return `I'm working on ${topicPhrase} today. Honestly, I'm not sure where it usually goes wrong — can you help me find the weak spot as we work through it?`;
  }
  return `I'm working on ${topicPhrase} today, and the part that usually trips me up is ${casual(stickingPoint)}. Can we start there?`;
}

// ---- The pre-session plan (6a) ----

export type PlanStep = { title: string; meta: string; minutes: number };

export type SessionPlan = {
  // The lead line echoes the student's own words; `emphasis` is the bold
  // sticking-point segment (design: "with extra care on **choosing a
  // method** — your words, not mine"). A not-sure answer gets a plain
  // single-segment lead instead -- no invented emphasis.
  lead: { before: string; emphasis?: string; after?: string };
  steps: PlanStep[];
  totalMinutes: number;
};

// Reshuffle cycles these deterministically (no Math.random -- the same
// variant index always yields the same plan, so the spec can pin each one).
export const PLAN_VARIANT_COUNT = 3;

/**
 * Builds the 3-step plan client-side from the two check-in answers (the
 * agreed no-backend approach): warm up / the sticking point / prove it,
 * with two reshuffle variants that reorder the emphasis. Durations are
 * fixed per step and summed into the Start button's "~N min".
 */
export function buildSessionPlan(topic: string, stickingPoint: string, variant: number): SessionPlan {
  const notSure = stickingPoint === NOT_SURE_CHIP;
  const sticking = notSure ? '' : casual(stickingPoint);

  const lead = notSure
    ? { before: `${topic} today — we'll find where it goes wrong together, one step at a time.` }
    : { before: `${topic}, with extra care on `, emphasis: sticking, after: ' — your words, not mine.' };

  const stickingStep = (minutes: number, meta: string): PlanStep =>
    notSure
      ? { title: 'Find the sticking point — watch where it wobbles', meta: `A few quick probes, ~${minutes} min`, minutes }
      : { title: `The sticking point — ${sticking}`, meta: `${meta}, ~${minutes} min`, minutes };

  const proveIt: PlanStep = { title: 'Prove it — one on your own', meta: 'I only watch, ~3 min', minutes: 3 };

  const variants: PlanStep[][] = [
    [
      { title: 'Warm up — one you can already do', meta: `${topic}, ~3 min`, minutes: 3 },
      stickingStep(6, 'Slow and careful'),
      proveIt,
    ],
    [
      notSure
        ? { title: 'Straight in — find where it wobbles', meta: 'A few quick probes, ~6 min', minutes: 6 }
        : { title: `Straight to it — ${sticking} first`, meta: 'The hard part while fresh, ~6 min', minutes: 6 },
      { title: 'Steady it — a similar one together', meta: `${topic}, ~4 min`, minutes: 4 },
      proveIt,
    ],
    [
      { title: 'Warm up — a quick confidence rep', meta: `${topic}, ~2 min`, minutes: 2 },
      stickingStep(7, 'Two in a row'),
      { title: 'Stretch — one notch harder', meta: 'Only if you want it, ~3 min', minutes: 3 },
    ],
  ];

  const steps = variants[((variant % PLAN_VARIANT_COUNT) + PLAN_VARIANT_COUNT) % PLAN_VARIANT_COUNT];
  return { lead, steps, totalMinutes: steps.reduce((sum, step) => sum + step.minutes, 0) };
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
