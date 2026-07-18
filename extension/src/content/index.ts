import { createShadowRootUi, defineContentScript } from '#imports';
import type { ShadowRootContentScriptUi } from '#imports';
import type { Root } from 'react-dom/client';
import { mountOverlay, unmountOverlay } from '../overlay/mount';
import { PANEL_CLOSED_EVENT, PANEL_EXPANDED_EVENT, SESSION_RECAP_EVENT, type TurnResult } from '../overlay/Overlay';
import type { Utterance } from '../overlay/VoiceController';
import {
  clearAnnotations,
  showTurnAnnotations,
  showTurnAnnotationsSequenced,
  teardown as teardownAnnotations,
  type AnnotationRenderStats,
  type EquationRegistry,
} from './annotations';
import { extractPageContext } from './pageExtractor';
import { installGlobalErrorCapture } from '../lib/monitoring';
import type {
  AiReplyPayload,
  AnswerField,
  Annotation,
  CalyxaMessage,
  LogErrorPayload,
  OpeningScanReplyPayload,
  PageContext,
  PageTopic,
  ReferralLinkReplyPayload,
  ReferralOffer,
  ReferralOfferReplyPayload,
  SendFeedbackPayload,
  SendFeedbackReplyPayload,
  SessionEndedPayload,
  SessionStartInfo,
  SessionStatePayload,
  StatusPin,
  StickingCandidate,
  StrugglePrediction,
  StudyKitReplyPayload,
  StudyKitResult,
  TelemetryEvent,
  TurnMessage,
  VoiceSttReplyPayload,
  VoiceTtsReplyPayload,
  VoiceTtsStreamMessage,
  VoiceTurnStreamMessage,
} from '../types/messages';

// Overlay UI handle, created once per page in main(). Held at module scope
// because a content script's execution context lives for the page's lifetime —
// unlike the background service worker, where module-level state is lost between
// wakes. Task 4 toggles it (mount/remove) when the keyboard shortcut fires.
let overlayUi: ShadowRootContentScriptUi<Root> | undefined;

// The PageContext captured on the most recent overlay EXPAND (Sprint 07 Task
// 5/6, ADR-012/ADR-013; moved from overlay-MOUNT to overlay-EXPAND in
// Sprint 14 Task 6 -- the filed Sprint 13 live-find). Mount happens once per
// page load for a signed-in user, which on an SPA (Khan Academy) can run
// before the exercise even renders, leaving the whole session context-blind;
// expand (handlePanelExpand below, wired to Overlay.tsx's PANEL_EXPANDED_EVENT)
// is the actually-intended "fresh right before the tutor needs it" moment,
// and it re-fires on every re-expand too (not just the first), so an SPA
// navigation between minimizes is picked up. Never cached across opens,
// never persisted to disk/DB — read by sendAiTurn below to attach to the
// next AI_TURN. Undefined until the panel has been expanded at least once
// in this page's lifetime.
let capturedPageContext: PageContext | undefined;

// The equation-element registry captured ALONGSIDE the PageContext above
// (Sprint 12, ADR-022): capturedEquationElements[i] is the live source
// element of capturedPageContext.equations[i]. Same lifetime discipline —
// refreshed on every overlay EXPAND (Sprint 14 Task 6, moved with the
// capture above), never cached across opens — and it never leaves this
// content script: elements can't serialize, and by design the registry
// never rides a chrome.runtime message or persists (ADR-023).
// currentEquationRegistry() below zips this with capturedPageContext.equations
// into what the annotation resolver (annotations.ts, Task 5) matches
// textMatch targets against; sendAiTurn (Task 7) reads it per turn. Entries
// can go stale (an SPA re-render disconnects them); the resolver checks
// isConnected at draw/re-anchor time rather than this file policing
// staleness here.
let capturedEquationElements: (Element | null)[] = [];

// Zips the two module-scope arrays above into the shape the annotation
// resolver expects (Sprint 12 Task 7). Read fresh on every turn rather than
// cached alongside them, since it's a trivial O(n) map over data that's
// already held -- no reason to keep a second copy in sync.
function currentEquationRegistry(): EquationRegistry {
  const equations = capturedPageContext?.equations ?? [];
  return equations.map((equation, index) => ({
    equation,
    element: capturedEquationElements[index] ?? null,
  }));
}

// The panel-EXPAND handler (Sprint 14 Task 6): wired to Overlay.tsx's
// PANEL_EXPANDED_EVENT below, which fires on every real expand -- first
// open AND every re-expand after a minimize, keyboard shortcut or a direct
// pill click alike. Synchronous (extractPageContext is a one-shot DOM read,
// ADR-012) so the opening-scan effect's onOpeningScan call, triggered by
// the SAME expand and resolved in the next microtask, always sees this
// turn's fresh capture, never the previous one.
function handlePanelExpand(): void {
  const { context, equationElements } = extractPageContext();
  capturedPageContext = context;
  capturedEquationElements = equationElements;
}

// The opening-scan plausible-problem gate (Sprint 14 Task 6, ADR-030): a
// cheap, pure pre-filter so a blank tab or a non-math page never reaches
// the model for no value -- non-empty equations, OR a text excerpt past a
// trivial length. Exported for the Task 9 vitest spec (lifecycle.test.ts).
const MIN_PLAUSIBLE_TEXT_CHARS = 20;

