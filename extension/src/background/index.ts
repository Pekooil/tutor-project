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
