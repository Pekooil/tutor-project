import { defineContentScript } from '#imports';
import type { MathMentorMessage } from '../types/messages';

// MathMentor content script.
//
// DOM policy (locked): READ-ONLY. This script must never mutate the host page —
// no elements added, no styles changed, no attributes modified. It only reads
// window.location and messages the background service worker.
export default defineContentScript({
  // (1) Inject on every page the student visits.
  matches: ['<all_urls>'],
  async main() {
    // (2) Confirm injection.
    console.log(`MathMentor content: injected on ${window.location.hostname}`);

    // (3) Announce readiness to the background service worker.
    const message: MathMentorMessage = { type: 'CONTENT_READY' };

    // (4) Log any response. The background worker may be asleep and
    // sendMessage can throw / reject, so guard it with try/catch.
    try {
      const response = await chrome.runtime.sendMessage(message);
      if (response !== undefined) {
        console.log('MathMentor content: response from background', response);
      }
    } catch (error) {
      console.warn('MathMentor content: CONTENT_READY not acknowledged', error);
    }
  },
});
