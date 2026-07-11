// @vitest-environment jsdom
//
// Sprint 18 Task 4 (ADR-044): the extension-side a11y audit. The web axe spec
// (web/tests/axe-web-surfaces.test.ts) covers the server-rendered auth/account
// pages; the overlay + popup render React trees with NO server, so this spec
// mounts them into jsdom (the overlay-display.test.ts precedent) and runs
// axe-core over each — the same WCAG 2.1 A/AA structural check the web spec
// runs (roles, labels, focus order, button/field names, aria-*).
//
// The Sprint 14 decomposition (TitleBar/Composer/Transcript/CheckinCard/
// PingToast) + the Sprint 17 Onboarding and TitleBar feedback affordance are
// each presentational — props in, callbacks out — so they mount in isolation
// with representative props covering the recording / degraded / calibrating
// states the plan calls out.
//
// Two documented axe scopings, mirroring the web spec's own limits:
//   - color-contrast is DISABLED (jsdom computes no layout/cascade, so ratios
//     are unreliable — the same note the web spec carries). The manual
//     contrast pass lives in docs/a11y-contrast-audit.md.
//   - page-scope rules (region/landmark-one-main/document-title/html-has-lang/
//     page-has-heading-one/bypass) are DISABLED: these surfaces are embedded
//     fragments inside the host page's shadow root, never a document of their
//     own, so "every page needs one main landmark" etc. do not apply.

import { createElement as h, act, createRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import axe from 'axe-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Onboarding } from '../src/overlay/Onboarding';
import { TitleBar } from '../src/overlay/TitleBar';
import { Composer } from '../src/overlay/Composer';
import { CheckinScan, CheckinCard } from '../src/overlay/CheckinCard';
import { PingToast } from '../src/overlay/PingToast';
import { Transcript } from '../src/overlay/Transcript';
import { App as PopupApp } from '../src/popup/main';
import type {
  AssessmentItem,
  SessionStatePayload,
  StatusPin,
} from '../src/types/messages';
import type { DisplayMessage } from '../src/overlay/Overlay';

// React 19's `act` requires this flag to run without warnings.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const AXE_OPTIONS = {
  runOnly: { type: 'tag' as const, values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] },
  rules: {
    // jsdom can't compute contrast — covered manually (see file header).
    'color-contrast': { enabled: false },
    // Page-scope rules that don't apply to an embedded overlay/popup fragment.
    region: { enabled: false },
    'landmark-one-main': { enabled: false },
    'page-has-heading-one': { enabled: false },
    'document-title': { enabled: false },
    'html-has-lang': { enabled: false },
    bypass: { enabled: false },
  },
};

const mounted: { root: Root; container: HTMLElement }[] = [];

async function mount(node: ReturnType<typeof h>): Promise<HTMLElement> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(node);
  });
  mounted.push({ root, container });
  return container;
}

