import { StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Overlay, type TurnResult } from './Overlay';
import type { ProfileOverview, TurnMessage } from '../types/messages';
import type { Utterance } from './VoiceController';

// Framework plumbing only. The content script calls these from WXT's
// createShadowRootUi onMount / onRemove callbacks (Task 3). Keeping React's
// createRoot / unmount here means the content script never imports react-dom
// directly — the overlay package owns its own mounting.

export type OverlayTransports = {
  /**
   * onChunk is called for each text delta when streaming. Omit for
   * non-streaming (voice) turns. Resolves the reply plus the turn's tags
   * and pings when the wire carried any (Sprint 13, ADR-024/026).
   */
  onSend: (messages: TurnMessage[], onChunk?: (chunk: string) => void) => Promise<TurnResult>;
  onTranscribe: (audio: Utterance) => Promise<{ transcript: string; sttMs: number }>;
  onSynthesize: (text: string) => Promise<{ audio: ArrayBuffer; ttsMs: number }>;
  /** Reports when synthesized speech starts playing + its duration (ms) -- see Overlay.tsx's prop comment. */
  onVoicePlaybackStart: (durationMs: number) => void;
  /** Fetches the read-only profile overview (Sprint 13, ADR-024/025) -- see Overlay.tsx's prop comment. */
  onLoadOverview: () => Promise<ProfileOverview>;
  /** Sends the existing END_SESSION message (Sprint 13, ADR-025) -- see Overlay.tsx's prop comment. */
  onEndSession: () => Promise<void>;
};

export type MountOverlayOptions = OverlayTransports;

/**
 * Creates a React root on the shadow-root container and renders the overlay,
 * threading the AI_TURN / VOICE_STT / VOICE_TTS transports through. All of
 * it is built by the content script (Sprint 05 Task 6 / Sprint 06 Task 6) —
 * the overlay itself never imports chrome.* or the extractor. Returns the
 * Root so the caller can tear it down on dismissal.
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
