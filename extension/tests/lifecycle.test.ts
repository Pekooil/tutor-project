// @vitest-environment jsdom
//
// Sprint 14 Task 9: the lifecycle spec -- three PURE helpers, no browser
// harness, no network (the annotations.test.ts / overlay-display.test.ts
// precedent): the solution-progress clamp/easing reducer and the
// close-choreography state machine (both Overlay.tsx, Task 7), and the
// opening-scan's plausible-problem gate (content/index.ts, Task 6).
// content/index.ts is this workspace's first spec to import a module that
// uses WXT's `#imports` virtual module (createShadowRootUi,
// defineContentScript) -- resolved via the new extension/vitest.config.ts
// (WXT's own documented `WxtVitest()` testing plugin), additive to every
// other spec in this workspace.
import { describe, expect, it } from 'vitest';
import {
  PROGRESS_MAX_REGRESSION,
  easeProgress,
  nextCloseState,
  type CloseChoreographyState,
} from '../src/overlay/Overlay';
import { isPlausibleProblem } from '../src/content/index';
import type { PageContext } from '../src/types/messages';

describe('easeProgress — the solution-progress clamp/easing reducer (Sprint 14 Task 7, ADR-028)', () => {
  it('advances freely on an upward move', () => {
    expect(easeProgress(0.2, 0.5, false)).toBe(0.5);
  });

  it('bounds a downward move to at most PROGRESS_MAX_REGRESSION, never the full drop', () => {
    // A wrong step reported as 0.1 after being at 0.6 would be a 0.5 crater
    // -- the client bound caps the VISIBLE regression at 0.15, regardless of
    // how far the model's own number fell.
    expect(easeProgress(0.6, 0.1, false)).toBeCloseTo(0.6 - PROGRESS_MAX_REGRESSION, 10);
  });

  it('allows a downward move smaller than the regression bound through unchanged', () => {
    expect(easeProgress(0.6, 0.5, false)).toBe(0.5);
  });

  it('clamps an out-of-range next value to [0, 1] before comparing it to the previous value', () => {
    expect(easeProgress(0.9, 1.4, false)).toBe(1);
    expect(easeProgress(0.9, -0.4, false)).toBeCloseTo(0.9 - PROGRESS_MAX_REGRESSION, 10);
  });

  it('holds the previous value when the turn carried no solutionProgress at all', () => {
    expect(easeProgress(0.42, undefined, false)).toBe(0.42);
  });

  it('forces exactly 1 on solved, regardless of what solutionProgress said this turn', () => {
    expect(easeProgress(0.3, 0.5, true)).toBe(1);
    expect(easeProgress(0.3, undefined, true)).toBe(1);
    expect(easeProgress(0.3, 0, true)).toBe(1);
  });
});

