import {
  clearActiveSession,
  clearAuth,
  getAuth,
  setActiveSession,
  setAuth,
  type ActiveSession,
  type AuthUser,
  type SessionMode,
  type StoredAuth,
} from './storage';

// Backend HTTP client for the extension (Sprint 04 Task 6 / ADR-006).
//
// This module must ONLY be imported from the background service worker --
// PLAN §2.2 designates the worker as the extension's sole network-egress
// context. The popup and content script never import this directly; they
// talk to the worker via chrome.runtime messages (Task 7).
//
// API_BASE is a plain build-time constant, not a Supabase key: the extension
// holds no secret to put behind an env var. `http://localhost:3000` is the
// Sprint 03/04 dev backend (same value documented in /web/.env.local.example).
// The production origin is added at launch -- swap this constant then, and
// add it to wxt.config.ts's host_permissions alongside the dev origin.
export const API_BASE = 'http://localhost:3000';

// Thrown when the backend has rejected the refresh token itself (not just an
// expired access token). Callers should treat this as "signed out": there is
// no token left to retry with.
export class SignedOutError extends Error {
  constructor() {
    super('signed out');
  }
}

export async function signIn(email: string, password: string): Promise<AuthUser> {
  const res = await fetch(`${API_BASE}/api/auth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });

  const body = await res.json();
  if (!res.ok) {
    throw new Error(body.error ?? `sign-in failed: ${res.status}`);
  }

  const user: AuthUser = { id: body.user.id, email: body.user.email ?? null };
  await setAuth({
    access_token: body.access_token,
    refresh_token: body.refresh_token,
    expires_at: body.expires_at,
    user,
  });

  return user;
}

export async function signOut(): Promise<void> {
  await clearAuth();
  await clearActiveSession();
}

/**
 * Rotates the stored token pair using the stored refresh_token. `/api/auth/refresh`
 * returns only `{access_token,refresh_token,expires_at}` (no `user`), so the
 * previously stored user is carried over -- a refresh never changes identity.
 *
 * On a 401 the refresh token itself is no longer valid: clearAuth and surface
 * SignedOutError so the caller stops retrying.
 */
export async function refresh(): Promise<StoredAuth> {
  const current = await getAuth();
  if (!current) throw new SignedOutError();

  const res = await fetch(`${API_BASE}/api/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh_token: current.refresh_token }),
  });

  if (res.status === 401) {
    await clearAuth();
    throw new SignedOutError();
  }

  const body = await res.json();
  if (!res.ok) {
    throw new Error(body.error ?? `refresh failed: ${res.status}`);
  }

  const next: StoredAuth = {
    access_token: body.access_token,
    refresh_token: body.refresh_token,
    expires_at: body.expires_at,
    user: current.user,
  };
  await setAuth(next);

  return next;
}

/**
 * Attaches the stored access_token as a bearer header and runs the request.
 * On a 401 (expired access token, not a dead refresh token) it calls
 * refresh() exactly once and retries the original request -- never twice,
 * per ADR-006.
 */
async function authorizedFetch(path: string, init: RequestInit): Promise<Response> {
  const current = await getAuth();
  if (!current) throw new SignedOutError();

  const withAuth = (token: string): RequestInit => ({
    ...init,
    headers: { ...init.headers, Authorization: `Bearer ${token}` },
  });

  const res = await fetch(`${API_BASE}${path}`, withAuth(current.access_token));
  if (res.status !== 401) return res;

  const refreshed = await refresh();
  return fetch(`${API_BASE}${path}`, withAuth(refreshed.access_token));
}

export async function startSession({
  pageDomain,
  mode,
}: {
  pageDomain: string | null;
  mode: SessionMode;
}): Promise<ActiveSession> {
  const res = await authorizedFetch('/api/session/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pageDomain, mode }),
  });

  const body = await res.json();
  if (!res.ok) {
    throw new Error(body.error ?? `start_session failed: ${res.status}`);
  }

  const active: ActiveSession = {
    sessionId: body.sessionId,
    mode: body.mode,
    degraded: body.degraded,
    remaining: body.remaining,
  };
  await setActiveSession(active);

  return active;
}

export async function endSession(sessionId: string): Promise<void> {
  const res = await authorizedFetch('/api/session/end', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId }),
  });

  const body = await res.json();
  if (!res.ok) {
    throw new Error(body.error ?? `end_session failed: ${res.status}`);
  }

  await clearActiveSession();
}
