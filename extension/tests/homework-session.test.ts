// The homework session's rules (spec §3, §4, §5, §6, §7, §8). Every module
// under test is pure, so these run with no DOM, no chrome.*, and no timers.
import { describe, expect, it } from 'vitest';
import { buildQuickChips, parseRangeSelection } from '../src/overlay/homework/denominator';
import {
  MIN_SESSIONS_FOR_ESTIMATE,
  buildOpener,
  denominatorPrompt,
  estimateRange,
} from '../src/overlay/homework/opener';
import {
  MAX_MOMENTS_PER_SESSION,
  MOMENT_COOLDOWN_MS,
  pickReaction,
} from '../src/overlay/homework/reactions';
import {
  createSession,
  longestUnaidedRun,
  pauseSession,
  problemElapsedMs,
  recordTap,
  resumeSession,
  sessionElapsedMs,
  undoLastTap,
} from '../src/overlay/homework/session';
import { buildSummary, mismatchLine, scopeLine } from '../src/overlay/homework/summary';
import { EMPTY_REACTION_MEMORY, type HomeworkHistoryEntry, type SetProblem } from '../src/overlay/homework/types';
import { parseCompletionUtterance, trioLabels } from '../src/overlay/homework/vocabulary';

const T0 = 1_800_000_000_000;

function problems(count: number, startAt = 1): SetProblem[] {
  return Array.from({ length: count }, (_, index) => ({
    label: String(startAt + index),
    snippet: `problem ${startAt + index}`,
    sourceIndex: index,
  }));
}

function session(count = 8, options: { graded?: boolean } = {}) {
  return createSession({
    locationKey: 'https://example.com/hw',
    pageTitle: 'Factoring practice',
    concept: 'Factoring quadratics',
    problems: problems(count),
    graded: options.graded ?? false,
    now: T0,
  });
}

// ---- §3 denominator ------------------------------------------------------

describe('denominator — quick chips (spec §3)', () => {
  it('keys odds/evens on the PRINTED label, not the row position', () => {
    const chips = buildQuickChips(['7', '8', '9', '10']);
    const odds = chips.find((chip) => chip.id === 'odds');
    // Printed 7 and 9 are the odds -- rows 0 and 2.
    expect(odds?.indexes).toEqual([0, 2]);
  });

  it('offers a chip only when it produces a valid non-empty subset', () => {
    // One problem: odds would be everything, evens nothing, half nothing.
    expect(buildQuickChips(['1'])).toEqual([]);
    // All-odd labels: "odds" would select the whole set, so it is not offered.
    expect(buildQuickChips(['1', '3', '5']).map((chip) => chip.id)).not.toContain('odds');
  });
});

describe('denominator — range input (spec §3)', () => {
  const labels = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'];

  it('accepts ranges, singletons, and mixtures', () => {
    expect(parseRangeSelection('1-12', labels)).toHaveLength(12);
    expect(parseRangeSelection('3,5,7', labels)).toEqual([2, 4, 6]);
    expect(parseRangeSelection('1-6, 9, 11', labels)).toEqual([0, 1, 2, 3, 4, 5, 8, 10]);
  });

  it('accepts en/em dashes and reversed ranges', () => {
    expect(parseRangeSelection('3–5', labels)).toEqual([2, 3, 4]);
    expect(parseRangeSelection('5-3', labels)).toEqual([2, 3, 4]);
  });

  it('ignores numbers that name no printed problem rather than guessing', () => {
    expect(parseRangeSelection('99', labels)).toEqual([]);
    expect(parseRangeSelection('11-99', labels)).toEqual([10, 11]);
    expect(parseRangeSelection('nonsense', labels)).toEqual([]);
  });
});

describe('denominator — the prompt leads with adjust on a shaky count', () => {
  it('states a confident count and asks about an unconfident one', () => {
    expect(denominatorPrompt(8, 'high')).toEqual({
      text: 'I see 8 on the page — doing all of them?',
      leadWithAdjust: false,
    });
    expect(denominatorPrompt(63, 'low').leadWithAdjust).toBe(true);
  });
});

// ---- §2 opener -----------------------------------------------------------

describe('opener — the first-ever session (spec §2, variant A)', () => {
  it('shows no estimate, no comparison, and no placeholder', () => {
    const lines = buildOpener({ concept: 'Factoring quadratics', count: 8, history: [] });
    expect(lines.variant).toBe('A');
    expect(lines.headline).toBe('Factoring quadratics. 8 problems.');
    expect(lines.estimateLine).toBeNull();
    expect(lines.comparisonLine).toBeNull();
    expect(lines.misconceptionLine).toBeNull();
    // Framed forward, not as an apology for missing data.
    expect(lines.forwardLine).toContain("I'll track your pace tonight");
  });

  it('renders the bare count when the concept read was absent', () => {
    const lines = buildOpener({ concept: null, count: 8, history: [] });
    expect(lines.headline).toBe('8 problems.');
  });

  it('says "1 problem", not "1 problems"', () => {
    expect(buildOpener({ concept: null, count: 1, history: [] }).headline).toBe('1 problem.');
  });
});

