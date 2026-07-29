import { pickReaction } from './reactions';
import {
  EMPTY_REACTION_MEMORY,
  type CompletedProblem,
  type HomeworkSession,
  type Outcome,
  type PageGrade,
  type Reaction,
  type SetProblem,
} from './types';

// The homework session's state machine (spec §4 + §7). Pure: every function
// here takes a session and returns a NEW one. The overlay renders it, the
// store persists it, and neither owns the rules.

/** Spec §4: a dinner break must not render as "47 minutes on that one". */
export const BLUR_PAUSE_AFTER_MS = 2 * 60_000;
/** Spec §4: the undo window on the reaction chip. */
export const UNDO_WINDOW_MS = 5_000;
/** Spec §7: a paused session older than this is archived, not resumed. */
export const SESSION_EXPIRY_MS = 18 * 60 * 60_000;

function newId(): string {
  // crypto.randomUUID is available in every context this runs in (content
  // script, jsdom ≥ 22); the fallback keeps a bare test environment honest.
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `hw-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function createSession(options: {
  locationKey: string;
  pageTitle: string | null;
  concept: string | null;
  problems: SetProblem[];
  graded: boolean;
  now?: number;
}): HomeworkSession {
  const now = options.now ?? Date.now();
  return {
    id: newId(),
    locationKey: options.locationKey,
    pageTitle: options.pageTitle,
    concept: options.concept,
    // Frozen here and never mutated (spec §3): a denominator that changes
    // mid-set makes the progress bar untrustworthy, and the bar's
    // trustworthiness is the whole mechanic.
    denominator: options.problems.length,
    problems: options.problems,
    graded: options.graded,
    startedAt: now,
    endedAt: null,
    status: 'active',
    completed: [],
    reactions: { ...EMPTY_REACTION_MEMORY, variantCursor: {} },
    accumulatedMs: 0,
    runningSince: now,
    problemStartedAt: now,
    pausedAt: null,
  };
}

export function sessionElapsedMs(session: HomeworkSession, now: number): number {
  return session.accumulatedMs + (session.runningSince !== null ? now - session.runningSince : 0);
}

export function problemElapsedMs(session: HomeworkSession, now: number): number {
  const reference = session.runningSince !== null ? now : (session.pausedAt ?? now);
  return Math.max(0, reference - session.problemStartedAt);
}

/** Banks the running segment and stops both clocks. Idempotent. */
export function pauseSession(session: HomeworkSession, now: number): HomeworkSession {
  if (session.runningSince === null) return session;
  return {
    ...session,
    accumulatedMs: sessionElapsedMs(session, now),
    runningSince: null,
    pausedAt: now,
    status: session.status === 'complete' ? 'complete' : 'paused',
  };
}

/**
 * Restarts both clocks, shifting the CURRENT problem's start by the length of
 * the break so the paused time never lands on that problem's elapsed total.
 */
export function resumeSession(session: HomeworkSession, now: number): HomeworkSession {
  if (session.runningSince !== null) return session;
  const gap = session.pausedAt !== null ? Math.max(0, now - session.pausedAt) : 0;
  return {
    ...session,
    runningSince: now,
    pausedAt: null,
    problemStartedAt: session.problemStartedAt + gap,
    status: 'active',
  };
}

/** Spec §7: a set the student abandoned must not fire a celebration summary. */
export function isExpired(session: HomeworkSession, now: number): boolean {
  const reference = session.pausedAt ?? session.endedAt ?? session.startedAt;
  return session.status !== 'complete' && now - reference > SESSION_EXPIRY_MS;
}

export function isComplete(session: HomeworkSession): boolean {
  return session.completed.length >= session.denominator;
}

/** The label of the problem the next tap will record against, or null. */
export function currentLabel(session: HomeworkSession): string | null {
  return session.problems[session.completed.length]?.label ?? null;
}

/** The problem the next tap will record against -- what "Stuck" hands to the tutor. */
export function currentProblem(session: HomeworkSession): SetProblem | null {
  return session.problems[session.completed.length] ?? null;
}

/**
 * Longest run of problems completed with NO help inside this one set. This is
 * the design's "streak" -- it is not a Duolingo day-streak and must never
 * become one.
 */
export function longestUnaidedRun(completed: readonly CompletedProblem[]): number {
  let best = 0;
  let run = 0;
  for (const problem of completed) {
    if (problem.outcome === 'tutored') {
      run = 0;
      continue;
    }
    run += 1;
    if (run > best) best = run;
  }
  return best;
}

/**
 * Records one completion. Spec §4: taps advance SEQUENTIALLY through the
 * confirmed denominator -- if the student works out of order that's fine, the
 * outcome is recorded against the sequence position rather than a guess at
 * which problem they were looking at.
 *
 * The bar never moves backward within a session: this only ever appends.
 */
export function recordTap(
  session: HomeworkSession,
  options: { outcome: Outcome; now: number; pageGrade?: PageGrade | null },
): { session: HomeworkSession; reaction: Reaction } {
  const index = session.completed.length;
  const problem = session.problems[index];
  const seconds = Math.max(0, Math.round(problemElapsedMs(session, options.now) / 1000));

  const entry: CompletedProblem = {
    index,
    label: problem?.label ?? String(index + 1),
    outcome: options.outcome,
    seconds,
    ...(options.pageGrade ? { pageGrade: options.pageGrade } : {}),
  };
  const completed = [...session.completed, entry];

  const { reaction, memory } = pickReaction({
    outcome: options.outcome,
    seconds,
    completed,
    denominator: session.denominator,
    memory: session.reactions,
    nextLabel: session.problems[completed.length]?.label ?? null,
    now: options.now,
  });

  const finished = completed.length >= session.denominator;
  return {
    session: {
      ...session,
      completed,
      reactions: memory,
      // The next problem's clock starts the moment this tap lands (spec §4).
      problemStartedAt: options.now,
      status: finished ? 'complete' : session.status,
      endedAt: finished ? options.now : null,
      accumulatedMs: finished ? sessionElapsedMs(session, options.now) : session.accumulatedMs,
      runningSince: finished ? null : session.runningSince,
    },
    reaction,
  };
}

/**
 * The undo (spec §4): a mis-tap is inevitable and the bar can't move backward,
 * so the reaction chip carries a short undo window. Reverts the LAST
 * completion, including the reaction memory it consumed -- an undone combo
 * must not have burned the moment budget.
 *
 * `previousMemory` is the memory as it stood BEFORE the tap; the caller holds
 * it for exactly the undo window. Without it the reaction bookkeeping would
 * silently drift, so this refuses rather than guessing.
 */
export function undoLastTap(
  session: HomeworkSession,
  options: {
    previousMemory: HomeworkSession['reactions'];
    previousProblemStartedAt: number;
    now: number;
  },
): HomeworkSession {
  if (session.completed.length === 0) return session;
  return {
    ...session,
    completed: session.completed.slice(0, -1),
    reactions: options.previousMemory,
    problemStartedAt: options.previousProblemStartedAt,
    status: 'active',
    endedAt: null,
    pausedAt: null,
    // Re-arm the clock if the completing tap had stopped it.
    runningSince: session.runningSince ?? options.now,
  };
}

/**
 * Remaining-time estimate for the pill's indicator. Uses THIS session's own
 * observed pace once there is any, falling back to the history pace, and
 * returns null when there is neither -- the indicator is simply absent rather
 * than showing a number Calyxa invented.
 *
 * Spec §2: this is an estimate that updates from live pace. It must never turn
 * amber, red, or otherwise imply the student is behind.
 */
export function remainingMinutes(
  session: HomeworkSession,
  now: number,
  fallbackMinutesPerProblem: number | null,
): number | null {
  const remaining = session.denominator - session.completed.length;
  if (remaining <= 0) return null;

  const observed = session.completed.length > 0 ? sessionElapsedMs(session, now) / 60_000 / session.completed.length : null;
  const perProblem = observed ?? fallbackMinutesPerProblem;
  if (perProblem === null || !Number.isFinite(perProblem) || perProblem <= 0) return null;
  return Math.max(1, Math.round(remaining * perProblem));
}
