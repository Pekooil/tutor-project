import { defineBackground } from '#imports';
import type {
  AiTurnPayload,
  CalyxaMessage,
  GenerateStudyKitPayload,
  LogErrorPayload,
  OpeningScanPayload,
  PageContext,
  SendFeedbackPayload,
  SendFeedbackReplyPayload,
  SendTelemetryPayload,
  SessionStatePayload,
  SignInPayload,
  StartSessionPayload,
  StudyKitReplyPayload,
  TelemetryEvent,
  TurnMessage,
  VoiceSttPayload,
  VoiceTtsPayload,
} from '../types/messages';
import * as api from '../lib/api';
import { installGlobalErrorCapture } from '../lib/monitoring';
import {
  clearRunningTranscript,
  getActiveSession,
  getAuth,
  getRunningTranscript,
  setRunningTranscript,
} from '../lib/storage';

// Calyxa background service worker (Manifest V3).
//
// MV3 constraints observed here:
//   - The service worker is NOT persistent. No in-memory variable is assumed to
//     survive between wake cycles; all persisted state lives in
//     chrome.storage.local.
//   - No setInterval/setTimeout at the top level — the worker can be killed and
//     a pending timer would be lost.
//   - No DOM access — service workers have no DOM.
export default defineBackground(() => {
  // This function runs on every service worker wake (the MV3 equivalent of
  // top-level module execution). Register event listeners synchronously here so
  // they are in place before any event fires after a wake.

  // (1) First install: announce, initialise the persisted wake counter, and
  // (public launch, 2026-07-17) open the website's guided setup in a new tab —
  // a fresh install has no account and no visible surface (the overlay only
  // mounts signed-in), so /welcome is where they learn to create an account,
  // pin the icon, and sign in. `reason === 'install'` only: updates and
  // browser restarts must never pop a tab.
  chrome.runtime.onInstalled.addListener((details) => {
    console.log('Calyxa SW: installed', details.reason);
    void chrome.storage.local.set({ wakeCount: 0 });
    if (details.reason === 'install') {
      void chrome.tabs.create({ url: `${api.API_BASE}/welcome?src=extension` });
    }
  });

  // (1b) Error monitoring (Sprint 17 Task 6, ADR-043). Capture uncaught
  // errors + unhandled rejections in the WORKER's own global scope (`self`)
  // and relay them, already scrubbed by monitoring.ts, straight to
  // /api/errors via api.reportError. The background is the sole
  // network-egress context (ADR-006), so it forwards directly -- there is no
  // LOG_ERROR hop here (that hop is the CONTENT script's, which cannot reach
  // the network and relays to the background instead). api.reportError never
  // throws and holds no DSN (the secret lives only in the /api/errors route),
  // so this can neither feed back into itself nor leak a key into the bundle.
  // Registered synchronously on every wake so it is in place before any later
  // handler here can throw.
  installGlobalErrorCapture(self, (event) => void api.reportError(event), { context: 'background' });

  // (3) Log every inbound message. No specific message types are handled yet,
  // and nothing here calls sendResponse, so the listener must NOT return true —
  // `true` tells Chrome an async response is coming, and the sender's
  // `await chrome.runtime.sendMessage(...)` hangs forever waiting for a
  // response that never arrives. Returning false/undefined resolves the
  // sender's promise immediately with `undefined`.
  chrome.runtime.onMessage.addListener((message: CalyxaMessage) => {
    console.log('Calyxa SW: message received', message);
    return false;
  });

  // (4) Relay the toggle-overlay keyboard command to the active tab's content
  // script, which owns the overlay. Commands are delivered to the service
  // worker only, so the SW forwards them. Registered synchronously like the
  // listeners above, so it is in place before any command fires after a wake.
  chrome.commands.onCommand.addListener((command) => {
    console.log('Calyxa SW: command received', command);
    if (command !== 'toggle-overlay') return;
    void toggleOverlayInActiveTab();
  });

  // (4b) Auth + session messages from the popup (Sprint 04 Task 7). Unlike
  // listener (3) above, every branch here calls sendResponse asynchronously,
  // so this listener MUST return true for the types it handles — `true`
  // keeps the message channel open until sendResponse fires. It returns
  // false for anything else so it never blocks listener (3)'s synchronous
  // logging path. Every handler re-reads chrome.storage.session itself
  // (directly, or via lib/api.ts) rather than trusting any in-memory value,
  // since the worker can have been killed and woken between messages.
  chrome.runtime.onMessage.addListener((message: CalyxaMessage, sender, sendResponse) => {
    switch (message.type) {
      case 'GET_STATE':
        void buildSessionState().then(sendResponse);
        return true;
      case 'SIGN_IN':
        void handleSignIn(message.payload as SignInPayload).then(sendResponse);
        return true;
      case 'SIGN_OUT':
        void handleSignOut().then(sendResponse);
        return true;
      case 'START_SESSION':
        void handleStartSession((message.payload as StartSessionPayload | undefined) ?? { pageDomain: null }).then(
          sendResponse,
        );
        return true;
      case 'END_SESSION':
        void handleEndSession().then(sendResponse);
        return true;
      case 'AI_TURN': {
        const { messages, pageContext } = message.payload as AiTurnPayload;
        void handleAiTurn(messages, pageContext, deriveTabDomain(sender.tab?.url)).then(sendResponse);
        return true;
      }
      case 'VOICE_STT':
        void handleVoiceStt(message.payload as VoiceSttPayload).then(sendResponse);
        return true;
      case 'VOICE_TTS':
        void handleVoiceTts(message.payload as VoiceTtsPayload).then(sendResponse);
        return true;
      case 'OPENING_SCAN': {
        const payload = message.payload as OpeningScanPayload;
        void handleOpeningScan(payload, deriveTabDomain(sender.tab?.url)).then(sendResponse);
        return true;
      }
      // (Sprint 17 Task 6, ADR-043) Beta-instrumentation egress. The overlay
      // and content script never reach the network (ADR-006); they relay these
      // three, and the worker owns the /api/telemetry, /api/feedback, and
      // /api/errors calls.
      case 'SEND_TELEMETRY': {
        // Fire-and-forget: buffered + flushed + failure-swallowed by
        // enqueueTelemetry. No response awaited, so return false (never true)
        // -- the sender's sendMessage promise resolves immediately.
        const { events } = message.payload as SendTelemetryPayload;
        void enqueueTelemetry(events);
        return false;
      }
      case 'SEND_FEEDBACK':
        // Request/reply, unlike the other two: feedback is user-initiated, so
        // the affordance (Task 7) gets an { ok } / { error } back to surface a
        // save failure.
        void handleSendFeedback(message.payload as SendFeedbackPayload).then(sendResponse);
        return true;
      case 'LOG_ERROR':
        // Fire-and-forget relay of an ALREADY-scrubbed content-script error
        // (monitoring.ts scrubbed it before it left the content script) to
        // /api/errors. api.reportError never throws and drops the scrub's
        // `timestamp` (the route rejects extra keys).
        void api.reportError(message.payload as LogErrorPayload);
        return false;
      // (Public launch, 2026-07-17) The Sprint 17 ONBOARDING_STATUS /
      // ONBOARDING_SUBMIT relays are retired with the diagnostic onboarding
      // surface — the first-run tutorial that replaced it persists its seen
      // flag in chrome.storage.local from the content script, with no
      // background hop and no /api/onboarding call.
      // (Sprint 21 Task 5, ADR-049) Study-kit generation. The recap card can't
      // reach the network (ADR-006), so it relays the just-ended sessionId here
      // and the worker owns the /api/study/generate call. Request/reply like
      // SEND_FEEDBACK: a failure IS surfaced so the card can retry.
      case 'GENERATE_STUDY_KIT':
        void handleGenerateStudyKit(message.payload as GenerateStudyKitPayload).then(sendResponse);
        return true;
      default:
        return false;
    }
  });

  // (4c) Word-by-word AI turn via a persistent port (chrome.runtime.connect).
  // The content script opens 'AI_STREAM', sends { messages, pageContext }, and
  // receives one chunk message per token so the overlay can animate them
  // word-by-word. Sprint 19 Task 8: ordinary text turns now stream those tokens
  // straight from the server's envelope SSE route (/api/ai/turn/stream, the same
  // route the voice path uses) so text replies begin rendering at the first
  // delta; the session-start opener alone stays on the buffered /api/ai/turn
  // path and is split client-side (SESSION START MODE is not on the stream
  // route -- see the handler). ADR-006 upheld: the background service worker
  // remains the sole network-egress context.
  //
  // Sprint 11 (ADR-019): the worker attaches the stored active sessionId +
  // the measured think-time to the relay (getTurnContext) and stamps the
  // reply-delivered anchor afterwards (stampTurnAnchor) so the NEXT turn can
  // measure. Transport only — the payload the overlay sends and the
  // chunk/done messages it receives are otherwise unchanged.
  //
  // Sprint 12 (ADR-023): `done` additionally carries `annotations` when
  // api.aiTurn() returned any — OMITTED (not `undefined`, not `[]`) on a
  // turn with none, so a no-annotation `done` message is byte-identical to
  // Sprint 11's `{ type: 'done', reply }`. Sprint 15 (ADR-034) threads
  // `pins` the same way, alongside annotations (replacing Sprint 13's
  // profileTags/pings pair). Sprint 14 (ADR-027/028) threads
  // `solutionProgress`/`session` the same additive way.
  // (4d) Streamed TTS via a dedicated persistent port (Sprint 15 Task 6,
  // ADR-033) -- the AI_STREAM pattern reused for voice. content/index.ts
  // opens 'VOICE_TTS_STREAM', posts one VoiceTtsPayload ({text}), and
  // receives base64 chunk messages as the route's ElevenLabs stream arrives,
  // followed by exactly one 'done' (with ttsMs) or 'error'. The existing
  // one-shot VOICE_TTS handler above is untouched -- it remains the
  // per-utterance fallback the overlay uses when MediaSource/codec friction
  // makes the streamed path unusable.
  chrome.runtime.onConnect.addListener((port) => {
    if (port.name !== 'VOICE_TTS_STREAM') return;
    port.onMessage.addListener(async (msg: VoiceTtsPayload) => {
      try {
        const { ttsMs, degraded, degradedCap } = await api.ttsSynthesizeStream(msg.text, (chunk) => {
          try {
            port.postMessage({ type: 'chunk', audio: uint8ArrayToBase64(chunk) });
          } catch {
            // Port already disconnected -- the reader loop in
            // ttsSynthesizeStream keeps draining, but further chunks are
            // dropped here too; caught again on the next postMessage.
          }
        });
        // Sprint 18 Task 8 (ADR-043): a cost-capped TTS leg emits degraded_hit.
        // On degrade no chunks were posted; the 'done' below carries ttsMs 0
        // plus the `degraded` flag (cost-cap fix, 2026-07-15) so the overlay's
        // streaming player stops waiting for audio and reveals text instead.
        if (degraded && degradedCap) emitDegradedHit(degradedCap, 'elevenlabs_tts');
        try {
          port.postMessage({ type: 'done', ttsMs, ...(degraded ? { degraded: true } : {}) });
        } catch {
          // Port already disconnected -- all chunks were sent, no action needed.
        }
      } catch (error) {
        try {
          port.postMessage({ type: 'error', error: toErrorMessage(error) });
        } catch {
          // Port already disconnected.
        }
      }
    });
  });

  chrome.runtime.onConnect.addListener((port) => {
    if (port.name !== 'AI_STREAM') return;
    // Captured once per port (one port per sendAiTurn call, i.e. per turn) --
    // the fallback auto-start trigger (ADR-027 Decision 1, amended) needs the
    // SAME pageDomain derivation the opening scan and the old popup used.
    const pageDomain = deriveTabDomain(port.sender?.tab?.url);
    port.onMessage.addListener(async (msg: AiTurnPayload) => {
      try {
        await ensureSessionStarted(pageDomain, 'text');
        const turnContext = await getTurnContext();
        // Sprint 19 Task 8: ordinary text turns now stream token-by-token from
        // the server via the envelope SSE route (/api/ai/turn/stream, the exact
        // route the voice path already uses) instead of the old
        // buffer-then-client-split -- so a text reply begins rendering at the
        // first delta instead of only after the whole reply is generated. Each
        // server `sayDelta` is relayed as the SAME 'chunk' message the overlay
        // already consumes, so nothing downstream (content/sendAiTurn, Overlay)
        // changes. The SESSION-START opener is the one exception: its structured
        // sessionStart field drives SESSION START MODE, which the stream route
        // doesn't implement, so that single first turn stays on the buffered
        // /api/ai/turn path (client-split into chunks below) -- keeping the
        // server pedagogy change out of Task 8's latency-only scope.
        const result = msg.sessionStart
          ? await api.aiTurn(msg.messages, msg.pageContext, turnContext, msg.sessionStart)
          : await api.aiTurnEnvelopeStream(msg.messages, msg.pageContext, turnContext, (text) => {
              try { port.postMessage({ type: 'chunk', text }); } catch { /* port disconnected */ }
            });
        const { reply, annotations, pins, solutionProgress, session, chips, answerFields, degraded, degradedCap } =
          result;
        // Sprint 18 Task 8 (ADR-043): a cost-capped turn emits degraded_hit.
        if (degraded && degradedCap) emitDegradedHit(degradedCap, 'claude_turn');
        // The session-start opener didn't stream, so split its buffered reply
        // into chunks here (whitespace boundaries, trailing spaces kept on the
        // preceding token so the overlay reconstructs spacing). The streamed
        // path already posted its chunks via the onSayDelta relay above.
        if (msg.sessionStart) {
          const tokens = reply.match(/\S+\s*/g) ?? [];
          for (const token of tokens) {
            try { port.postMessage({ type: 'chunk', text: token }); } catch { break; }
          }
        }
        await setRunningTranscript(msg.messages);
        await stampTurnAnchor(turnContext.sessionId);
        // ADR-027 Decision 2: AI-signaled, client-confirmed end. The signal
        // itself (session.complete) is enough to end it server-side right
        // away; the VISIBLE close choreography (recap wait -> ring ->
        // collapse) is Task 7's job once solutionProgress/session reach the
        // overlay. Unawaited, like every other broadcast in this file — the
        // reply is not held up waiting for /api/session/end, and Task 7's
        // own design already tolerates the recap arriving asynchronously.
        if (session?.complete) void handleEndSession();
        try {
          port.postMessage({
            type: 'done',
            reply,
            ...(annotations ? { annotations } : {}),
            ...(pins ? { pins } : {}),
            ...(solutionProgress !== undefined ? { solutionProgress } : {}),
            ...(session ? { session } : {}),
            ...(chips ? { chips } : {}),
            ...(answerFields ? { answerFields } : {}),
          });
        } catch {
          // Port already disconnected — all chunks were sent, no action needed.
        }
      } catch (error) {
        try {
          port.postMessage({ type: 'error', error: toErrorMessage(error) });
        } catch {
          // Port already disconnected.
        }
      }
    });
  });

  // (4e) Streamed-envelope VOICE turn via a dedicated persistent port (Sprint
  // 15 voice follow-on, ADR-033 amendment) -- the AI_STREAM pattern, but for
  // the VOICE path and carrying the FORCED-TOOL envelope. content/index.ts
  // opens 'VOICE_TURN_STREAM', posts one AiTurnPayload, and receives one 'say'
  // message per spoken-text delta (so the overlay can start per-sentence TTS
  // before the reply finishes -- the ~4-5s leg the latency probe found),
  // followed by exactly one 'done' (the full envelope) or 'error'. The one-shot
  // AI_TURN/handleAiTurn path above is UNTOUCHED and stays the buffered
  // fallback the overlay drops to on any streaming failure. Same session +
  // think-time bookkeeping as handleAiTurn (voice mode, ADR-019/027).
  chrome.runtime.onConnect.addListener((port) => {
    if (port.name !== 'VOICE_TURN_STREAM') return;
    const pageDomain = deriveTabDomain(port.sender?.tab?.url);
    port.onMessage.addListener(async (msg: AiTurnPayload) => {
      try {
        await ensureSessionStarted(pageDomain, 'voice');
        const turnContext = await getTurnContext();
        const { reply, annotations, pins, solutionProgress, session, chips, answerFields, degraded, degradedCap } =
          await api.aiTurnEnvelopeStream(msg.messages, msg.pageContext, turnContext, (text) => {
            try {
              port.postMessage({ type: 'say', text });
            } catch {
              // Port already disconnected -- the stream keeps draining so the
              // final envelope still lands (or is dropped on the done post).
            }
          });
        // Sprint 18 Task 8 (ADR-043): a cost-capped voice turn emits degraded_hit.
        if (degraded && degradedCap) emitDegradedHit(degradedCap, 'claude_turn');
        await setRunningTranscript(msg.messages);
        await stampTurnAnchor(turnContext.sessionId);
        if (session?.complete) void handleEndSession();
        try {
          port.postMessage({
            type: 'done',
            reply,
            ...(annotations ? { annotations } : {}),
            ...(pins ? { pins } : {}),
            ...(solutionProgress !== undefined ? { solutionProgress } : {}),
            ...(session ? { session } : {}),
            ...(chips ? { chips } : {}),
            ...(answerFields ? { answerFields } : {}),
            // Cost-cap fix (2026-07-15): thread the turn's degraded flag to
            // the overlay (it was stripped here before) so a capped reply is
            // knowably text-only-by-design.
            ...(degraded ? { degraded: true } : {}),
          });
        } catch {
          // Port already disconnected.
        }
      } catch (error) {
        try {
          port.postMessage({ type: 'error', error: toErrorMessage(error) });
        } catch {
          // Port already disconnected.
        }
      }
    });
  });

  // (2) Every wake: read → increment → persist → log the wake counter.
  void recordWake();

  // (5) Dev diagnostic: warn loudly if the toggle command has no bound key, so
  // an unbound shortcut is never a silent failure (see the helper for why this
  // happens after a hot reload).
  void warnIfToggleShortcutUnbound();
});

