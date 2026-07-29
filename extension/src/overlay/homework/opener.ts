import type { HomeworkHistoryEntry } from './types';

// The first-session opener (spec §2) -- the highest-priority screen in slice
// 1, and the one most likely to be got wrong.
//
// The design handoff draws the data-rich opener ("Last Tuesday's factoring set
// took you 50 minutes"). Every one of those lines requires history the student
// does not have on their first session -- which is precisely the session that
// has to land. So the three variants are built EXPLICITLY here rather than
// left to degrade into empty strings or em-dashes.

/** Spec §2: never shown before 3 completed sessions of pace data. */
export const MIN_SESSIONS_FOR_ESTIMATE = 3;
/** Spec §2: the range's half-width is never tighter than this fraction. */
export const MIN_ESTIMATE_SPREAD = 0.15;

export type OpenerLines = {
  /** Always present. "Factoring quadratics. 8 problems." / "8 problems." */
  headline: string;
  /** Variant C only -- requires a confident problem-to-concept mapping. */
  misconceptionLine: string | null;
  /** Variant C only -- a prior session on this same topic. */
  comparisonLine: string | null;
  /** Variants B and C -- requires MIN_SESSIONS_FOR_ESTIMATE of pace data. */
  estimateLine: string | null;
  /** Variant A only: forward-framed, never an apology for having no data. */
  forwardLine: string | null;
  variant: 'A' | 'B' | 'C';
};

function plural(count: number, unit: string): string {
  return `${count} ${unit}${count === 1 ? '' : 's'}`;
}

/**
 * Minutes per problem across the student's history, used to project this set.
 * Sessions with a zero denominator (impossible in practice, cheap to guard)
 * are skipped rather than dividing by zero.
 */
function paceSamples(history: readonly HomeworkHistoryEntry[]): number[] {
  return history
    .filter((entry) => entry.denominator > 0 && entry.totalSeconds > 0)
    .map((entry) => entry.totalSeconds / 60 / entry.denominator);
}

function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/**
 * The student's average minutes per problem across their history, unrounded --
 * what the pill's remaining-time ring falls back to until THIS session has an
 * observed pace of its own. null before there is enough history, and the ring
 * is then simply absent rather than showing a number Calyxa invented.
 *
 * Deliberately separate from estimateRange: that one rounds to 5-minute
 * boundaries for a whole set, which is far too coarse to divide back down to a
 * single problem.
 */
export function meanMinutesPerProblem(history: readonly HomeworkHistoryEntry[]): number | null {
  const samples = paceSamples(history);
  if (samples.length < MIN_SESSIONS_FOR_ESTIMATE) return null;
  const value = mean(samples);
  return Number.isFinite(value) && value > 0 ? value : null;
}

/**
 * The time estimate (spec §2): always a RANGE, never a point value, with its
 * width reflecting the variance in the student's own history and a floor of
 * ±15%. Returns null before MIN_SESSIONS_FOR_ESTIMATE sessions of pace data --
 * a first-timer gets no estimate at all, not a made-up one.
 */
export function estimateRange(
  history: readonly HomeworkHistoryEntry[],
  denominator: number,
): { lowMinutes: number; highMinutes: number } | null {
  const samples = paceSamples(history);
  if (samples.length < MIN_SESSIONS_FOR_ESTIMATE) return null;

  const perProblem = mean(samples);
  const centre = perProblem * denominator;
  if (!Number.isFinite(centre) || centre <= 0) return null;

  // Spread = the student's own coefficient of variation, floored at 15%.
  const deviation = Math.sqrt(mean(samples.map((value) => (value - perProblem) ** 2)));
  const spread = Math.max(MIN_ESTIMATE_SPREAD, perProblem > 0 ? deviation / perProblem : 0);

  const low = Math.max(1, Math.round(centre * (1 - spread) / 5) * 5);
  const high = Math.max(low + 5, Math.round(centre * (1 + spread) / 5) * 5);
  return { lowMinutes: low, highMinutes: high };
}

