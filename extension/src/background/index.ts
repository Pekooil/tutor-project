import { defineBackground } from '#imports';
import type {
  AiTurnPayload,
  CalyxaMessage,
  SessionStatePayload,
  SignInPayload,
  StartSessionPayload,
  TurnMessage,
} from '../types/messages';
import * as api from '../lib/api';
import { getActiveSession, getAuth } from '../lib/storage';

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
      case 'AI_TURN':
        void handleAiTurn((message.payload as AiTurnPayload).messages).then(sendResponse);
        return true;
      default:
        return false;
    }
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

async function handleEndSession(): Promise<CalyxaMessage> {
  const active = await getActiveSession();
  if (!active) {
    return buildSessionState('no active session');
  }
  try {
    await api.endSession(active.sessionId);
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
 */
async function handleAiTurn(messages: TurnMessage[]): Promise<CalyxaMessage> {
  try {
    const reply = await api.aiTurn(messages);
    return { type: 'AI_REPLY', payload: { reply } };
  } catch (error) {
    return { type: 'AI_REPLY', payload: { error: toErrorMessage(error) } };
  }
}
