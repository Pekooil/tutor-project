// The check-in -> recap flow's pure helpers (design handoff states 05/06b/07;
// the kickoff.test.ts slot, replaced with it): copy building and
// deterministic derivation only -- the React wiring stays in the components
// (CheckinCard/RecapCard/SectionBloom).

import { describe, expect, it } from 'vitest';
import {
  NOT_SURE_CHIP,
  bloomLine,
  buildStickingChips,
  conceptOutcome,
  formatRecapMeta,
  humanizeMisconceptionLabel,
  pickRecapInsight,
} from '../src/overlay/session-flow';
import type { SessionRecap, StickingCandidate } from '../src/types/messages';

function makeRecap(overrides: Partial<SessionRecap> = {}): SessionRecap {
  return {
    concepts: [],
    misconceptionsAdded: [],
    misconceptionsResolved: [],
    nextReviews: [],
    trends: [],
    ...overrides,
  };
}

// (The buildSessionStartMessage/buildReframeStartMessage specs lived here
// until the design follow-up removed the builders themselves: the check-in
// confirmation now crosses the wire as the structured sessionStart field --
// no student turn, fabricated or otherwise, ever enters the conversation.
// The server-side prompt rendering is pinned by web/tests/system-prompt.test.ts.)

describe('conceptOutcome — recorded counts onto the three recap rows', () => {
  it('reads a clean run as solid', () => {
    expect(conceptOutcome({ title: 'Factoring simple quadratics', correct: 3, incorrect: 0 })).toEqual({
      kind: 'solid',
      line: 'Factoring simple quadratics — solid',
    });
  });

  it('reads a majority-right run as N of M', () => {
    expect(conceptOutcome({ title: 'Choosing factor vs. formula', correct: 4, incorrect: 1 })).toEqual({
      kind: 'mostly',
      line: 'Choosing factor vs. formula — 4 of 5 right',
    });
  });

  it('reads everything else (ties, majority-wrong, zero-correct) as revisit', () => {
    expect(conceptOutcome({ title: 'Negative coefficients', correct: 1, incorrect: 1 }).kind).toBe('revisit');
    expect(conceptOutcome({ title: 'Negative coefficients', correct: 0, incorrect: 2 }).line).toBe(
      'Negative coefficients — worth one more pass',
    );
    expect(conceptOutcome({ title: 'Untouched', correct: 0, incorrect: 0 }).kind).toBe('revisit');
  });
});

describe('formatRecapMeta — the "18 min · 5 problems" header line', () => {
  const concepts = [
    { conceptKey: 'a', title: 'A', turns: 4, correct: 3, incorrect: 1, mastery: 0.8, state: 'solid' },
    { conceptKey: 'b', title: 'B', turns: 1, correct: 1, incorrect: 0, mastery: 0.6, state: 'mostly' },
  ];

  it('joins duration and the gradable-answer count', () => {
    expect(formatRecapMeta(makeRecap({ concepts }), 18 * 60000)).toBe('18 min · 5 problems');
  });

  it('drops the minutes segment when no client-side start time exists', () => {
    expect(formatRecapMeta(makeRecap({ concepts }), null)).toBe('5 problems');
  });

  it('rounds sub-minute sessions up to 1 min and uses the singular for one problem', () => {
    const one = makeRecap({ concepts: [{ ...concepts[1] }] });
    expect(formatRecapMeta(one, 20_000)).toBe('1 min · 1 problem');
  });
});

describe('pickRecapInsight — grounded process praise, or nothing', () => {
  const resolved = { conceptKey: 'k', title: 'Quadratics', category: 'sign_error.distribution', description: '' };
  const trend = { conceptKey: 'k', title: 'Choosing a method', sessions: 3, line: '3 sessions in a row improving' };

  it('prefers a resolved misconception, humanized', () => {
    const insight = pickRecapInsight(makeRecap({ misconceptionsResolved: [resolved], trends: [trend] }));
    expect(insight).toContain('sign error distribution');
    expect(insight).not.toContain('sign_error');
  });

  it('falls back to the trend line', () => {
    expect(pickRecapInsight(makeRecap({ trends: [trend] }))).toContain('3 sessions in a row improving');
  });

  it('returns null when the session earned neither (the common case)', () => {
    expect(pickRecapInsight(makeRecap())).toBeNull();
  });
});

describe('bloomLine — the section-complete card subtitle', () => {
  it('names the sticking point the student picked', () => {
    expect(bloomLine('Quadratic equations', 'Choosing a method')).toBe('Choosing a method · every step was yours');
  });

  it('falls back to the topic on the not-sure answer, then to the bare line', () => {
    expect(bloomLine('Quadratic equations', NOT_SURE_CHIP)).toBe('Quadratic equations · every step was yours');
    expect(bloomLine(null, null)).toBe('Every step was yours');
  });
});

