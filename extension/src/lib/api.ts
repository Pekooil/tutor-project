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
import type {
  AnswerField,
  Annotation,
  AssessmentItem,
  AssessmentResult,
  LogErrorPayload,
  OnboardingStatusReplyPayload,
  PageContext,
  PageTopic,
  SendFeedbackPayload,
  SessionCompletion,
  SessionRecap,
  SessionStartInfo,
  StatusPin,
  StickingCandidate,
  StrugglePrediction,
  TelemetryEvent,
  TurnMessage,
} from '../types/messages';

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
//
// Sprint 13 (ADR-025): the route's response now additionally carries
// `recap` (built after the reconcile, from the post-apply tables) -- this
// was previously discarded (`Promise<void>`); it is now parsed straight
// through and returned, same no-re-validation discipline as `annotations`
// in aiTurn() below. Omitted (not `undefined`, not `{}`) for a session with
// no gradable interactions. The storage clear and error handling are
// otherwise unchanged.
export async function endSession(sessionId: string, transcript?: TurnMessage[]): Promise<{ recap?: SessionRecap }> {
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

  return { ...(body.recap ? { recap: body.recap as SessionRecap } : {}) };
}

/**
 * Sends the running transcript to the Claude proxy (Sprint 05 / ADR-008) and
 * returns the tutor's reply text (+ optional annotations, Sprint 12 /
 * ADR-023; + optional status pins, Sprint 15 / ADR-034 -- replacing Sprint
 * 13's profileTags/pings pair). `/api/ai/turn` is stateless -- non-streaming
 * fallback retained for any callers that don't need streaming.
 *
 * `turnContext` (Sprint 11 / ADR-019) threads the active sessionId and the
 * client-measured think-time so the route can persist the turn's
 * session_interactions row with a real response_latency_ms. Both are
 * OPTIONAL and ride the same request body -- no new endpoint, no auth
 * change; the route degrades to "no persistence this turn" when they are
 * absent (older callers keep working unchanged), so nothing is validated
 * on this side -- same discipline as pageContext above.
 *
 * `annotations` and `pins` are parsed straight through from the response
 * body with no re-validation here -- the backend already
 * validated/grounded/computed them before ever putting them on the wire,
 * and each is OMITTED (never included, not `undefined`) from the returned
 * object when the response didn't carry any, matching the route's own
 * additive-omission contract. `solutionProgress`/`session` (Sprint 14,
 * ADR-027/028) follow the exact same discipline -- the route already
 * clamped/validated both (envelope.ts), so this is thread-through only.
 */
export async function aiTurn(
  messages: TurnMessage[],
  pageContext?: PageContext,
  turnContext?: { sessionId?: string; responseLatencyMs?: number },
  // The session-start kickoff's structured confirmation (SessionStartInfo):
  // present ONLY on the session's first turn, always alongside an empty
  // `messages` array -- the route builds its own placeholder turn and the
  // SESSION START MODE prompt block from it. Thread-through only, same
  // no-validation discipline as pageContext.
  sessionStart?: SessionStartInfo,
): Promise<{
  reply: string;
  annotations?: Annotation[];
  pins?: StatusPin[];
  solutionProgress?: number;
  session?: SessionCompletion;
  chips?: string[];
  answerFields?: AnswerField[];
}> {
  const res = await authorizedFetch('/api/ai/turn', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages,
      pageContext,
      ...(sessionStart ? { sessionStart } : {}),
      ...(turnContext?.sessionId ? { sessionId: turnContext.sessionId } : {}),
      ...(turnContext?.responseLatencyMs !== undefined
        ? { responseLatencyMs: turnContext.responseLatencyMs }
        : {}),
    }),
  });

  const body = await res.json();
  if (!res.ok) {
    throw new Error(body.error ?? `ai_turn failed: ${res.status}`);
  }

  return {
    reply: body.reply,
    ...(Array.isArray(body.annotations) && body.annotations.length > 0
      ? { annotations: body.annotations as Annotation[] }
      : {}),
    ...(Array.isArray(body.pins) && body.pins.length > 0 ? { pins: body.pins as StatusPin[] } : {}),
    ...(typeof body.solutionProgress === 'number' ? { solutionProgress: body.solutionProgress } : {}),
    ...(body.session ? { session: body.session as SessionCompletion } : {}),
    ...(Array.isArray(body.chips) && body.chips.length > 0 ? { chips: body.chips as string[] } : {}),
    ...(Array.isArray(body.answerFields) && body.answerFields.length > 0
      ? { answerFields: body.answerFields as AnswerField[] }
      : {}),
  };
}