export function isPlausibleProblem(context: PageContext | undefined): boolean {
  if (!context) return false;
  if (context.equations.length > 0) return true;
  return (context.text?.trim().length ?? 0) >= MIN_PLAUSIBLE_TEXT_CHARS;
}

// The opening scan's transport (Sprint 14 Task 6, ADR-030): called by
// Overlay.tsx once per real expand while the conversation is still empty.
// Gates on the freshly captured capturedPageContext (handlePanelExpand
// above already ran for this same expand); requests OPENING_SCAN only when
// the gate passes, draws any annotations the reply carries (same
// showTurnAnnotations call sendAiTurn uses), and resolves null -- never
// throws -- on every degrade path: nothing plausible on the page, a
// request failure, or an empty/whitespace reply (the model's own "not
// confident" signal, ADR-030 Decision 5). Overlay.tsx appends the result as
// the first assistant bubble; a null result renders nothing, same as a
// failed overview fetch.
//
// Sprint 14 Task 7: also surfaces `annotations` (in addition to drawing
// them, unchanged) so Overlay.tsx's color-linked highlighting can apply to
// the opening scan's own bubble too -- the model is held to the same
// exact-target.text-reuse discipline there (system-prompt.ts's OPENING SCAN
// MODE block), so there's no reason the first bubble should be exempt.
async function requestOpeningScan(): Promise<{
  reply: string;
  annotations?: Annotation[];
  prediction?: StrugglePrediction;
  topic?: PageTopic;
  stickingCandidates?: StickingCandidate[];
  commonSticking?: string[];
} | null> {
  if (!isPlausibleProblem(capturedPageContext)) return null;

  const registry = currentEquationRegistry();
  const message: CalyxaMessage = {
    type: 'OPENING_SCAN',
    payload: { pageContext: capturedPageContext },
  };

  let response: CalyxaMessage;
  try {
    response = await chrome.runtime.sendMessage(message);
  } catch (error) {
    console.warn('Calyxa content: opening scan not acknowledged', error);
    return null;
  }

  const payload = response?.payload as OpeningScanReplyPayload | undefined;
  if (!payload || 'error' in payload || !payload.reply.trim()) {
    return null;
  }

  emitAnnotationRendered(payload.annotations?.length ?? 0, showTurnAnnotations(payload.annotations ?? [], registry));
  return {
    reply: payload.reply,
    ...(payload.annotations && payload.annotations.length > 0 ? { annotations: payload.annotations } : {}),
    // The session-kickoff struggle prediction, the check-in's page-detected
    // topic, and its 5b sticking-point candidates (all grounded
    // server-side): ride through to the overlay's check-in, same additive
    // discipline.
    ...(payload.prediction ? { prediction: payload.prediction } : {}),
    ...(payload.topic ? { topic: payload.topic } : {}),
    ...(payload.stickingCandidates && payload.stickingCandidates.length > 0
      ? { stickingCandidates: payload.stickingCandidates }
      : {}),
    ...(payload.commonSticking && payload.commonSticking.length > 0
      ? { commonSticking: payload.commonSticking }
      : {}),
  };
}

