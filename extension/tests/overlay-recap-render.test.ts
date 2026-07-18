// @vitest-environment jsdom
//
// Sprint 21 Task 8 follow-up (ADR-049): the FIRST integration test that mounts
// the whole Overlay and drives the completion -> recap handoff end to end. It
// closes the coverage gap the Task 8 acceptance surfaced: nothing exercised the
// SESSION_ENDED -> SESSION_RECAP_EVENT -> recap-card render path, so a real
// "recap produced but never rendered" bug would have been invisible (only the
// pure nextCloseState reducer + recap-kit.test.ts's direct RecapCard mount were
// covered). The overlay-display.test.ts precedent (raw createRoot + act in
// jsdom); the recap arrives as the SESSION_RECAP_EVENT window CustomEvent that
// content/index.ts forwards from the background's SESSION_ENDED broadcast.
//
// It also PINS the exact behavior Task 8's live debugging found on Darcy's
// short test session: a session with no gradable interactions ends with the
// recap OMITTED, so the recap card (and "Make a study kit") is correctly
// skipped -- the by-design, data-gated behavior, not a bug.

import { createElement as h, act, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, it, expect, vi } from 'vitest';

import { Overlay, SESSION_RECAP_EVENT } from '../src/overlay/Overlay';
import type { SessionRecap, StudyKit, StudyKitResult } from '../src/types/messages';

// React 19's `act` requires this flag to run without warnings.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type OverlayProps = ComponentProps<typeof Overlay>;

const RECAP: SessionRecap = {
  concepts: [
    { conceptKey: 'algebra.quadratics.factoring', title: 'Factoring quadratics', turns: 4, correct: 3, incorrect: 1, mastery: 0.6, state: 'learning' },
  ],
  misconceptionsAdded: [],
  misconceptionsResolved: [],
  nextReviews: [],
  trends: [],
};

const KIT: StudyKit = {
  notes: ['Find two numbers that multiply to c and add to b.'],
  problems: [{ statement: 'Factor x^2 + 7x + 12.', solution: '(x + 3)(x + 4)' }],
  flashcards: [{ front: 'What multiplies to 12 and adds to 7?', back: '3 and 4' }],
};

// Minimal transports -- the recap path never calls any of them (it rides a
// window event, not a turn); they exist only to satisfy the required props.
function baseProps(overrides: Partial<OverlayProps> = {}): OverlayProps {
  return {
    onSend: async () => ({ reply: '' }),
    onSendVoiceStreaming: async () => ({ reply: '' }),
    onTranscribe: async () => ({ transcript: '', sttMs: 0 }),
    onSynthesize: async () => ({ audio: new ArrayBuffer(0), ttsMs: 0 }),
    onSynthesizeStream: async () => ({ ttsMs: 0 }),
    onVoicePlaybackStart: () => {},
    onEndSession: async () => {},
    onOpeningScan: async () => null,
    // No tutorial transports: an unwired onFetchTutorialSeen means the
    // first-run tour never opens (and the scan gate resolves immediately).
    ...overrides,
  };
}

const mounted: { root: Root; container: HTMLElement }[] = [];

async function mount(props: OverlayProps): Promise<HTMLElement> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(h(Overlay, props));
  });
  await flush(); // let mount effects (event listeners, onboarding check) settle
  mounted.push({ root, container });
  return container;
}

async function flush(): Promise<void> {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

// The SESSION_ENDED broadcast, as it reaches the overlay (content/index.ts
// forwards it as this window CustomEvent). At mount no bloom is up, so
// onSessionRecap applies the recap immediately -- the manual-end / no-bloom
// production path, and the direct way to prove a produced recap renders.
async function dispatchRecap(detail: { recap?: SessionRecap; sessionId?: string }): Promise<void> {
  await act(async () => {
    window.dispatchEvent(new CustomEvent(SESSION_RECAP_EVENT, { detail }));
  });
  await flush();
}

function makeKitButton(c: HTMLElement): HTMLButtonElement | undefined {
  return [...c.querySelectorAll('button')].find((b) => /make a study kit/i.test(b.textContent ?? '')) as
    | HTMLButtonElement
    | undefined;
}

afterEach(async () => {
  await act(async () => {
    for (const { root } of mounted) root.unmount();
  });
  for (const { container } of mounted) container.remove();
  mounted.length = 0;
  vi.restoreAllMocks();
});

describe('Overlay completion → recap-card render', () => {
  it('renders the recap card (with "Make a study kit") when a real recap arrives, and generates for that session', async () => {
    const onGenerateStudyKit = vi.fn().mockResolvedValue({ kit: KIT } as StudyKitResult);
    const c = await mount(baseProps({ onGenerateStudyKit }));

    // No recap yet -> no recap card.
    expect(c.textContent).not.toContain('Complete session');

    // The SESSION_ENDED recap lands (with the ended sessionId, Task 5).
    await dispatchRecap({ recap: RECAP, sessionId: 'sess-42' });

    // The recap card rendered through the real event handoff.
    expect(c.textContent).toContain('Factoring quadratics');
    expect(c.textContent).toContain('Complete session');

    // Task 5's "Make a study kit" entry point is reachable via the real flow.
    const button = makeKitButton(c);
    expect(button).toBeTruthy();

    // And it generates for the sessionId that rode the recap event (Task 5's
    // sessionId plumbing, end to end through the real Overlay).
    await act(async () => {
      button!.click();
    });
    await flush();
    expect(onGenerateStudyKit).toHaveBeenCalledWith('sess-42');
    // The kit renders as the compact summary (2026-07-16), never the materials.
    expect(c.textContent).toMatch(/study kit is ready/i);
    expect(c.textContent).not.toContain('Factor x^2 + 7x + 12.');
  });

  it('renders NO recap card when the ended session produced no recap (0 gradable interactions)', async () => {
    // This is the exact by-design behavior Task 8 debugging found on the short
    // test session: no gradable turns -> recap omitted -> no card, no button.
    const c = await mount(baseProps({ onGenerateStudyKit: vi.fn() }));

    await dispatchRecap({ sessionId: 'sess-2' }); // recap omitted from the broadcast

    expect(c.textContent).not.toContain('Complete session');
    expect(makeKitButton(c)).toBeUndefined();
  });
});
