import { StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Overlay, type PageContextSummary } from './Overlay';
import type { TurnMessage } from '../types/messages';
import type { Utterance } from './VoiceController';

// Framework plumbing only. The content script calls these from WXT's
// createShadowRootUi onMount / onRemove callbacks (Task 3). Keeping React's
// createRoot / unmount here means the content script never imports react-dom
// directly — the overlay package owns its own mounting.

export type OverlayTransports = {
  onSend: (messages: TurnMessage[]) => Promise<string>;
  onTranscribe: (audio: Utterance) => Promise<{ transcript: string; sttMs: number }>;
  onSynthesize: (text: string) => Promise<{ audio: ArrayBuffer; ttsMs: number }>;
};

export type MountOverlayOptions = OverlayTransports & {
  // The summary of the PageContext captured by pageExtractor.ts at this
  // overlay open (Sprint 07, Task 5/6) — a count only, never the raw page
  // content. Optional so a caller that hasn't wired extraction still mounts
  // the overlay; Overlay.tsx shows no chip in that case.
  pageContextSummary?: PageContextSummary;
};

/**
 * Creates a React root on the shadow-root container and renders the overlay,
 * threading the AI_TURN / VOICE_STT / VOICE_TTS transports through, plus the
 * page-context summary (Sprint 07). All of it is built by the content
 * script (Sprint 05 Task 6 / Sprint 06 Task 6 / Sprint 07 Task 6) — the
 * overlay itself never imports chrome.* or the extractor. Returns the Root
 * so the caller can tear it down on dismissal.
 */
export function mountOverlay(container: HTMLElement, options: MountOverlayOptions): Root {
  const root = createRoot(container);
  root.render(
    <StrictMode>
      <Overlay {...options} />
    </StrictMode>,
  );
  return root;
}

/** Unmounts a previously created overlay root, removing it from the shadow root. */
export function unmountOverlay(root: Root): void {
  root.unmount();
}