/**
 * Reads the persisted wake counter, increments it, writes it back, and logs the
 * new value. Awaits every chrome.storage call so a read never races ahead of
 * the previous write (see the sprint plan's MV3 storage risk note).
 */
async function recordWake(): Promise<void> {
  const stored = await chrome.storage.local.get('wakeCount');
  const current = typeof stored.wakeCount === 'number' ? stored.wakeCount : 0;
  const next = current + 1;
  await chrome.storage.local.set({ wakeCount: next });
  console.log(`Calyxa SW: wake #${next}`);
}

/**
 * Forwards a TOGGLE_OVERLAY message to the active tab's content script.
 * chrome.tabs.sendMessage rejects on tabs with no content script (chrome://
 * pages, the Web Store, the New Tab page), so the call is guarded and such a
 * failure is a deliberate no-op.
 */
async function toggleOverlayInActiveTab(): Promise<void> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  console.log('Calyxa SW: relaying TOGGLE_OVERLAY to active tab', tab?.id, tab?.url);
  if (!tab?.id) return;
  const message: CalyxaMessage = { type: 'TOGGLE_OVERLAY' };
  try {
    await chrome.tabs.sendMessage(tab.id, message);
  } catch (error) {
    // Most common cause: the page was open before the extension's last reload,
    // so it has no live content script. Reloading the page fixes it.
    console.warn(
      'Calyxa SW: could not reach the content script — reload the page and retry',
      error,
    );
  }
}

