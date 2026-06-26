import type { ActiveSession, AuthUser } from '../lib/storage';

// Shared message types exchanged between the content script, the popup, and
// the background service worker.
//   CONTENT_READY  (Sprint 01) — content script announces it has injected.
//   TOGGLE_OVERLAY (Sprint 02) — background relays the keyboard command to the
//                  active tab's content script to show/hide the overlay.
//   GET_STATE      (Sprint 04) — popup -> background, no payload. The popup
//                  document dies on blur (PLAN §2.2), so it re-mounts with no
//                  memory of prior state on every open and asks for the
//                  current SESSION_STATE rather than defaulting to "signed
//                  out". Added alongside the plan's five Task 7 message types
//                  because none of SIGN_IN/SIGN_OUT/START_SESSION/END_SESSION
//                  is a safe no-op query (each one has a real side effect).
//   SIGN_IN        (Sprint 04) — popup -> background: SignInPayload.
//   SIGN_OUT       (Sprint 04) — popup -> background, no payload.
//   START_SESSION  (Sprint 04) — popup -> background: StartSessionPayload.
//   END_SESSION    (Sprint 04) — popup -> background, no payload — the
//                  background ends whatever session chrome.storage.session
//                  holds, not one the popup names.
//   SESSION_STATE  (Sprint 04) — background -> popup, the reply to every
//                  message above. Carries display fields only, never a
//                  token (PLAN §2.2: the popup holds no session logic).
//   AI_TURN        (Sprint 05) — overlay -> content -> background:
//                  AiTurnPayload. Carries the FULL running transcript from
//                  the overlay on every call, not just the new message --
//                  the worker is stateless and holds no conversation memory
//                  (ADR-008 history model).
//   AI_REPLY       (Sprint 05) — background -> caller, the reply to AI_TURN:
//                  AiReplyPayload ({reply} on success, {error} otherwise --
//                  a SignedOutError surfaces as the literal string "not
//                  signed in").
export type MessageType =
  | 'CONTENT_READY'
  | 'TOGGLE_OVERLAY'
  | 'GET_STATE'
  | 'SIGN_IN'
  | 'SIGN_OUT'
  | 'START_SESSION'
  | 'END_SESSION'
  | 'SESSION_STATE'
  | 'AI_TURN'
  | 'AI_REPLY';

export interface CalyxaMessage {
  type: MessageType;
  payload?: unknown;
}

export type SignInPayload = {
  email: string;
  password: string;
};

export type StartSessionPayload = {
  pageDomain: string | null;
  mode?: 'voice' | 'text';
};

export type SessionStatePayload = {
  signedIn: boolean;
  user: AuthUser | null;
  activeSession: ActiveSession | null;
  error?: string;
};

export type TurnMessage = {
  role: 'user' | 'assistant';
  content: string;
};

export type AiTurnPayload = {
  messages: TurnMessage[];
};

export type AiReplyPayload = { reply: string } | { error: string };