describe('humanizeMisconceptionLabel — a recorded misconception as chip text', () => {
  it('prefers the free-text description when one was logged', () => {
    expect(humanizeMisconceptionLabel({ category: 'sign-errors', description: 'drops the negative sign' })).toBe(
      'drops the negative sign',
    );
  });

  it('falls back to the humanized category when the description is empty/whitespace', () => {
    expect(humanizeMisconceptionLabel({ category: 'sign_error.distribution', description: '' })).toBe(
      'sign error distribution',
    );
    expect(humanizeMisconceptionLabel({ category: 'setup-errors', description: '   ' })).toBe('setup errors');
  });
});

describe('buildStickingChips — the personalized 5b sticking-point chips', () => {
  const signErrors: StickingCandidate = { category: 'sign-errors', description: 'drops the negative sign' };
  const setupErrors: StickingCandidate = { category: 'setup-errors', description: 'writes the equation backwards' };
  const methodChoice: StickingCandidate = { category: 'method-choice', description: '' };

  it('with zero recorded candidates, falls back to the exact original fixed set (byte-identical to the design board)', () => {
    const chips = buildStickingChips([]);
    expect(chips.map((chip) => chip.value)).toEqual([
      'Setting up the equation',
      'Choosing a method',
      'The algebra steps',
      'Honestly, not sure',
    ]);
    expect(chips.every((chip) => !chip.personalized)).toBe(true);
    expect(chips.map((chip) => chip.rank)).toEqual([1, 2, 3, null]);
  });

  it('with 3 recorded candidates, all three ranked slots are personalized and none of the generic pool appears', () => {
    const chips = buildStickingChips([signErrors, setupErrors, methodChoice]);
    expect(chips).toHaveLength(4);
    expect(chips.slice(0, 3).every((chip) => chip.personalized)).toBe(true);
    expect(chips.map((chip) => chip.value)).toEqual([
      'drops the negative sign',
      'writes the equation backwards',
      'method choice', // humanized category, description was empty
      NOT_SURE_CHIP,
    ]);
    expect(chips[3]).toEqual({ value: NOT_SURE_CHIP, label: NOT_SURE_CHIP, rank: null, personalized: false });
  });

  it('with 1 recorded candidate, fills the remaining 2 ranked slots from the generic pool, in order', () => {
    const chips = buildStickingChips([signErrors]);
    expect(chips.map((chip) => ({ value: chip.value, personalized: chip.personalized, rank: chip.rank }))).toEqual([
      { value: 'drops the negative sign', personalized: true, rank: 1 },
      { value: 'Setting up the equation', personalized: false, rank: 2 },
      { value: 'Choosing a method', personalized: false, rank: 3 },
      { value: NOT_SURE_CHIP, personalized: false, rank: null },
    ]);
  });

  it('every one of the top 3 is labeled "Top N possible misconception," regardless of personalized/generic source', () => {
    const personalizedOnly = buildStickingChips([signErrors]);
    // rank 1 (real) and rank 2/3 (generic fill) all get the label -- the
    // per-chip `rank` field IS that label's number; the not-sure chip (rank
    // null) is the only one excluded.
    expect(personalizedOnly.filter((chip) => chip.rank !== null)).toHaveLength(3);
    expect(personalizedOnly.map((chip) => chip.rank)).toEqual([1, 2, 3, null]);
  });

  it('caps at 3 ranked slots even when handed more than 3 candidates', () => {
    const extra: StickingCandidate = { category: 'extra', description: 'a fourth one that must never appear' };
    const chips = buildStickingChips([signErrors, setupErrors, methodChoice, extra]);
    expect(chips).toHaveLength(4);
    expect(chips.map((chip) => chip.value)).not.toContain('a fourth one that must never appear');
  });

  it('skips a generic fallback option that would exactly duplicate a personalized chip already shown', () => {
    const chips = buildStickingChips([{ category: 'method-choice', description: 'Choosing a method' }]);
    const values = chips.map((chip) => chip.value);
    // "Choosing a method" appears exactly once (from the personalized slot),
    // never a second time as a generic-pool duplicate.
    expect(values.filter((value) => value === 'Choosing a method')).toHaveLength(1);
  });

  it('capitalizes the display label but leaves `value` as the raw (sentence-friendly) text', () => {
    const chips = buildStickingChips([signErrors]);
    expect(chips[0].value).toBe('drops the negative sign');
    expect(chips[0].label).toBe('Drops the negative sign');
  });
});