/**
 * Logs a warning when the `toggle-overlay` command has no keyboard shortcut.
 *
 * Chrome applies a command's manifest `suggested_key` ONLY on first install —
 * never on an update or in-place reload (which is what `wxt dev` hot-reload and
 * the chrome://extensions "Reload" button do). So if the extension was first
 * loaded with a different or unbindable key (e.g. Cmd+Shift+M, which Chrome
 * reserves for the profile switcher), the command stays unbound even after the
 * manifest is corrected and rebuilt — and the keypress silently does nothing.
 * Surfacing it here makes that invisible failure actionable: assign the key at
 * chrome://extensions/shortcuts, or fully restart `wxt dev` (a new profile means
 * a fresh install, so the suggested_key is applied).
 */
async function warnIfToggleShortcutUnbound(): Promise<void> {
  const commands = await chrome.commands.getAll();
  const toggle = commands.find((command) => command.name === 'toggle-overlay');
  if (toggle && !toggle.shortcut) {
    console.warn(
      'Calyxa SW: "toggle-overlay" has no keyboard shortcut bound. Chrome ' +
        'applies suggested_key only on first install — set it at ' +
        'chrome://extensions/shortcuts, or fully restart `wxt dev`.',
    );
  }
}

/**
 * Builds the SESSION_STATE reply from chrome.storage.session, read fresh —
 * never from an in-memory value, since the worker may have woken between the
 * action that triggered this and the read. Carries display fields only
 * (AuthUser/ActiveSession have no token fields); never the access_token.
 */
