// Pins the tutor-mode transition table (design handoff 8c -- the mode is
// derived CLIENT-SIDE from each turn's own signals; tutor-modes.ts) plus
// the header's stage label and clock formatting. Pure functions, no
// DOM/mocks -- the session-flow.test.ts precedent.
import { describe, expect, it } from 'vitest';
import type { StatusPinKind } from '../src/types/messages';
import {
  STAGE_2_THRESHOLD,
  STAGE_3_THRESHOLD,
  TUTOR_MODES,
  deriveTutorMode,
  formatElapsed,
  stageLabel,
  type TurnSignal,
} from '../src/overlay/tutor-modes';

function signal(overrides: Partial<TurnSignal> & { kinds?: StatusPinKind[] } = {}): TurnSignal {
  const { kinds = [], ...rest } = overrides;
  return {
    pins: kinds.map((kind) => ({ kind })),
    missStreak: 0,
    advanceStreak: 0,
    progress: 0,
    complete: false,
    ...rest,
  };
}

describe('TUTOR_MODES — the eight-mode catalog', () => {
  it('carries all eight modes, keyed consistently', () => {
    const keys = Object.keys(TUTOR_MODES).sort();
    expect(keys).toEqual(['build', 'challenge', 'coach', 'explore', 'practice', 'recover', 'review', 'verify']);
    for (const [key, mode] of Object.entries(TUTOR_MODES)) {
      expect(mode.key).toBe(key);
      expect(mode.name.length).toBeGreaterThan(0);
      expect(mode.glyph.length).toBeGreaterThan(0);
    }
  });
});

