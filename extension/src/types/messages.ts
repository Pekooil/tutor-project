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
//   VOICE_STT      (Sprint 06) — overlay -> content -> background:
//                  VoiceSttPayload. Carries a SINGLE short push-to-talk
//                  utterance per turn, never a live stream (ADR-010); the
//                  worker hands it to Whisper and never writes it to
//                  disk/DB (ADR-011). `audio` crosses this boundary as
//                  base64, not a raw ArrayBuffer -- see the
//                  binary-over-messaging note below.
//   VOICE_STT_REPLY (Sprint 06) — background -> caller, the reply to
//                  VOICE_STT: VoiceSttReplyPayload ({transcript,sttMs} on
//                  success, {error} otherwise -- a SignedOutError surfaces
//                  as the literal string "not signed in", same as AI_REPLY).
//   VOICE_TTS      (Sprint 06) — overlay -> content -> background:
//                  VoiceTtsPayload ({text}).
//   VOICE_TTS_REPLY (Sprint 06) — background -> caller, the reply to
//                  VOICE_TTS: VoiceTtsReplyPayload ({audio,ttsMs} on
//                  success, {error} otherwise). `audio` is base64-encoded
//                  audio/mpeg bytes, decoded for playback only -- never
//                  persisted (ADR-011).
//
//   Binary-over-messaging caveat (ADR-010): chrome.runtime.sendMessage
//   payloads are structured-cloned/JSON, so a raw ArrayBuffer/Blob is not a
//   safe bet to survive every hop overlay -> content -> background intact.
//   VOICE_STT/VOICE_TTS_REPLY carry audio as base64 strings instead, and
//   keep it small -- this is a single push-to-talk utterance per turn, not a
//   live stream.
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
  | 'AI_REPLY'
  | 'VOICE_STT'
  | 'VOICE_STT_REPLY'
  | 'VOICE_TTS'
  | 'VOICE_TTS_REPLY';

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

export type VoiceSttPayload = {
  audio: string; // base64-encoded utterance bytes -- see the binary-over-messaging note above
  mimeType: string;
};

export type VoiceSttReplyPayload = { transcript: string; sttMs: number } | { error: string };

export type VoiceTtsPayload = {
  text: string;
};

export type VoiceTtsReplyPayload = { audio: string; ttsMs: number } | { error: string };

// Mirrors /web/lib/voice/latency.ts exactly -- that file is the source of
// truth; this is a by-convention re-declaration for the client side (no
// shared module spans the extension/web boundary).
export type LatencyTrace = {
  sttMs: number;
  aiMs: number;
  ttsMs: number;
  networkMs: number;
  totalMs: number;
};