// The overlay's AI_TURN transport. When `onChunk` is provided (text turns),
// streams via a persistent port (AI_STREAM) so the overlay can render
// word-by-word. When omitted (voice turns that need the full reply before
// TTS synthesis), falls back to the non-streaming sendMessage path.
// This is the ONLY chrome.* surface threaded into the overlay — Overlay.tsx
// itself never imports chrome.*, so this function is its sole window onto
// the extension. pageContext is captured at overlay-open time (see below).
//
// Sprint 15 (ADR-034): resolves { reply, pins? } instead of a bare string --
// status pins ride both reply paths (the port's `done` message and the
// AI_REPLY payload) additively, each key present only when the wire carried
// entries, so the overlay's omission checks mirror the route's own
// (replacing Sprint 13's profileTags/pings pair). Annotation handling on
// both paths is unchanged.
//
// Sprint 14 Task 7 (ADR-027/028/029): also surfaces `annotations`,
// `solutionProgress`, and `session` on the resolved TurnResult -- Task 6
// already put all three on the wire, but nothing downstream read them until
// now (the close choreography and the progress bar need session/
// solutionProgress; the color-linked highlighting needs the raw
// annotations, which the resolved DrawInstruction[] the layer draws from
// has already lost target.text by the time it's dispatched). Additive only
// -- the existing showTurnAnnotations draw call and pendingVoiceAnnotations
// sequencing are unchanged; this just ALSO hands the same array to Overlay.tsx.
async function sendAiTurn(
  messages: TurnMessage[],
  onChunk?: (text: string) => void,
  // The session-start kickoff's structured confirmation (SessionStartInfo)
  // -- present ONLY on the first turn fired by the check-in confirm /
  // reframe start, always with an empty `messages` array. Pure
  // pass-through: rides the AI_STREAM payload to the background and the
  // /api/ai/turn body from there; the server renders it into the prompt.
  sessionStart?: SessionStartInfo,
): Promise<TurnResult> {
  // Snapshotted once per turn, not re-read at reply time: a turn's whole
  // round trip should resolve against the page as it was when the turn was
  // sent, not whatever the overlay happens to hold by the time the reply
  // lands (Sprint 12 Task 7 -- "the current registry").
  const registry = currentEquationRegistry();

  if (onChunk) {
    return new Promise<TurnResult>((resolve, reject) => {
      const port = chrome.runtime.connect({ name: 'AI_STREAM' });
      let settled = false;

      port.onMessage.addListener(
        (msg: {
          type: string;
          text?: string;
          reply?: string;
          annotations?: Annotation[];
          pins?: StatusPin[];
          solutionProgress?: number;
          session?: TurnResult['session'];
          chips?: string[];
          answerFields?: AnswerField[];
          error?: string;
        }) => {
          if (msg.type === 'chunk' && msg.text) {
            onChunk(msg.text);
          } else if (msg.type === 'done' && !settled) {
            settled = true;
            port.disconnect();
            // New turn's annotations replace the previous turn's drawings
            // (controller behaviour); a turn with none is a no-op there.
            emitAnnotationRendered(
              msg.annotations?.length ?? 0,
              showTurnAnnotations(msg.annotations ?? [], registry),
            );
            resolve({
              reply: msg.reply ?? '',
              ...(msg.pins && msg.pins.length > 0 ? { pins: msg.pins } : {}),
              ...(msg.annotations && msg.annotations.length > 0 ? { annotations: msg.annotations } : {}),
              ...(msg.solutionProgress !== undefined ? { solutionProgress: msg.solutionProgress } : {}),
              ...(msg.session ? { session: msg.session } : {}),
              ...(msg.chips && msg.chips.length > 0 ? { chips: msg.chips } : {}),
              ...(msg.answerFields && msg.answerFields.length > 0 ? { answerFields: msg.answerFields } : {}),
            });
          } else if (msg.type === 'error' && !settled) {
            settled = true;
            port.disconnect();
            reject(new Error(msg.error ?? 'Unknown streaming error'));
          }
        },
      );

      port.onDisconnect.addListener(() => {
        if (!settled) {
          settled = true;
          reject(new Error('Background disconnected unexpectedly during streaming.'));
        }
      });

      port.postMessage({
        messages,
        pageContext: capturedPageContext,
        ...(sessionStart ? { sessionStart } : {}),
      });
    });
  }

  // Non-streaming path (voice turns): annotations are NOT drawn here.
  // Synthesis + playback happen after this promise resolves (Overlay.tsx's
  // handleMicStop calls onSynthesize then plays the audio), and the voice
  // sequencing feature needs the actual TTS duration -- unknown until
  // playback starts -- to time the reveal ladder. The resolved payload is
  // held here and consumed by handleVoicePlaybackStart below, once that
  // duration is known. Always overwrites any previous pending value, so an
  // interrupted/failed prior voice turn can never leak into this one.
  const message: CalyxaMessage = {
    type: 'AI_TURN',
    payload: { messages, pageContext: capturedPageContext },
  };
  const response: CalyxaMessage = await chrome.runtime.sendMessage(message);
  const payload = response.payload as AiReplyPayload;
  if ('error' in payload) {
    throw new Error(payload.error);
  }
  pendingVoiceAnnotations = { annotations: payload.annotations ?? [], registry };
  return {
    reply: payload.reply,
    ...(payload.pins && payload.pins.length > 0 ? { pins: payload.pins } : {}),
    ...(payload.annotations && payload.annotations.length > 0 ? { annotations: payload.annotations } : {}),
    ...(payload.solutionProgress !== undefined ? { solutionProgress: payload.solutionProgress } : {}),
    ...(payload.session ? { session: payload.session } : {}),
    ...(payload.chips && payload.chips.length > 0 ? { chips: payload.chips } : {}),
    ...(payload.answerFields && payload.answerFields.length > 0 ? { answerFields: payload.answerFields } : {}),
  };
}

// The overlay's STREAMED-ENVELOPE voice transport (Sprint 15 voice follow-on,
// ADR-033 amendment): opens the VOICE_TURN_STREAM port (same chrome.runtime.
// connect pattern as sendAiTurn's AI_STREAM branch) and relays each spoken-
// text delta to `onSayDelta` as it arrives, so Overlay.tsx can start
// per-sentence TTS before the whole reply is generated. Resolves the SAME
// TurnResult sendAiTurn's voice path does. Like that path, annotations are
// NOT drawn here -- they are held in pendingVoiceAnnotations and drawn at
// playback start (handleVoicePlaybackStart). sendAiTurn (non-streaming) stays
// the buffered fallback the overlay drops to on any streaming failure.
async function sendVoiceTurnStreaming(
  messages: TurnMessage[],
  onSayDelta: (text: string) => void,
): Promise<TurnResult> {
  const registry = currentEquationRegistry();
  return new Promise<TurnResult>((resolve, reject) => {
    const port = chrome.runtime.connect({ name: 'VOICE_TURN_STREAM' });
    let settled = false;

    port.onMessage.addListener((msg: VoiceTurnStreamMessage) => {
      if (msg.type === 'say') {
        onSayDelta(msg.text);
      } else if (msg.type === 'done' && !settled) {
        settled = true;
        port.disconnect();
        // Voice: annotations draw at PLAYBACK START, not here -- same as the
        // non-streaming voice branch in sendAiTurn.
        pendingVoiceAnnotations = { annotations: msg.annotations ?? [], registry };
        resolve({
          reply: msg.reply,
          ...(msg.pins && msg.pins.length > 0 ? { pins: msg.pins } : {}),
          ...(msg.annotations && msg.annotations.length > 0 ? { annotations: msg.annotations } : {}),
          ...(msg.solutionProgress !== undefined ? { solutionProgress: msg.solutionProgress } : {}),
          ...(msg.session ? { session: msg.session } : {}),
          ...(msg.chips && msg.chips.length > 0 ? { chips: msg.chips } : {}),
          ...(msg.answerFields && msg.answerFields.length > 0 ? { answerFields: msg.answerFields } : {}),
          // Cost-cap signal passthrough (2026-07-15 fix) -- see TurnResult.
          ...(msg.degraded ? { degraded: true as const } : {}),
        });
      } else if (msg.type === 'error' && !settled) {
        settled = true;
        port.disconnect();
        reject(new Error(msg.error));
      }
    });

    port.onDisconnect.addListener(() => {
      if (!settled) {
        settled = true;
        reject(new Error('Background disconnected unexpectedly during voice turn streaming.'));
      }
    });

    port.postMessage({ messages, pageContext: capturedPageContext });
  });
}

