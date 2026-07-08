// Pins the ping system's pure display logic (design handoff 8b: sixteen+
// signals, three tones; pings.ts) -- the kind→tone map, the milestone
// gate, and the marker copy.
import { describe, expect, it } from 'vitest';
import type { StatusPinKind } from '../src/types/messages';
import { MILESTONE_KINDS, PIN_TONE, milestoneLine } from '../src/overlay/pings';

// The full kind set, mirrored from types/messages.ts -- a new kind added
// there without a tone here fails the completeness check below (and the
// Record type already fails the build).
const ALL_KINDS: StatusPinKind[] = [
  'prediction-confirmed',
  'misconception-detected',
  'pattern-detected',
  'pattern-broken',
  'streak-progress',
  'concept-understood',
  'progress',
  'final-step',
  'teaching-visual',
  'teaching-decompose',
  'pace-up',
  'guidance-up',
  'guidance-down',
  'difficulty-up',
  'difficulty-down',
  'callback',
  'due-review',
  'confidence-up',
  'self-caught',
];

describe('PIN_TONE — every kind maps to one of the three tones', () => {
  it('covers the full kind set', () => {
    for (const kind of ALL_KINDS) {
      expect(['positive', 'adjust', 'watch']).toContain(PIN_TONE[kind]);
    }
  });

  it('watch-outs are exactly the recorded-trouble kinds (the 8b amber set)', () => {
    const watch = ALL_KINDS.filter((kind) => PIN_TONE[kind] === 'watch').sort();
    expect(watch).toEqual(['misconception-detected', 'pattern-detected', 'prediction-confirmed']);
  });

  it('tone is a KIND property, not a category one — the guidance pair splits', () => {
    expect(PIN_TONE['guidance-up']).toBe('adjust');
    expect(PIN_TONE['guidance-down']).toBe('positive');
    expect(PIN_TONE['difficulty-up']).toBe('positive');
    expect(PIN_TONE['difficulty-down']).toBe('adjust');
  });
});

describe('MILESTONE_KINDS — which pins also settle into the transcript', () => {
  it('is exactly the three the design board shows', () => {
    expect([...MILESTONE_KINDS].sort()).toEqual(['concept-understood', 'misconception-detected', 'pattern-broken']);
  });

  it('every milestone kind renders in a non-adjust tone (a marker is a win or a watch-out)', () => {
    for (const kind of MILESTONE_KINDS) {
      expect(PIN_TONE[kind]).not.toBe('adjust');
    }
  });
});

describe('milestoneLine — the marker copy', () => {
  it("turns the server label's first colon separator into the design's middle dot", () => {
    expect(milestoneLine({ label: 'Pattern broken: sign errors' })).toBe('Pattern broken · sign errors');
  });

  it('leaves a colon-less label untouched, and only converts the FIRST separator', () => {
    expect(milestoneLine({ label: 'Key concept understood' })).toBe('Key concept understood');
    expect(milestoneLine({ label: 'Noted: ratio: parts vs wholes' })).toBe('Noted · ratio: parts vs wholes');
  });
});
