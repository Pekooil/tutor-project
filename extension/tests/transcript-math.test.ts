// Sprint 15 fix pass: splitMathBlocks (Transcript.tsx) -- the ChatGPT-style
// math layout's pure segmentation function (prose runs vs. $$ math blocks) --
// and stripMathDelimiters (Overlay.tsx) -- the companion strip applied to
// every transient consumer of the raw `say` text (stream tokens, the voice
// word reveal, the text handed to TTS). Both are pure string functions,
// testable without a browser (the transcript-highlight.test.ts precedent).
import { describe, expect, it } from 'vitest';
import { splitMathBlocks, tokenizeMathText } from '../src/overlay/Transcript';
import { stripMathDelimiters } from '../src/overlay/Overlay';

describe('splitMathBlocks — the $$ math-block segmentation (Sprint 15 fix pass)', () => {
  it('a reply with no math blocks is one prose run, untouched', () => {
    expect(splitMathBlocks('Great work! What comes next?')).toEqual([
      { kind: 'text', text: 'Great work! What comes next?' },
    ]);
  });

  it('a mid-reply block splits into prose / math / prose, whitespace around the block trimmed', () => {
    expect(splitMathBlocks('Combine the terms: $$5t^2 + 8t^2 = 13t^2$$ Now the t terms?')).toEqual([
      { kind: 'text', text: 'Combine the terms:' },
      { kind: 'math', text: '5t^2 + 8t^2 = 13t^2' },
      { kind: 'text', text: 'Now the t terms?' },
    ]);
  });

  it('the math text itself is trimmed inside the delimiters', () => {
    expect(splitMathBlocks('$$  x = 2  $$')).toEqual([{ kind: 'math', text: 'x = 2' }]);
  });

  it('blocks at the very start and very end produce no empty prose runs', () => {
    expect(splitMathBlocks('$$2x + 3 = 11$$ Subtract 3 from both sides. $$2x = 8$$')).toEqual([
      { kind: 'math', text: '2x + 3 = 11' },
      { kind: 'text', text: 'Subtract 3 from both sides.' },
      { kind: 'math', text: '2x = 8' },
    ]);
  });

  it('consecutive blocks with only whitespace between them yield no empty prose run', () => {
    expect(splitMathBlocks('$$a = 1$$\n$$b = 2$$')).toEqual([
      { kind: 'math', text: 'a = 1' },
      { kind: 'math', text: 'b = 2' },
    ]);
  });

  it('an unpaired $$ stays in the prose rather than being guessed at', () => {
    expect(splitMathBlocks('That costs $$ a lot')).toEqual([{ kind: 'text', text: 'That costs $$ a lot' }]);
  });

  it('an empty block ($$ $$) is dropped entirely', () => {
    expect(splitMathBlocks('Before $$   $$ after')).toEqual([
      { kind: 'text', text: 'Before' },
      { kind: 'text', text: 'after' },
    ]);
  });

  it('newlines around a block are trimmed (the block supplies its own margin under pre-wrap)', () => {
    expect(splitMathBlocks('Start here:\n$$y = mx + b$$\nWhat is m?')).toEqual([
      { kind: 'text', text: 'Start here:' },
      { kind: 'math', text: 'y = mx + b' },
      { kind: 'text', text: 'What is m?' },
    ]);
  });
});

describe('tokenizeMathText — calculator notation rendered as real math (Sprint 15 fix pass, round 2)', () => {
  it('renders ^ exponents as sup tokens (bare, negative, parenthesized, braced)', () => {
    expect(tokenizeMathText('x^2 + y^-1 + 2^(n+1) + a^{2k}')).toEqual([
      { kind: 'text', text: 'x' },
      { kind: 'sup', text: '2' },
      { kind: 'text', text: ' + y' },
      { kind: 'sup', text: '-1' },
      { kind: 'text', text: ' + 2' },
      { kind: 'sup', text: 'n+1' },
      { kind: 'text', text: ' + a' },
      { kind: 'sup', text: '2k' },
    ]);
  });

  it('prettifies sqrt/pi/theta and comparison/plus-minus operators into real symbols', () => {
    expect(tokenizeMathText('sqrt(x) <= pi and theta != 0, x = +-2')).toEqual([
      { kind: 'text', text: '√(x) ≤ π and θ ≠ 0, x = ±2' },
    ]);
  });

  it('renders * as an interpunct with tight spacing', () => {
    expect(tokenizeMathText('2 * x*y')).toEqual([{ kind: 'text', text: '2 · x · y' }]);
  });

  it('leaves everything unrecognized verbatim — never a guessed transformation', () => {
    expect(tokenizeMathText('(x + 2)(x + 3) = 0')).toEqual([{ kind: 'text', text: '(x + 2)(x + 3) = 0' }]);
  });

  it('does not treat sqrt/pi inside longer words as symbols', () => {
    expect(tokenizeMathText('spice')).toEqual([{ kind: 'text', text: 'spice' }]);
    expect(tokenizeMathText('pin')).toEqual([{ kind: 'text', text: 'pin' }]);
  });
});

describe('stripMathDelimiters — the transient-surface strip (Sprint 15 fix pass)', () => {
  it('removes paired $$ delimiters, keeping the math itself', () => {
    expect(stripMathDelimiters('Combine: $$5t^2 + 8t^2 = 13t^2$$ done.')).toBe('Combine: 5t^2 + 8t^2 = 13t^2 done.');
  });

  it('removes a lone $ too, so a delimiter split across two stream deltas cannot leak half of itself', () => {
    expect(stripMathDelimiters('$')).toBe('');
    expect(stripMathDelimiters('$$2x')).toBe('2x');
  });

  it('leaves text without delimiters untouched', () => {
    expect(stripMathDelimiters('no math here')).toBe('no math here');
  });
});
