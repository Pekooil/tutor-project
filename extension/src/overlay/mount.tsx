import { StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Overlay, type TurnResult } from './Overlay';
import type { Annotation, ProfileOverview, ProfileTag, TurnMessage } from '../types/messages';
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
  /**
   * Streaming sibling of onSynthesize (Sprint 15 Task 6, ADR-033): invokes
   * `onChunk` as each audio chunk arrives over the VOICE_TTS_STREAM port,
   * so Overlay.tsx can start MediaSource playback before the full reply is
   * synthesized. onSynthesize above is KEPT as the buffered fallback for a
   * MediaSource/codec failure on a given utterance.
   */
  onSynthesizeStream: (text: string, onChunk: (chunk: Uint8Array) => void) => Promise<{ ttsMs: number }>;
  /** Reports when synthesized speech starts playing + its duration (ms) -- see Overlay.tsx's prop comment. */
  onVoicePlaybackStart: (durationMs: number) => void;
  /** Fetches the read-only profile overview (Sprint 13, ADR-024/025) -- see Overlay.tsx's prop comment. */
  onLoadOverview: () => Promise<ProfileOverview>;
  /** Sends the existing END_SESSION message (Sprint 13, ADR-025) -- see Overlay.tsx's prop comment. */
  onEndSession: () => Promise<void>;
  /** The proactive opening scan (Sprint 14 Task 6/7, ADR-030) -- see Overlay.tsx's prop comment. */
  onOpeningScan: () => Promise<{ reply: string; tags?: ProfileTag[]; annotations?: Annotation[] } | null>;
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
