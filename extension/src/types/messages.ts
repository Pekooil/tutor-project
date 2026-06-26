// Shared message types exchanged between the content script and the background
// service worker.
//   CONTENT_READY  (Sprint 01) — content script announces it has injected.
//   TOGGLE_OVERLAY (Sprint 02) — background relays the keyboard command to the
//                  active tab's content script to show/hide the overlay.
export type MessageType = 'CONTENT_READY' | 'TOGGLE_OVERLAY';

export interface CalyxaMessage {
  type: MessageType;
  payload?: unknown;
}
