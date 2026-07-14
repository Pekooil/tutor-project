// @vitest-environment jsdom
//
// Sprint 13 Task 9: the overlay's pure display-logic spec (the Sprint 12
// annotations.test.ts precedent -- jsdom, no WXT/browser harness). Overlay.tsx
// exports these helpers specifically so they're testable in isolation from
// the React component tree (its own header comment, "exported for the Task 9
// vitest/jsdom spec"): stripHistory (display extras never re-enter the
// outbound wire), filterPinsForDisplay (the status-pin priority/cap/dedupe
// gate, ADR-034 -- superseding Sprint 13's filterPingsForDisplay + capTags),
// masteryDelta (the client-side recap delta vs the panel-open baseline), and
// humanizeDue (the forward look's due-date phrasing).
import { describe, expect, it } from 'vitest';
import {
  DELTA_EPSILON,
  MAX_PINS_PER_TURN,
  PIN_PRIORITY,
  filterPinsForDisplay,
  humanizeDue,
  masteryDelta,
  stripHistory,
  windowHistory,
  HISTORY_WINDOW_TURNS,
  type DisplayMessage,
} from '../src/overlay/Overlay';
import type { ProfileOverview, StatusPin, TurnMessage } from '../src/types/messages';

function pin(kind: StatusPin['kind'], conceptKey: string | null, label = 'x'): StatusPin {
  const category: StatusPin['category'] =
    kind === 'prediction-confirmed'
      ? 'prediction'
      : kind === 'callback' || kind === 'due-review'
        ? 'memory'
        : kind === 'confidence-up'
          ? 'confidence'
          : kind === 'self-caught'
            ? 'independence'
            : 'progress';
  return { category, kind, conceptKey, label };
}