function history(count: number, overrides: Partial<HomeworkHistoryEntry> = {}): HomeworkHistoryEntry[] {
  return Array.from({ length: count }, (_, index) => ({
    concept: 'Long division',
    denominator: 8,
    totalSeconds: 40 * 60,
    endedAt: T0 - (index + 1) * 86_400_000,
    longestUnaidedRun: 3,
    ...overrides,
  }));
}

describe('opener — estimates and comparisons (spec §2, variants B and C)', () => {
  it('withholds the estimate until there is enough pace data', () => {
    expect(estimateRange(history(MIN_SESSIONS_FOR_ESTIMATE - 1), 8)).toBeNull();
    expect(estimateRange(history(MIN_SESSIONS_FOR_ESTIMATE), 8)).not.toBeNull();
  });

  it('is always a range, never a point value', () => {
    const estimate = estimateRange(history(4), 8);
    expect(estimate).not.toBeNull();
    expect(estimate!.highMinutes).toBeGreaterThan(estimate!.lowMinutes);
  });

  it('variant B: pace history but nothing on this topic', () => {
    const lines = buildOpener({ concept: 'Factoring quadratics', count: 8, history: history(4) });
    expect(lines.variant).toBe('B');
    expect(lines.estimateLine).toMatch(/At your usual pace, roughly \d+–\d+ minutes\./);
    expect(lines.comparisonLine).toBeNull();
  });

  it('variant C: a prior set on this same topic', () => {
    const lines = buildOpener({
      concept: 'Factoring quadratics',
      count: 8,
      history: history(4, { concept: 'Factoring quadratics', totalSeconds: 50 * 60 }),
      now: T0,
    });
    expect(lines.variant).toBe('C');
    expect(lines.comparisonLine).toContain('50 minutes');
  });

  it('omits the misconception line entirely when nothing is mapped', () => {
    const lines = buildOpener({
      concept: 'Factoring quadratics',
      count: 8,
      history: history(4, { concept: 'Factoring quadratics' }),
    });
    expect(lines.misconceptionLine).toBeNull();
  });
});

// ---- §4 taps, timing, undo ----------------------------------------------

describe('taps (spec §4)', () => {
  it('advances sequentially and never moves backward', () => {
    let current = session(4);
    for (const outcome of ['ok', 'shaky', 'ok', 'ok'] as const) {
      current = recordTap(current, { outcome, now: T0 + 60_000 }).session;
    }
    expect(current.completed.map((problem) => problem.index)).toEqual([0, 1, 2, 3]);
    expect(current.status).toBe('complete');
  });

  it('times each problem from the previous tap landing', () => {
    let current = session(3);
    current = recordTap(current, { outcome: 'ok', now: T0 + 120_000 }).session;
    expect(current.completed[0].seconds).toBe(120);
    current = recordTap(current, { outcome: 'ok', now: T0 + 150_000 }).session;
    expect(current.completed[1].seconds).toBe(30);
  });

  it('excludes a long break from both clocks (spec §4 pause rule)', () => {
    let current = session(3);
    // Away for 30 minutes starting one minute in.
    current = pauseSession(current, T0 + 60_000);
    current = resumeSession(current, T0 + 60_000 + 30 * 60_000);
    // Then one more minute of real work.
    const at = T0 + 60_000 + 30 * 60_000 + 60_000;
    expect(Math.round(sessionElapsedMs(current, at) / 1000)).toBe(120);
    expect(Math.round(problemElapsedMs(current, at) / 1000)).toBe(120);
  });

  it('undo reverts the completion AND the reaction budget it consumed', () => {
    const start = session(8);
    const before = start.reactions;
    const { session: after } = recordTap(start, { outcome: 'ok', now: T0 + 60_000 });
    const undone = undoLastTap(after, {
      previousMemory: before,
      previousProblemStartedAt: start.problemStartedAt,
      now: T0 + 61_000,
    });
    expect(undone.completed).toHaveLength(0);
    expect(undone.reactions).toEqual(before);
    expect(undone.status).toBe('active');
  });
});

describe('longestUnaidedRun — a within-set run, never a day streak', () => {
  it('breaks on tutored and not on shaky', () => {
    expect(
      longestUnaidedRun([
        { index: 0, label: '1', outcome: 'ok', seconds: 1 },
        { index: 1, label: '2', outcome: 'shaky', seconds: 1 },
        { index: 2, label: '3', outcome: 'ok', seconds: 1 },
        { index: 3, label: '4', outcome: 'tutored', seconds: 1 },
        { index: 4, label: '5', outcome: 'ok', seconds: 1 },
      ]),
    ).toBe(3);
  });
});

