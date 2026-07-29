// Stuck detection — the design's "raise hand" (README §7). What matters here
// is restraint: every rule below exists to keep Calyxa from interrupting a
// student who is simply thinking.
import { describe, expect, it } from 'vitest';
import {
  EMPTY_STUCK_MEMORY,
  STUCK_CEILING_MS,
  STUCK_DEFAULT_MS,
  STUCK_FLOOR_MS,
  STUCK_PACE_MULTIPLIER,
  personalPaceMs,
  recordStuckDeclined,
  recordStuckOffered,
  shouldRaiseHand,
  stuckOfferLine,
  stuckThresholdMs,
} from '../src/overlay/homework/stuck';
import { createSession, recordTap } from '../src/overlay/homework/session';
import type { CompletedProblem, HomeworkHistoryEntry } from '../src/overlay/homework/types';

const T0 = 1_800_000_000_000;

function completed(seconds: number[], outcome: CompletedProblem['outcome'] = 'ok'): CompletedProblem[] {
  return seconds.map((value, index) => ({
    index,
    label: String(index + 1),
    outcome,
    seconds: value,
  }));
}

function history(minutesPerProblem: number, count = 3): HomeworkHistoryEntry[] {
  return Array.from({ length: count }, (_, index) => ({
    concept: 'Factoring quadratics',
    denominator: 8,
    totalSeconds: minutesPerProblem * 60 * 8,
    endedAt: T0 - index * 86_400_000,
    longestUnaidedRun: 3,
  }));
}

function session(denominator = 8) {
  return createSession({
    locationKey: 'https://example.com/hw',
    pageTitle: null,
    concept: 'Factoring quadratics',
    problems: Array.from({ length: denominator }, (_, index) => ({
      label: String(index + 1),
      snippet: `problem ${index + 1}`,
      sourceIndex: index,
    })),
    graded: false,
    now: T0,
  });
}

describe('personalPaceMs — N is personal, not a constant', () => {
  it('prefers this session’s own median over history', () => {
    const pace = personalPaceMs(completed([120, 120, 120]), history(9));
    expect(pace).toBe(120_000);
  });

  it('excludes tutored problems from the session median', () => {
    // A problem that took 11 minutes BECAUSE Calyxa was walking them through
    // it says nothing about how long they work alone.
    const rows = [...completed([60, 60]), ...completed([660], 'tutored').map((r) => ({ ...r, index: 2 }))];
    expect(personalPaceMs(rows, [])).toBe(60_000);
  });

  it('falls back to history when the session has nothing yet', () => {
    expect(personalPaceMs([], history(4))).toBe(4 * 60_000);
  });

  it('is null with no pace data anywhere', () => {
    expect(personalPaceMs([], [])).toBeNull();
  });
});

describe('stuckThresholdMs — clamped at both ends', () => {
  it('scales with the student’s own pace', () => {
    const pace = 4 * 60_000;
    expect(stuckThresholdMs(completed([240, 240, 240]), [], EMPTY_STUCK_MEMORY)).toBe(
      pace * STUCK_PACE_MULTIPLIER,
    );
  });

  it('never nags a fast student below the floor', () => {
    // 30s per problem × 2.5 = 75s, which would be nagging.
    expect(stuckThresholdMs(completed([30, 30, 30]), [], EMPTY_STUCK_MEMORY)).toBe(STUCK_FLOOR_MS);
  });

  it('never waits past the ceiling for a slow one', () => {
    expect(stuckThresholdMs(completed([1800, 1800]), [], EMPTY_STUCK_MEMORY)).toBe(STUCK_CEILING_MS);
  });

  it('uses the honest middle when there is no pace data at all', () => {
    expect(stuckThresholdMs([], [], EMPTY_STUCK_MEMORY)).toBe(STUCK_DEFAULT_MS);
  });

  it('widens to the ceiling for the rest of the set after a decline', () => {
    const declined = recordStuckDeclined(EMPTY_STUCK_MEMORY, 0);
    expect(stuckThresholdMs(completed([60, 60, 60]), [], declined)).toBe(STUCK_CEILING_MS);
  });
});

describe('shouldRaiseHand — every false is a student left alone to think', () => {
  const base = {
    history: history(4),
    memory: EMPTY_STUCK_MEMORY,
    tutoringOpen: false,
  };

  it('fires once the current problem passes the personal threshold', () => {
    expect(
      shouldRaiseHand({ ...base, session: session(), problemElapsedMs: 11 * 60_000 }),
    ).toBe(true);
  });

  it('stays quiet before the threshold', () => {
    expect(shouldRaiseHand({ ...base, session: session(), problemElapsedMs: 60_000 })).toBe(false);
  });

  it('never interrupts a tutoring detour', () => {
    expect(
      shouldRaiseHand({ ...base, session: session(), problemElapsedMs: 30 * 60_000, tutoringOpen: true }),
    ).toBe(false);
  });

  it('never re-offers on a problem the student declined', () => {
    const memory = recordStuckDeclined(EMPTY_STUCK_MEMORY, 0);
    expect(
      shouldRaiseHand({ ...base, memory, session: session(), problemElapsedMs: 30 * 60_000 }),
    ).toBe(false);
  });

  it('does not double-fire while the offer is already up', () => {
    const memory = recordStuckOffered(EMPTY_STUCK_MEMORY, 0);
    expect(
      shouldRaiseHand({ ...base, memory, session: session(), problemElapsedMs: 30 * 60_000 }),
    ).toBe(false);
  });

  it('treats a paused clock as absence, not silence', () => {
    const paused = { ...session(), runningSince: null, pausedAt: T0 };
    expect(shouldRaiseHand({ ...base, session: paused, problemElapsedMs: 30 * 60_000 })).toBe(false);
  });

  it('stops once the set is done', () => {
    let current = session(1);
    current = recordTap(current, { outcome: 'ok', now: T0 + 1000 }).session;
    expect(shouldRaiseHand({ ...base, session: current, problemElapsedMs: 30 * 60_000 })).toBe(false);
  });

  it('re-arms on the next problem after a decline elsewhere', () => {
    // Declined problem 0; now on problem 1 -- the net is back, just patient.
    let current = session();
    current = recordTap(current, { outcome: 'ok', now: T0 + 1000 }).session;
    const memory = recordStuckDeclined(EMPTY_STUCK_MEMORY, 0);
    expect(
      shouldRaiseHand({ ...base, memory, session: current, problemElapsedMs: STUCK_CEILING_MS + 1000 }),
    ).toBe(true);
  });
});

describe('the offer copy promises a question, not an answer', () => {
  it('names the problem when there is a label', () => {
    expect(stuckOfferLine('5')).toBe('Quiet for a while on number 5.');
    expect(stuckOfferLine(null)).toBe('Quiet for a while on this one.');
  });
});