// The overlay's End-session transport (Sprint 13, ADR-025): the EXISTING
// END_SESSION message -- the same background handler, RPC, and storage
// clear the popup uses, no parallel path. The reply is a SESSION_STATE
// (error-carrying on failure); the recap arrives separately via the
// SESSION_ENDED broadcast handled in main() below.
async function endSessionFromOverlay(): Promise<void> {
  const response: CalyxaMessage = await chrome.runtime.sendMessage({ type: 'END_SESSION' });
  const payload = response.payload as SessionStatePayload | undefined;
  if (payload?.error) {
    throw new Error(payload.error);
  }
}

// The overlay's telemetry + feedback transports (Sprint 17 Task 6, ADR-043):
// the SAME "sole chrome.* surface threaded into the overlay" role as
// sendAiTurn above -- Overlay.tsx never imports chrome.*, so these are its
// only window onto the background. Both relay to the background, which is the
// sole network-egress context (ADR-006) and owns the /api/telemetry +
// /api/feedback calls. Threaded through mountOverlay below; Task 7's UI (the
// onboarding-completion event + the report/rate affordance) calls them.

/**
 * Fire-and-forget telemetry relay. A telemetry event that never lands is
 * invisible to the student -- the background batches and swallows POST
 * failures, and sendMessage itself can reject if the worker is unreachable
 * (swallowed here too). The events are the typed, content-free union
 * (no free-text field, ADR-043); nothing the student typed or the tutor said
 * can ride here.
 */
async function sendTelemetry(events: TelemetryEvent[]): Promise<void> {
  const message: CalyxaMessage = { type: 'SEND_TELEMETRY', payload: { events } };
  try {
    await chrome.runtime.sendMessage(message);
  } catch {
    // Worker asleep/unreachable -- a dropped telemetry event is acceptable.
  }
}

/**
 * Feedback relay. Unlike telemetry this is USER-initiated, so a failure IS
 * surfaced: the background replies { ok } / { error } and this rethrows on
 * error so the affordance (Task 7) can show a retry. `message` is the one
 * deliberate user-authored free-text field this sprint (ADR-043).
 */
async function sendFeedback(payload: SendFeedbackPayload): Promise<void> {
  const message: CalyxaMessage = { type: 'SEND_FEEDBACK', payload };
  const response: CalyxaMessage = await chrome.runtime.sendMessage(message);
  const reply = response?.payload as SendFeedbackReplyPayload | undefined;
  if (reply && 'error' in reply) {
    throw new Error(reply.error);
  }
}

/**
 * The `send` seam wired into monitoring.ts's installGlobalErrorCapture below
 * (Sprint 17 Task 6, ADR-043). The content script cannot reach the network
 * (ADR-006), so a captured, ALREADY-scrubbed error is relayed to the
 * background via LOG_ERROR, which forwards it to /api/errors. Fire-and-forget
 * and must never itself throw -- a failed error report becoming an error
 * would be its own bug (and, worse, could re-enter the capture).
 */
function sendLogError(event: LogErrorPayload): void {
  const message: CalyxaMessage = { type: 'LOG_ERROR', payload: event };
  void chrome.runtime.sendMessage(message).catch(() => {
    // Worker asleep/unreachable -- a dropped error report is acceptable.
  });
}

// The overlay's first-run tutorial transports (public launch, 2026-07-17),
// replacing the Sprint 17 diagnostic-onboarding relays (ADR-042 surface
// retired): same "sole chrome.* surface for the overlay" role as the
// transports above, but purely LOCAL -- whether the usage tour was seen is
// a UI fact, so it lives in chrome.storage.local (no background hop, no
// server call, nothing personal).

const TUTORIAL_SEEN_KEY = 'tutorialSeen';

/**
 * Reads whether the first-run tour was already completed/skipped. Never
 * throws -- a storage failure degrades to `true` (already seen), so a broken
 * storage layer can never nag the student on every page load.
 */
async function fetchTutorialSeen(): Promise<boolean> {
  try {
    const stored = await chrome.storage.local.get(TUTORIAL_SEEN_KEY);
    return stored[TUTORIAL_SEEN_KEY] === true;
  } catch {
    return true;
  }
}

