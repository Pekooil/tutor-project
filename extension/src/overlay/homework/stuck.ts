import type { CompletedProblem, HomeworkHistoryEntry, HomeworkSession } from './types';

// Stuck detection — the design handoff's "raise hand" (README §7), deferred out
// of slice 1 and built here.
//
// The rule the design states: "after N silent minutes (N personal, from pace
// data) the pill asks ONE question, not the answer; gentle and refusable."
//
// Two things that shape this file:
//
// 1. N IS PERSONAL. A constant would be wrong in both directions -- 4 minutes
//    is nothing on a proof and an eternity on mental arithmetic. N is derived
//    from the student's OWN observed pace: this session's per-problem median
//    first, their history's average second, and only a wide floor when there is
//    neither. A student who takes 9 minutes a problem should not be interrupted
//    at 5.
//
// 2. NOTHING HERE CALLS A MODEL. Spec §10 is explicit: zero model calls during
//    the working portion of a session. So the offer itself is templated and
//    local; the QUESTION comes from the tutor's first turn, after the student
//    accepts -- which is the existing tutoring flow, and the only place a model
//    call is sanctioned. That is a deliberate deviation from the prototype,
//    which renders the question inside the card: generating it up front would
//    mean billing a model call for every student who was simply thinking, which
//    is most of them.

/**
 * How much slower than their own pace a student has to be before the offer
 * fires. 2.5x is past "this one is harder" and into "this one has stopped
 * moving" -- the effort-visible reaction already fires at 2x, so the offer sits
 * deliberately beyond the point where Calyxa has merely noticed.
 */
export const STUCK_PACE_MULTIPLIER = 2.5;

/** Never interrupt sooner than this, however fast the student normally is. */
export const STUCK_FLOOR_MS = 3 * 60_000;
/** Never wait longer than this, however slow they normally are. */
export const STUCK_CEILING_MS = 12 * 60_000;
/** With no pace data at all, this is the honest middle. */
export const STUCK_DEFAULT_MS = 5 * 60_000;

/**
 * After a decline, back off hard for the REST OF THE SET rather than for a
 * while: a student who said "I'm good" once should not be asked again two
 * minutes later, and asking again on the next problem is the same
 * interruption wearing a different number. Re-armed only by a completion.
 */
export type StuckMemory = {
  /** Sequence index the offer is currently armed against, or null. */
  offeredFor: number | null;
  /** Sequence indexes the student declined on. Never re-offered. */
  declined: number[];
  /** True once a decline happened -- widens the threshold for the whole set. */
  everDeclined: boolean;
};

export const EMPTY_STUCK_MEMORY: StuckMemory = { offeredFor: null, declined: [], everDeclined: false };

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

/**
 * The student's own per-problem pace in ms, most-specific source first:
 * THIS session's completed problems (what they are actually doing tonight),
 * then their history (what they usually do), then null.
 *
 * `tutored` problems are excluded from the session median: a problem that took
 * 11 minutes *because Calyxa was walking them through it* is not evidence about
 * how long they work alone, and including it would inflate N exactly when the
 * student has already shown they need help.
 */
export function personalPaceMs(
  completed: readonly CompletedProblem[],
  history: readonly HomeworkHistoryEntry[],
): number | null {
  const unaided = completed.filter((problem) => problem.outcome !== 'tutored').map((problem) => problem.seconds);
  const sessionMedian = median(unaided);
  if (sessionMedian !== null && sessionMedian > 0) return sessionMedian * 1000;

  const historyPace = history
    .filter((entry) => entry.denominator > 0 && entry.totalSeconds > 0)
    .map((entry) => (entry.totalSeconds / entry.denominator) * 1000);
  if (historyPace.length === 0) return null;
  return historyPace.reduce((sum, value) => sum + value, 0) / historyPace.length;
}

/**
 * N, in ms. Personal where there is pace data, clamped at both ends so the
 * offer can never become either nagging or useless. A student who has already
 * declined once this set gets the ceiling — they told us to back off, and the
 * only honest way to keep a safety net without nagging is to make it very
 * patient.
 */
export function stuckThresholdMs(
  completed: readonly CompletedProblem[],
  history: readonly HomeworkHistoryEntry[],
  memory: StuckMemory,
): number {
  if (memory.everDeclined) return STUCK_CEILING_MS;
  const pace = personalPaceMs(completed, history);
  if (pace === null) return STUCK_DEFAULT_MS;
  return Math.min(STUCK_CEILING_MS, Math.max(STUCK_FLOOR_MS, pace * STUCK_PACE_MULTIPLIER));
}

/**
 * Whether to raise a hand right now. Deliberately conservative -- every `false`
 * here is a student left alone to think, which is the correct default and the
 * whole reason the threshold is personal.
 *
 * Never fires when: the set is done, a tutoring detour is already open, the
 * student declined on this problem, the offer is already up, or the clock is
 * paused (a backgrounded tab is not silence, it is absence).
 */
export function shouldRaiseHand(options: {
  session: HomeworkSession;
  history: readonly HomeworkHistoryEntry[];
  memory: StuckMemory;
  /** ms spent on the CURRENT problem, blur-pauses already excluded. */
  problemElapsedMs: number;
  tutoringOpen: boolean;
}): boolean {
  const { session, history, memory, problemElapsedMs, tutoringOpen } = options;
  if (tutoringOpen) return false;
  if (session.status !== 'active' || session.runningSince === null) return false;
  const index = session.completed.length;
  if (index >= session.denominator) return false;
  if (memory.offeredFor === index) return false;
  if (memory.declined.includes(index)) return false;
  return problemElapsedMs >= stuckThresholdMs(session.completed, history, memory);
}

/**
 * The offer's copy. Templated, never generated -- and it deliberately does NOT
 * contain the question. The design's card reads "One question: <question>";
 * producing that before the student has said yes would mean a model call for
 * every student who was just thinking. Instead the offer promises exactly one
 * question and the tutor's first turn delivers it, which is the same contract
 * from the student's side and costs nothing when they decline.
 */
export function stuckOfferLine(label: string | null): string {
  return label ? `Quiet for a while on number ${label}.` : 'Quiet for a while on this one.';
}

export const STUCK_OFFER_SUB = 'Want one question to get it moving? Not the answer — one question.';

export function recordStuckOffered(memory: StuckMemory, index: number): StuckMemory {
  return { ...memory, offeredFor: index };
}

export function recordStuckDeclined(memory: StuckMemory, index: number): StuckMemory {
  return {
    offeredFor: null,
    declined: memory.declined.includes(index) ? memory.declined : [...memory.declined, index],
    everDeclined: true,
  };
}

/** A completion clears the armed offer -- the next problem starts fresh. */
export function clearStuckOffer(memory: StuckMemory): StuckMemory {
  return { ...memory, offeredFor: null };
}
