import { longestUnaidedRun, sessionElapsedMs } from './session';
import type { HomeworkHistoryEntry, HomeworkSession } from './types';

// The auto-firing summary (spec §8). Honest scope is a HARD requirement: for
// problems the student did alone on a `graded: false` page, Calyxa does not
// know whether they were right, and the summary must never imply it graded the
// whole set.

export type HomeworkSummary = {
  totalMinutes: number;
  completedCount: number;
  denominator: number;
  longestRun: number;
  counts: { ok: number; shaky: number; tutored: number };
  /** Null unless a comparable prior set on this topic exists. */
  comparisonLine: string | null;
  /** Always present: what Calyxa can and cannot vouch for. */
  scopeLine: string;
  /** Spec §6.4: shown once, gently, framed as an opportunity. Null when none. */
  mismatchLine: string | null;
};

function pluralize(count: number, unit: string): string {
  return `${count} ${unit}${count === 1 ? '' : 's'}`;
}

/**
 * The self-comparison (spec §8: "with self-comparison only if history
 * exists"). Always against the student's OWN history, never other students,
 * and only against a set of comparable size -- "38 minutes vs 50" is
 * meaningless if the other set was twice as long.
 */
export function comparisonLine(
  session: HomeworkSession,
  history: readonly HomeworkHistoryEntry[],
  totalMinutes: number,
): string | null {
  const key = (session.concept ?? '').trim().toLowerCase();
  if (!key) return null;
  const prior = history
    .filter((entry) => (entry.concept ?? '').trim().toLowerCase() === key)
    .filter((entry) => entry.denominator === session.denominator)
    .sort((a, b) => b.endedAt - a.endedAt)[0];
  if (!prior) return null;

  const priorMinutes = Math.max(1, Math.round(prior.totalSeconds / 60));
  const delta = priorMinutes - totalMinutes;
  const spent = pluralize(totalMinutes, 'minute');
  if (delta === 0) return `${spent} — same as last time.`;
  return delta > 0
    ? `${spent} — ${delta} faster than last time.`
    : `${spent}. Last time's set took you ${priorMinutes}.`;
}

/** "38 minutes." / "1 minute." -- the no-history fallback headline. */
export function plainTimeLine(totalMinutes: number): string {
  return `${pluralize(totalMinutes, 'minute')}.`;
}

/**
 * The honest-scope line. Varies on `graded` and on how many problems were
 * worked together, because those are exactly the two things that decide what
 * Calyxa actually knows.
 */
export function scopeLine(session: HomeworkSession): string {
  const tutored = session.completed.filter((problem) => problem.outcome === 'tutored').length;
  const solo = session.completed.length - tutored;

  if (session.graded) {
    return tutored > 0
      ? `${solo} solo · ${pluralize(tutored, 'problem')} worked together — the page checked the rest.`
      : `All ${solo} solo, page-checked.`;
  }
  return tutored > 0
    ? `No answer key here — only the ${tutored} worked together ${tutored === 1 ? 'is' : 'are'} verified. The rest you marked done yourself.`
    : 'No answer key here — completion and confidence only. The rest you marked done yourself.';
}

/**
 * The self-report vs. page-grade conflict (spec §6), surfaced ONCE, here,
 * gently -- never mid-set, never as a caught lie. The inverse case (marked
 * shaky, page says correct) is recorded but deliberately says nothing.
 */
export function mismatchLine(session: HomeworkSession): string | null {
  const mismatches = session.completed.filter(
    (problem) => problem.outcome === 'ok' && problem.pageGrade === 'incorrect',
  );
  if (mismatches.length === 0) return null;

  const labels = mismatches.map((problem) => problem.label);
  const which = labels.length <= 3 ? ` (${labels.join(', ')})` : '';
  return mismatches.length === 1
    ? `One you marked "got it"${which} came back wrong on the page. Worth one more look.`
    : `${mismatches.length} you marked "got it"${which} came back wrong on the page. Worth one more look.`;
}

/**
 * Builds the whole summary. `session` must be COMPLETE -- a partial session
 * gets no celebration summary (spec §8); it is archived quietly instead, and
 * the caller is responsible for not calling this on one.
 */
export function buildSummary(
  session: HomeworkSession,
  history: readonly HomeworkHistoryEntry[],
  now: number,
): HomeworkSummary {
  const totalMinutes = Math.max(1, Math.round(sessionElapsedMs(session, now) / 60_000));
  const counts = {
    ok: session.completed.filter((problem) => problem.outcome === 'ok').length,
    shaky: session.completed.filter((problem) => problem.outcome === 'shaky').length,
    tutored: session.completed.filter((problem) => problem.outcome === 'tutored').length,
  };

  return {
    totalMinutes,
    completedCount: session.completed.length,
    denominator: session.denominator,
    longestRun: longestUnaidedRun(session.completed),
    counts,
    comparisonLine: comparisonLine(session, history, totalMinutes),
    scopeLine: scopeLine(session),
    mismatchLine: mismatchLine(session),
  };
}

/** What a completed set contributes to the local pace history. */
export function toHistoryEntry(session: HomeworkSession, now: number): HomeworkHistoryEntry {
  return {
    concept: session.concept,
    denominator: session.denominator,
    totalSeconds: Math.max(1, Math.round(sessionElapsedMs(session, now) / 1000)),
    endedAt: session.endedAt ?? now,
    longestUnaidedRun: longestUnaidedRun(session.completed),
  };
}