// Let a mounted component's async effects (e.g. the popup's GET_STATE round
// trip) settle before auditing.
async function flush(): Promise<void> {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

async function expectNoAxeViolations(container: HTMLElement, label: string): Promise<void> {
  const results = await axe.run(container, AXE_OPTIONS);
  if (results.violations.length > 0) {
    const detail = results.violations
      .map(
        (v) =>
          `  • [${v.id}] ${v.help} — ${v.nodes.length} node(s); first: ${v.nodes[0]?.target?.join(' ') ?? '?'}`,
      )
      .join('\n');
    throw new Error(`axe found ${results.violations.length} violation(s) on "${label}":\n${detail}`);
  }
  expect(results.violations).toEqual([]);
}

afterEach(async () => {
  await act(async () => {
    for (const { root } of mounted) root.unmount();
  });
  for (const { container } of mounted) container.remove();
  mounted.length = 0;
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Overlay surfaces (Sprint 14 decomposition)
// ---------------------------------------------------------------------------

const noop = () => {};

describe('overlay a11y — Sprint 14 surfaces', () => {
  it('CheckinScan (the calibrating / "reading the page" state)', async () => {
    const c = await mount(h(CheckinScan));
    await expectNoAxeViolations(c, 'CheckinScan');
  });

  it('CheckinCard (opening scan: confirm-topic / reframe)', async () => {
    const c = await mount(
      h(CheckinCard, {
        topic: { conceptKey: 'quadratics', title: 'Quadratic equations' },
        sticking: { value: 'factoring quadratics', label: 'Factoring quadratics', rank: 1, personalized: true },
        disabled: false,
        autoStartActive: true,
        autoStartMs: 5000,
        onStart: noop,
        onReframe: noop,
      }),
    );
    await expectNoAxeViolations(c, 'CheckinCard');
  });

  it('Composer (resting state)', async () => {
    const c = await mount(
      h(Composer, {
        hasContent: false,
        recording: false,
        connecting: false,
        level: 0,
        input: '',
        busy: false,
        closing: false,
        placeholder: 'Answer out loud or type here',
        inputFocused: false,
        caretLeft: 0,
        inputElRef: createRef<HTMLInputElement>(),
        measureElRef: createRef<HTMLSpanElement>(),
        onSubmit: noop,
        onInputChange: noop,
        onCaretRefresh: noop,
        onInputFocus: noop,
        onInputBlur: noop,
        onMicClick: noop,
      }),
    );
    await expectNoAxeViolations(c, 'Composer (resting)');
  });

  it('Composer (recording state)', async () => {
    const c = await mount(
      h(Composer, {
        hasContent: false,
        recording: true,
        connecting: false,
        level: 0.6,
        input: '',
        busy: false,
        closing: false,
        placeholder: 'Listening…',
        inputFocused: false,
        caretLeft: 0,
        inputElRef: createRef<HTMLInputElement>(),
        measureElRef: createRef<HTMLSpanElement>(),
        onSubmit: noop,
        onInputChange: noop,
        onCaretRefresh: noop,
        onInputFocus: noop,
        onInputBlur: noop,
        onMicClick: noop,
      }),
    );
    await expectNoAxeViolations(c, 'Composer (recording)');
  });

  it('Transcript (a live tutor exchange)', async () => {
    const messages: DisplayMessage[] = [
      { role: 'user', content: 'How do I solve 2x + 3 = 11?' },
      { role: 'assistant', content: 'Start by isolating x. What do you get if you subtract 3 from both sides?' },
    ];
    const c = await mount(
      h(Transcript, {
        messages,
        streamingTokens: [],
        busy: false,
        notice: null,
        liveTranscript: '',
        chips: ['x = 4', 'x = 8'],
        chipsDisabled: false,
        onChipTap: noop,
        answerFields: null,
        answerFieldsDisabled: false,
        onAnswerFieldsSubmit: noop,
        chatEndRef: createRef<HTMLDivElement>(),
      }),
    );
    await expectNoAxeViolations(c, 'Transcript');
  });

  it('PingToast (a status pin)', async () => {
    const pin: StatusPin = {
      category: 'progress',
      kind: 'concept-understood',
      conceptKey: 'quadratics',
      label: 'Concept understood',
    };
    const c = await mount(h(PingToast, { pin }));
    await expectNoAxeViolations(c, 'PingToast');
  });
});

// ---------------------------------------------------------------------------
// TitleBar + the Sprint 17 feedback affordance
// ---------------------------------------------------------------------------

function titleBarProps() {
  return {
    playing: false,
    isDragging: false,
    recording: false,
    busy: false,
    ending: false,
    closing: false,
    ringing: false,
    ringDurationMs: 0,
    accessory: null,
    chip: null,
    session: null,
    onHeaderPointerDown: noop,
    onHeaderPointerMove: noop,
    onHeaderPointerUp: noop,
    onInterrupt: noop,
    onMinimize: noop,
    onCloseSession: noop,
    onSubmitFeedback: async () => {},
  };
}

describe('overlay a11y — TitleBar + feedback affordance (Sprint 17)', () => {
  it('TitleBar (window controls + feedback trigger, closed)', async () => {
    const c = await mount(h(TitleBar, titleBarProps()));
    await expectNoAxeViolations(c, 'TitleBar (feedback closed)');
  });

  it('TitleBar feedback popover (opened — report / rate / message)', async () => {
    const c = await mount(h(TitleBar, titleBarProps()));
    const trigger = c.querySelector<HTMLButtonElement>('button[aria-label="Send feedback"]');
    expect(trigger, 'feedback trigger button must exist and be labelled').not.toBeNull();
    await act(async () => {
      trigger!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await expectNoAxeViolations(c, 'TitleBar (feedback popover open)');
  });
});

// ---------------------------------------------------------------------------
// Onboarding (Sprint 17)
// ---------------------------------------------------------------------------

describe('overlay a11y — Onboarding (Sprint 17)', () => {
  it('Onboarding (answering a self-check item)', async () => {
    const items: AssessmentItem[] = [
      {
        conceptKey: 'linear-equations',
        strand: 'algebra',
        strandLabel: 'Algebra',
        title: 'Solving linear equations',
        prompt: 'How confident are you solving 2x + 3 = 11?',
        kind: 'choice',
        options: [
          { label: 'I can solve it confidently', outcome: 'correct', selfConfidence: 'high' },
          { label: 'I could try but might slip', outcome: 'partial', selfConfidence: 'med' },
          { label: 'I’m not sure where to start', outcome: 'incorrect', selfConfidence: 'low' },
        ],
      },
    ];
    const c = await mount(
      h(Onboarding, {
        items,
        onSubmit: async () => ({ seededCount: 1 }),
        onSkip: noop,
        onComplete: noop,
      }),
    );
    await expectNoAxeViolations(c, 'Onboarding (answering)');
  });
});

// ---------------------------------------------------------------------------
// Popup (three states) — App is exported for this spec; drive it by mocking
// the background round trip (chrome.runtime.sendMessage).
// ---------------------------------------------------------------------------

function setSendMessage(impl: () => Promise<unknown>): void {
  const g = globalThis as unknown as { chrome?: { runtime?: Record<string, unknown> } };
  if (!g.chrome) g.chrome = {};
  if (!g.chrome.runtime) g.chrome.runtime = {};
  g.chrome.runtime.sendMessage = vi.fn(impl);
}

const signedOut: SessionStatePayload = { signedIn: false, user: null, activeSession: null };
const signedInDegraded: SessionStatePayload = {
  signedIn: true,
  user: { id: 'u1', email: 'student@example.com' },
  activeSession: { sessionId: 's1', mode: 'text', degraded: true, remaining: 0 },
};

describe('popup a11y (Sprint 04 / Sprint 10)', () => {
  it('popup (loading state)', async () => {
    setSendMessage(() => new Promise(() => {})); // never resolves → stays on the spinner
    const c = await mount(h(PopupApp));
    await expectNoAxeViolations(c, 'popup (loading)');
  });

  it('popup (signed out — sign-in form)', async () => {
    setSendMessage(async () => ({ type: 'SESSION_STATE', payload: signedOut }));
    const c = await mount(h(PopupApp));
    await flush();
    await expectNoAxeViolations(c, 'popup (signed out)');
  });

  it('popup (signed in — degraded / free-limit card)', async () => {
    setSendMessage(async () => ({ type: 'SESSION_STATE', payload: signedInDegraded }));
    const c = await mount(h(PopupApp));
    await flush();
    await expectNoAxeViolations(c, 'popup (signed in, degraded)');
  });
});