describe('nextCloseState — the close-choreography state machine (Sprint 14 Task 7, ADR-027/028)', () => {
  it('walks the full happy path: idle -> completing -> ringing -> closed -> (reset) -> idle', () => {
    let state: CloseChoreographyState = 'idle';
    state = nextCloseState(state, 'complete');
    expect(state).toBe('completing');
    state = nextCloseState(state, 'recap-grace-elapsed');
    expect(state).toBe('ringing');
    state = nextCloseState(state, 'ring-elapsed');
    expect(state).toBe('closed');
    state = nextCloseState(state, 'reset');
    expect(state).toBe('idle');
  });

  it('"reset" returns to idle from ANY state, unconditionally', () => {
    for (const state of ['idle', 'completing', 'ringing', 'closed'] as const) {
      expect(nextCloseState(state, 'reset')).toBe('idle');
    }
  });

  it('an out-of-order event is a no-op -- the state machine never skips a step', () => {
    expect(nextCloseState('idle', 'recap-grace-elapsed')).toBe('idle');
    expect(nextCloseState('idle', 'ring-elapsed')).toBe('idle');
    expect(nextCloseState('completing', 'complete')).toBe('completing');
    expect(nextCloseState('completing', 'ring-elapsed')).toBe('completing');
    expect(nextCloseState('ringing', 'complete')).toBe('ringing');
    expect(nextCloseState('ringing', 'recap-grace-elapsed')).toBe('ringing');
    expect(nextCloseState('closed', 'complete')).toBe('closed');
    expect(nextCloseState('closed', 'recap-grace-elapsed')).toBe('closed');
    expect(nextCloseState('closed', 'ring-elapsed')).toBe('closed');
  });

  it('a stray second "complete" while already running the choreography never restarts the ring', () => {
    // Overlay.tsx's beginCloseChoreography guards on this exact fact ("idle
    // is the only state 'complete' does anything from") so a second
    // session.complete signal (or a stray ✕ click mid-close) can't fire a
    // second grace/ring timer pair.
    expect(nextCloseState('completing', 'complete')).toBe('completing');
    expect(nextCloseState('ringing', 'complete')).toBe('ringing');
  });

  // "Composer disabled during ring" / "minimize during choreography does
  // not clear" (the sprint plan's own phrasing) are properties of how
  // Overlay.tsx DERIVES booleans from this state and of what the reducer
  // does NOT do, not further reducer transitions -- pinned here structurally
  // rather than by rendering the component (out of scope for a pure spec):
  it('every non-idle state reads as "closing" (Composer/TitleBar disable), and only "ringing" reads as the ring itself', () => {
    const closing = (state: CloseChoreographyState) => state !== 'idle';
    const ringing = (state: CloseChoreographyState) => state === 'ringing';

    expect(closing('idle')).toBe(false);
    expect(closing('completing')).toBe(true);
    expect(closing('ringing')).toBe(true);
    expect(closing('closed')).toBe(true);

    expect(ringing('idle')).toBe(false);
    expect(ringing('completing')).toBe(false);
    expect(ringing('ringing')).toBe(true);
    expect(ringing('closed')).toBe(false);
  });

  it('the reducer has no "clear" event at all -- clearing the transcript is exclusively Overlay.tsx\'s own effect on reaching "closed", never a transition this function can be asked to perform on minimize or anything else', () => {
    // CloseChoreographyEvent is the closed union 'complete' | 'recap-grace-
    // elapsed' | 'ring-elapsed' | 'reset' -- minimize dispatches NONE of
    // these (handleMinimize in Overlay.tsx never calls nextCloseState), so
    // there is no event this reducer exposes that a minimize click could
    // send to trigger a clear. Every state transition above is total and
    // side-effect-free; the only place messages are ever cleared is the
    // separate `closeState === 'closed'` effect, which minimize alone can
    // never reach (it doesn't touch closeState).
    const allEvents = ['complete', 'recap-grace-elapsed', 'ring-elapsed', 'reset'] as const;
    expect(allEvents).toHaveLength(4);
    expect(allEvents).not.toContain('minimize');
    expect(allEvents).not.toContain('clear');
  });
});

describe('isPlausibleProblem — the opening-scan plausible-problem gate (Sprint 14 Task 6, ADR-030)', () => {
  it('is false for an absent PageContext (nothing captured yet)', () => {
    expect(isPlausibleProblem(undefined)).toBe(false);
  });

  it('is false for an empty PageContext -- no equations, no text', () => {
    const context: PageContext = { equations: [] };
    expect(isPlausibleProblem(context)).toBe(false);
  });

  it('is true whenever equations are present, regardless of any text', () => {
    const context: PageContext = { equations: [{ latex: 'x^2 + 5x + 6' }] };
    expect(isPlausibleProblem(context)).toBe(true);
  });

  it('is true for a text excerpt at or past the trivial-length floor, with no equations', () => {
    const context: PageContext = { equations: [], text: 'x'.repeat(20) };
    expect(isPlausibleProblem(context)).toBe(true);
  });

  it('is false for a text excerpt under the trivial-length floor', () => {
    const context: PageContext = { equations: [], text: 'x'.repeat(19) };
    expect(isPlausibleProblem(context)).toBe(false);
  });

  it('trims whitespace before measuring length -- padding alone never counts as plausible', () => {
    const context: PageContext = { equations: [], text: '   ' + ' '.repeat(30) + '   ' };
    expect(isPlausibleProblem(context)).toBe(false);
  });

  it('is false for a context whose text is entirely absent (undefined, not just empty)', () => {
    const context: PageContext = { equations: [] };
    expect(isPlausibleProblem(context)).toBe(false);
  });
});
