// The check-in -> plan -> recap flow's pure helpers (design handoff states
// 05/06/07; the kickoff.test.ts slot, replaced with it): copy building and
// deterministic derivation only -- the React wiring stays in the components
// (CheckinCard/PlanCard/RecapCard/SectionBloom).

import { describe, expect, it } from 'vitest';
import {
  NOT_SURE_CHIP,
  PLAN_VARIANT_COUNT,
  STICKING_CHIPS,
  TOPIC_FALLBACK_CHIPS,
  bloomLine,
  buildSessionPlan,
  buildSessionStartMessage,
  conceptOutcome,
  formatRecapMeta,
  pickRecapInsight,
} from '../src/overlay/session-flow';
import type { SessionRecap } from '../src/types/messages';

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

describe('buildSessionStartMessage — the check-in answers as a real student turn', () => {
  it('names a detected topic mid-sentence, lowercased, with the sticking point', () => {
    const message = buildSessionStartMessage('Quadratic equations', 'Choosing a method');
    expect(message).toContain('quadratic equations');
    expect(message).toContain('choosing a method');
    expect(message).toMatch(/start there\?$/i);
  });

  it('keeps an acronym-led topic intact (no mangled lowercase)', () => {
    expect(buildSessionStartMessage('SOH-CAH-TOA review', 'The algebra steps')).toContain('SOH-CAH-TOA review');
  });

  it('phrases the fallback chips naturally instead of echoing the label', () => {
    expect(buildSessionStartMessage('Homework set', 'The algebra steps')).toContain('my homework set');
    expect(buildSessionStartMessage('Exam prep', 'The algebra steps')).toContain('exam prep');
  });

  it('never echoes the not-sure sentinel as a named weakness', () => {
    const message = buildSessionStartMessage('Quadratic equations', NOT_SURE_CHIP);
    expect(message).not.toContain(NOT_SURE_CHIP.toLowerCase());
    expect(message).toContain('not sure where it usually goes wrong');
  });
});

describe('buildSessionPlan — three steps, deterministic reshuffle', () => {
  it('always yields exactly 3 steps whose minutes sum to totalMinutes', () => {
    for (let variant = 0; variant < PLAN_VARIANT_COUNT; variant++) {
      const plan = buildSessionPlan('Quadratic equations', 'Choosing a method', variant);
      expect(plan.steps).toHaveLength(3);
      expect(plan.totalMinutes).toBe(plan.steps.reduce((sum, step) => sum + step.minutes, 0));
    }
  });

  it("bolds the student's own sticking point in the lead line", () => {
    const plan = buildSessionPlan('Quadratic equations', 'Choosing a method', 0);
    expect(plan.lead.emphasis).toBe('choosing a method');
    expect(plan.lead.before).toContain('Quadratic equations');
    expect(plan.lead.after).toContain('your words, not mine');
  });

  it('drops the emphasis (no invented weakness) on the not-sure answer', () => {
    const plan = buildSessionPlan('Quadratic equations', NOT_SURE_CHIP, 0);
    expect(plan.lead.emphasis).toBeUndefined();
    expect(plan.steps.some((step) => step.title.includes('Find the sticking point'))).toBe(true);
  });

  it('reshuffles deterministically and cycles back after PLAN_VARIANT_COUNT', () => {
    const first = buildSessionPlan('Quadratic equations', 'Choosing a method', 0);
    const second = buildSessionPlan('Quadratic equations', 'Choosing a method', 1);
    const wrapped = buildSessionPlan('Quadratic equations', 'Choosing a method', PLAN_VARIANT_COUNT);
    expect(second.steps[0].title).not.toBe(first.steps[0].title);
    expect(wrapped).toEqual(first);
  });
});

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

describe('the fixed chip sets (design copy, pinned)', () => {
  it('matches the design board exactly', () => {
    expect(STICKING_CHIPS).toEqual([
      'Setting up the equation',
      'Choosing a method',
      'The algebra steps',
      'Honestly, not sure',
    ]);
    expect(TOPIC_FALLBACK_CHIPS).toEqual(['Homework set', 'Exam prep', 'Something else']);
  });
});
