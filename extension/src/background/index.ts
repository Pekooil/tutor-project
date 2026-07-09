import { defineBackground } from '#imports';
import type {
  AiTurnPayload,
  CalyxaMessage,
  OpeningScanPayload,
  PageContext,
  SessionStatePayload,
  SignInPayload,
  StartSessionPayload,
  TurnMessage,
  VoiceSttPayload,
  VoiceTtsPayload,
} from '../types/messages';
import * as api from '../lib/api';
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

  // (1) First install: announce, then initialise the persisted wake counter.
  chrome.runtime.onInstalled.addListener(() => {
    console.log('Calyxa SW: installed');
    void chrome.storage.local.set({ wakeCount: 0 });
  });

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
      default:
        return false;
    }
  });

  // (4c) Word-by-word AI turn via a persistent port (chrome.runtime.connect).
  // The content script opens 'AI_STREAM', sends { messages, pageContext }, and
  // receives one chunk message per word token so the overlay can animate them
  // word-by-word. Uses the non-streaming /api/ai/turn endpoint (same as the
  // voice path) and splits the reply client-side — this avoids a dependency on
  // /api/ai/stream, which requires a server restart to pick up after the route
  // file is first created (Turbopack dev-server limitation). ADR-006 upheld:
  // the background service worker remains the sole network-egress context.
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
        const { ttsMs } = await api.ttsSynthesizeStream(msg.text, (chunk) => {
          try {
            port.postMessage({ type: 'chunk', audio: uint8ArrayToBase64(chunk) });
          } catch {
            // Port already disconnected -- the reader loop in
            // ttsSynthesizeStream keeps draining, but further chunks are
            // dropped here too; caught again on the next postMessage.
          }
        });
        try {
          port.postMessage({ type: 'done', ttsMs });
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
        const { reply, annotations, pins, solutionProgress, session, chips } = await api.aiTurn(
          msg.messages,
          msg.pageContext,
          turnContext,
          msg.sessionStart,
        );
        // Split on whitespace boundaries, keeping trailing spaces attached to
        // the preceding token so the overlay reconstructs spacing correctly.
        const tokens = reply.match(/\S+\s*/g) ?? [];
        for (const token of tokens) {
          try { port.postMessage({ type: 'chunk', text: token }); } catch { break; }
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
        const { reply, annotations, pins, solutionProgress, session, chips } =
          await api.aiTurnEnvelopeStream(msg.messages, msg.pageContext, turnContext, (text) => {
            try {
              port.postMessage({ type: 'say', text });
            } catch {
              // Port already disconnected -- the stream keeps draining so the
              // final envelope still lands (or is dropped on the done post).
            }
          });
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
    await api.startSession({ pageDomain: payload.pageDomain, mode: payload.mode ?? 'voice' });
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
    void broadcastToAllTabs({ type: 'SESSION_ENDED', payload: { ...(recap ? { recap } : {}) } });
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
    const { reply, annotations, pins, solutionProgress, session, chips } = await api.aiTurn(
      messages,
      pageContext,
      turnContext,
    );
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

  if (await getActiveSession()) {
    return { type: 'OPENING_SCAN', payload: EMPTY_REPLY };
  }

  try {
    await api.startSession({ pageDomain, mode: 'text' });
  } catch (error) {
    console.warn('Calyxa SW: opening scan startSession failed, degrading to a silent open', toErrorMessage(error));
    return { type: 'OPENING_SCAN', payload: EMPTY_REPLY };
  }

  try {
    const active = await getActiveSession();
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
async function handleVoiceStt(payload: VoiceSttPayload): Promise<CalyxaMessage> {
  try {
    const { transcript, sttMs } = await api.sttTranscribe({
      bytes: base64ToArrayBuffer(payload.audio),
      mimeType: payload.mimeType,
    });
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
async function handleVoiceTts(payload: VoiceTtsPayload): Promise<CalyxaMessage> {
  try {
    const { audio, ttsMs } = await api.ttsSynthesize(payload.text);
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