/**
 * The proactive opening scan (Sprint 14 Task 6, ADR-030): a real AI turn
 * with no student message, requested by the content script only after its
 * own plausible-problem gate passes on the freshly captured `pageContext`.
 * Reuses `/api/ai/turn` (the `opening: true` branch, Task 4) rather than a
 * new endpoint -- same auth, same entitlement checks. `sessionId` is the
 * one `startSession` (called by the background BEFORE this, ADR-030
 * Decision 3) just returned, so the opening scan's own turn is that
 * session's row #1. Never carries `assessment`/`pins`/`solutionProgress`/
 * `session` -- there is nothing yet to grade, score, or close; `reply` may
 * be an empty string (the model's own "not confident" signal), passed
 * through as-is, same discipline as aiTurn() above. The route's
 * `profileTags` field is no longer consumed (the transcript's tag pills
 * were retired by ADR-034's status pins), so it is not parsed here.
 */
export async function openingScan(
  pageContext: PageContext,
  sessionId: string | undefined,
): Promise<{
  reply: string;
  annotations?: Annotation[];
  prediction?: StrugglePrediction;
  topic?: PageTopic;
  stickingCandidates?: StickingCandidate[];
}> {
  const res = await authorizedFetch('/api/ai/turn', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      opening: true,
      pageContext,
      ...(sessionId ? { sessionId } : {}),
    }),
  });

  const body = await res.json();
  if (!res.ok) {
    throw new Error(body.error ?? `opening_scan failed: ${res.status}`);
  }

  return {
    reply: body.reply,
    ...(Array.isArray(body.annotations) && body.annotations.length > 0
      ? { annotations: body.annotations as Annotation[] }
      : {}),
    // The session-kickoff struggle prediction: shape-checked field by field
    // (the same defensive unwrap discipline as the arrays above) -- a
    // malformed prediction is dropped, never half-passed to the card.
    ...(body.prediction &&
    typeof body.prediction.conceptKey === 'string' &&
    typeof body.prediction.title === 'string' &&
    typeof body.prediction.category === 'string' &&
    typeof body.prediction.description === 'string'
      ? { prediction: body.prediction as StrugglePrediction }
      : {}),
    // The check-in's page-detected topic (state 5a's suggestion card): same
    // field-by-field unwrap discipline as `prediction` above.
    ...(body.topic && typeof body.topic.conceptKey === 'string' && typeof body.topic.title === 'string'
      ? { topic: body.topic as PageTopic }
      : {}),
    // The check-in's 5b sticking-point candidates: same array-shape
    // discipline as annotations/profileTags above (a per-item field-by-field
    // unwrap isn't warranted here -- these come straight from a grounded DB
    // read, not the model, the same trust level as the arrays above rather
    // than `prediction`/`topic`'s single-object shape).
    ...(Array.isArray(body.stickingCandidates) && body.stickingCandidates.length > 0
      ? { stickingCandidates: body.stickingCandidates as StickingCandidate[] }
      : {}),
  };
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
 * Streamed-envelope turn (Sprint 15 voice follow-on, ADR-033 amendment) --
 * the voice path's replacement for aiTurn() that starts per-sentence TTS
 * before the whole reply is generated. Calls /api/ai/turn/stream (SSE),
 * invokes `onSayDelta` for each spoken-text delta as it arrives, and resolves
 * with the SAME shape aiTurn() returns (the terminal `envelope` event's
 * payload) once the stream ends. aiTurn() above is KEPT verbatim as the
 * buffered fallback the voice path drops to on any streaming failure.
 *
 * Reuses authorizedFetch, so a dead refresh token surfaces SignedOutError
 * exactly as every other helper does.
 */
type StreamEnvelopePayload = {
  reply: string;
  annotations?: Annotation[];
  pins?: StatusPin[];
  solutionProgress?: number;
  session?: SessionCompletion;
  chips?: string[];
  answerFields?: AnswerField[];
};