/** The most recent completed set on this same concept, or null. */
export function priorSessionOnTopic(
  history: readonly HomeworkHistoryEntry[],
  concept: string | null,
): HomeworkHistoryEntry | null {
  if (!concept) return null;
  const key = concept.trim().toLowerCase();
  const matches = history
    .filter((entry) => (entry.concept ?? '').trim().toLowerCase() === key)
    .sort((a, b) => b.endedAt - a.endedAt);
  return matches[0] ?? null;
}

/** "Last Tuesday" / "yesterday" / "on Mar 3" -- how the comparison line reads. */
function whenPhrase(endedAt: number, now: number): string {
  const date = new Date(endedAt);
  const days = Math.round((startOfDay(now) - startOfDay(endedAt)) / 86_400_000);
  if (days <= 0) return "Earlier today's";
  if (days === 1) return "Yesterday's";
  if (days < 7) return `Last ${date.toLocaleDateString(undefined, { weekday: 'long' })}'s`;
  return `Your ${date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
}

function startOfDay(value: number): number {
  const date = new Date(value);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/**
 * Builds the opener. Which variant you get is decided ENTIRELY by what data
 * actually exists:
 *
 *   A -- first session ever, or no pace history yet. No estimate, no
 *        comparison, and the forward line frames the absence as something that
 *        starts working now rather than as an apology.
 *   B -- pace history, but nothing on this topic. Estimate only.
 *   C -- a prior session on this topic. The design's drawn state.
 *
 * `concept` is null whenever the read was absent or low-confidence, and the
 * headline is then just the count -- "8 problems." alone is a valid opener,
 * "Reading the page" shimmering for eight seconds is not.
 *
 * `misconception` is passed only when there is BOTH mastery data for the
 * concept AND a confident problem-to-concept mapping; otherwise it is omitted
 * entirely. Never a placeholder.
 */
export function buildOpener(options: {
  concept: string | null;
  count: number;
  history: readonly HomeworkHistoryEntry[];
  misconception?: { label: string; phrase: string } | null;
  now?: number;
}): OpenerLines {
  const { concept, count, history, misconception } = options;
  const now = options.now ?? Date.now();

  const headline = concept ? `${concept}. ${plural(count, 'problem')}.` : `${plural(count, 'problem')}.`;

  const prior = priorSessionOnTopic(history, concept);
  const estimate = estimateRange(history, count);

  if (!estimate) {
    return {
      headline,
      misconceptionLine: null,
      comparisonLine: null,
      estimateLine: null,
      forwardLine: "I'll track your pace tonight so I can tell you what to expect next time.",
      variant: 'A',
    };
  }

  const estimateLine = `At your usual pace, roughly ${estimate.lowMinutes}–${estimate.highMinutes} minutes.`;

  if (!prior) {
    return {
      headline,
      misconceptionLine: null,
      comparisonLine: null,
      estimateLine,
      forwardLine: null,
      variant: 'B',
    };
  }

  const priorMinutes = Math.max(1, Math.round(prior.totalSeconds / 60));
  return {
    headline,
    misconceptionLine: misconception
      ? `Number ${misconception.label} is the type that usually slows you down.`
      : null,
    comparisonLine: `${whenPhrase(prior.endedAt, now)} ${concept ? `${concept.toLowerCase()} ` : ''}set took you ${priorMinutes} minutes.`,
    estimateLine,
    forwardLine: null,
    variant: 'C',
  };
}

/**
 * The denominator question (spec §3). On an absurd count the count is put as a
 * QUESTION rather than a statement and the adjust path leads -- a >40 read is
 * almost certainly a mis-parse, and stating it as fact would be the first
 * thing the student sees Calyxa get wrong.
 */
export function denominatorPrompt(count: number, confidence: 'high' | 'low'): {
  text: string;
  leadWithAdjust: boolean;
} {
  if (confidence === 'low') {
    return { text: `I counted ${count} on the page — does that look right?`, leadWithAdjust: true };
  }
  return { text: `I see ${count} on the page — doing all of them?`, leadWithAdjust: false };
}