describe('stripHistory — display extras never re-enter the outbound wire', () => {
  it('keeps only role/content, dropping annotation extras entirely', () => {
    const messages: DisplayMessage[] = [
      { role: 'user', content: 'hi' },
      {
        role: 'assistant',
        content: 'hello',
        annotations: [{ id: 'a1', type: 'highlight', target: { kind: 'textMatch', text: '5t^2' } }],
        annotationColors: { a1: 'annot-1' },
      },
    ];

    expect(stripHistory(messages)).toEqual([
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello' },
    ]);
  });

  it('drops milestone MARKER entries outright — the session annotating itself never reaches the wire', () => {
    const messages: DisplayMessage[] = [
      { role: 'user', content: 'hi' },
      {
        role: 'assistant',
        content: 'Pattern broken · sign errors',
        milestone: { kind: 'pattern-broken', tone: 'positive', line: 'Pattern broken · sign errors' },
      },
      { role: 'assistant', content: 'Nice — what are the roots?' },
    ];

    expect(stripHistory(messages)).toEqual([
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'Nice — what are the roots?' },
    ]);
  });

  it('a history with no extras anywhere round-trips unchanged (back-compat)', () => {
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

describe(`windowHistory — trims prior history to the last ${HISTORY_WINDOW_TURNS} turns (PLAN §2.5, Sprint 19 Task 8)`, () => {
  // A synthetic alternating history: `turns` user/assistant PAIRS.
  function alternating(turns: number): TurnMessage[] {
    const out: TurnMessage[] = [];
    for (let t = 0; t < turns; t++) {
      out.push({ role: 'user', content: `u${t}` });
      out.push({ role: 'assistant', content: `a${t}` });
    }
    return out;
  }

  it('leaves a short history (fewer than the window) untouched', () => {
    const history = alternating(3);
    expect(windowHistory(history)).toEqual(history);
  });

  it('a history exactly at the window is untouched', () => {
    const history = alternating(HISTORY_WINDOW_TURNS);
    expect(windowHistory(history)).toEqual(history);
  });

  it(`keeps only the last ${HISTORY_WINDOW_TURNS} user turns when the history is longer`, () => {
    const history = alternating(HISTORY_WINDOW_TURNS + 5); // 13 turns, 26 messages
    const windowed = windowHistory(history);
    // 8 turns * 2 messages/turn = 16, and it must begin on the 6th turn's user
    // message (turns are 0-indexed: t=5..12 survive).
    expect(windowed).toHaveLength(HISTORY_WINDOW_TURNS * 2);
    expect(windowed[0]).toEqual({ role: 'user', content: `u${HISTORY_WINDOW_TURNS + 5 - HISTORY_WINDOW_TURNS}` });
    expect(windowed[windowed.length - 1]).toEqual({ role: 'assistant', content: `a${HISTORY_WINDOW_TURNS + 5 - 1}` });
  });

  it('always begins the window on a USER message even when the tail ends on an assistant turn (Anthropic API requires a leading user turn)', () => {
    const history = alternating(HISTORY_WINDOW_TURNS + 4);
    const windowed = windowHistory(history);
    expect(windowed[0].role).toBe('user');
  });

  it('respects a custom window size', () => {
    const history = alternating(10);
    const windowed = windowHistory(history, 2);
    expect(windowed).toEqual([
      { role: 'user', content: 'u8' },
      { role: 'assistant', content: 'a8' },
      { role: 'user', content: 'u9' },
      { role: 'assistant', content: 'a9' },
    ]);
  });

  it('an empty history windows to an empty array', () => {
    expect(windowHistory([])).toEqual([]);
  });
});

describe(`filterPinsForDisplay — priority-sorted, ≤${MAX_PINS_PER_TURN} per turn, one kind:concept per session`, () => {
  it('passes an ordinary single pin through untouched', () => {
    const shown = new Set<string>();
    const result = filterPinsForDisplay([pin('concept-understood', 'algebra.quadratics.factoring')], shown);

    expect(result).toEqual([pin('concept-understood', 'algebra.quadratics.factoring')]);
    expect(shown.has('concept-understood:algebra.quadratics.factoring')).toBe(true);
  });

  it(`caps at ${MAX_PINS_PER_TURN} pins in a single turn`, () => {
    const shown = new Set<string>();
    const pins = [
      pin('pattern-broken', 'concept-a'),
      pin('pattern-broken', 'concept-b'),
      pin('pattern-broken', 'concept-c'),
    ];

    expect(filterPinsForDisplay(pins, shown)).toEqual(pins.slice(0, MAX_PINS_PER_TURN));
  });

  it('the HIGHEST-priority pins win the cap regardless of wire order', () => {
    const shown = new Set<string>();
    const dueReview = pin('due-review', 'concept-a');
    const callback = pin('callback', 'concept-b');
    const broken = pin('pattern-broken', 'concept-c');

    // Server order: memory pins first, the headline event last -- the gate
    // must still surface pattern-broken first, not drop it to the cap, and
    // callback outranks due-review for the second slot.
    const result = filterPinsForDisplay([dueReview, callback, broken], shown);
    expect(result).toEqual([broken, callback]);
  });

  it('equal-priority pins keep the server order (stable sort)', () => {
    const shown = new Set<string>();
    const visual = pin('teaching-visual', null);
    const pace = pin('pace-up', null);
    expect(PIN_PRIORITY[visual.kind]).toBe(PIN_PRIORITY[pace.kind]);
    expect(filterPinsForDisplay([visual, pace], shown)).toEqual([visual, pace]);
  });

  it('a kind already shown for a concept THIS SESSION is suppressed a second time', () => {
    const shown = new Set<string>(['concept-understood:algebra.quadratics.factoring']);
    const result = filterPinsForDisplay([pin('concept-understood', 'algebra.quadratics.factoring')], shown);
    expect(result).toEqual([]);
  });

  it("the same kind for a DIFFERENT concept is never suppressed by another concept's dedupe entry", () => {
    const shown = new Set<string>(['concept-understood:concept-a']);
    const result = filterPinsForDisplay([pin('concept-understood', 'concept-b')], shown);
    expect(result).toEqual([pin('concept-understood', 'concept-b')]);
  });

  it('a progress pin for a concept whose concept-understood was already shown is NOT suppressed -- kinds dedupe independently', () => {
    const shown = new Set<string>(['concept-understood:algebra.quadratics.factoring']);
    const result = filterPinsForDisplay([pin('progress', 'algebra.quadratics.factoring')], shown);
    expect(result).toEqual([pin('progress', 'algebra.quadratics.factoring')]);
  });

  it('a concept-less move pin (conceptKey null) dedupes purely by kind -- once per session', () => {
    const shown = new Set<string>();
    expect(filterPinsForDisplay([pin('guidance-up', null)], shown)).toHaveLength(1);
    expect(shown.has('guidance-up:')).toBe(true);
    expect(filterPinsForDisplay([pin('guidance-up', null)], shown)).toEqual([]);
  });

  it('pattern-broken pins are never deduped -- each completed streak is a distinct real event', () => {
    const shown = new Set<string>();
    const first = filterPinsForDisplay([pin('pattern-broken', 'concept-a')], shown);
    const second = filterPinsForDisplay([pin('pattern-broken', 'concept-a')], shown);
    expect(first).toHaveLength(1);
    expect(second).toHaveLength(1);
  });

  it('undefined pins filter to an empty array', () => {
    expect(filterPinsForDisplay(undefined, new Set())).toEqual([]);
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
