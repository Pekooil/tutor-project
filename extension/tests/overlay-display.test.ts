// @vitest-environment jsdom
//
// Sprint 13 Task 9: the overlay's pure display-logic spec (the Sprint 12
// annotations.test.ts precedent -- jsdom, no WXT/browser harness). Overlay.tsx
// exports these helpers specifically so they're testable in isolation from
// the React component tree (its own header comment, "exported for the Task 9
// vitest/jsdom spec"): stripHistory (tags never re-enter the outbound wire),
// capTags (the client-side ≤2 cap), filterPingsForDisplay (the ping dedupe
// gate), masteryDelta (the client-side recap delta vs the panel-open
// baseline), and humanizeDue (the forward look's due-date phrasing).
import { describe, expect, it } from 'vitest';
import {
  DELTA_EPSILON,
  MAX_PINGS_PER_TURN,
  MAX_TAGS_PER_TURN,
  capTags,
  filterPingsForDisplay,
  humanizeDue,
  masteryDelta,
  stripHistory,
  type DisplayMessage,
} from '../src/overlay/Overlay';
import type { ProfileOverview, ProfileTag, TurnPing } from '../src/types/messages';

function tag(kind: ProfileTag['kind'], label: string): ProfileTag {
  return { kind, conceptKey: 'algebra.quadratics.factoring', label };
}

function ping(kind: TurnPing['kind'], conceptKey: string, label = 'x'): TurnPing {
  return { kind, conceptKey, title: conceptKey, label };
}

describe('stripHistory — tags never re-enter the outbound wire', () => {
  it('keeps only role/content, dropping tags entirely', () => {
    const messages: DisplayMessage[] = [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello', tags: [tag('reviewing', 'Factoring')] },
    ];

    expect(stripHistory(messages)).toEqual([
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello' },
    ]);
  });

  it('a history with no tags anywhere round-trips unchanged (back-compat)', () => {
    const messages: DisplayMessage[] = [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello' },
    ];
    expect(stripHistory(messages)).toEqual(messages);
  });

  it('an empty history strips to an empty array', () => {
    expect(stripHistory([])).toEqual([]);
  });
});

describe(`capTags — client-side ≤${MAX_TAGS_PER_TURN} defence in depth`, () => {
  it('passes through a short list unchanged', () => {
    const tags = [tag('reviewing', 'a')];
    expect(capTags(tags)).toEqual(tags);
  });

  it(`truncates to the first ${MAX_TAGS_PER_TURN} when the server somehow sent more`, () => {
    const tags = [tag('reviewing', 'a'), tag('strength', 'b'), tag('due-review', 'c')];
    expect(capTags(tags)).toEqual(tags.slice(0, MAX_TAGS_PER_TURN));
  });

  it('undefined tags cap to an empty array', () => {
    expect(capTags(undefined)).toEqual([]);
  });
});

describe(`filterPingsForDisplay — ≤${MAX_PINGS_PER_TURN} per turn, one mastery-up per concept per session`, () => {
  it('passes an ordinary single ping through untouched', () => {
    const shown = new Set<string>();
    const result = filterPingsForDisplay([ping('mastery-up', 'algebra.quadratics.factoring')], shown);

    expect(result).toEqual([ping('mastery-up', 'algebra.quadratics.factoring')]);
    expect(shown.has('mastery-up:algebra.quadratics.factoring')).toBe(true);
  });

  it(`caps at ${MAX_PINGS_PER_TURN} pings in a single turn`, () => {
    const shown = new Set<string>();
    const pings = [
      ping('mastery-up', 'concept-a'),
      ping('misconception-resolved', 'concept-b'),
      ping('misconception-resolved', 'concept-c'),
    ];

    expect(filterPingsForDisplay(pings, shown)).toEqual(pings.slice(0, MAX_PINGS_PER_TURN));
  });

  it('a mastery-up for a concept already shown THIS SESSION is suppressed a second time', () => {
    const shown = new Set<string>(['mastery-up:algebra.quadratics.factoring']);
    const result = filterPingsForDisplay([ping('mastery-up', 'algebra.quadratics.factoring')], shown);
    expect(result).toEqual([]);
  });

  it('a mastery-up for a DIFFERENT concept is never suppressed by another concept\'s dedupe entry', () => {
    const shown = new Set<string>(['mastery-up:concept-a']);
    const result = filterPingsForDisplay([ping('mastery-up', 'concept-b')], shown);
    expect(result).toEqual([ping('mastery-up', 'concept-b')]);
  });

  it('a mastery-progress for a concept whose mastery-up was already shown is NOT suppressed -- different kinds dedupe independently', () => {
    const shown = new Set<string>(['mastery-up:algebra.quadratics.factoring']);
    const result = filterPingsForDisplay([ping('mastery-progress', 'algebra.quadratics.factoring')], shown);
    expect(result).toEqual([ping('mastery-progress', 'algebra.quadratics.factoring')]);
  });

  it('misconception-resolved pings are never deduped -- each completed streak is a distinct real event', () => {
    const shown = new Set<string>();
    const result = filterPingsForDisplay(
      [ping('misconception-resolved', 'concept-a'), ping('misconception-resolved', 'concept-a')],
      shown,
    );
    expect(result).toHaveLength(2);
  });

  it('undefined pings filter to an empty array', () => {
    expect(filterPingsForDisplay(undefined, new Set())).toEqual([]);
  });
});

