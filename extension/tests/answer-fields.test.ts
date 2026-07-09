// Multi-part answers (design 8d): the overlay's pure display-logic spec for
// the labeled-per-unknown answer panel (the overlay-display.test.ts precedent
// -- pure helpers, no React/browser harness). The panel's typed values are
// display-ephemeral: they only ever leave the overlay as ONE ordinary student
// turn (the joined "<label> = <value>" line), never as a structured wire
// field, so these two helpers are the whole contract worth pinning.
import { describe, expect, it } from 'vitest';
import { formatMultiPartAnswer, multiPartComplete } from '../src/overlay/Transcript';
import { stripHistory, type DisplayMessage } from '../src/overlay/Overlay';
import type { AnswerField } from '../src/types/messages';

const TRIANGLE: AnswerField[] = [
  { label: 'Adjacent', placeholder: 'e.g. 8.66' },
  { label: 'Hypotenuse', placeholder: 'e.g. 10' },
];

describe('formatMultiPartAnswer — the boxes commit as one graded student turn', () => {
  it('joins each field as "<label> = <value>", comma-separated, in field order', () => {
    expect(formatMultiPartAnswer(TRIANGLE, ['8.66', '10'])).toBe('Adjacent = 8.66, Hypotenuse = 10');
  });

  it('trims each value so stray spaces never reach the model', () => {
    expect(formatMultiPartAnswer(TRIANGLE, ['  8.66 ', ' 10'])).toBe('Adjacent = 8.66, Hypotenuse = 10');
  });

  it('preserves calculator notation in values verbatim (only whitespace trimmed)', () => {
    const fields: AnswerField[] = [{ label: 'x' }, { label: 'y' }];
    expect(formatMultiPartAnswer(fields, ['sqrt(2)', '-3/4'])).toBe('x = sqrt(2), y = -3/4');
  });

  it('treats a missing value slot as empty rather than throwing', () => {
    expect(formatMultiPartAnswer(TRIANGLE, ['8.66'])).toBe('Adjacent = 8.66, Hypotenuse = ');
  });
});

describe('multiPartComplete — the check gate stays shut until every box is filled', () => {
  it('is false when any field is blank or whitespace-only', () => {
    expect(multiPartComplete(TRIANGLE, ['8.66', ''])).toBe(false);
    expect(multiPartComplete(TRIANGLE, ['8.66', '   '])).toBe(false);
    expect(multiPartComplete(TRIANGLE, ['', ''])).toBe(false);
  });

  it('is true only once all fields carry a non-blank value', () => {
    expect(multiPartComplete(TRIANGLE, ['8.66', '10'])).toBe(true);
  });

  it('is false for an empty field list (no panel to complete)', () => {
    expect(multiPartComplete([], [])).toBe(false);
  });
});

describe('answer fields are display-ephemeral — the committed turn is plain role/content', () => {
  it('the joined answer rides the wire as an ordinary user turn, carrying no structured field', () => {
    // What the panel produces IS just a user message: stripHistory keeps it as
    // bare role/content, exactly like a typed or chip-tapped answer. There is
    // no answerFields field on DisplayMessage for it to leak through.
    const committed = formatMultiPartAnswer(TRIANGLE, ['8.66', '10']);
    const messages: DisplayMessage[] = [
      { role: 'assistant', content: 'What are the adjacent side and the hypotenuse?' },
      { role: 'user', content: committed },
    ];
    expect(stripHistory(messages)).toEqual([
      { role: 'assistant', content: 'What are the adjacent side and the hypotenuse?' },
      { role: 'user', content: 'Adjacent = 8.66, Hypotenuse = 10' },
    ]);
  });
});