// ---- §5 reactions --------------------------------------------------------

function react(options: {
  outcome: 'ok' | 'shaky' | 'tutored';
  done: number;
  denominator: number;
  seconds?: number;
  memory?: typeof EMPTY_REACTION_MEMORY;
  now?: number;
  priorSeconds?: number[];
}) {
  const priors = options.priorSeconds ?? Array.from({ length: options.done - 1 }, () => 60);
  const completed = [
    ...priors.map((seconds, index) => ({
      index,
      label: String(index + 1),
      outcome: 'ok' as const,
      seconds,
    })),
    {
      index: options.done - 1,
      label: String(options.done),
      outcome: options.outcome,
      seconds: options.seconds ?? 60,
    },
  ];
  return pickReaction({
    outcome: options.outcome,
    seconds: options.seconds ?? 60,
    completed,
    denominator: options.denominator,
    memory: options.memory ?? EMPTY_REACTION_MEMORY,
    now: options.now ?? T0,
  });
}

describe('reactions (spec §5)', () => {
  it('fires exactly one reaction per tap', () => {
    const { reaction } = react({ outcome: 'ok', done: 1, denominator: 8 });
    expect(typeof reaction.text).toBe('string');
    expect(reaction.text.length).toBeGreaterThan(0);
  });

  it('set complete outranks everything else', () => {
    const { reaction } = react({ outcome: 'ok', done: 8, denominator: 8 });
    expect(reaction.rule).toBe('set-complete');
    expect(reaction.tone).toBe('moment');
  });

  it('combo fires at 3 and then every 3', () => {
    let memory = EMPTY_REACTION_MEMORY;
    const rules: string[] = [];
    for (let done = 1; done <= 7; done++) {
      // 90s apart so the moment cooldown never demotes.
      const result = react({ outcome: 'ok', done, denominator: 25, memory, now: T0 + done * 120_000 });
      rules.push(result.reaction.rule);
      memory = result.memory;
    }
    expect(rules[2]).toBe('combo');
    expect(rules[5]).toBe('combo');
    expect(rules[3]).not.toBe('combo');
  });

  it('a tutored outcome breaks the combo run', () => {
    let memory = EMPTY_REACTION_MEMORY;
    memory = react({ outcome: 'ok', done: 1, denominator: 25, memory }).memory;
    memory = react({ outcome: 'tutored', done: 2, denominator: 25, memory }).memory;
    expect(memory.comboRun).toBe(0);
  });

  it('suppresses halfway and near-the-end on a short set', () => {
    // 4 problems: halfway would fire at 2, near-end at 3.
    expect(react({ outcome: 'ok', done: 2, denominator: 4 }).reaction.rule).not.toBe('halfway');
    expect(react({ outcome: 'ok', done: 3, denominator: 4 }).reaction.rule).not.toBe('near-end');
    // 6 problems: both are back on.
    expect(react({ outcome: 'ok', done: 3, denominator: 6 }).reaction.rule).toBe('halfway');
  });

  it('demotes a cooled-down moment to a whisper rather than dropping it', () => {
    // Two `ok` already banked, so this tap completes a run of 3 -- a combo,
    // which is a moment, arriving inside the cooldown of a previous one.
    const memory = { ...EMPTY_REACTION_MEMORY, comboRun: 2, lastMomentAt: T0, momentsFired: 1 };
    const { reaction } = react({
      outcome: 'ok',
      done: 3,
      denominator: 25,
      memory,
      now: T0 + MOMENT_COOLDOWN_MS - 1_000,
    });
    expect(reaction.rule).toBe('combo');
    expect(reaction.tone).toBe('whisper');
    expect(reaction.text.length).toBeGreaterThan(0);
  });

  it('caps moments per session, and set-complete is exempt', () => {
    const spent = { ...EMPTY_REACTION_MEMORY, momentsFired: MAX_MOMENTS_PER_SESSION };
    expect(react({ outcome: 'ok', done: 3, denominator: 25, memory: spent, now: T0 }).reaction.tone).toBe(
      'whisper',
    );
    expect(react({ outcome: 'ok', done: 8, denominator: 8, memory: spent, now: T0 }).reaction.tone).toBe(
      'moment',
    );
  });

  it('names the effort when a problem took well over the median', () => {
    const { reaction } = react({
      outcome: 'ok',
      done: 5,
      denominator: 25,
      seconds: 360,
      priorSeconds: [60, 55, 65, 60],
      // combo would otherwise win; spend the budget so it demotes past effort.
      memory: { ...EMPTY_REACTION_MEMORY, comboRun: 0, combosFired: 99 },
    });
    expect(reaction.rule).toBe('effort');
    expect(reaction.text).toContain('6 minutes');
  });

  it('acknowledges a shaky in the review tone', () => {
    const { reaction } = react({ outcome: 'shaky', done: 2, denominator: 25 });
    expect(reaction.rule).toBe('shaky');
    expect(reaction.tone).toBe('review');
  });

  it('rotates phrasing rather than repeating one line', () => {
    let memory = EMPTY_REACTION_MEMORY;
    const seen = new Set<string>();
    for (let done = 1; done <= 3; done++) {
      const result = react({ outcome: 'shaky', done, denominator: 25, memory });
      seen.add(result.reaction.text);
      memory = result.memory;
    }
    expect(seen.size).toBe(3);
  });
});