async function buildSessionState(error?: string): Promise<CalyxaMessage> {
  const auth = await getAuth();
  const activeSession = await getActiveSession();
  const payload: SessionStatePayload = {
    signedIn: auth !== null,
    user: auth?.user ?? null,
    activeSession,
    ...(error ? { error } : {}),
  };
  return { type: 'SESSION_STATE', payload };
}

/** SignedOutError -> the exact "not signed in" text Task 8's manual gate checks for. */
function toErrorMessage(error: unknown): string {
  if (error instanceof api.SignedOutError) return 'not signed in';
  return error instanceof Error ? error.message : 'unknown error';
}

// ---------------------------------------------------------------------------
// Telemetry batching (Sprint 17 Task 6, ADR-043)
//
// The overlay/content relay one event at a time (SEND_TELEMETRY), and the
// background's own funnel emissions (session_started) add more. The worker
// accumulates them and flushes as a SINGLE /api/telemetry POST on either of
// two triggers -- the buffer reaching TELEMETRY_BATCH_MAX events, or the
// OLDEST buffered event aging past TELEMETRY_BATCH_MAX_AGE_MS -- so a busy
// session is a handful of requests, not one per event (the plan's "flush on N
// or interval"). A lost or late event never affects the student (every flush
// swallows its own failure), which is exactly what lets the buffer live in
// chrome.storage.session (survives worker wakes, cleared on browser close)
// instead of needing durable storage.
//
// The flush DECISION is a pure reducer (reduceTelemetryBatch) -- state in,
// {next state, events-to-flush} out, no chrome/network -- so Task 8's
// telemetry-routing spec can test the N-and-age logic directly (the
// isPlausibleProblem export-for-test precedent).
// ---------------------------------------------------------------------------

export const TELEMETRY_BATCH_MAX = 20;
export const TELEMETRY_BATCH_MAX_AGE_MS = 5_000;

export type TelemetryBatchState = {
  events: TelemetryEvent[];
  // When the currently-buffered run started (the age clock). null iff the
  // buffer is empty.
  oldestAt: number | null;
};

export const EMPTY_TELEMETRY_BATCH: TelemetryBatchState = { events: [], oldestAt: null };

/**
 * Pure batch/flush reducer. Appends `incoming` to the buffered state and
 * decides whether to flush: on reaching `maxBatch` events, OR when the oldest
 * buffered event has aged past `maxAgeMs` as of `now`. On a flush it returns
 * the whole buffer to send plus an empty next state; otherwise the grown
 * buffer and no flush. Deterministic in `now` (no Date.now() inside), so it is
 * directly unit-testable. Passing `incoming: []` is the age-only re-check the
 * flush timer uses.
 */
export function reduceTelemetryBatch(
  state: TelemetryBatchState,
  incoming: TelemetryEvent[],
  now: number,
  maxBatch: number = TELEMETRY_BATCH_MAX,
  maxAgeMs: number = TELEMETRY_BATCH_MAX_AGE_MS,
): { next: TelemetryBatchState; flush: TelemetryEvent[] } {
  const events = incoming.length > 0 ? [...state.events, ...incoming] : state.events;
  // Keep an already-running clock; start one only when the buffer first holds
  // something.
  const oldestAt = state.oldestAt ?? (events.length > 0 ? now : null);

  const full = events.length >= maxBatch;
  const aged = oldestAt !== null && now - oldestAt >= maxAgeMs;

  if (events.length > 0 && (full || aged)) {
    return { next: { ...EMPTY_TELEMETRY_BATCH }, flush: events };
  }
  return { next: { events, oldestAt }, flush: [] };
}

const TELEMETRY_BATCH_KEY = 'calyxa_telemetry_batch';

// Within-wake only: a pending best-effort flush timer for a PARTIAL batch. Not
// persisted -- a worker death drops it, but the buffer survives in
// chrome.storage.session and the next enqueue's age check flushes it. This is
// the one sanctioned transient timer in this file (never a top-level or
// persistent one, per the MV3 discipline at the top) precisely because losing
// it only DELAYS a telemetry event, never the student.
let telemetryFlushTimer: ReturnType<typeof setTimeout> | undefined;

async function readTelemetryBatch(): Promise<TelemetryBatchState> {
  const stored = await chrome.storage.session.get(TELEMETRY_BATCH_KEY);
  return (stored[TELEMETRY_BATCH_KEY] as TelemetryBatchState | undefined) ?? { ...EMPTY_TELEMETRY_BATCH };
}

