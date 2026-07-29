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
  AuthSessionPayload,
  LogErrorPayload,
  PageContext,
  PageTopic,
  ReferralStatusPayload,
  SendFeedbackPayload,
  SessionCompletion,
  ScoreChange,
  SessionRecap,
  SessionStartInfo,
  StatusPin,
  StickingCandidate,
  StrugglePrediction,
  StudyArtifact,
  StudyKit,
  StudyKitResult,
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
// holds no secret to put behind an env var. Sprint 19 Task 9 (ADR-045): flipped
// from the `http://localhost:3000` dev backend to the PRODUCTION origin for the
// beta submission build -- https://calyxa.app is the custom domain on the same
// Vercel project (not the old tutor-project-web.vercel.app alias), and
// wxt.config.ts's host_permissions already carries it. This is the
// "swap the prod origin in at launch" step in docs/release-runbook.md; to run
// the extension against a local backend again, revert this to
// http://localhost:3000 (the value documented in /web/.env.local.example).
export const API_BASE = 'https://calyxa.app';

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
 * Stores a session pushed from the website (Part 2 bridge) in exactly the same
 * StoredAuth shape signIn writes, so every downstream path (authorizedFetch,
 * refresh via /api/auth/refresh, SESSION_STATE) is identical whether the user
 * signed in through the old popup form or the web bridge. No supabase-js and no
 * Supabase key ever enters the extension (ADR-006): the tokens are opaque
 * bearers the backend proxy validates. Provider-agnostic — the payload is the
 * same for an email/password or a Google web sign-in.
 */
