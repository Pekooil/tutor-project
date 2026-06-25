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

  // (3) Log every inbound message. No specific message types are handled yet;
  // returning true keeps the message channel open for async responses that
  // later sprints will send.
  chrome.runtime.onMessage.addListener((message: MathMentorMessage) => {
    console.log('MathMentor SW: message received', message);
    return true;
  });

  // (4) Relay the toggle-overlay keyboard command to the active tab's content
  // script, which owns the overlay. Commands are delivered to the service
  // worker only, so the SW forwards them. Registered synchronously like the
  // listeners above, so it is in place before any command fires after a wake.
  chrome.commands.onCommand.addListener((command) => {
    if (command !== 'toggle-overlay') return;
    void toggleOverlayInActiveTab();
  });

  // (2) Every wake: read → increment → persist → log the wake counter.
  void recordWake();
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
  if (!tab?.id) return;
  const message: MathMentorMessage = { type: 'TOGGLE_OVERLAY' };
  try {
    await chrome.tabs.sendMessage(tab.id, message);
  } catch {
    // No content script on this page — nothing to toggle.
  }
}