async function writeTelemetryBatch(state: TelemetryBatchState): Promise<void> {
  await chrome.storage.session.set({ [TELEMETRY_BATCH_KEY]: state });
}

/**
 * Buffers telemetry events and flushes per reduceTelemetryBatch. Called by the
 * SEND_TELEMETRY handler (overlay/content events) and by the background's own
 * funnel emissions (reportSessionStarted). Reads/writes the buffer through
 * chrome.storage.session, never a module variable, matching this file's
 * ephemeral-worker discipline.
 */
async function enqueueTelemetry(events: TelemetryEvent[]): Promise<void> {
  if (events.length === 0) return;
  const state = await readTelemetryBatch();
  const { next, flush } = reduceTelemetryBatch(state, events, Date.now());
  await writeTelemetryBatch(next);

  if (flush.length > 0) {
    clearTelemetryFlushTimer();
    void flushTelemetry(flush);
    return;
  }

  // A partial batch remains: arm the best-effort age-flush so a trailing event
  // (e.g. a lone session_started) still lands without waiting for the next one.
  scheduleTelemetryFlush();
}

function scheduleTelemetryFlush(): void {
  if (telemetryFlushTimer) return;
  telemetryFlushTimer = setTimeout(() => {
    telemetryFlushTimer = undefined;
    void flushDueTelemetry();
  }, TELEMETRY_BATCH_MAX_AGE_MS);
}

function clearTelemetryFlushTimer(): void {
  if (telemetryFlushTimer) {
    clearTimeout(telemetryFlushTimer);
    telemetryFlushTimer = undefined;
  }
}

/** The flush timer fired: flush the buffer if it has actually aged out; otherwise re-arm. */
async function flushDueTelemetry(): Promise<void> {
  const state = await readTelemetryBatch();
  const { next, flush } = reduceTelemetryBatch(state, [], Date.now());
  if (flush.length === 0) {
    // Not yet aged (a size-flush in between reset the clock) -- re-arm if a
    // partial batch still remains.
    if (next.events.length > 0) scheduleTelemetryFlush();
    return;
  }
  await writeTelemetryBatch(next);
  void flushTelemetry(flush);
}

/**
 * POSTs a flushed batch, swallowing any failure -- a lost event never
 * affects the student (ADR-043). Exported (Sprint 17 Task 8) so
 * telemetry-routing.test.ts can assert the swallow directly, the same
 * "exported for the test task" convention as reduceTelemetryBatch,
 * isPlausibleProblem, and easeProgress/nextCloseState elsewhere in this
 * workspace.
 */
export async function flushTelemetry(events: TelemetryEvent[]): Promise<void> {
  try {
    await api.sendTelemetry(events);
  } catch (error) {
    console.warn('Calyxa SW: telemetry flush failed, dropping batch', toErrorMessage(error));
  }
}

/**
 * Fire-and-forget funnel emission: records the session_started event when the
 * background actually starts a session (ADR-043). This is the ONE telemetry
 * event the background originates itself -- session start is a background-owned
 * fact (ensureSessionStarted / handleOpeningScan / handleStartSession) -- so it
 * belongs here rather than in the overlay. Batched + swallowed like all
 * telemetry. onboarding_completed / turn_latency / annotation_rendered / voice_used
 * originate where THEIR data lives (the overlay's completion + voice-timing +
 * annotation-draw paths). `degraded_hit` is the OTHER background-originated
 * event (emitDegradedHit below, Sprint 18 Task 8) -- the cost-cap signal is
 * only observable here, where the api.ts responses land.
 */
function reportSessionStarted(mode: 'voice' | 'text'): void {
  void enqueueTelemetry([{ kind: 'session_started', mode }]);
}

/**
 * Fire-and-forget `degraded_hit` emission (Sprint 18 Task 8, ADR-043): fired
 * when an AI/voice route degraded under the Sprint 16 cost cap (ADR-041).
 * `cap` is the route's own `degradedCap` annotation (the client cannot tell
 * soft from hard from the bare `degraded` flag); `source` is which leg
 * degraded. Batched + swallowed like every other event -- a dropped
 * beta-health signal never affects the student, and this changes NO turn/voice
 * behavior (emission only). Exported for telemetry-routing.test.ts, the same
 * "exported for the test task" convention as reduceTelemetryBatch/flushTelemetry.
 */
export function emitDegradedHit(
  cap: 'soft' | 'hard',
  source: 'claude_turn' | 'whisper_stt' | 'elevenlabs_tts',
): void {
  void enqueueTelemetry([{ kind: 'degraded_hit', cap, source }]);
}

/**
 * Relays one overlay feedback capture to /api/feedback (Task 4). Request/reply
 * (unlike telemetry): returns { ok } on a successful insert and { error } on
 * failure, so Task 7's affordance can surface a retry -- feedback is
 * user-initiated, so a failure is NOT silently swallowed. `message` is the one
 * deliberate user-authored free-text field this sprint (ADR-043).
 */
async function handleSendFeedback(payload: SendFeedbackPayload): Promise<CalyxaMessage> {
  try {
    await api.sendFeedback(payload);
    const reply: SendFeedbackReplyPayload = { ok: true };
    return { type: 'SEND_FEEDBACK', payload: reply };
  } catch (error) {
    const reply: SendFeedbackReplyPayload = { error: toErrorMessage(error) };
    return { type: 'SEND_FEEDBACK', payload: reply };
  }
}

/**
 * Relays a study-kit generation request to /api/study/generate (Sprint 21
 * Task 5, ADR-049). Request/reply (the handleSendFeedback shape): returns the
 * route's own { kit } / { refused } 200 outcome on success, and { error } on a
 * real failure (auth, network, a 502) -- study-kit generation is user-initiated
 * off the recap card, so a failure is surfaced (a retry), not swallowed. The
 * worker is the sole network-egress context (ADR-006); the recap card never
 * calls the route directly.
 */
async function handleGenerateStudyKit(payload: GenerateStudyKitPayload): Promise<CalyxaMessage> {
  try {
    const result = await api.generateStudyKit(payload.sessionId);
    const reply: StudyKitReplyPayload = result;
    return { type: 'STUDY_KIT_REPLY', payload: reply };
  } catch (error) {
    const reply: StudyKitReplyPayload = { error: toErrorMessage(error) };
    return { type: 'STUDY_KIT_REPLY', payload: reply };
  }
}