describe('deriveTutorMode — the transition table', () => {
  it('a signal-less turn keeps the current mode (the session idles at Explore)', () => {
    expect(deriveTutorMode('explore', signal())).toBe('explore');
    expect(deriveTutorMode('coach', signal())).toBe('coach');
  });

  it('a misconception pulls into Coach ("a misconception fires or hints ramp up")', () => {
    expect(deriveTutorMode('explore', signal({ kinds: ['misconception-detected'] }))).toBe('coach');
    expect(deriveTutorMode('practice', signal({ kinds: ['guidance-up'] }))).toBe('coach');
    expect(deriveTutorMode('build', signal({ kinds: ['prediction-confirmed'] }))).toBe('coach');
    expect(deriveTutorMode('explore', signal({ kinds: ['teaching-decompose'] }))).toBe('coach');
    expect(deriveTutorMode('explore', signal({ kinds: ['difficulty-down'] }))).toBe('coach');
  });

  it('a key concept landing enters Build', () => {
    expect(deriveTutorMode('coach', signal({ kinds: ['concept-understood'] }))).toBe('build');
  });

  it('a broken pattern or guidance easing off enters Practice', () => {
    expect(deriveTutorMode('build', signal({ kinds: ['pattern-broken'] }))).toBe('practice');
    expect(deriveTutorMode('coach', signal({ kinds: ['guidance-down'] }))).toBe('practice');
  });

  it('a level-up enters Challenge; the final step enters Verify', () => {
    expect(deriveTutorMode('practice', signal({ kinds: ['difficulty-up'] }))).toBe('challenge');
    expect(deriveTutorMode('practice', signal({ kinds: ['final-step'] }))).toBe('verify');
  });

  it('two misses in a row force the Recover soft reset, over any other signal except completion', () => {
    expect(deriveTutorMode('practice', signal({ missStreak: 2 }))).toBe('recover');
    expect(deriveTutorMode('practice', signal({ missStreak: 2, kinds: ['concept-understood'] }))).toBe('recover');
    // One miss alone never triggers it.
    expect(deriveTutorMode('practice', signal({ missStreak: 1 }))).toBe('practice');
  });

  it('a completing turn is Reviewing no matter what else fired', () => {
    expect(deriveTutorMode('verify', signal({ complete: true }))).toBe('review');
    expect(deriveTutorMode('coach', signal({ complete: true, missStreak: 2, kinds: ['misconception-detected'] }))).toBe(
      'review',
    );
  });

  it('one turn carrying several signals lands on the most significant (earned over corrective)', () => {
    // concept-understood (build) + misconception-detected (coach): build wins.
    expect(deriveTutorMode('explore', signal({ kinds: ['misconception-detected', 'concept-understood'] }))).toBe('build');
    // pattern-broken (practice) outranks concept-understood (build).
    expect(deriveTutorMode('coach', signal({ kinds: ['concept-understood', 'pattern-broken'] }))).toBe('practice');
    // final-step (verify) outranks difficulty-up (challenge).
    expect(deriveTutorMode('practice', signal({ kinds: ['difficulty-up', 'final-step'] }))).toBe('verify');
  });

  it('the design walk holds: Explore → Coach → Build → Practice → Verify → Review', () => {
    let mode = deriveTutorMode('explore', signal({ kinds: ['misconception-detected'] }));
    expect(mode).toBe('coach');
    mode = deriveTutorMode(mode, signal({ kinds: ['concept-understood'] }));
    expect(mode).toBe('build');
    mode = deriveTutorMode(mode, signal({ kinds: ['pattern-broken'] }));
    expect(mode).toBe('practice');
    mode = deriveTutorMode(mode, signal({ kinds: ['final-step'] }));
    expect(mode).toBe('verify');
    mode = deriveTutorMode(mode, signal({ complete: true }));
    expect(mode).toBe('review');
  });

  // ---- Momentum transitions (2026-07-18): quiet turns follow the solution
  // arc instead of idling in Explore / sticking in Coach ----
  describe('momentum on signal-less turns', () => {
    it('two advancing steps climb Explore into Build even with no pin', () => {
      expect(deriveTutorMode('explore', signal({ advanceStreak: 2, progress: 0.2 }))).toBe('build');
    });

    it('one advancing step climbs OUT of the corrective modes (coach/recover → build)', () => {
      expect(deriveTutorMode('coach', signal({ advanceStreak: 1, progress: 0.3 }))).toBe('build');
      expect(deriveTutorMode('recover', signal({ advanceStreak: 1, progress: 0.3 }))).toBe('build');
    });

    it('sustained advance past mid-solution enters Practice', () => {
      expect(deriveTutorMode('build', signal({ advanceStreak: 2, progress: STAGE_2_THRESHOLD }))).toBe('practice');
      expect(deriveTutorMode('explore', signal({ advanceStreak: 2, progress: 0.5 }))).toBe('practice');
    });

    it('the final stretch is Verify regardless of current mode', () => {
      expect(deriveTutorMode('practice', signal({ progress: STAGE_3_THRESHOLD }))).toBe('verify');
      expect(deriveTutorMode('explore', signal({ progress: 0.9 }))).toBe('verify');
    });

    it('explicit pins still OUTRANK momentum (a misconception at 90% is Coaching, not Verifying)', () => {
      expect(
        deriveTutorMode('practice', signal({ kinds: ['misconception-detected'], advanceStreak: 2, progress: 0.9 })),
      ).toBe('coach');
      expect(deriveTutorMode('explore', signal({ missStreak: 2, progress: 0.9 }))).toBe('recover');
    });

    it('a genuinely quiet turn (no streak, low progress) still keeps the current mode', () => {
      expect(deriveTutorMode('explore', signal({ advanceStreak: 0, progress: 0.2 }))).toBe('explore');
      expect(deriveTutorMode('build', signal({ advanceStreak: 1, progress: 0.3 }))).toBe('build');
    });

    it('the momentum walk holds without a single model signal: Explore → Build → Practice → Verify', () => {
      let mode: ReturnType<typeof deriveTutorMode> = 'explore';
      mode = deriveTutorMode(mode, signal({ advanceStreak: 2, progress: 0.25 }));
      expect(mode).toBe('build');
      mode = deriveTutorMode(mode, signal({ advanceStreak: 3, progress: 0.5 }));
      expect(mode).toBe('practice');
      mode = deriveTutorMode(mode, signal({ advanceStreak: 4, progress: 0.88 }));
      expect(mode).toBe('verify');
      mode = deriveTutorMode(mode, signal({ complete: true, progress: 1 }));
      expect(mode).toBe('review');
    });
  });
});

describe('stageLabel — the header subtitle stage (thirds of the eased progress)', () => {
  it('walks the three stages by threshold', () => {
    expect(stageLabel(0, false)).toBe('Stage 1 of 3');
    expect(stageLabel(STAGE_2_THRESHOLD - 0.01, false)).toBe('Stage 1 of 3');
    expect(stageLabel(STAGE_2_THRESHOLD, false)).toBe('Stage 2 of 3');
    expect(stageLabel(STAGE_3_THRESHOLD - 0.01, false)).toBe('Stage 2 of 3');
    expect(stageLabel(STAGE_3_THRESHOLD, false)).toBe('Stage 3 of 3');
  });

  it('a completing session reads Stage 3 regardless of the number', () => {
    expect(stageLabel(0.1, true)).toBe('Stage 3 of 3');
  });
});

describe('formatElapsed — the header clock', () => {
  it('formats m:ss with zero-padded seconds', () => {
    expect(formatElapsed(0)).toBe('0:00');
    expect(formatElapsed(9_000)).toBe('0:09');
    expect(formatElapsed(65_000)).toBe('1:05');
    expect(formatElapsed(724_000)).toBe('12:04');
  });

  it('a negative elapsed (clock skew) clamps to 0:00 rather than going weird', () => {
    expect(formatElapsed(-5_000)).toBe('0:00');
  });
});
