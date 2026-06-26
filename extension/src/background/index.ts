import { defineBackground } from '#imports';
import type { MathMentorMessage } from '../types/messages';

// MathMentor background service worker (Manifest V3).
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
    console.log('MathMentor SW: installed');
    void chrome.storage.local.set({ wakeCount: 0 });
  });

  // (3) Log every inbound message. No specific message types are handled yet,
  // and nothing here calls sendResponse, so the listener must NOT return true —
  // `true` tells Chrome an async response is coming, and the sender's
  // `await chrome.runtime.sendMessage(...)` hangs forever waiting for a
  // response that never arrives. Returning false/undefined resolves the
  // sender's promise immediately with `undefined`.
  chrome.runtime.onMessage.addListener((message: MathMentorMessage) => {
    console.log('MathMentor SW: message received', message);
    return false;
  });

  // (4) Relay the toggle-overlay keyboard command to the active tab's content
  // script, which owns the overlay. Commands are delivered to the service
  // worker only, so the SW forwards them. Registered synchronously like the
  // listeners above, so it is in place before any command fires after a wake.
  chrome.commands.onCommand.addListener((command) => {
    console.log('MathMentor SW: command received', command);
    if (command !== 'toggle-overlay') return;
    void toggleOverlayInActiveTab();
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
  console.log(`MathMentor SW: wake #${next}`);
}

/**
 * Forwards a TOGGLE_OVERLAY message to the active tab's content script.
 * chrome.tabs.sendMessage rejects on tabs with no content script (chrome://
 * pages, the Web Store, the New Tab page), so the call is guarded and such a
 * failure is a deliberate no-op.
 */
async function toggleOverlayInActiveTab(): Promise<void> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  console.log('MathMentor SW: relaying TOGGLE_OVERLAY to active tab', tab?.id, tab?.url);
  if (!tab?.id) return;
  const message: MathMentorMessage = { type: 'TOGGLE_OVERLAY' };
  try {
    await chrome.tabs.sendMessage(tab.id, message);
  } catch (error) {
    // Most common cause: the page was open before the extension's last reload,
    // so it has no live content script. Reloading the page fixes it.
    console.warn(
      'MathMentor SW: could not reach the content script — reload the page and retry',
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
      'MathMentor SW: "toggle-overlay" has no keyboard shortcut bound. Chrome ' +
        'applies suggested_key only on first install — set it at ' +
        'chrome://extensions/shortcuts, or fully restart `wxt dev`.',
    );
  }
}
