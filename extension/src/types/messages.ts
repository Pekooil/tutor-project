// Shared message types exchanged between the content script and the background
// service worker. Kept intentionally small in Sprint 01 — more message types
// arrive in later sprints.

export type MessageType = 'CONTENT_READY';

export interface MathMentorMessage {
  type: MessageType;
  payload?: unknown;
}
