import { createShadowRootUi, defineContentScript } from '#imports';
import type { ShadowRootContentScriptUi } from '#imports';
import type { Root } from 'react-dom/client';
import { mountOverlay, unmountOverlay } from '../overlay/mount';
import type { Utterance } from '../overlay/VoiceController';
import type {
  AiReplyPayload,
  CalyxaMessage,
  TurnMessage,
  VoiceSttReplyPayload,
  VoiceTtsReplyPayload,
} from '../types/messages';

// Overlay UI handle, created once per page in main(). Held at module scope
// because a content script's execution context lives for the page's lifetime —
// unlike the background service worker, where module-level state is lost between
// wakes. Task 4 toggles it (mount/remove) when the keyboard shortcut fires.
let overlayUi: ShadowRootContentScriptUi<Root> | undefined;

// The overlay's AI_TURN transport (Sprint 05). This is the ONLY chrome.*
// surface threaded into the overlay — Overlay.tsx itself never imports
// chrome.*, so this function is its sole window onto the extension. It only
// relays messages to the background worker (the sole network-egress
// context, PLAN §2.2); it adds no host-page read, keeping the DOM policy
// unchanged.
async function sendAiTurn(messages: TurnMessage[]): Promise<string> {
  const message: CalyxaMessage = { type: 'AI_TURN', payload: { messages } };
  const response: CalyxaMessage = await chrome.runtime.sendMessage(message);
  const payload = response.payload as AiReplyPayload;
  if ('error' in payload) {
    throw new Error(payload.error);
  }
  return payload.reply;
}

// The overlay's VOICE_STT/VOICE_TTS transports (Sprint 06). Same role as
// sendAiTurn above: the ONLY chrome.* surface threaded into the overlay for
// voice, relaying to the background worker and adding no host-page read.
// `audio` crosses the messaging boundary as base64 (ADR-010 — see the
// binary-over-messaging note in types/messages.ts), so each direction is
// encoded/decoded here, the mirror image of background/index.ts's helpers.
async function sendVoiceStt(audio: Utterance): Promise<{ transcript: string; sttMs: number }> {
  const message: CalyxaMessage = {
    type: 'VOICE_STT',
    payload: { audio: arrayBufferToBase64(audio.bytes), mimeType: audio.mimeType },
  };
  const response: CalyxaMessage = await chrome.runtime.sendMessage(message);
  const payload = response.payload as VoiceSttReplyPayload;
  if ('error' in payload) {
    throw new Error(payload.error);
  }
  return payload;
}

async function sendVoiceTts(text: string): Promise<{ audio: ArrayBuffer; ttsMs: number }> {
  const message: CalyxaMessage = { type: 'VOICE_TTS', payload: { text } };
  const response: CalyxaMessage = await chrome.runtime.sendMessage(message);
  const payload = response.payload as VoiceTtsReplyPayload;
  if ('error' in payload) {
    throw new Error(payload.error);
  }
  return { audio: base64ToArrayBuffer(payload.audio), ttsMs: payload.ttsMs };
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
export default defineContentScript({
  // (1) Inject on every page the student visits.
  matches: ['<all_urls>'],
  // Route the bundled overlay stylesheet INTO the shadow root (consumed by
  // createShadowRootUi below) instead of injecting it into the host page <head>.
  cssInjectionMode: 'ui',
  async main(ctx) {
    // (2) Confirm injection.
    console.log(`Calyxa content: injected on ${window.location.hostname}`);

    // (3) Toggle the overlay when the background relays the keyboard command.
    // Registered FIRST and synchronously, before any `await` below — the two
    // awaits that follow (the CONTENT_READY round-trip and createShadowRootUi's
    // stylesheet fetch) take real time, and a command can arrive in that window.
    // If `overlayUi` isn't built yet when that happens, queue the toggle instead
    // of dropping it, so a fast shortcut press right after page load still
    // shows the overlay once setup finishes.
    let pendingToggle = false;
    chrome.runtime.onMessage.addListener((message: CalyxaMessage) => {
      if (message.type !== 'TOGGLE_OVERLAY') return;
      console.log('Calyxa content: TOGGLE_OVERLAY received; overlay ready =', !!overlayUi);
      if (!overlayUi) {
        pendingToggle = true;
        return;
      }
      if (overlayUi.mounted) {
        overlayUi.remove();
      } else {
        overlayUi.mount();
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

    // (5) Build the overlay UI once. createShadowRootUi is async because it
    // fetches the bundled stylesheet to inject into the shadow root. The host
    // element is appended to the document root (<html>) so it cannot be trapped
    // inside a host-page stacking context. We do NOT mount here — the overlay
    // starts hidden and is toggled on demand by the keyboard shortcut (Task 4).
    overlayUi = await createShadowRootUi<Root>(ctx, {
      name: 'calyxa-overlay',
      position: 'inline',
      anchor: document.documentElement,
      append: 'last',
      onMount: (container) =>
        mountOverlay(container, { onSend: sendAiTurn, onTranscribe: sendVoiceStt, onSynthesize: sendVoiceTts }),
      onRemove: (root) => {
        if (root) unmountOverlay(root);
      },
    });

    // (6) Apply a toggle that arrived before setup finished (see step 3).
    if (pendingToggle) {
      console.log('Calyxa content: applying queued toggle from before overlay was ready');
      overlayUi.mount();
    }
  },
});