// ---- §4 voice/text parity ------------------------------------------------

describe('voice and text parity (spec §4, §10)', () => {
  it('maps the three words and their reasonable synonyms', () => {
    expect(parseCompletionUtterance('done')).toBe('ok');
    expect(parseCompletionUtterance('got it')).toBe('ok');
    expect(parseCompletionUtterance('next')).toBe('ok');
    expect(parseCompletionUtterance('shaky')).toBe('shaky');
    expect(parseCompletionUtterance('not sure')).toBe('shaky');
    expect(parseCompletionUtterance('stuck')).toBe('tutored');
    expect(parseCompletionUtterance('no idea')).toBe('tutored');
    expect(parseCompletionUtterance('help')).toBe('tutored');
  });

  it('prefers the help/shaky reading over an affirmative token inside it', () => {
    expect(parseCompletionUtterance('got it but not sure')).toBe('shaky');
    expect(parseCompletionUtterance("done but I'm stuck")).toBe('tutored');
  });

  it('leaves a real question alone so it reaches the tutor', () => {
    expect(parseCompletionUtterance('why does the sign flip when I distribute this')).toBeNull();
    expect(parseCompletionUtterance('')).toBeNull();
  });

  it('drops the correctness claim when the page has no answer key', () => {
    expect(trioLabels(true).ok).toBe('Got it');
    expect(trioLabels(false).ok).toBe('Done');
    expect(trioLabels(false).stuck).toBe('Stuck');
  });
});

// ---- §6 + §8 summary -----------------------------------------------------

describe('summary — honest scope (spec §8)', () => {
  it('never implies it graded a set on a page with no answer key', () => {
    let current = session(3, { graded: false });
    current = recordTap(current, { outcome: 'ok', now: T0 + 1000 }).session;
    current = recordTap(current, { outcome: 'ok', now: T0 + 2000 }).session;
    current = recordTap(current, { outcome: 'ok', now: T0 + 3000 }).session;
    const line = scopeLine(current);
    expect(line).toContain('No answer key here');
    expect(line).toContain('you marked done yourself');
  });

  it('says what the page checked when the page can check', () => {
    let current = session(2, { graded: true });
    current = recordTap(current, { outcome: 'ok', now: T0 + 1000 }).session;
    current = recordTap(current, { outcome: 'tutored', now: T0 + 2000 }).session;
    expect(scopeLine(current)).toContain('worked together');
  });
});

describe('summary — the page-grade conflict (spec §6)', () => {
  it('surfaces a "got it" the page marked wrong, once, gently', () => {
    let current = session(2, { graded: true });
    current = recordTap(current, { outcome: 'ok', now: T0 + 1000, pageGrade: 'incorrect' }).session;
    current = recordTap(current, { outcome: 'ok', now: T0 + 2000, pageGrade: 'correct' }).session;
    const line = mismatchLine(current);
    expect(line).toContain('Worth one more look');
    expect(line).not.toMatch(/wrong answer|you were wrong|incorrectly/i);
    // The bar did not retreat: both taps still counted.
    expect(current.completed).toHaveLength(2);
  });

  it('says nothing about the inverse case', () => {
    let current = session(1, { graded: true });
    current = recordTap(current, { outcome: 'shaky', now: T0 + 1000, pageGrade: 'correct' }).session;
    expect(mismatchLine(current)).toBeNull();
  });
});

describe('summary — totals', () => {
  it('reports the confidence breakdown and the longest unaided run', () => {
    let current = session(4);
    current = recordTap(current, { outcome: 'ok', now: T0 + 60_000 }).session;
    current = recordTap(current, { outcome: 'ok', now: T0 + 120_000 }).session;
    current = recordTap(current, { outcome: 'tutored', now: T0 + 180_000 }).session;
    current = recordTap(current, { outcome: 'shaky', now: T0 + 240_000 }).session;
    const summary = buildSummary(current, [], T0 + 240_000);
    expect(summary.counts).toEqual({ ok: 2, shaky: 1, tutored: 1 });
    expect(summary.longestRun).toBe(2);
    expect(summary.totalMinutes).toBe(4);
    // No history: no self-comparison invented.
    expect(summary.comparisonLine).toBeNull();
  });
});