describe('masteryDelta — client-side vs the panel-open overview snapshot', () => {
  function baselineWith(conceptKey: string, mastery: number): ProfileOverview {
    return {
      calibrating: false,
      mastery: [{ conceptKey, title: conceptKey, mastery, state: 'learning', confidenceBand: 'medium' }],
      weakSpots: [],
      dueForReview: [],
    };
  }

  it('computes the signed delta against a present baseline', () => {
    const baseline = baselineWith('algebra.quadratics.factoring', 0.4);
    expect(masteryDelta(baseline, 'algebra.quadratics.factoring', 0.55)).toBeCloseTo(0.15, 6);
    expect(masteryDelta(baseline, 'algebra.quadratics.factoring', 0.3)).toBeCloseTo(-0.1, 6);
  });

  it('returns null when there is no baseline at all (never saw the overview this session)', () => {
    expect(masteryDelta(null, 'algebra.quadratics.factoring', 0.5)).toBeNull();
  });

  it('returns null for a concept the baseline never touched (absolute value, no arrow)', () => {
    const baseline = baselineWith('algebra.quadratics.factoring', 0.4);
    expect(masteryDelta(baseline, 'algebra.exponents.power-rule', 0.5)).toBeNull();
  });

  it(`DELTA_EPSILON (${DELTA_EPSILON}) is the no-arrow threshold the overlay applies on top of this`, () => {
    const baseline = baselineWith('algebra.quadratics.factoring', 0.4);
    const delta = masteryDelta(baseline, 'algebra.quadratics.factoring', 0.4009);
    expect(Math.abs(delta!)).toBeLessThan(DELTA_EPSILON);
  });
});

describe('humanizeDue — the forward look\'s phrasing (the dates themselves are the FSRS schedule, untouched)', () => {
  // Constructed from LOCAL components (not a fixed UTC string) so the day-
  // diff math is exercised the same way regardless of the test runner's
  // timezone -- humanizeDue itself buckets by LOCAL calendar day
  // (getFullYear/getMonth/getDate), so the fixtures must anchor the same way.
  const now = new Date(2026, 6, 5, 12, 0, 0); // July 5, 2026, local noon
  function localDaysFromNow(days: number): string {
    return new Date(2026, 6, 5 + days, 12, 0, 0).toISOString();
  }

  it('a past or same-day due date reads as due now', () => {
    expect(humanizeDue(localDaysFromNow(-4), now)).toBe('due for review now');
    expect(humanizeDue(localDaysFromNow(0), now)).toBe('due for review now');
  });

  it('exactly one day out reads as "tomorrow"', () => {
    expect(humanizeDue(localDaysFromNow(1), now)).toBe('comes back tomorrow');
  });

  it('within the week reads as a weekday name', () => {
    const due = new Date(2026, 6, 9, 12, 0, 0);
    expect(humanizeDue(due.toISOString(), now)).toBe(
      `comes back ${due.toLocaleDateString(undefined, { weekday: 'long' })}`,
    );
  });

  it('a week or more out reads as a short month/day date', () => {
    const due = new Date(2026, 6, 20, 12, 0, 0);
    expect(humanizeDue(due.toISOString(), now)).toBe(
      `comes back ${due.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`,
    );
  });

  it('an unparseable date degrades to a vague fallback rather than "Invalid Date"', () => {
    expect(humanizeDue('not-a-date', now)).toBe('coming back soon');
  });
});
