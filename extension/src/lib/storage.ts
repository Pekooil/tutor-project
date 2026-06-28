// Thin wrappers over chrome.storage.session (Sprint 04 Task 6 / ADR-006).
//
// chrome.storage.session, never .local or .sync: tokens must not hit disk
// (PLAN §2.2) and must not sync across the user's devices. Session storage
// lives in memory only and is cleared when the browser closes.
//
// The background service worker is ephemeral (MV3) -- it can be killed and
// woken at any time with no in-memory state surviving a restart. Callers must
// re-read these values fresh at the top of every handler; nothing here is
// cached in a module-level variable.
//
// The running transcript (Sprint 08 / ADR-015) is the one bounded exception
// to "the worker holds no conversation memory": handleAiTurn caches the
// latest full transcript here purely so handleEndSession can forward it for
// the session-summary write. It lives in chrome.storage.session only --
// never .local/disk (ADR-011) -- and is cleared on END_SESSION and on
// sign-out, same lifetime discipline as ACTIVE_SESSION_KEY above.

// type-only import: erased at compile time, so this does not create a
// runtime circular dependency with types/messages.ts (which itself
// type-imports ActiveSession/AuthUser from this file).
import type { TurnMessage } from '../types/messages';

export type AuthUser = {
  id: string;
  email: string | null;
};

export type StoredAuth = {
  access_token: string;
  refresh_token: string;
  expires_at: number | undefined;
  user: AuthUser;
};

export type SessionMode = 'voice' | 'text';

export type ActiveSession = {
  sessionId: string;
  mode: SessionMode;
  degraded: boolean;
  remaining: number | null;
};

const AUTH_KEY = 'calyxa_auth';
const ACTIVE_SESSION_KEY = 'calyxa_active_session';
const RUNNING_TRANSCRIPT_KEY = 'calyxa_running_transcript';

export async function getAuth(): Promise<StoredAuth | null> {
  const stored = await chrome.storage.session.get(AUTH_KEY);
  return (stored[AUTH_KEY] as StoredAuth | undefined) ?? null;
}

export async function setAuth(auth: StoredAuth): Promise<void> {
  await chrome.storage.session.set({ [AUTH_KEY]: auth });
}

export async function clearAuth(): Promise<void> {
  await chrome.storage.session.remove(AUTH_KEY);
}

export async function getActiveSession(): Promise<ActiveSession | null> {
  const stored = await chrome.storage.session.get(ACTIVE_SESSION_KEY);
  return (stored[ACTIVE_SESSION_KEY] as ActiveSession | undefined) ?? null;
}

export async function setActiveSession(session: ActiveSession): Promise<void> {
  await chrome.storage.session.set({ [ACTIVE_SESSION_KEY]: session });
}

export async function clearActiveSession(): Promise<void> {
  await chrome.storage.session.remove(ACTIVE_SESSION_KEY);
}

export async function getRunningTranscript(): Promise<TurnMessage[] | null> {
  const stored = await chrome.storage.session.get(RUNNING_TRANSCRIPT_KEY);
  return (stored[RUNNING_TRANSCRIPT_KEY] as TurnMessage[] | undefined) ?? null;
}

export async function setRunningTranscript(transcript: TurnMessage[]): Promise<void> {
  await chrome.storage.session.set({ [RUNNING_TRANSCRIPT_KEY]: transcript });
}

export async function clearRunningTranscript(): Promise<void> {
  await chrome.storage.session.remove(RUNNING_TRANSCRIPT_KEY);
}
