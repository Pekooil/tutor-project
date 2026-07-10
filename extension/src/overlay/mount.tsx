import { StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Overlay, type TurnResult } from './Overlay';
import type {
  Annotation,
  PageTopic,
  SendFeedbackPayload,
  StickingCandidate,
  TelemetryEvent,
  TurnMessage,
} from '../types/messages';
import type { Utterance } from './VoiceController';

// Framework plumbing only. The content script calls these from WXT's
// createShadowRootUi onMount / onRemove callbacks (Task 3). Keeping React's
// createRoot / unmount here means the content script never imports react-dom
// directly — the overlay package owns its own mounting.

export type OverlayTransports = {
  /**
   * onChunk is called for each text delta when streaming. Omit for
   * non-streaming (voice) turns. Resolves the reply plus the turn's status
   * pins when the wire carried any (Sprint 15, ADR-034).
   */
  onSend: (messages: TurnMessage[], onChunk?: (chunk: string) => void) => Promise<TurnResult>;
  /**
   * Streamed-envelope VOICE turn (Sprint 15 voice follow-on, ADR-033
   * amendment): relays each spoken-text delta to `onSayDelta` as it streams
   * from /api/ai/turn/stream, so Overlay.tsx can start per-sentence TTS before
   * the full reply is generated (the ~4-5s turn leg the latency probe found).
   * Resolves the SAME TurnResult as onSend's voice path. onSend (buffered) is
   * KEPT as the fallback the voice path drops to on any streaming failure.
   */
  onSendVoiceStreaming: (
    messages: TurnMessage[],
    onSayDelta: (text: string) => void,
  ) => Promise<TurnResult>;
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
  /** Sends the existing END_SESSION message (Sprint 13, ADR-025) -- see Overlay.tsx's prop comment. */
  onEndSession: () => Promise<void>;
  /** The proactive opening scan (Sprint 14 Task 6/7, ADR-030) -- see Overlay.tsx's prop comment. */
  onOpeningScan: () => Promise<{
    reply: string;
    annotations?: Annotation[];
    topic?: PageTopic;
    stickingCandidates?: StickingCandidate[];
  } | null>;
  /**
   * Beta-instrumentation transports (Sprint 17 Task 6, ADR-043). The content
   * script wires these to the background (the sole network-egress context,
   * ADR-006), which owns the /api/telemetry + /api/feedback calls. Both are
   * OPTIONAL so the overlay can render without them (e.g. a test harness or a
   * mount that predates this wiring); Task 7's UI consumes them -- the
   * onboarding-completion event fires onSendTelemetry, and the report/rate
   * affordance calls onReportFeedback. onSendTelemetry is fire-and-forget (a
   * dropped event is invisible to the student); onReportFeedback rejects on a
   * save failure so the affordance can surface a retry. Telemetry events are
   * the typed, content-free union (no free-text field, ADR-043).
   */
  onSendTelemetry?: (events: TelemetryEvent[]) => Promise<void>;
  onReportFeedback?: (payload: SendFeedbackPayload) => Promise<void>;
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
