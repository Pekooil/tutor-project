// @vitest-environment jsdom
//
// Sprint 15 Task 8: pure-helper spec for the mic cold-start state machine
// (Task 5) and the TTS reveal-pacing math (Task 6), both extracted verbatim
// from Overlay.tsx into voice-timing.ts for exactly this reason -- no real
// getUserMedia, MediaSource, or <audio> element anywhere here, same jsdom
// convention as overlay-display.test.ts.
import { describe, expect, it } from 'vitest';
import { micStateReducer, wordsDueByTime, type MicState } from '../src/overlay/voice-timing';

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
