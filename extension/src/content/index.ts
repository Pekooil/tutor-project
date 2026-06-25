import { createShadowRootUi, defineContentScript } from '#imports';
import type { ShadowRootContentScriptUi } from '#imports';
import type { Root } from 'react-dom/client';
import { mountOverlay, unmountOverlay } from '../overlay/mount';
import type { MathMentorMessage } from '../types/messages';

// Overlay UI handle, created once per page in main(). Held at module scope
// because a content script's execution context lives for the page's lifetime —
// unlike the background service worker, where module-level state is lost between
// wakes. Task 4 toggles it (mount/remove) when the keyboard shortcut fires.
let overlayUi: ShadowRootContentScriptUi<Root> | undefined;

// MathMentor content script.
//
// DOM policy (locked): READ-ONLY on the host page. This script must never
// read-modify any node, style, or attribute that belongs to the host page.
//
// The ONE sanctioned exception (ADR-002): the overlay lives in a shadow root on
// a single extension-owned host element, <mathmentor-overlay>, appended to the
// document root and removed on dismissal. The shadow boundary isolates its
// styles, so nothing the overlay does is observable in the host page's light
// DOM. createShadowRootUi does not touch the host DOM until ui.mount() runs, so
// while the overlay is closed the host-page footprint is zero.
export default defineContentScript({
  // (1) Inject on every page the student visits.
  matches: ['<all_urls>'],
  // Route the bundled overlay stylesheet INTO the shadow root (consumed by
  // createShadowRootUi below) instead of injecting it into the host page <head>.
  cssInjectionMode: 'ui',
  async main(ctx) {
    // (2) Confirm injection.
    console.log(`MathMentor content: injected on ${window.location.hostname}`);

    // (3) Announce readiness to the background service worker (Sprint 01). The
    // worker may be asleep and sendMessage can throw / reject, so guard it.
    const message: MathMentorMessage = { type: 'CONTENT_READY' };
    try {
      const response = await chrome.runtime.sendMessage(message);
      if (response !== undefined) {
        console.log('MathMentor content: response from background', response);
      }
    } catch (error) {
      console.warn('MathMentor content: CONTENT_READY not acknowledged', error);
    }

    // (4) Build the overlay UI once. createShadowRootUi is async because it
    // fetches the bundled stylesheet to inject into the shadow root. The host
    // element is appended to the document root (<html>) so it cannot be trapped
    // inside a host-page stacking context. We do NOT mount here — the overlay
    // starts hidden and is toggled on demand by the keyboard shortcut (Task 4).
    overlayUi = await createShadowRootUi<Root>(ctx, {
      name: 'mathmentor-overlay',
      position: 'inline',
      anchor: document.documentElement,
      append: 'last',
      onMount: (container) => mountOverlay(container),
      onRemove: (root) => {
        if (root) unmountOverlay(root);
      },
    });
  },
});
