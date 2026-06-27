import { StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Overlay } from './Overlay';
import type { TurnMessage } from '../types/messages';

// Framework plumbing only. The content script calls these from WXT's
// createShadowRootUi onMount / onRemove callbacks (Task 3). Keeping React's
// createRoot / unmount here means the content script never imports react-dom
// directly — the overlay package owns its own mounting.

/**
 * Creates a React root on the shadow-root container and renders the overlay,
 * threading the AI_TURN transport through. `onSend` is built by the content
 * script (Task 6) — the overlay itself never imports chrome.*.
 * Returns the Root so the caller can tear it down on dismissal.
 */
export function mountOverlay(container: HTMLElement, onSend: (messages: TurnMessage[]) => Promise<string>): Root {
  const root = createRoot(container);
  root.render(
    <StrictMode>
      <Overlay onSend={onSend} />
    </StrictMode>,
  );
  return root;
}

/** Unmounts a previously created overlay root, removing it from the shadow root. */
export function unmountOverlay(root: Root): void {
  root.unmount();
}
