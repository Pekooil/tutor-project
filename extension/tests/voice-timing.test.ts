// @vitest-environment jsdom
//
// Sprint 15 Task 8: pure-helper spec for the mic cold-start state machine
// (Task 5) and the TTS reveal-pacing math (Task 6), both extracted verbatim
// from Overlay.tsx into voice-timing.ts for exactly this reason -- no real
// getUserMedia, MediaSource, or <audio> element anywhere here, same jsdom
// convention as overlay-display.test.ts.
import { describe, expect, it } from 'vitest';
import {
  createSentenceAccumulator,
  micStateReducer,
  wordsDueByTime,
  type MicState,
} from '../src/overlay/voice-timing';

describe('micStateReducer (ADR-033 Task 5, the connecting→listening state machine)', () => {
  it('click moves idle to connecting', () => {
    expect(micStateReducer('idle', 'click')).toBe('connecting');
  });

  it('capture-started moves connecting to recording', () => {
    expect(micStateReducer('connecting', 'capture-started')).toBe('recording');
  });

  it('capture-failed moves connecting back to idle -- never stuck "connecting"', () => {
    expect(micStateReducer('connecting', 'capture-failed')).toBe('idle');
  });

  it('stop moves recording back to idle', () => {
    expect(micStateReducer('recording', 'stop')).toBe('idle');
  });

  it('connecting and recording are never simultaneously reachable from one action', () => {
    // From idle, only 'click' has an effect; from connecting, only
    // 'capture-started'/'capture-failed'; from recording, only 'stop' --
    // every other (state, action) pair below is a no-op, which is the
    // "one honest state at a time" contract Overlay.tsx's comment names.
    const noops: Array<[MicState, Parameters<typeof micStateReducer>[1]]> = [
      ['idle', 'capture-started'],
      ['idle', 'capture-failed'],
      ['idle', 'stop'],
      ['connecting', 'click'],
      ['connecting', 'stop'],
      ['recording', 'click'],
      ['recording', 'capture-started'],
      ['recording', 'capture-failed'],
    ];
    for (const [state, action] of noops) {
      expect(micStateReducer(state, action)).toBe(state);
    }
  });

  it('a click already in progress is idempotent (a second click while connecting changes nothing)', () => {
    const afterFirst = micStateReducer('idle', 'click');
    expect(micStateReducer(afterFirst, 'click')).toBe(afterFirst);
  });
});

describe('wordsDueByTime (ADR-033 Task 6, timeupdate-driven reveal pacing)', () => {
  const MS_PER_WORD = 320;

  it('reveals the first word immediately at currentTime 0 -- never a silent gap before word one', () => {
    expect(wordsDueByTime(0, MS_PER_WORD, 10)).toBe(1);
  });

  it('reveals more words as time advances, one word per MS_PER_WORD', () => {
    expect(wordsDueByTime(MS_PER_WORD, MS_PER_WORD, 10)).toBe(2);
    expect(wordsDueByTime(MS_PER_WORD * 3, MS_PER_WORD, 10)).toBe(4);
  });

  it('never exceeds totalWords even with a very large elapsed time', () => {
    expect(wordsDueByTime(MS_PER_WORD * 1000, MS_PER_WORD, 10)).toBe(10);
  });

  it('self-corrects for a stall — the same currentTime always yields the same due count (no drift accumulation)', () => {
    // currentTime literally stops advancing during a network stall; calling
    // this twice at the same currentTime must be idempotent, which is the
    // whole reason this is currentTime-driven rather than a wall-clock
    // setInterval (which would keep ticking through the stall).
    expect(wordsDueByTime(1000, MS_PER_WORD, 10)).toBe(wordsDueByTime(1000, MS_PER_WORD, 10));
  });

  it('returns 0 for zero total words (an empty reply never reveals a phantom word)', () => {
    expect(wordsDueByTime(5000, MS_PER_WORD, 0)).toBe(0);
  });
});

describe('createSentenceAccumulator (ADR-033 amendment — per-sentence TTS off the streamed say)', () => {
  // Feeds say-deltas in arbitrary splits and returns [emittedSentences, remainder].
  function run(deltas: string[]): [string[], string | null] {
    const acc = createSentenceAccumulator();
    const emitted: string[] = [];
    for (const d of deltas) emitted.push(...acc.push(d));
    return [emitted, acc.flush()];
  }

  it('emits a sentence as soon as its terminating punctuation + space arrives', () => {
    const acc = createSentenceAccumulator();
    expect(acc.push('Great question')).toEqual([]);
    expect(acc.push('. ')).toEqual(['Great question.']); // completed by the ". "
    expect(acc.push('What is next')).toEqual([]); // no boundary yet
  });

  it('splits a multi-sentence reply arriving in one delta into separate sentences', () => {
    const [emitted, remainder] = run(['First. Second! Third? ']);
    expect(emitted).toEqual(['First.', 'Second!', 'Third?']);
    expect(remainder).toBeNull();
  });

  it('reconstructs across boundary-straddling fragments (punct in one delta, space in the next)', () => {
    const [emitted] = run(['The outer function', ' is u to the fifth.', ' Now differentiate it.', ' ']);
    expect(emitted).toEqual(['The outer function is u to the fifth.', 'Now differentiate it.']);
  });

  it('flush() returns the trailing sentence that never got terminating whitespace', () => {
    const acc = createSentenceAccumulator();
    expect(acc.push('Try factoring x squared plus five x plus six.')).toEqual([]); // no trailing space
    expect(acc.flush()).toBe('Try factoring x squared plus five x plus six.');
  });

  it('does NOT split a decimal (no whitespace after the dot) — keeps it in one segment', () => {
    const acc = createSentenceAccumulator();
    const emitted = acc.push('Pi is about 3.14 here. ');
    expect(emitted).toEqual(['Pi is about 3.14 here.']);
  });

  it('the concatenation of all emitted sentences + remainder recovers the full say (modulo whitespace)', () => {
    const deltas = ['Look at ', '5t^2 and 8t^2. ', 'Can you add ', 'them together?', ' Then simplify'];
    const [emitted, remainder] = run(deltas);
    const rebuilt = [...emitted, remainder].filter(Boolean).join(' ');
    const original = deltas.join('').replace(/\s+/g, ' ').trim();
    expect(rebuilt).toBe(original);
  });

  it('flush() returns null when everything was already emitted', () => {
    const acc = createSentenceAccumulator();
    acc.push('Done. ');
    expect(acc.flush()).toBeNull();
  });
});