export async function applyBridgedSession(payload: AuthSessionPayload): Promise<AuthUser> {
  const { session } = payload;
  const user: AuthUser = { id: session.user.id, email: session.user.email ?? null };
  await setAuth({
    access_token: session.access_token,
    refresh_token: session.refresh_token,
    expires_at: session.expires_at,
    user,
  });
  return user;
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
export async function endSession(
  sessionId: string,
  transcript?: TurnMessage[],
): Promise<{ recap?: SessionRecap; scoreChange?: ScoreChange }> {
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

  return {
    ...(body.recap ? { recap: body.recap as SessionRecap } : {}),
    ...(body.scoreChange ? { scoreChange: body.scoreChange as ScoreChange } : {}),
  };
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
  // Sprint 18 Task 8 (ADR-043): the cost-cap degradation signal, surfaced so
  // the background can emit a `degraded_hit` telemetry event. `degradedCap`
  // distinguishes soft (voice→text) from hard (resting) -- `degraded` alone
  // cannot. Field-by-field unwrap (same discipline as the arrays above): both
  // are surfaced only when the route sent a well-formed pair, never guessed.
  degraded?: true;
  degradedCap?: 'soft' | 'hard';
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
    ...(body.degraded === true && (body.degradedCap === 'soft' || body.degradedCap === 'hard')
      ? { degraded: true as const, degradedCap: body.degradedCap }
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
  commonSticking?: string[];
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
    // The concept's curated common misconceptions (cold-start chip fill):
    // plain display strings, same array-shape discipline as above.
    ...(Array.isArray(body.commonSticking) && body.commonSticking.length > 0
      ? { commonSticking: (body.commonSticking as unknown[]).filter((s): s is string => typeof s === 'string') }
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
  // Sprint 18 Task 8 (ADR-043): the streamed voice turn's cost-cap signal,
  // riding the terminal envelope (web/app/api/ai/turn/stream) the same way the
  // buffered /api/ai/turn carries it -- surfaced for `degraded_hit` emission.
  degraded?: true;
  degradedCap?: 'soft' | 'hard';
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
    ...(envelope.degraded === true && (envelope.degradedCap === 'soft' || envelope.degradedCap === 'hard')
      ? { degraded: true as const, degradedCap: envelope.degradedCap }
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
  // Sprint 18 Task 8 (ADR-043): the cost-cap short-circuit signal. When the
  // route degrades this leg (`{ degraded, degradedCap }`, no transcript), these
  // are surfaced so the background can emit `degraded_hit`; the transcript/sttMs
  // are absent exactly as before (unchanged degrade-to-text behavior).
  // 'voice_credit' (public launch, 2026-07-18): the per-free-user monthly
  // voice budget — same degrade, distinct telemetry tag.
  degraded?: true;
  degradedCap?: 'soft' | 'hard' | 'voice_credit';
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

  return {
    transcript: body.transcript,
    sttMs: body.sttMs,
    ...(body.degraded === true &&
    (body.degradedCap === 'soft' || body.degradedCap === 'hard' || body.degradedCap === 'voice_credit')
      ? { degraded: true as const, degradedCap: body.degradedCap }
      : {}),
  };
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
export async function ttsSynthesize(
  text: string,
): Promise<{ audio: ArrayBuffer; ttsMs: number; degraded?: true; degradedCap?: 'soft' | 'hard' | 'voice_credit' }> {
  const res = await authorizedFetch('/api/voice/tts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });

  if (!res.ok) {
    const body = await res.json();
    throw new Error(body.error ?? `tts_synthesize failed: ${res.status}`);
  }

  // Sprint 18 Task 8 (ADR-043): the cost-cap degraded short-circuit returns
  // JSON (`{ degraded, degradedCap }`) with a 200, NOT audio bytes
  // (web/app/api/voice/tts). Detect it by content-type BEFORE reading the body
  // as an ArrayBuffer -- reading a JSON body as audio would hand the overlay
  // garbage bytes (a latent mishandle this guard also closes). No audio is
  // produced this leg; the signal is surfaced for `degraded_hit` emission.
  if (res.headers.get('content-type')?.includes('application/json')) {
    const body = await res.json().catch(() => ({}));
    if (body.degraded === true) {
      return {
        audio: new ArrayBuffer(0),
        ttsMs: 0,
        degraded: true,
        degradedCap:
          body.degradedCap === 'hard' || body.degradedCap === 'voice_credit' ? body.degradedCap : 'soft',
      };
    }
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
): Promise<{ ttsMs: number; degraded?: true; degradedCap?: 'soft' | 'hard' | 'voice_credit' }> {
  const res = await authorizedFetch('/api/voice/tts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });

  if (!res.ok) {
    const body = await res.json();
    throw new Error(body.error ?? `tts_synthesize failed: ${res.status}`);
  }

  // Sprint 18 Task 8 (ADR-043): same cost-cap degraded short-circuit guard as
  // ttsSynthesize -- the degraded response is JSON, not a stream, so detect it
  // by content-type before draining the body as audio chunks. No chunks are
  // emitted this leg; the signal is surfaced for `degraded_hit`.
  if (res.headers.get('content-type')?.includes('application/json')) {
    const body = await res.json().catch(() => ({}));
    if (body.degraded === true) {
      return {
        ttsMs: 0,
        degraded: true,
        degradedCap:
          body.degradedCap === 'hard' || body.degradedCap === 'voice_credit' ? body.degradedCap : 'soft',
      };
    }
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
/**
 * Mirrors completed/paused homework sessions to the server (ADR-057), so the
 * Studio v4 dashboard can show sets that outlive one browser profile.
 *
 * Resolves the ids the server actually accepted, so the caller can clear
 * exactly those from its retry queue and keep the rest. Throws on a transport
 * or auth failure -- but the CALLER swallows it: this is a mirror, never the
 * source of truth, and a student mid-set must never feel a failed sync.
 */
export async function syncHomeworkSessions(sessions: unknown[]): Promise<string[]> {
  const res = await authorizedFetch('/api/homework/sync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessions }),
  });

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((body as { error?: string }).error ?? `homework_sync failed: ${res.status}`);
  }
  const synced = (body as { synced?: unknown }).synced;
  return Array.isArray(synced) ? synced.filter((id): id is string => typeof id === 'string') : [];
}

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
 * Generates a study kit for one completed session (Sprint 21 Task 5, ADR-049):
 * POSTs { sessionId } to /api/study/generate. Uses authorizedFetch, so a dead
 * refresh token surfaces SignedOutError like every other helper. THROWS on a
 * non-2xx (the background handler catches it into a { error } reply) so the
 * recap card can offer a retry -- study-kit generation is user-initiated off
 * the recap card, so a failure is surfaced, not swallowed (the sendFeedback
 * posture, not telemetry's).
 *
 * Returns the route's own graceful outcomes on a 200: { kit } when a kit was
 * generated + persisted, or { refused } when the route declined WITHOUT an
 * error -- the hard cost cap (no Claude call, ADR-041) or a session with
 * nothing worth generating (never a half-kit persisted, ADR-049). Both are
 * normal 200s, not errors, so they are returned rather than thrown; the recap
 * card shows a gentle message + its placeholder for either.
 */
export async function generateStudyKit(sessionId: string): Promise<StudyKitResult> {
  const res = await authorizedFetch('/api/study/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId }),
  });

  const body = await res.json();
  if (!res.ok) {
    throw new Error(body.error ?? `study_kit failed: ${res.status}`);
  }

  // The route's discriminated 200 shapes -- checked field by field (the
  // defensive-unwrap discipline the aiTurn helpers use), never half-passed.
  if (body.kit && typeof body.kit === 'object') {
    return { kit: body.kit as StudyKit };
  }
  if (body.refused === 'cost' || body.refused === 'empty') {
    return { refused: body.refused };
  }
  // A 200 that is neither a kit nor a known refusal is an unexpected shape --
  // treat it as a failure so the caller's error path (a retry) handles it,
  // rather than rendering an empty card.
  throw new Error('study_kit: unexpected response shape');
}

/**
 * Lists the caller's persisted study-kit artifacts (Sprint 21 Task 5,
 * ADR-049): GET /api/study/list, newest first, RLS-scoped server-side. An
 * optional `sessionId` filters to one session's kit. Uses authorizedFetch;
 * THROWS on a non-2xx. This is the transport for the future dashboard /
 * past-kits surface (Sprint 22's "Study kits" list) -- the recap card this
 * sprint is generate-on-click and does not call it. Provided now as the
 * symmetric read of the generate write, per the Task 5 plan.
 */
export async function listStudyKits(sessionId?: string): Promise<StudyArtifact[]> {
  const path = sessionId ? `/api/study/list?sessionId=${encodeURIComponent(sessionId)}` : '/api/study/list';
  const res = await authorizedFetch(path, { method: 'GET' });
  const body = await res.json();
  if (!res.ok) {
    throw new Error(body.error ?? `study_list failed: ${res.status}`);
  }
  return (Array.isArray(body.artifacts) ? body.artifacts : []) as StudyArtifact[];
}

/**
 * The caller's referral state (ADR-053): GET /api/referral/status. The
 * background's offer logic (handleGetReferralOffer) reads completedSessions /
 * outOfSessions from it; the numbers are display + decision inputs only --
 * the reward itself is granted server-side at referred-signup time. THROWS on
 * a non-2xx like listStudyKits.
 */
export async function getReferralStatus(): Promise<ReferralStatusPayload> {
  const res = await authorizedFetch('/api/referral/status', { method: 'GET' });
  const body = await res.json();
  if (!res.ok) {
    throw new Error(body.error ?? `referral_status failed: ${res.status}`);
  }
  return body as ReferralStatusPayload;
}

/**
 * Allocate-if-absent the caller's referral code (ADR-053): POST
 * /api/referral/link. Idempotent server-side -- calling it twice returns the
 * same code. THROWS on a non-2xx so the referral card can offer a retry.
 */
export async function createReferralLink(): Promise<{ code: string; link: string }> {
  const res = await authorizedFetch('/api/referral/link', { method: 'POST' });
  const body = await res.json();
  if (!res.ok || typeof body.link !== 'string' || typeof body.code !== 'string') {
    throw new Error(body.error ?? `referral_link failed: ${res.status}`);
  }
  return { code: body.code, link: body.link };
}

// (Public launch, 2026-07-17) getOnboardingStatus / submitOnboarding are
// retired with the Sprint 17 diagnostic onboarding surface: the first-run
// tutorial that replaced it is client-local (chrome.storage.local seen flag,
// content/index.ts) and never calls /api/onboarding. The web route remains
// live server-side for the profile's own bookkeeping.