/** Persists the seen flag (fired on both finish and skip). Best-effort. */
async function markTutorialSeen(): Promise<void> {
  try {
    await chrome.storage.local.set({ [TUTORIAL_SEEN_KEY]: true });
  } catch {
    // A failed write means the tour may show once more on the next page
    // load -- acceptable, and preferable to surfacing an error for it.
  }
}

/**
 * The feedback affordance's sessionId lookup (Sprint 17 Task 7, ADR-039):
 * "wired to the current sessionId when one is active". Reuses the EXISTING
 * GET_STATE message (no new message type -- background/index.ts's
 * buildSessionState already returns `activeSession`) rather than adding a
 * dedicated one; read FRESH at submit time, never cached, since the active
 * session can start/end at any point in the panel's lifetime. undefined on
 * any failure or when no session is active -- feedback.session_id is
 * optional (nullable FK), so this degrades to an unlinked capture, never a
 * blocked submission.
 */
async function getActiveSessionId(): Promise<string | undefined> {
  try {
    const response: CalyxaMessage = await chrome.runtime.sendMessage({ type: 'GET_STATE' });
    return (response?.payload as SessionStatePayload | undefined)?.activeSession?.sessionId;
  } catch {
    return undefined;
  }
}

/**
 * Study-kit generation relay (Sprint 21 Task 5, ADR-049): the SAME "sole
 * chrome.* surface for the overlay" role as the feedback relay above -- the
 * recap card can't reach the network (ADR-006), so it relays the just-ended
 * sessionId here and the background owns the /api/study/generate call.
 * Request/reply: returns the { kit } / { refused } outcome, and THROWS on
 * an { error } reply (or an unreachable worker) so the recap card's try/catch
 * shows a retry -- generation is user-initiated, so a failure is surfaced, not
 * swallowed (the sendFeedback posture).
 */
async function generateStudyKit(sessionId: string): Promise<StudyKitResult> {
  const message: CalyxaMessage = { type: 'GENERATE_STUDY_KIT', payload: { sessionId } };
  const response: CalyxaMessage = await chrome.runtime.sendMessage(message);
  const reply = response?.payload as StudyKitReplyPayload | undefined;
  if (!reply || 'error' in reply) {
    throw new Error(reply && 'error' in reply ? reply.error : 'study kit request did not reach the background');
  }
  return reply;
}

/**
 * Referral-offer relay (ADR-053): asked by the overlay at session close.
 * The background owns both the /api/referral/status call AND the
 * show-it-now suppression rules; this just relays the answer. Best-effort
 * like the telemetry relay -- any failure resolves null (no card), never an
 * error surface.
 */
async function fetchReferralOffer(): Promise<ReferralOffer | null> {
  try {
    const response: CalyxaMessage = await chrome.runtime.sendMessage({ type: 'GET_REFERRAL_OFFER' });
    return (response?.payload as ReferralOfferReplyPayload | undefined)?.offer ?? null;
  } catch {
    return null;
  }
}

/**
 * Referral-link relay (ADR-053): the referral card's "Get my invite link"
 * click. Request/reply with the sendFeedback/generateStudyKit posture --
 * user-initiated, so an { error } reply (or an unreachable worker) THROWS
 * and the card offers a retry.
 */
async function createReferralLink(): Promise<{ code: string; link: string }> {
  const message: CalyxaMessage = { type: 'CREATE_REFERRAL_LINK' };
  const response: CalyxaMessage = await chrome.runtime.sendMessage(message);
  const reply = response?.payload as ReferralLinkReplyPayload | undefined;
  if (!reply || 'error' in reply) {
    throw new Error(reply && 'error' in reply ? reply.error : 'referral link request did not reach the background');
  }
  return reply;
}

// Set by sendAiTurn's voice-path branch above when a reply arrives, and
// consumed the moment TTS playback actually starts (handleVoicePlaybackStart
// below) -- the gap between the two is exactly the onSynthesize + audio-
// decode time Overlay.tsx's handleMicStop spends between them. undefined
// whenever no voice reply is currently waiting on a playback-start signal.
let pendingVoiceAnnotations: { annotations: Annotation[]; registry: EquationRegistry } | undefined;

// Wired to Overlay.tsx's onVoicePlaybackStart (Sprint 12 follow-up): reveals
// the held turn's annotations sequenced to the now-known speech duration
// (showTurnAnnotationsSequenced -- "point at what's currently being said",
// item 2 of the live annotation-precision follow-up) instead of showing
// them all at once. A no-op if nothing is pending (e.g. a text turn, which
// never sets pendingVoiceAnnotations in the first place).
function handleVoicePlaybackStart(durationMs: number): void {
  if (!pendingVoiceAnnotations) return;
  const { annotations, registry } = pendingVoiceAnnotations;
  pendingVoiceAnnotations = undefined;
  emitAnnotationRendered(annotations.length, showTurnAnnotationsSequenced(annotations, registry, durationMs));
}

