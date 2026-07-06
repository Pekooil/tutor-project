// @vitest-environment jsdom
//
// Sprint 14 Task 9: highlightAnnotatedPhrases (Transcript.tsx, Task 7/ADR-029
// amendment) -- a pure function over a `say` string, a turn's annotations,
// and the shared per-turn color assignment (Overlay.tsx's
// assignAnnotationColors), so it's testable without a browser (the
// annotations.test.ts / overlay-display.test.ts precedent).
import { describe, expect, it } from 'vitest';
import { highlightAnnotatedPhrases } from '../src/overlay/Transcript';
import { assignAnnotationColors, type AnnotationColorMap } from '../src/overlay/Overlay';
import type { Annotation } from '../src/types/messages';

function textMatchAnnotation(id: string, text: string): Annotation {
  return { id, type: 'highlight', target: { kind: 'textMatch', text } };
}

describe('highlightAnnotatedPhrases — color-linked text highlighting (Sprint 14 Task 7, ADR-029 amendment)', () => {
  it('highlights an exact substring match in the annotation\'s assigned color', () => {
    const annotations = [textMatchAnnotation('a1', 'x^2 + 5x + 6')];
    const colorMap = assignAnnotationColors(annotations);

    const segments = highlightAnnotatedPhrases('Let\'s factor x^2 + 5x + 6 together.', annotations, colorMap);

    expect(segments).toEqual([
      { text: "Let's factor ", colorClass: null },
      { text: 'x^2 + 5x + 6', colorClass: 'cx-annot-text-annot-1' },
      { text: ' together.', colorClass: null },
    ]);
  });

  it('a near-miss (different case) renders as plain text, never a broken/guessed highlight', () => {
    const annotations = [textMatchAnnotation('a1', 'x^2 + 5x + 6')];
    const colorMap = assignAnnotationColors(annotations);

    const segments = highlightAnnotatedPhrases("Let's factor X^2 + 5X + 6 together.", annotations, colorMap);

    expect(segments).toEqual([{ text: "Let's factor X^2 + 5X + 6 together.", colorClass: null }]);
  });

  it('a near-miss (different whitespace) renders as plain text', () => {
    const annotations = [textMatchAnnotation('a1', 'x^2 + 5x + 6')];
    const colorMap = assignAnnotationColors(annotations);

    const segments = highlightAnnotatedPhrases("Let's factor x^2  + 5x + 6 together.", annotations, colorMap);

    expect(segments).toEqual([{ text: "Let's factor x^2  + 5x + 6 together.", colorClass: null }]);
  });

  it('multiple non-overlapping matches each get their OWN annotation\'s color, in order-assigned slots', () => {
    const annotations = [textMatchAnnotation('a1', 'x^2'), textMatchAnnotation('a2', '5x')];
    const colorMap = assignAnnotationColors(annotations);

    const segments = highlightAnnotatedPhrases('The x^2 term and the 5x term.', annotations, colorMap);

    expect(segments).toEqual([
      { text: 'The ', colorClass: null },
      { text: 'x^2', colorClass: 'cx-annot-text-annot-1' },
      { text: ' term and the ', colorClass: null },
      { text: '5x', colorClass: 'cx-annot-text-annot-2' },
      { text: ' term.', colorClass: null },
    ]);
  });

  it('a shorter candidate that is a substring of a longer one never steals the match ahead of the longer, more specific one', () => {
    // '5x' is a substring of '5x + 6' -- the longer target must win at the
    // position where both could match, per the longest-text-first ordering.
    const annotations = [textMatchAnnotation('short', '5x'), textMatchAnnotation('long', '5x + 6')];
    const colorMap = assignAnnotationColors(annotations);

    const segments = highlightAnnotatedPhrases('Consider 5x + 6 here.', annotations, colorMap);

    // Color-slot assignment is array-order-based (assignAnnotationColors),
    // independent of the match-priority ordering above: 'short' is index 0
    // -> annot-1, 'long' is index 1 -> annot-2 -- 'long' is the one that
    // actually wins the match, so its color (annot-2) is what should render.
    expect(colorMap).toEqual({ short: 'annot-1', long: 'annot-2' })
    expect(segments).toEqual([
      { text: 'Consider ', colorClass: null },
      { text: '5x + 6', colorClass: 'cx-annot-text-annot-2' },
      { text: ' here.', colorClass: null },
    ]);
  });

  it('only textMatch-kind annotations are candidates -- a selector/bbox target with a `text` field is never matched', () => {
    const annotations: Annotation[] = [
      { id: 'sel', type: 'highlight', target: { kind: 'selector', selector: '.foo', text: 'x^2' } },
    ];
    const colorMap = assignAnnotationColors(annotations);

    const segments = highlightAnnotatedPhrases('Look at x^2 here.', annotations, colorMap);

    expect(segments).toEqual([{ text: 'Look at x^2 here.', colorClass: null }]);
  });

  it('an annotation missing from the color map (no assigned slot) is never matched, rather than guessing a color', () => {
    const annotations = [textMatchAnnotation('a1', 'x^2')];
    const emptyColorMap: AnnotationColorMap = {};

    const segments = highlightAnnotatedPhrases('The x^2 term.', annotations, emptyColorMap);

    expect(segments).toEqual([{ text: 'The x^2 term.', colorClass: null }]);
  });

  it('no annotations at all returns the whole say as one plain segment', () => {
    expect(highlightAnnotatedPhrases('Nothing to highlight here.', undefined, undefined)).toEqual([
      { text: 'Nothing to highlight here.', colorClass: null },
    ]);
    expect(highlightAnnotatedPhrases('Nothing to highlight here.', [], {})).toEqual([
      { text: 'Nothing to highlight here.', colorClass: null },
    ]);
  });

  it('an empty say string returns a single empty plain segment, not an error', () => {
    const annotations = [textMatchAnnotation('a1', 'x^2')];
    const colorMap = assignAnnotationColors(annotations);

    expect(highlightAnnotatedPhrases('', annotations, colorMap)).toEqual([{ text: '', colorClass: null }]);
  });

  it('a target.text that never appears in say at all renders entirely plain', () => {
    const annotations = [textMatchAnnotation('a1', 'y^2 + 1')];
    const colorMap = assignAnnotationColors(annotations);

    const segments = highlightAnnotatedPhrases('This talks about something else entirely.', annotations, colorMap);

    expect(segments).toEqual([{ text: 'This talks about something else entirely.', colorClass: null }]);
  });
});
