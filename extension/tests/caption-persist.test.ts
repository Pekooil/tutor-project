// @vitest-environment jsdom
//
// The persistent tutor reply (Darcy's 2026-07-16 ask): a committed caption no
// longer auto-dissolves -- it holds until the student's next action. This
// integration spec mounts the whole Overlay (the overlay-recap-render.test.ts
// harness) and drives a real text turn end to end, pinning:
//   1. the reply is still on screen long after the retired 1.4s/2.4s windows
//      (a dissolve timer firing would fail the fake-timer sweep);
//   2. the turn's answer chips render INSIDE the held caption card, tappable
//      while the reply is visible;
//   3. tapping a chip sends the next turn and REPLACES the held reply -- the
//      "until the next turn" half of the contract.

import { createElement as h, act, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, it, expect, vi } from 'vitest';

import { Overlay, type TurnResult } from '../src/overlay/Overlay';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type OverlayProps = ComponentProps<typeof Overlay>;

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
    onFetchOnboardingStatus: async () => ({ needed: false }),
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
  await flush();
  mounted.push({ root, container });
  return container;
}

async function flush(): Promise<void> {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

// A departed surface now lingers as a fading ghost for SURFACE_EXIT_MS
// (the 2026-07-16 all-surfaces exit fade) before unmounting -- wait past
// that window before asserting content is fully gone.
async function waitGhostOut(): Promise<void> {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 320));
  });
}

afterEach(async () => {
  for (const { root, container } of mounted.splice(0)) {
    await act(async () => {
      root.unmount();
    });
    container.remove();
  }
  vi.useRealTimers();
});

function findButton(container: HTMLElement, match: (b: HTMLButtonElement) => boolean): HTMLButtonElement {
  const button = [...container.querySelectorAll('button')].find(match);
  if (!button) throw new Error('button not found');
  return button;
}

/** Drives one full typed turn: shortcut-open -> Text -> type -> submit. */
async function sendTypedTurn(container: HTMLElement, text: string): Promise<void> {
  await act(async () => {
    window.dispatchEvent(new CustomEvent('calyxa:toggle-panel'));
  });
  await act(async () => {
    findButton(container, (b) => b.getAttribute('aria-label') === 'Text').click();
  });
  const input = container.querySelector<HTMLInputElement>('input[aria-label="Message Calyxa"]')!;
  expect(input).toBeTruthy();
  const setValue = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
  await act(async () => {
    setValue.call(input, text);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () => {
    input.form!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
  await flush();
}

describe('the persistent tutor reply (2026-07-16)', () => {
  it('holds the committed reply + in-card chips indefinitely, and a chip tap replaces it with the next turn', async () => {
    const replies: TurnResult[] = [
      { reply: 'First factor the left side.', chips: ['x-3', 'x+3', 'Not sure'] },
      { reply: 'Right -- x minus three it is.' },
    ];
    const onSend = vi.fn(async () => replies[Math.min(onSend.mock.calls.length - 1, replies.length - 1)]);
    const container = await mount(baseProps({ onSend }));

    await sendTypedTurn(container, 'factor x^2 - 9');
    expect(onSend).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain('First factor the left side.');

    // The chips render INSIDE the held caption card, next to the reply.
    const chipButton = findButton(container, (b) => b.textContent === 'x-3');
    expect(chipButton.closest('.cx-card')?.textContent).toContain('First factor the left side.');

    // The retired dissolve windows (1.4s voice / 2.4s text + the 270ms exit)
    // must NOT be lurking on a timer: sweep far past them and the reply and
    // its chips are still up.
    vi.useFakeTimers();
    await act(async () => {
      vi.advanceTimersByTime(60_000);
    });
    vi.useRealTimers();
    expect(container.textContent).toContain('First factor the left side.');
    expect([...container.querySelectorAll('button')].some((b) => b.textContent === 'x-3')).toBe(true);

    // A chip tap is the student's next action: it commits as the next turn
    // and the NEW reply replaces the held one.
    await act(async () => {
      findButton(container, (b) => b.textContent === 'x-3').click();
    });
    await flush();
    expect(onSend).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain('Right -- x minus three it is.');
    await waitGhostOut();
    expect(container.textContent).not.toContain('First factor the left side.');
  });

  it('Escape still dismisses the held reply (the explicit collapse)', async () => {
    const onSend = vi.fn(async (): Promise<TurnResult> => ({ reply: 'Try isolating x first.' }));
    const container = await mount(baseProps({ onSend }));

    await sendTypedTurn(container, 'solve 2x + 3 = 11');
    expect(container.textContent).toContain('Try isolating x first.');

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    await flush();
    await waitGhostOut();
    expect(container.textContent).not.toContain('Try isolating x first.');
  });
});