// Two-part public suffixes this heuristic knows about. Not a full Public
// Suffix List implementation -- pageDomain is a display/grouping hint
// stored alongside a session row, not something the server gates access
// on, so an approximation is acceptable. Moved here from popup/main.tsx
// (Sprint 14 Task 6): the popup no longer starts sessions, but the
// background now does on the student's behalf (the opening scan and the
// auto-start-on-send fallback both need the SAME sender-tab derivation the
// popup's Start button used to do itself).
const TWO_LABEL_SUFFIXES = new Set([
  'co.uk', 'org.uk', 'gov.uk', 'ac.uk',
  'co.jp', 'co.nz', 'co.za', 'co.in',
  'com.au', 'com.br', 'com.mx',
]);

function toETldPlusOne(hostname: string): string {
  const labels = hostname.split('.');
  if (labels.length <= 2) return hostname;
  const lastTwo = labels.slice(-2).join('.');
  return TWO_LABEL_SUFFIXES.has(lastTwo) ? labels.slice(-3).join('.') : lastTwo;
}

/** Derives a display-hint domain from a sender tab's URL; null on any parse failure or a tab-less sender. */
function deriveTabDomain(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return toETldPlusOne(new URL(url).hostname);
  } catch {
    return null;
  }
}

// Turn timing (Sprint 11 / ADR-019): response_latency_ms is the think-time
// signal PLAN §2.3's third lucky-guess sub-guard needs — measured here as
// "previous reply delivered → this turn request". The anchor lives in
// chrome.storage.session (never an in-memory variable — the worker dies
// between turns; same direct-chrome.storage discipline as recordWake above)
// and is keyed to the sessionId it was stamped under, so a stale anchor
// from an earlier session can never masquerade as think-time in a new one.
// It is a client-measured approximation: for a voice turn it includes TTS
// playback of the previous reply, which this worker cannot observe; the
// server's own 10-minute cap drops walked-away-from-the-desk values.
const TURN_ANCHOR_KEY = 'turnAnchor';

type TurnAnchor = { sessionId: string; at: number };

/**
 * Builds the sessionId + responseLatencyMs context api.aiTurn threads to
 * /api/ai/turn (ADR-019). No active session -> {} (the route then persists
 * nothing this turn, exactly the pre-Sprint-11 behaviour); an anchor from a
 * different session, or a negative delta (clock adjustment), yields a
 * sessionId with no latency rather than a fabricated one.
 */
async function getTurnContext(): Promise<{ sessionId?: string; responseLatencyMs?: number }> {
  const active = await getActiveSession();
  if (!active) return {};

  const stored = await chrome.storage.session.get(TURN_ANCHOR_KEY);
  const anchor = stored[TURN_ANCHOR_KEY] as TurnAnchor | undefined;
  const elapsed = anchor && anchor.sessionId === active.sessionId ? Date.now() - anchor.at : -1;

  return {
    sessionId: active.sessionId,
    ...(elapsed >= 0 ? { responseLatencyMs: elapsed } : {}),
  };
}

/**
 * Stamps "the reply was just delivered" for the session, so the next
 * getTurnContext can measure the student's think-time from it. No-op when
 * the turn ran without a session (nothing was persisted, nothing to time).
 */
async function stampTurnAnchor(sessionId: string | undefined): Promise<void> {
  if (!sessionId) return;
  const anchor: TurnAnchor = { sessionId, at: Date.now() };
  await chrome.storage.session.set({ [TURN_ANCHOR_KEY]: anchor });
}

async function handleSignIn(payload: SignInPayload): Promise<CalyxaMessage> {
  try {
    await api.signIn(payload.email, payload.password);
    const state = await buildSessionState();
    // The idle pill is gated on signedIn (Sprint 10 Task 6 round 4) — any tab
    // already open when sign-in happens needs to learn about it immediately,
    // not on next page load, so its content script can mount the overlay.
    void broadcastToAllTabs(state);
    return state;
  } catch (error) {
    return buildSessionState(toErrorMessage(error));
  }
}

async function handleSignOut(): Promise<CalyxaMessage> {
  await api.signOut();
  // Same lifetime discipline as the auth/active-session clears just above --
  // the running transcript must not outlive the signed-out user (ADR-015).
  await clearRunningTranscript();
  const state = await buildSessionState();
  // Mirror of the sign-in broadcast above -- every open tab's idle pill must
  // disappear the moment the user signs out, not on next page load.
  void broadcastToAllTabs(state);
  return state;
}

/**
 * Relays a SESSION_STATE push to every tab's content script (as opposed to
 * the request/response SESSION_STATE reply the popup gets). Used only on
 * actual signedIn transitions (sign-in/sign-out) so open tabs' idle pills
 * mount/unmount live instead of requiring a page reload. chrome.tabs.sendMessage
 * rejects for tabs with no live content script (chrome://, Web Store, the New
 * Tab page, or a tab loaded before this extension build) -- expected and
 * ignored, same guard as toggleOverlayInActiveTab above.
 */
async function broadcastToAllTabs(state: CalyxaMessage): Promise<void> {
  const tabs = await chrome.tabs.query({});
  await Promise.all(
    tabs.map(async (tab) => {
      if (!tab.id) return;
      try {
        await chrome.tabs.sendMessage(tab.id, state);
      } catch {
        // No live content script on this tab -- expected, ignore.
      }
    }),
  );
}

async function handleStartSession(payload: StartSessionPayload): Promise<CalyxaMessage> {
  try {
    const mode = payload.mode ?? 'voice';
    await api.startSession({ pageDomain: payload.pageDomain, mode });
    reportSessionStarted(mode);
    return buildSessionState();
  } catch (error) {
    return buildSessionState(toErrorMessage(error));
  }
}

/**
 * Ends the active session and, if handleAiTurn cached a running transcript
 * for it (Sprint 08 / ADR-015), forwards that transcript for the backend's
 * end-of-session summary write -- the sprint's only new DB write. The cache
 * is read fresh (never an in-memory value, per the ephemeral-worker
 * discipline) and cleared only after api.endSession succeeds, mirroring how
 * api.endSession itself only clears the active session on success. A
 * session ended with no prior AI_TURN (no cached transcript) still ends
 * cleanly -- transcript is simply omitted from the request body.
 *
 * Sprint 13 (ADR-025): on success, broadcasts SESSION_ENDED (with the
 * recap when the route returned one) to every tab via broadcastToAllTabs --
 * the same push used for sign-in/sign-out above. This is the ONLY handler
 * for END_SESSION regardless of which surface sent it (the popup or, from
 * Task 8, the overlay's own control), so both reach the same broadcast and
 * an open panel always sees the recap of a session ended from either place.
 * A recap-less end (no gradable interactions, or the route omitted it)
 * still broadcasts -- with `recap` simply absent -- so listeners don't need
 * to distinguish "no broadcast" from "broadcast, nothing to show".
 */
