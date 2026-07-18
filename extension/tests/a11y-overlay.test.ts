// @vitest-environment jsdom
//
// Sprint 18 Task 4 (ADR-044): the extension-side a11y audit, updated for the
// "Calyxa Ambient Pill" redesign. The web axe spec covers the server-rendered
// auth/account pages; the overlay + popup render React trees with NO server,
// so this spec mounts them into jsdom (the overlay-display.test.ts precedent)
// and runs axe-core over each — the same WCAG 2.1 A/AA structural check
// (roles, labels, focus order, button/field names, aria-*).
//
// The ambient decomposition (Composer-as-pill-text-row / ConceptCard /
// ConceptFallbackCard / FeedbackCard / PingToast / Onboarding) is each
// presentational — props in, callbacks out — so they mount in isolation with
// representative props. The retired panel surfaces (TitleBar, the Transcript
// message list, CheckinScan) retired their audits with them.
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
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Tutorial } from '../src/overlay/Tutorial';
import { Composer } from '../src/overlay/Composer';
import { ConceptCard, ConceptFallbackCard, type ConceptVariant } from '../src/overlay/CheckinCard';
import { FeedbackCard } from '../src/overlay/FeedbackCard';
import { PingToast } from '../src/overlay/PingToast';
import { AnswerFields } from '../src/overlay/Transcript';
import { App as PopupApp } from '../src/popup/main';
import type {
  SessionStatePayload,
  StatusPin,
} from '../src/types/messages';

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
// Ambient-pill surfaces
// ---------------------------------------------------------------------------

const noop = () => {};

function conceptCardProps(variant: ConceptVariant) {
  return {
    variant,
    topic: { conceptKey: 'quadratics', title: 'Quadratic equations' },
    sticking: { value: 'factoring quadratics', label: 'Factoring quadratics', rank: 1 as const, personalized: true },
    disabled: false,
    autoStartActive: true,
    autoStartMs: 5200,
    onStart: noop,
    onReframe: noop,
  };
}

describe('overlay a11y — ambient pill surfaces', () => {
  it('ConceptCard (banner — the default variant, drain bar armed)', async () => {
    const c = await mount(h(ConceptCard, conceptCardProps('banner')));
    await expectNoAxeViolations(c, 'ConceptCard (banner)');
  });

  it('ConceptCard (stacked variant)', async () => {
    const c = await mount(h(ConceptCard, conceptCardProps('stacked')));
    await expectNoAxeViolations(c, 'ConceptCard (stacked)');
  });

  it('ConceptCard (minimal variant)', async () => {
    const c = await mount(h(ConceptCard, conceptCardProps('minimal')));
    await expectNoAxeViolations(c, 'ConceptCard (minimal)');
  });

  it('ConceptFallbackCard (scan named no topic — screen-capture fallback)', async () => {
    const c = await mount(h(ConceptFallbackCard, { disabled: false, onFrame: noop }));
    await expectNoAxeViolations(c, 'ConceptFallbackCard');
  });

  it('Composer (the in-pill text row, resting)', async () => {
    const c = await mount(
      h(Composer, {
        inputRef: createRef<HTMLInputElement>(),
        value: '',
        busy: false,
        disabled: false,
        placeholder: 'Ask about this problem…',
        onChange: noop,
        onSubmit: noop,
        onClose: noop,
      }),
    );
    await expectNoAxeViolations(c, 'Composer (resting)');
  });

  it('Composer (the in-pill text row, thinking)', async () => {
    const c = await mount(
      h(Composer, {
        inputRef: createRef<HTMLInputElement>(),
        value: 'how do I factor this?',
        busy: true,
        disabled: false,
        placeholder: 'Ask about this problem…',
        onChange: noop,
        onSubmit: noop,
        onClose: noop,
      }),
    );
    await expectNoAxeViolations(c, 'Composer (thinking)');
  });

  it('AnswerFields (the multi-part answer card body)', async () => {
    const c = await mount(
      h(AnswerFields, {
        fields: [
          { label: 'Adjacent', placeholder: 'e.g. 8.66' },
          { label: 'Hypotenuse', placeholder: 'e.g. 10' },
        ],
        disabled: false,
        onSubmit: noop,
      }),
    );
    await expectNoAxeViolations(c, 'AnswerFields');
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
// The feedback affordance (Sprint 17, re-homed to its own card)
// ---------------------------------------------------------------------------

describe('overlay a11y — FeedbackCard (Sprint 17 affordance, ambient home)', () => {
  it('FeedbackCard (report / rate / message form)', async () => {
    const c = await mount(h(FeedbackCard, { onSubmit: async () => {}, onClose: noop }));
    await expectNoAxeViolations(c, 'FeedbackCard (form)');
  });

  it('FeedbackCard (rating kind selected — the star row)', async () => {
    const c = await mount(h(FeedbackCard, { onSubmit: async () => {}, onClose: noop }));
    const rate = Array.from(c.querySelectorAll('button')).find((b) => b.textContent === 'Rate');
    expect(rate, 'the Rate kind tab must exist').toBeTruthy();
    await act(async () => {
      rate!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await expectNoAxeViolations(c, 'FeedbackCard (rating)');
  });
});

// ---------------------------------------------------------------------------
// Tutorial (public launch, 2026-07-17 — replaces the Sprint 17 Onboarding
// diagnostic in the first-run slot)
// ---------------------------------------------------------------------------

describe('overlay a11y — Tutorial (first-run tour)', () => {
  it('Tutorial (first step, with Next/Skip controls)', async () => {
    const c = await mount(h(Tutorial, { onDone: noop }));
    await expectNoAxeViolations(c, 'Tutorial (first step)');
  });

  it('Tutorial (mid-tour, with the Back control present)', async () => {
    const c = await mount(h(Tutorial, { onDone: noop }));
    await act(async () => {
      const next = [...c.querySelectorAll('button')].find((b) => b.textContent === 'Next');
      next!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await expectNoAxeViolations(c, 'Tutorial (mid-tour)');
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
