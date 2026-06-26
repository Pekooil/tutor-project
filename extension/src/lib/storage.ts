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
