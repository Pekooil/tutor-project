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
import type { PageContext, TurnMessage } from '../types/messages';

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

// transcript (Sprint 08 / ADR-015) is OPTIONAL and, when present, rides in
// the same request body -- no new route. The backend treats it as untrusted
// input and runs the session-summary write best-effort, so it is forwarded
// as-is here with no validation on this side, same discipline as
// pageContext in aiTurn() below.
export async function endSession(sessionId: string, transcript?: TurnMessage[]): Promise<void> {
  const res = await authorizedFetch('/api/session/end', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId, ...(transcript ? { transcript } : {}) }),
  });

  const body = await res.json();
  if (!res.ok) {
    throw new Error(body.error ?? `end_session failed: ${res.status}`);
  }

  await clearActiveSession();
}

/**
 * Sends the running transcript to the Claude proxy (Sprint 05 / ADR-008) and
 * returns the tutor's reply text. `/api/ai/turn` is stateless -- non-streaming
 * fallback retained for any callers that don't need streaming.
 */
export async function aiTurn(messages: TurnMessage[], pageContext?: PageContext): Promise<string> {
  const res = await authorizedFetch('/api/ai/turn', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages, pageContext }),
  });

  const body = await res.json();
  if (!res.ok) {
    throw new Error(body.error ?? `ai_turn failed: ${res.status}`);
  }

  return body.reply;
}

/**
 * Streaming variant of aiTurn. Calls `/api/ai/stream` (SSE), invokes
 * `onChunk` for every text delta as it arrives, and resolves with the
 * concatenated full reply once the stream ends. The background service
 * worker calls this and relays chunks via a `chrome.runtime` port.
 */
export async function aiTurnStream(
  messages: TurnMessage[],
  pageContext: PageContext | undefined,
  onChunk: (text: string) => void,
): Promise<string> {
  const res = await authorizedFetch('/api/ai/stream', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages, pageContext }),
  });

  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    throw new Error((errBody as { error?: string }).error ?? `ai_stream failed: ${res.status}`);
  }

  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let fullText = '';
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const data = line.slice(6);
      if (data === '[DONE]') return fullText;
      try {
        const parsed = JSON.parse(data) as { text?: string; error?: string };
        if (parsed.error) throw new Error(parsed.error);
        if (parsed.text) {
          fullText += parsed.text;
          onChunk(parsed.text);
        }
      } catch (err) {
        if (err instanceof SyntaxError) continue;
        throw err;
      }
    }
  }

  return fullText;
}

/**
 * Sends one push-to-talk utterance to the Whisper proxy (Task 3 / ADR-010)
 * as a raw body + Content-Type header (matching the route's accepted shape)
 * and returns the transcript. Audio is held only in memory on both legs --
 * this function never writes it anywhere (ADR-011).
 *
 * Reuses authorizedFetch verbatim, so a dead refresh token surfaces
 * SignedOutError exactly as the other helpers above do.
 */
export async function sttTranscribe(audio: { bytes: ArrayBuffer; mimeType: string }): Promise<{
  transcript: string;
  sttMs: number;
}> {
  const res = await authorizedFetch('/api/voice/stt', {
    method: 'POST',
    headers: { 'Content-Type': audio.mimeType },
    body: audio.bytes,
  });

  const body = await res.json();
  if (!res.ok) {
    throw new Error(body.error ?? `stt_transcribe failed: ${res.status}`);
  }

  return { transcript: body.transcript, sttMs: body.sttMs };
}

/**
 * Sends the tutor's reply text to the ElevenLabs proxy (Task 3 / ADR-010)
 * and returns the synthesized audio bytes plus the route's reported
 * processing time (the `x-tts-ms` header, not buffered into the JSON body so
 * the route can stream the audio straight through).
 *
 * Reuses authorizedFetch verbatim, so a dead refresh token surfaces
 * SignedOutError exactly as the other helpers above do.
 */
export async function ttsSynthesize(text: string): Promise<{ audio: ArrayBuffer; ttsMs: number }> {
  const res = await authorizedFetch('/api/voice/tts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });

  if (!res.ok) {
    const body = await res.json();
    throw new Error(body.error ?? `tts_synthesize failed: ${res.status}`);
  }

  const ttsMs = Number(res.headers.get('x-tts-ms') ?? 0);
  const audio = await res.arrayBuffer();

  return { audio, ttsMs };
}
