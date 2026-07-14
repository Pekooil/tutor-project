// @vitest-environment jsdom
//
// Sprint 21 Task 7 (ADR-049): the recap card's "Generated for you" surface.
// Pure + render, the overlay-display.test.ts / a11y-overlay.test.ts precedent
// (raw createRoot + act in jsdom, no server, no chrome.*). Covers the three
// things the plan names: the flip/reveal reducer (toggleIndex, pure), the kit
// -> recap-card view mapping (notes list / problems with reveal / flip
// flashcards), and that a generation failure or refusal degrades to the
// placeholder gracefully.

import { createElement as h, act, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, it, expect, vi } from 'vitest';

import { RecapCard, toggleIndex } from '../src/overlay/RecapCard';
import type { SessionRecap, StudyKit, StudyKitResult } from '../src/types/messages';

type RecapProps = ComponentProps<typeof RecapCard>;

// React 19's `act` requires this flag to run without warnings.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const noop = () => {};

const RECAP: SessionRecap = {
  concepts: [
    { conceptKey: 'algebra.factoring', title: 'Factoring', turns: 3, correct: 3, incorrect: 0, mastery: 0.7, state: 'learning' },
  ],
  misconceptionsAdded: [],
  misconceptionsResolved: [],
  nextReviews: [],
  trends: [],
};

const KIT: StudyKit = {
  notes: ['Find two numbers that multiply to c and add to b.', 'Write the factors and check by expanding.'],
  problems: [{ statement: 'Factor x^2 + 7x + 12.', solution: '(x + 3)(x + 4)' }],
  flashcards: [{ front: 'What multiplies to 12 and adds to 7?', back: '3 and 4' }],
};

const mounted: { root: Root; container: HTMLElement }[] = [];

async function mount(props: RecapProps): Promise<HTMLElement> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(h(RecapCard, props));
  });
  mounted.push({ root, container });
  return container;
}

async function flush(): Promise<void> {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

async function click(el: Element | undefined): Promise<void> {
  if (!el) throw new Error('click target not found');
  await act(async () => {
    (el as HTMLElement).click();
  });
  await flush();
}

function button(c: HTMLElement, re: RegExp): HTMLButtonElement | undefined {
  return [...c.querySelectorAll('button')].find((b) => re.test(b.textContent ?? '')) as HTMLButtonElement | undefined;
}

function baseProps(overrides: Partial<RecapProps> = {}): RecapProps {
  return { recap: RECAP, topicTitle: null, disabled: false, onDone: noop, sessionId: 'sess-1', ...overrides };
}

afterEach(async () => {
  await act(async () => {
    for (const { root } of mounted) root.unmount();
  });
  for (const { container } of mounted) container.remove();
  mounted.length = 0;
  vi.restoreAllMocks();
});

describe('toggleIndex (pure flip/reveal reducer)', () => {
  it('adds an absent index and removes a present one, never mutating the input', () => {
    expect([...toggleIndex(new Set(), 1)]).toEqual([1]);
    expect([...toggleIndex(new Set([1]), 1)]).toEqual([]);
    expect([...toggleIndex(new Set([1]), 2)].sort()).toEqual([1, 2]);

    const original = new Set([1]);
    toggleIndex(original, 2);
    expect([...original]).toEqual([1]); // input untouched
  });
});

describe('RecapCard "Generated for you" surface', () => {
  it('renders the reserved placeholder (and no generate button) when generation is unavailable', async () => {
    // No transport at all.
    const c1 = await mount(baseProps({ onGenerateStudyKit: undefined }));
    expect(c1.querySelectorAll('.cx-recap-placeholder')).toHaveLength(2);
    expect(button(c1, /make a study kit/i)).toBeUndefined();

    // Transport present but no ended sessionId to generate against.
    const c2 = await mount(baseProps({ sessionId: null, onGenerateStudyKit: vi.fn() }));
    expect(c2.querySelectorAll('.cx-recap-placeholder')).toHaveLength(2);
    expect(button(c2, /make a study kit/i)).toBeUndefined();
  });

  it('generates and renders notes, problems (with solution reveal), and a flip flashcard', async () => {
    const onGenerate = vi.fn().mockResolvedValue({ kit: KIT } as StudyKitResult);
    const c = await mount(baseProps({ sessionId: 'sess-42', onGenerateStudyKit: onGenerate }));

    await click(button(c, /make a study kit/i));

    expect(onGenerate).toHaveBeenCalledWith('sess-42');
    // Notes + problem statement render.
    expect(c.textContent).toContain('Find two numbers that multiply to c and add to b.');
    expect(c.textContent).toContain('Factor x^2 + 7x + 12.');
    // The solution is hidden until revealed.
    expect(c.textContent).not.toContain('(x + 3)(x + 4)');

    await click(button(c, /show solution/i));
    expect(c.textContent).toContain('(x + 3)(x + 4)');
    expect(button(c, /hide solution/i)).toBeTruthy();

    // Flip flashcard: tap toggles aria-pressed + the question/answer label.
    const card = c.querySelector('[aria-label^="Flashcard question"]') as HTMLElement;
    expect(card).toBeTruthy();
    expect(card.getAttribute('aria-pressed')).toBe('false');

    await click(card);
    const flippedCard = c.querySelector('[aria-label^="Flashcard answer"]') as HTMLElement;
    expect(flippedCard).toBeTruthy();
    expect(flippedCard.getAttribute('aria-pressed')).toBe('true');
  });

  it('degrades to the placeholder + a resting message on a hard-cost-cap refusal', async () => {
    const onGenerate = vi.fn().mockResolvedValue({ refused: 'cost' } as StudyKitResult);
    const c = await mount(baseProps({ onGenerateStudyKit: onGenerate }));

    await click(button(c, /make a study kit/i));

    expect(c.textContent).toMatch(/resting for today/i);
    expect(c.querySelectorAll('.cx-recap-placeholder')).toHaveLength(2);
    // A cost refusal is not retryable -- no "Try again".
    expect(button(c, /try again/i)).toBeUndefined();
  });

  it("degrades to the placeholder on an 'empty' refusal (nothing to generate)", async () => {
    const onGenerate = vi.fn().mockResolvedValue({ refused: 'empty' } as StudyKitResult);
    const c = await mount(baseProps({ onGenerateStudyKit: onGenerate }));

    await click(button(c, /make a study kit/i));

    expect(c.textContent).toMatch(/wasn't enough/i);
    expect(c.querySelectorAll('.cx-recap-placeholder')).toHaveLength(2);
  });

  it('degrades to the placeholder + a Try again on a real failure, and the retry re-calls the transport', async () => {
    const onGenerate = vi
      .fn()
      .mockRejectedValueOnce(new Error('worker unreachable'))
      .mockResolvedValueOnce({ kit: KIT } as StudyKitResult);
    const c = await mount(baseProps({ onGenerateStudyKit: onGenerate }));

    await click(button(c, /make a study kit/i));

    expect(c.textContent).toMatch(/couldn't generate/i);
    expect(c.querySelectorAll('.cx-recap-placeholder')).toHaveLength(2);

    const retry = button(c, /try again/i);
    expect(retry).toBeTruthy();

    await click(retry);
    expect(onGenerate).toHaveBeenCalledTimes(2);
    // The retry succeeded -> the kit now renders.
    expect(c.textContent).toContain('Factor x^2 + 7x + 12.');
  });
});