export async function aiTurnEnvelopeStream(
  messages: TurnMessage[],
  pageContext: PageContext | undefined,
  turnContext: { sessionId?: string; responseLatencyMs?: number } | undefined,
  onSayDelta: (text: string) => void,
): Promise<StreamEnvelopePayload> {
  const res = await authorizedFetch('/api/ai/turn/stream', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages,
      pageContext,
      ...(turnContext?.sessionId ? { sessionId: turnContext.sessionId } : {}),
      ...(turnContext?.responseLatencyMs !== undefined
        ? { responseLatencyMs: turnContext.responseLatencyMs }
        : {}),
    }),
  });

  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    throw new Error((errBody as { error?: string }).error ?? `ai_turn_stream failed: ${res.status}`);
  }

  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let envelope: StreamEnvelopePayload | null = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const data = line.slice(6);
      if (data === '[DONE]') continue;
      let parsed: {
        sayDelta?: string;
        envelope?: StreamEnvelopePayload;
        error?: string;
      };
      try {
        parsed = JSON.parse(data);
      } catch (err) {
        if (err instanceof SyntaxError) continue;
        throw err;
      }
      if (parsed.error) throw new Error(parsed.error);
      if (typeof parsed.sayDelta === 'string') {
        onSayDelta(parsed.sayDelta);
      } else if (parsed.envelope) {
        envelope = parsed.envelope;
      }
    }
  }

  if (!envelope) {
    throw new Error('ai_turn_stream ended without an envelope');
  }

  return {
    reply: envelope.reply,
    ...(Array.isArray(envelope.annotations) && envelope.annotations.length > 0
      ? { annotations: envelope.annotations }
      : {}),
    ...(Array.isArray(envelope.pins) && envelope.pins.length > 0 ? { pins: envelope.pins } : {}),
    ...(typeof envelope.solutionProgress === 'number' ? { solutionProgress: envelope.solutionProgress } : {}),
    ...(envelope.session ? { session: envelope.session } : {}),
    // Answer inputs thread through the streamed-voice envelope too (the
    // background destructures both from this return) -- chips and the design-8d
    // multi-part fields alike, each present only when the turn carried it.
    ...(Array.isArray(envelope.chips) && envelope.chips.length > 0 ? { chips: envelope.chips } : {}),
    ...(Array.isArray(envelope.answerFields) && envelope.answerFields.length > 0
      ? { answerFields: envelope.answerFields }
      : {}),
  };
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

/**
 * Streaming sibling of ttsSynthesize (Sprint 15 Task 6, ADR-033): reads the
 * route's response body as it arrives and invokes `onChunk` once per chunk
 * instead of buffering the whole reply before returning. The route itself
 * already passes the ElevenLabs stream straight through with no server-side
 * buffering (web/app/api/voice/tts/route.ts) -- this is the client-side half
 * of removing the buffering leg the sprint plan flags (§"Task 6" -- the
 * background used to await res.arrayBuffer() here and relay one base64 blob,
 * which is exactly the silence-inducing buffering ttsSynthesize above still
 * does; that function is KEPT verbatim as the fallback for MediaSource/codec
 * failures per-utterance).
 *
 * `ttsMs` is read from the SAME x-tts-ms header as ttsSynthesize -- it
 * reflects the route's time-to-first-byte (the header arrives with the
 * response, before the body streams), not the total download time.
 *
 * Reuses authorizedFetch verbatim, so a dead refresh token surfaces
 * SignedOutError exactly as every other helper does.
 */
export async function ttsSynthesizeStream(
  text: string,
  onChunk: (chunk: Uint8Array) => void,
): Promise<{ ttsMs: number }> {
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
  const reader = res.body!.getReader();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) onChunk(value);
  }

  return { ttsMs };
}

// Sprint 17 / Task 6 (ADR-043): the three beta-instrumentation egress
// helpers. Like every other helper in this file, they run ONLY in the
// background service worker (the sole network-egress context, ADR-006) --
// the overlay/content reach them by relaying SEND_TELEMETRY / SEND_FEEDBACK /
// LOG_ERROR messages to the worker (background/index.ts), never by importing
// this module.

/**
 * POSTs a batch of typed, content-free telemetry events to /api/telemetry
 * (Task 4). Uses authorizedFetch, so the caller's own access token auths the
 * insert and a dead refresh token surfaces SignedOutError exactly as every
 * other helper does. THROWS on a non-2xx (so the caller can log), but the
 * background handler that calls this SWALLOWS the throw -- a lost telemetry
 * event must never affect the student (ADR-043 / the sprint's batching
 * posture). Never surfaces the DB/route error text to the student.
 */