async function handleEndSession(): Promise<CalyxaMessage> {
  const active = await getActiveSession();
  if (!active) {
    return buildSessionState('no active session');
  }
  try {
    const transcript = await getRunningTranscript();
    const { recap } = await api.endSession(active.sessionId, transcript ?? undefined);
    await clearRunningTranscript();
    // `sessionId` (Sprint 21 Task 5, ADR-049) rides the broadcast so the recap
    // card can generate a study kit for THIS session -- by the time the recap
    // renders, the active session is already cleared (above / in api.endSession),
    // so this broadcast is the only place the ended id is still known.
    void broadcastToAllTabs({
      type: 'SESSION_ENDED',
      payload: { ...(recap ? { recap } : {}), sessionId: active.sessionId },
    });
    return buildSessionState();
  } catch (error) {
    return buildSessionState(toErrorMessage(error));
  }
}

/**
 * The fallback auto-start trigger (ADR-027 Decision 1, amended by ADR-030's
 * Decision 3): session start now happens FIRST at the opening scan (when
 * panel-expand found a plausible problem), so by the time a turn is sent,
 * an ActiveSession usually already exists. This is the widened fallback --
 * "first-sent-turn, if the scan found nothing (or degraded)" -- checked at
 * turn-send time exactly as ADR-027 originally specified, lazily and
 * idempotently: a no-op if a session is already active, otherwise the same
 * api.startSession the popup used to call directly. A start failure is
 * swallowed here (not rethrown) so it degrades to a SESSIONLESS turn --
 * today's behavior -- rather than blocking the turn the student is waiting
 * on; the turn's own try/catch is reserved for the AI call itself.
 */
async function ensureSessionStarted(pageDomain: string | null, mode: 'voice' | 'text'): Promise<void> {
  if (await getActiveSession()) return;
  try {
    await api.startSession({ pageDomain, mode });
    reportSessionStarted(mode);
  } catch (error) {
    console.warn('Calyxa SW: auto-start-on-send failed, continuing sessionless', toErrorMessage(error));
  }
}

/**
 * Relays one AI_TURN to the Claude proxy. Reads nothing token-ish itself --
 * api.aiTurn() -> authorizedFetch() re-reads chrome.storage.session fresh,
 * per the ephemeral-worker discipline used throughout this file. On
 * SignedOutError the reply carries the exact "not signed in" text (via
 * toErrorMessage) the overlay shows as "sign in via the popup".
 *
 * pageContext (Sprint 07) is forwarded as-is -- this worker does not
 * inspect or persist it, it only relays whatever the content script
 * captured straight through to api.aiTurn (ADR-012/ADR-013).
 *
 * On a successful relay, caches `messages` -- the full running transcript
 * the overlay just sent -- via setRunningTranscript (Sprint 08 / ADR-015).
 * This is no new network traffic: the overlay already sends the full
 * transcript on every AI_TURN (ADR-008 history model); the worker simply
 * keeps the latest copy in chrome.storage.session so handleEndSession can
 * forward it for the session-summary write. Never cached on a failed
 * relay -- a failed turn was never actually part of the conversation.
 *
 * Sprint 11 (ADR-019): threads the active sessionId + measured think-time
 * (getTurnContext) and stamps the reply-delivered anchor on success, same
 * as the AI_STREAM port path above -- the voice pipeline's turns persist
 * session_interactions rows too.
 *
 * Sprint 12 (ADR-023): the AI_REPLY payload additionally carries
 * `annotations` when api.aiTurn() returned any — OMITTED on a turn with
 * none, so a no-annotation reply is byte-identical to Sprint 11's
 * `{ reply }`. Sprint 15 (ADR-034) threads `pins` the same way (replacing
 * Sprint 13's profileTags/pings pair). Voice turns get all of this for free
 * too, since they relay through this same handler.
 *
 * Sprint 14 (ADR-027, amended by ADR-030): `pageDomain` feeds the fallback
 * auto-start (ensureSessionStarted, `mode: 'voice'` -- AI_TURN is
 * exclusively the voice/non-streaming path, text turns use the AI_STREAM
 * port above). `solutionProgress`/`session` ride the reply the same
 * additive way as annotations/pins; a `session.complete: true`
 * ends the session server-side right away (mirrors the AI_STREAM port's own
 * handling above) -- the visible close choreography is Task 7's.
 */
async function handleAiTurn(
  messages: TurnMessage[],
  pageContext: PageContext | undefined,
  pageDomain: string | null,
): Promise<CalyxaMessage> {
  try {
    await ensureSessionStarted(pageDomain, 'voice');
    const turnContext = await getTurnContext();
    const { reply, annotations, pins, solutionProgress, session, chips, degraded, degradedCap } = await api.aiTurn(
      messages,
      pageContext,
      turnContext,
    );
    // Sprint 18 Task 8 (ADR-043): a cost-capped turn emits degraded_hit.
    if (degraded && degradedCap) emitDegradedHit(degradedCap, 'claude_turn');
    await setRunningTranscript(messages);
    await stampTurnAnchor(turnContext.sessionId);
    if (session?.complete) void handleEndSession();
    return {
      type: 'AI_REPLY',
      payload: {
        reply,
        ...(annotations ? { annotations } : {}),
        ...(pins ? { pins } : {}),
        ...(solutionProgress !== undefined ? { solutionProgress } : {}),
        ...(session ? { session } : {}),
        ...(chips ? { chips } : {}),
      },
    };
  } catch (error) {
    return { type: 'AI_REPLY', payload: { error: toErrorMessage(error) } };
  }
}

