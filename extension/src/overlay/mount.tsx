import { StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Overlay, type TurnResult } from './Overlay';
import type {
  Annotation,
  PageTopic,
  ReferralOffer,
  SendFeedbackPayload,
  StickingCandidate,
  StudyKitResult,
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
  // The voice transports resolve a `degraded` member instead of their normal
  // payload when the daily cost cap tripped that leg (ADR-041 Decision 2,
  // 2026-07-15 cost-cap fix) -- see Overlay.tsx's prop comments.
  onTranscribe: (audio: Utterance) => Promise<{ transcript: string; sttMs: number } | { degraded: true }>;
  onSynthesize: (
    text: string,
  ) => Promise<{ audio: ArrayBuffer; ttsMs: number; degraded?: undefined } | { degraded: true; ttsMs: 0 }>;
  /**
   * Streaming sibling of onSynthesize (Sprint 15 Task 6, ADR-033): invokes
   * `onChunk` as each audio chunk arrives over the VOICE_TTS_STREAM port,
   * so Overlay.tsx can start MediaSource playback before the full reply is
   * synthesized. onSynthesize above is KEPT as the buffered fallback for a
   * MediaSource/codec failure on a given utterance.
   */
  onSynthesizeStream: (
    text: string,
    onChunk: (chunk: Uint8Array) => void,
  ) => Promise<{ ttsMs: number; degraded?: true }>;
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
    commonSticking?: string[];
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
  /**
   * The feedback affordance's sessionId lookup (Sprint 17 Task 7, ADR-039):
   * reuses the existing GET_STATE message (content/index.ts), read fresh at
   * submit time. undefined on failure or when no session is active --
   * feedback.session_id is optional, so this degrades to an unlinked capture.
   */
  onGetActiveSessionId?: () => Promise<string | undefined>;
  /**
   * Study-kit generation transport (Sprint 21 Task 5, ADR-049). The recap
   * card calls this with the just-ended sessionId; the content script relays
   * it to the background (the sole network-egress context, ADR-006), which
   * owns the /api/study/generate call. Resolves { kit } or a graceful
   * { refused } (hard cost cap / nothing to generate) and REJECTS on a real
   * failure so the card can offer a retry. Optional, like the telemetry /
   * feedback transports above -- a mount that predates this wiring (or a test
   * harness) renders the recap card's placeholder tiles instead.
   */
  onGenerateStudyKit?: (sessionId: string) => Promise<StudyKitResult>;
  /**
   * Referral-card transports (ADR-053), optional like the other post-launch
   * transports. onReferralOffer is asked at session close and resolves the
   * background's show-it-now decision (null = show nothing; it is best-effort
   * and never rejects). onCreateReferralLink allocates the shareable link
   * idempotently and REJECTS on failure so the card can offer a retry.
   */
  onReferralOffer?: () => Promise<ReferralOffer | null>;
  onCreateReferralLink?: () => Promise<{ code: string; link: string }>;
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