// Sprint 17 (ADR-043): emit the content-free `annotation_rendered` telemetry
// event ONLY when a turn actually carried annotations. `count` is how many
// resolved + drew -- a `count` of 0 with a non-zero `carried` is exactly the
// "the model sent annotations but none rendered" signal (the drop rate the
// annotation-precision work cares about); `fallback` flags a bbox last-resort
// anchor. Relayed through the same background egress (sendTelemetry) as every
// other event; fire-and-forget, never blocks the draw.
function emitAnnotationRendered(carried: number, stats: AnnotationRenderStats): void {
  if (carried === 0) return;
  void sendTelemetry([{ kind: 'annotation_rendered', count: stats.count, fallback: stats.fallback }]);
}

// The overlay's VOICE_STT/VOICE_TTS transports (Sprint 06). Same role as
// sendAiTurn above: the ONLY chrome.* surface threaded into the overlay for
// voice, relaying to the background worker and adding no host-page read.
// `audio` crosses the messaging boundary as base64 (ADR-010 — see the
// binary-over-messaging note in types/messages.ts), so each direction is
// encoded/decoded here, the mirror image of background/index.ts's helpers.
// Both voice transports pass the cost-cap degraded member through untouched
// (cost-cap fix, 2026-07-15): a capped leg is a DESIGNED outcome (ADR-041
// Decision 2 -- voice degrades to text), not an error, so it must not throw.
async function sendVoiceStt(
  audio: Utterance,
): Promise<{ transcript: string; sttMs: number } | { degraded: true }> {
  const message: CalyxaMessage = {
    type: 'VOICE_STT',
    payload: { audio: arrayBufferToBase64(audio.bytes), mimeType: audio.mimeType },
  };
  const response: CalyxaMessage = await chrome.runtime.sendMessage(message);
  const payload = response.payload as VoiceSttReplyPayload;
  if ('error' in payload) {
    throw new Error(payload.error);
  }
  if ('degraded' in payload) {
    return { degraded: true };
  }
  return payload;
}

async function sendVoiceTts(
  text: string,
): Promise<{ audio: ArrayBuffer; ttsMs: number; degraded?: undefined } | { degraded: true; ttsMs: 0 }> {
  const message: CalyxaMessage = { type: 'VOICE_TTS', payload: { text } };
  const response: CalyxaMessage = await chrome.runtime.sendMessage(message);
  const payload = response.payload as VoiceTtsReplyPayload;
  if ('error' in payload) {
    throw new Error(payload.error);
  }
  if ('degraded' in payload) {
    return { degraded: true, ttsMs: 0 };
  }
  return { audio: base64ToArrayBuffer(payload.audio), ttsMs: payload.ttsMs };
}

/**
 * Streaming sibling of sendVoiceTts (Sprint 15 Task 6, ADR-033): opens the
 * VOICE_TTS_STREAM port (the same chrome.runtime.connect pattern sendAiTurn
 * uses for AI_STREAM above) instead of a one-shot sendMessage, so `onChunk`
 * fires as each base64 chunk arrives rather than waiting for one full-reply
 * VOICE_TTS_REPLY. sendVoiceTts above is UNTOUCHED and stays the fallback
 * Overlay.tsx falls back to per-utterance on a MediaSource/codec failure.
 */
async function sendVoiceTtsStream(
  text: string,
  onChunk: (chunk: Uint8Array) => void,
): Promise<{ ttsMs: number; degraded?: true }> {
  return new Promise<{ ttsMs: number; degraded?: true }>((resolve, reject) => {
    const port = chrome.runtime.connect({ name: 'VOICE_TTS_STREAM' });
    let settled = false;

    port.onMessage.addListener((msg: VoiceTtsStreamMessage) => {
      if (msg.type === 'chunk') {
        onChunk(base64ToUint8Array(msg.audio));
      } else if (msg.type === 'done' && !settled) {
        settled = true;
        port.disconnect();
        // `degraded` passthrough (cost-cap fix, 2026-07-15): no chunks were
        // relayed on a capped leg; the overlay reveals text instead.
        resolve({ ttsMs: msg.ttsMs, ...(msg.degraded ? { degraded: true as const } : {}) });
      } else if (msg.type === 'error' && !settled) {
        settled = true;
        port.disconnect();
        reject(new Error(msg.error));
      }
    });

    port.onDisconnect.addListener(() => {
      if (!settled) {
        settled = true;
        reject(new Error('Background disconnected unexpectedly during TTS streaming.'));
      }
    });

    port.postMessage({ text });
  });
}

/**
 * btoa/atob operate on binary strings, not bytes directly, so a typed-array
 * walk is needed on each side. Fine for a single short push-to-talk
 * utterance (ADR-010) -- this is not a bulk-data path.
 */
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

