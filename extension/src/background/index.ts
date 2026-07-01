import { defineBackground } from '#imports';
import type {
  AiTurnPayload,
  CalyxaMessage,
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
  chrome.runtime.onMessage.addListener((message: CalyxaMessage, _sender, sendResponse) => {
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
        void handleAiTurn(messages, pageContext).then(sendResponse);
        return true;
      }
      case 'VOICE_STT':
        void handleVoiceStt(message.payload as VoiceSttPayload).then(sendResponse);
        return true;
      case 'VOICE_TTS':
        void handleVoiceTts(message.payload as VoiceTtsPayload).then(sendResponse);
        return true;
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
  chrome.runtime.onConnect.addListener((port) => {
    if (port.name !== 'AI_STREAM') return;
    port.onMessage.addListener(async (msg: AiTurnPayload) => {
      try {
        const reply = await api.aiTurn(msg.messages, msg.pageContext);
        // Split on whitespace boundaries, keeping trailing spaces attached to
        // the preceding token so the overlay reconstructs spacing correctly.
        const tokens = reply.match(/\S+\s*/g) ?? [];
        for (const token of tokens) {
          try { port.postMessage({ type: 'chunk', text: token }); } catch { break; }
        }
        await setRunningTranscript(msg.messages);
        try {
          port.postMessage({ type: 'done', reply });
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

async function handleSignIn(payload: SignInPayload): Promise<CalyxaMessage> {
  try {
    await api.signIn(payload.email, payload.password);
    return buildSessionState();
  } catch (error) {
    return buildSessionState(toErrorMessage(error));
  }
}

async function handleSignOut(): Promise<CalyxaMessage> {
  await api.signOut();
  // Same lifetime discipline as the auth/active-session clears just above --
  // the running transcript must not outlive the signed-out user (ADR-015).
  await clearRunningTranscript();
  return buildSessionState();
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
 */
async function handleEndSession(): Promise<CalyxaMessage> {
  const active = await getActiveSession();
  if (!active) {
    return buildSessionState('no active session');
  }
  try {
    const transcript = await getRunningTranscript();
    await api.endSession(active.sessionId, transcript ?? undefined);
    await clearRunningTranscript();
    return buildSessionState();
  } catch (error) {
    return buildSessionState(toErrorMessage(error));
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
 */
async function handleAiTurn(messages: TurnMessage[], pageContext?: PageContext): Promise<CalyxaMessage> {
  try {
    const reply = await api.aiTurn(messages, pageContext);
    await setRunningTranscript(messages);
    return { type: 'AI_REPLY', payload: { reply } };
  } catch (error) {
    return { type: 'AI_REPLY', payload: { error: toErrorMessage(error) } };
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

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}