export async function sendTelemetry(events: TelemetryEvent[]): Promise<void> {
  const res = await authorizedFetch('/api/telemetry', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ events }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `telemetry failed: ${res.status}`);
  }
}

/**
 * POSTs one feedback capture to /api/feedback (Task 4), RLS-scoped to the
 * caller server-side. `message` is the single deliberate user-authored
 * free-text field this sprint (ADR-043). Uses authorizedFetch (feedback is
 * always an authed action, unlike error reporting below); THROWS on a
 * non-2xx so the affordance (Task 7) can surface a retry -- feedback is
 * user-initiated, so a failure is NOT silently swallowed the way telemetry
 * is.
 */
export async function sendFeedback(payload: SendFeedbackPayload): Promise<void> {
  const res = await authorizedFetch('/api/feedback', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `feedback failed: ${res.status}`);
  }
}

/**
 * Relays an already-scrubbed extension error to /api/errors (Task 5).
 *
 * Deliberately NOT authorizedFetch, unlike every other helper here: the
 * whole point of error monitoring is to catch failures that happen WITHOUT a
 * valid session too (a crashed worker on startup, a failed token refresh),
 * and authorizedFetch throws SignedOutError when signed out -- which would
 * blackhole exactly the errors most worth seeing. So this uses a PLAIN fetch,
 * attaches a stored access token ONLY best-effort (so the route can tag a
 * coarse userId when one happens to exist) and never refreshes it, and NEVER
 * throws -- a failed error-report must not itself become an error (and, in
 * the background, must not re-enter the global error handler that called it).
 *
 * Only {message, stack?, context?} are sent: /api/errors rejects any extra
 * key (its allow-list validation), so the scrub's own `timestamp` field is
 * dropped here rather than sent and 400'd.
 */
export async function reportError(event: LogErrorPayload): Promise<void> {
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    const current = await getAuth();
    if (current) headers.Authorization = `Bearer ${current.access_token}`;

    const { message, stack, context } = event;
    await fetch(`${API_BASE}/api/errors`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        message,
        ...(stack ? { stack } : {}),
        ...(context ? { context } : {}),
      }),
    });
  } catch {
    // Best-effort only -- a dropped error report is acceptable, and this
    // function must never throw back into the global error capture that
    // invoked it (which would loop).
  }
}

/**
 * GETs the cold-start onboarding status (Sprint 17 Task 7, ADR-042):
 * `{needed:false}` when the caller already has a graph or has already run
 * onboarding, `{needed:true, items}` otherwise -- `items` is the 8-12
 * assessment items /api/onboarding's GET selects fresh each check (the
 * extension has no @calyxa/curriculum dependency, so this is the one place
 * the item bank's output crosses the wire). Uses authorizedFetch, so a dead
 * refresh token surfaces SignedOutError like every other helper; the
 * background handler that calls this (background/index.ts) catches ANY
 * failure and degrades to {needed:false} rather than propagating it, since
 * onboarding is a nice-to-have gate, never a hard requirement.
 */
export async function getOnboardingStatus(): Promise<OnboardingStatusReplyPayload> {
  const res = await authorizedFetch('/api/onboarding', { method: 'GET' });
  const body = await res.json();
  if (!res.ok) {
    throw new Error(body.error ?? `onboarding status failed: ${res.status}`);
  }
  if (body.needed) {
    return { needed: true, items: body.items as AssessmentItem[] };
  }
  return { needed: false };
}

/**
 * POSTs the completed onboarding self-check to /api/onboarding (Task 3),
 * which seeds the caller's graph through the existing FSRS apply path and
 * writes onboarding_completed_at. Uses authorizedFetch; THROWS on a non-2xx
 * so the caller (Onboarding.tsx, via the background's request/reply) can
 * surface a retry -- unlike telemetry, a lost onboarding submission would
 * silently strand the student's answered self-check, so this is NOT
 * swallowed.
 */
export async function submitOnboarding(results: AssessmentResult[]): Promise<{ seededCount: number }> {
  const res = await authorizedFetch('/api/onboarding', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ results }),
  });
  const body = await res.json();
  if (!res.ok) {
    throw new Error(body.error ?? `onboarding submit failed: ${res.status}`);
  }
  return { seededCount: body.seededCount };
}