/** Same walk as base64ToArrayBuffer, returning a Uint8Array view directly (VOICE_TTS_STREAM chunks feed a SourceBuffer, which wants a typed array, not an ArrayBuffer). */
function base64ToUint8Array(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

// Calyxa content script.
//
// DOM policy (locked): READ-ONLY on the host page. This script must never
// read-modify any node, style, or attribute that belongs to the host page.
//
// The ONE sanctioned exception (ADR-002): the overlay lives in a shadow root on
// a single extension-owned host element, <calyxa-overlay>, appended to the
// document root and removed on dismissal. The shadow boundary isolates its
// styles, so nothing the overlay does is observable in the host page's light
// DOM. createShadowRootUi does not touch the host DOM until ui.mount() runs, so
// while the overlay is closed the host-page footprint is zero.
//
// Sprint 07 adds the first actual READ of host-page content: on every
// overlay EXPAND (Sprint 14 Task 6 -- moved from overlay mount, see
// handlePanelExpand above), extractPageContext() (pageExtractor.ts) makes a
// one-shot, synchronous, read-only pass over the page's math + visible
// text, excluding this script's own <calyxa-overlay> host. The result is
// held at module scope only long enough to attach to the next AI_TURN — it
// is never written to disk/DB (ADR-012/ADR-013).
export default defineContentScript({
  // (1) Inject on every page the student visits.
  matches: ['<all_urls>'],
  // Route the bundled overlay stylesheet INTO the shadow root (consumed by
  // createShadowRootUi below) instead of injecting it into the host page <head>.
  cssInjectionMode: 'ui',
  async main(ctx) {
    // (2) Confirm injection.
    console.log(`Calyxa content: injected on ${window.location.hostname}`);

    // (2b) Error monitoring (Sprint 17 Task 6, ADR-043). Capture uncaught
    // errors + unhandled rejections in THIS content script's isolated world
    // (`window`) and relay them, scrubbed, to the background via LOG_ERROR
    // (sendLogError). Registered first thing so an error during the awaits
    // below is still caught. The content script runs in an isolated JS world,
    // so this sees the extension's own errors, never the host page's scripts
    // -- exactly right: host-page errors are neither ours to report nor free
    // of the page content we must not capture. The scrub (monitoring.ts) has
    // already stripped everything but message/stack + a coarse `context`
    // BEFORE anything crosses to the background.
    installGlobalErrorCapture(window, sendLogError, { context: 'content' });

    // (3) Two listeners, registered FIRST and synchronously — before any
    // `await` below — because the awaits that follow (CONTENT_READY,
    // GET_STATE, createShadowRootUi's stylesheet fetch) take real time and
    // either event can arrive in that window; both are queued if `overlayUi`
    // isn't built yet.
    //
    // SESSION_STATE (Sprint 10 Task 6 round 4): the background pushes this on
    // every sign-in/sign-out (not just as a GET_STATE reply — see
    // broadcastToAllTabs in background/index.ts) so the idle pill mounts or
    // unmounts live for every open tab, matching "the pill stays up as long
    // as the user is signed in" rather than requiring a page reload.
    //
    // TOGGLE_OVERLAY: the keyboard shortcut no longer mounts/removes the
    // overlay (that is now purely a function of signedIn) — it opens/closes
    // the expanded panel on an already-mounted idle pill instead, via a
    // window CustomEvent Overlay.tsx listens for. A page with no signed-in
    // user has nothing mounted to toggle, so the shortcut is a no-op there.
    // The panel-close signal (Overlay.tsx's handleClose, Sprint 12 Task 6):
    // a dismissed tutor leaves a clean page, so the annotation controller
    // clears whatever it's holding. Registered once for the content
    // script's whole lifetime, same as the listener below -- annotations
    // are controller-owned state independent of any one overlay mount.
    window.addEventListener(PANEL_CLOSED_EVENT, () => {
      clearAnnotations();
    });

    // The panel-EXPAND signal (Sprint 14 Task 6): fires on every real
    // expand -- see handlePanelExpand's own comment for why this replaces
    // the old onMount-time capture below. Registered once for the content
    // script's lifetime, same as the listener above.
    window.addEventListener(PANEL_EXPANDED_EVENT, handlePanelExpand);

    let pendingToggle = false;
    let pendingSignedIn: boolean | undefined;
    chrome.runtime.onMessage.addListener((message: CalyxaMessage) => {
      if (message.type === 'SESSION_STATE') {
        const { signedIn } = message.payload as SessionStatePayload;
        console.log('Calyxa content: SESSION_STATE pushed; signedIn =', signedIn);
        if (!overlayUi) {
          pendingSignedIn = signedIn;
          return;
        }
        applySignedIn(overlayUi, signedIn);
        return;
      }
      // SESSION_ENDED (Sprint 13, ADR-025): forwarded to the overlay as the
      // SESSION_RECAP_EVENT window CustomEvent (the 'calyxa:toggle-panel'
      // bridge). Registered once here for the content script's lifetime,
      // like the panel-close listener above; if no panel is mounted/open,
      // the event simply has no listener -- ephemeral by design.
      if (message.type === 'SESSION_ENDED') {
        // `sessionId` (Sprint 21 Task 5, ADR-049) rides through to the recap
        // card so it can generate a study kit for the just-ended session.
        const { recap, sessionId } = (message.payload ?? {}) as SessionEndedPayload;
        window.dispatchEvent(
          new CustomEvent(SESSION_RECAP_EVENT, {
            detail: { ...(recap ? { recap } : {}), ...(sessionId ? { sessionId } : {}) },
          }),
        );
        return;
      }
      if (message.type !== 'TOGGLE_OVERLAY') return;
      console.log('Calyxa content: TOGGLE_OVERLAY received; overlay ready =', !!overlayUi);
      if (!overlayUi) {
        pendingToggle = true;
        return;
      }
      if (overlayUi.mounted) {
        window.dispatchEvent(new CustomEvent('calyxa:toggle-panel'));
      }
    });

    // (4) Announce readiness to the background service worker (Sprint 01). The
    // worker may be asleep and sendMessage can throw / reject, so guard it.
    const message: CalyxaMessage = { type: 'CONTENT_READY' };
    try {
      const response = await chrome.runtime.sendMessage(message);
      if (response !== undefined) {
        console.log('Calyxa content: response from background', response);
      }
    } catch (error) {
      console.warn('Calyxa content: CONTENT_READY not acknowledged', error);
    }

    // (4b) Read the current signedIn state (Sprint 10 Task 6 round 4). The
    // idle pill's visibility tracks this directly rather than the keyboard
    // shortcut, so an already-authenticated user sees it on every page with
    // no shortcut press required. Defaults to signed-out if the query fails
    // (e.g. a cold service-worker wake) -- the SESSION_STATE push above
    // still catches up if the real state was signed-in.
    let signedInAtLoad = false;
    try {
      const stateResponse: CalyxaMessage = await chrome.runtime.sendMessage({ type: 'GET_STATE' });
      signedInAtLoad = (stateResponse?.payload as SessionStatePayload | undefined)?.signedIn ?? false;
    } catch (error) {
      console.warn('Calyxa content: GET_STATE not acknowledged', error);
    }

    // (5) Build the overlay UI once. createShadowRootUi is async because it
    // fetches the bundled stylesheet to inject into the shadow root. The host
    // element is appended to the document root (<html>) so it cannot be trapped
    // inside a host-page stacking context. Mounting itself is deferred to step
    // 6 below, which applies whichever signedIn state is freshest (the initial
    // read above, or a SESSION_STATE push that arrived while this was in flight).
    overlayUi = await createShadowRootUi<Root>(ctx, {
      name: 'calyxa-overlay',
      position: 'inline',
      anchor: document.documentElement,
      append: 'last',
      onMount: (container) => {
        // No PageContext capture here (Sprint 14 Task 6 -- the filed Sprint
        // 13 live-find): building the idle pill is NOT "the tutor is about
        // to need this page's content" the way expanding the panel is. See
        // handlePanelExpand and the PANEL_EXPANDED_EVENT listener above --
        // capturedPageContext/capturedEquationElements stay whatever they
        // were (undefined, before the first-ever expand) until that fires.
        return mountOverlay(container, {
          onSend: sendAiTurn,
          onSendVoiceStreaming: sendVoiceTurnStreaming,
          onTranscribe: sendVoiceStt,
          onSynthesize: sendVoiceTts,
          onSynthesizeStream: sendVoiceTtsStream,
          onVoicePlaybackStart: handleVoicePlaybackStart,
          onEndSession: endSessionFromOverlay,
          onOpeningScan: requestOpeningScan,
          // Sprint 17 Task 6 (ADR-043): the telemetry + feedback transports.
          // Threaded now so the overlay-origin path is live; Task 7's UI (the
          // onboarding-completion event + the report/rate affordance) consumes
          // props.onSendTelemetry / props.onReportFeedback.
          onSendTelemetry: sendTelemetry,
          onReportFeedback: sendFeedback,
          // Public launch (2026-07-17): the first-run tutorial's seen-flag
          // transports (chrome.storage.local, no server call).
          onFetchTutorialSeen: fetchTutorialSeen,
          onMarkTutorialSeen: markTutorialSeen,
          // Sprint 17 Task 7 (ADR-039): the feedback affordance's sessionId lookup.
          onGetActiveSessionId: getActiveSessionId,
          // Sprint 21 Task 5 (ADR-049): the recap card's study-kit generation
          // transport -- relays the just-ended sessionId to the background,
          // which owns the /api/study/generate call.
          onGenerateStudyKit: generateStudyKit,
          // ADR-053: the referral card's transports -- the offer check (asked
          // at session close; background owns the API call + suppression) and
          // the link creation (user-initiated, throws so the card can retry).
          onReferralOffer: fetchReferralOffer,
          onCreateReferralLink: createReferralLink,
        });
      },
      onRemove: (root) => {
        // Full annotation teardown (listeners, timers, the layer's dispatch
        // to an empty set) on overlay unmount / sign-out (Sprint 12 Task 7)
        // -- the shadow root's own removal already guarantees no pixel
        // survives, but the controller's window-level scroll/resize
        // listeners and ttl timers are outside that shadow root and need
        // their own cleanup.
        teardownAnnotations();
        if (root) unmountOverlay(root);
      },
    });

    // (6) Apply whichever signedIn state is freshest: a SESSION_STATE push
    // that arrived while createShadowRootUi was in flight (step 3) wins over
    // the step 4b snapshot, since it is strictly newer.
    applySignedIn(overlayUi, pendingSignedIn ?? signedInAtLoad);

    // Apply a toggle that arrived before setup finished (see step 3). Only
    // meaningful if the pill ended up mounted above -- signed-out has
    // nothing to open.
    if (pendingToggle && overlayUi.mounted) {
      console.log('Calyxa content: applying queued toggle from before overlay was ready');
      window.dispatchEvent(new CustomEvent('calyxa:toggle-panel'));
    }
  },
});

/** Mounts or removes the overlay host to match `signedIn`, idempotently. */
function applySignedIn(ui: ShadowRootContentScriptUi<Root>, signedIn: boolean): void {
  if (signedIn && !ui.mounted) {
    ui.mount();
  } else if (!signedIn && ui.mounted) {
    ui.remove();
  }
}