/**
 * The proactive opening scan (Sprint 14 Task 6, ADR-030): fired by the
 * content script's plausible-problem gate on panel expand, BEFORE any
 * student message. Calls api.startSession FIRST (Decision 3 -- the scan's
 * own turn must land as that session's row #1), then the opening-scan route
 * variant; degrades to an empty reply (never an error the caller has to
 * distinguish) on every failure mode:
 *   - a session is ALREADY active (this panel already had its one scan/
 *     start this open, or a turn already started one) -- never a second
 *     startSession call, never a second scan;
 *   - startSession itself fails (quota, network) -- a sessionless open,
 *     same degrade as the fallback trigger above;
 *   - the AI call fails/times out -- the session started above STAYS
 *     active (it already counted as quota, ADR-030's explicit call) so the
 *     fallback first-sent-turn trigger picks it straight up; only the
 *     OPENING MESSAGE is lost.
 * Never emits assessment/pins/solutionProgress/session (api.openingScan's
 * own return shape already excludes them) -- there is nothing yet to grade,
 * score, or close on a turn with no prior student answer.
 */
async function handleOpeningScan(payload: OpeningScanPayload, pageDomain: string | null): Promise<CalyxaMessage> {
  const EMPTY_REPLY = { reply: '' };

  // The opening scan REUSES an already-active session rather than bailing to
  // an empty reply. The active session lives in chrome.storage.session for
  // the whole browser session and is only cleared on END_SESSION, so a fresh
  // panel open after a page reload/navigation (or any re-open that never
  // ended the prior session) inherits a lingering session. Bailing there left
  // the overlay with no scan result -- so it dropped straight to the bare
  // composer instead of the check-in starting screen (the detected topic +
  // predicted sticking point). The client only ever requests OPENING_SCAN
  // while its own transcript is empty (Overlay.tsx's messages.length === 0
  // gate + per-open openingScanFiredRef), so reusing the session here can
  // never interrupt or double-fire against a live conversation -- it just
  // re-grounds the proactive scan against the session already open. Only a
  // genuinely sessionless open starts (and counts as quota, ADR-030) a new
  // one and emits the session_started funnel event.
  let active = await getActiveSession();

  if (!active) {
    try {
      await api.startSession({ pageDomain, mode: 'text' });
      reportSessionStarted('text');
    } catch (error) {
      console.warn('Calyxa SW: opening scan startSession failed, degrading to a silent open', toErrorMessage(error));
      return { type: 'OPENING_SCAN', payload: EMPTY_REPLY };
    }
    active = await getActiveSession();
  }

  try {
    const { reply, annotations, prediction, topic, stickingCandidates } = await api.openingScan(
      payload.pageContext,
      active?.sessionId,
    );
    return {
      type: 'OPENING_SCAN',
      payload: {
        reply,
        ...(annotations ? { annotations } : {}),
        // The session-kickoff struggle prediction, the check-in's
        // page-detected topic, and its 5b sticking-point candidates (all
        // grounded server-side) -- additive pass-through, same omission
        // discipline as annotations above.
        ...(prediction ? { prediction } : {}),
        ...(topic ? { topic } : {}),
        ...(stickingCandidates ? { stickingCandidates } : {}),
      },
    };
  } catch (error) {
    console.warn('Calyxa SW: opening scan call failed, degrading to a silent open', toErrorMessage(error));
    return { type: 'OPENING_SCAN', payload: EMPTY_REPLY };
  }
}

/**
 * Relays one VOICE_STT to the Whisper proxy (Task 3 / ADR-010). `audio`
 * crosses the chrome.runtime messaging boundary as base64 (see the
 * binary-over-messaging note in types/messages.ts) and is decoded back to
 * an ArrayBuffer here before api.sttTranscribe hands it to the proxy, which
 * never persists it (ADR-011). On SignedOutError the reply carries the
 * exact "not signed in" text, matching handleAiTurn.
 */
// Exported for unit testing (voice-degrade.test.ts pins the degraded reply
// shape -- the 2026-07-15 cost-cap fix); only the message router calls it.
export async function handleVoiceStt(payload: VoiceSttPayload): Promise<CalyxaMessage> {
  try {
    const { transcript, sttMs, degraded, degradedCap } = await api.sttTranscribe({
      bytes: base64ToArrayBuffer(payload.audio),
      mimeType: payload.mimeType,
    });
    // Sprint 18 Task 8 (ADR-043): a cost-capped STT leg emits degraded_hit.
    // Cost-cap fix (2026-07-15): the degraded reply used to fall through to
    // the success shape with an UNDEFINED transcript, which broke the voice
    // turn downstream -- it now returns the explicit degraded member so the
    // overlay can tell the student voice is resting instead of erroring.
    if (degraded && degradedCap) {
      emitDegradedHit(degradedCap, 'whisper_stt');
      return { type: 'VOICE_STT_REPLY', payload: { degraded: true, degradedCap } };
    }
    return { type: 'VOICE_STT_REPLY', payload: { transcript, sttMs } };
  } catch (error) {
    return { type: 'VOICE_STT_REPLY', payload: { error: toErrorMessage(error) } };
  }
}

/**
 * Relays one VOICE_TTS to the ElevenLabs proxy (Task 3 / ADR-010). The
 * synthesized audio is encoded to base64 to cross the messaging boundary
 * back to the content script -- the same caveat as VOICE_STT, reversed
 * direction. On SignedOutError the reply carries the exact "not signed in"
 * text, matching handleAiTurn.
 */
// Exported for unit testing (voice-degrade.test.ts) -- same note as
// handleVoiceStt above.
export async function handleVoiceTts(payload: VoiceTtsPayload): Promise<CalyxaMessage> {
  try {
    const { audio, ttsMs, degraded, degradedCap } = await api.ttsSynthesize(payload.text);
    // Sprint 18 Task 8 (ADR-043): a cost-capped TTS leg emits degraded_hit.
    // Cost-cap fix (2026-07-15): the degraded reply used to be encoded as
    // zero-byte audio the overlay then tried to play -- it now returns the
    // explicit degraded member so the buffered voice path can skip playback
    // and commit the reply as text.
    if (degraded && degradedCap) {
      emitDegradedHit(degradedCap, 'elevenlabs_tts');
      return { type: 'VOICE_TTS_REPLY', payload: { degraded: true, degradedCap } };
    }
    return { type: 'VOICE_TTS_REPLY', payload: { audio: arrayBufferToBase64(audio), ttsMs } };
  } catch (error) {
    return { type: 'VOICE_TTS_REPLY', payload: { error: toErrorMessage(error) } };
  }
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

/** Same walk as arrayBufferToBase64, operating directly on a chunk view (VOICE_TTS_STREAM) rather than a whole buffer. */
function uint8ArrayToBase64(bytes: Uint8Array): string {
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
