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
//                  (ADR-008 history model). Sprint 07 adds an OPTIONAL
//                  pageContext: a single bounded PageContext snapshot read
//                  by pageExtractor.ts on overlay open, read-only, and never
//                  persisted (ADR-012/ADR-013) -- it rides this existing
//                  message, no new MessageType was added.
//   AI_REPLY       (Sprint 05) — background -> caller, the reply to AI_TURN:
//                  AiReplyPayload ({reply} on success, {error} otherwise --
//                  a SignedOutError surfaces as the literal string "not
//                  signed in"). Sprint 12 adds an OPTIONAL `annotations`
//                  alongside `reply` (ADR-023) -- present only when the
//                  turn's envelope carried at least one; absent, not [],
//                  on every other turn.
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
//   GET_PROFILE_OVERVIEW (Sprint 13) — content -> background, no payload.
//                  Reply reuses the same type: GetProfileOverviewReplyPayload
//                  ({overview} on success, {error} otherwise) — the same
//                  request/reply type-reuse convention SESSION_STATE already
//                  uses for GET_STATE. Read-only (ADR-024/025); the overlay
//                  fetches it fresh on every panel open, never caches it.
//   SESSION_ENDED  (Sprint 13) — background -> ALL tabs (broadcastToAllTabs,
//                  the SESSION_STATE push convention), fired once a session
//                  actually ends, from EITHER the popup's END_SESSION or a
//                  content-sent one: SessionEndedPayload ({recap} when the
//                  ended session had gradable interactions, omitted for a
//                  no-gradable session — never null/{}). No reply expected.
//   OPENING_SCAN   (Sprint 14 Task 6, ADR-030) — content -> background:
//                  OpeningScanPayload ({pageContext}, no messages -- the
//                  content script only sends this after its own plausible-
//                  problem gate passes). Reply reuses the same type
//                  (SESSION_STATE/GET_PROFILE_OVERVIEW's request/reply
//                  convention): OpeningScanReplyPayload ({reply,
//                  annotations?, profileTags?} on success -- reply is ""
//                  when the model found nothing confident to say, passed
//                  through as-is; {error} on failure). The background calls
//                  api.startSession BEFORE the AI call (ADR-030 Decision 3)
//                  and degrades silently -- an empty/whitespace reply here
//                  is the content script's cue to open with no message.
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
  | 'VOICE_TTS_REPLY'
  | 'GET_PROFILE_OVERVIEW'
  | 'SESSION_ENDED'
  | 'OPENING_SCAN';

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

// Mirrors /web/lib/ai/page-context.ts exactly -- that file is the source of
// truth for the page-context shape and the §2.5 budget (by-convention
// re-declaration, same as LatencyTrace below). No URL, no element rects --
// persistence and the annotation layer are both deferred (ADR-012/ADR-013).
export type PageEquation = {
  latex?: string;
  mathml?: string;
  text?: string;
};

export type PageContext = {
  title?: string;
  text?: string;
  equations: PageEquation[];
};

export type AiTurnPayload = {
  messages: TurnMessage[];
  // A single bounded PageContext snapshot, captured fresh by
  // pageExtractor.ts on overlay open and re-captured on every open -- never
  // cached across turns, never persisted (ADR-012/ADR-013). Absent when
  // extraction found nothing (e.g. an image-only page); the server falls
  // back to the empty-slot prompt wording in that case.
  pageContext?: PageContext;
};

// Mirrors /web/lib/ai/envelope.ts's Annotation/AnnotationTarget exactly --
// that file (and its parseEnvelope validation) is the source of truth for
// the shape (by-convention re-declaration, same as PageEquation above). The
// annotation-rendering layer (Sprint 12 / ADR-022) never crosses back the
// other way -- these only ever travel background -> content, never
// content -> background.
export type AnnotationTargetKind = 'selector' | 'bbox' | 'textMatch';
export type AnnotationType = 'highlight' | 'circle' | 'arrow' | 'label' | 'step-indicator';

export type AnnotationTarget = {
  kind: AnnotationTargetKind;
  selector?: string;
  bbox?: { x: number; y: number; w: number; h: number };
  text?: string;
};

export type Annotation = {
  id: string;
  type: AnnotationType;
  target: AnnotationTarget;
  style?: { color?: string; weight?: string };
  label?: string;
  step?: number;
  ttlMs?: number;
};

// Mirrors /web/lib/ai/envelope.ts's ProfileTag/ProfileTagKind exactly (Sprint
// 13, ADR-024/026) -- the same by-convention re-declaration as Annotation
// above. `label` here is already the route's grounded, title-resolved
// display copy -- the extension never re-derives or re-validates it.
export type ProfileTagKind = 'reviewing' | 'known-gap' | 'due-review' | 'strength' | 'callback';

export type ProfileTag = {
  kind: ProfileTagKind;
  conceptKey: string | null;
  label: string;
};

// Mirrors /web/lib/ai/envelope.ts's SessionCompletionReason/SessionCompletion
// exactly (Sprint 14, ADR-027/028) -- the same by-convention re-declaration
// as Annotation/ProfileTag above. `complete` is always literally `true` when
// present (the server's parse drops a malformed/false completion entirely,
// so "field absent" IS "still open" -- there is no false-shaped value to
// mirror here).
export type SessionCompletionReason = 'solved' | 'follow-up-declined' | 'follow-up-corrected';

export type SessionCompletion = { complete: true; reason: SessionCompletionReason };

// Sprint 12 / ADR-023 + Sprint 13 / ADR-024/025/026 + Sprint 14 / ADR-027/028:
// `annotations`, `profileTags`, `pings`, `solutionProgress`, and `session`
// all ride the existing AI_REPLY payload ADDITIVELY -- each present only
// when the turn actually produced one (never `null`, never an empty array/
// default), so a turn with none of the five is byte-identical to Sprint
// 11's `{ reply }`. None of the five is ever persisted anywhere. Consuming
// solutionProgress/session (the progress bar, the close choreography) is
// Sprint 14 Task 7 -- this task only gets them onto the wire and lets the
// background act on `session.complete` to end the session server-side.
export type AiReplyPayload =
  | {
      reply: string;
      annotations?: Annotation[];
      profileTags?: ProfileTag[];
      pings?: TurnPing[];
      solutionProgress?: number;
      session?: SessionCompletion;
    }
  | { error: string };

// Mirrors /web/app/api/profile/overview/route.ts's response shape exactly
// (Sprint 13, ADR-024/025) -- the source of truth for this shape; titles
// are resolved server-side (@calyxa/curriculum never ships in this bundle).
// Read-only, display-ephemeral: the overlay holds this in local state only,
// re-fetched fresh on every panel open (ADR-024's server-rendered-display /
// nothing-persisted rules).
export type ProfileOverview = {
  calibrating: boolean;
  // lastPracticedAt (Sprint 15 fix pass round 2): recency for the overview
  // card's "top 3 recently updated" sort; optional for wire back-compat.
  mastery: Array<{ conceptKey: string; title: string; mastery: number; state: string; confidenceBand: string; lastPracticedAt?: string | null }>;
  weakSpots: Array<{ conceptKey: string; title: string; category: string; description: string }>;
  dueForReview: Array<{ conceptKey: string; title: string; reason: string }>;
};

export type GetProfileOverviewReplyPayload = { overview: ProfileOverview } | { error: string };

// Mirrors /web/lib/learning/events.ts's TurnPing/TurnPingKind exactly
// (Sprint 13, ADR-026; widened Sprint 14 Task 5/6, the ADR-026 amendment --
// mastery-progress and streak-progress join the original two kinds).
// Computed by the model's own math, never the LLM -- no grounding gate
// applies to this one. `label` is the full, qualitative, server-rendered
// toast copy (never a number, ADR-026) -- the extension only renders it.
// Shown once and discarded; never persisted.
export type TurnPingKind = 'mastery-up' | 'mastery-progress' | 'misconception-resolved' | 'streak-progress';

export type TurnPing = {
  kind: TurnPingKind;
  conceptKey: string;
  title: string;
  label: string;
};

// Mirrors /web/lib/learning/recap.ts's SessionRecap (and its constituent
// Recap* types) exactly (Sprint 13, ADR-025/026) -- built AFTER the
// session-end reconcile, so it cannot disagree with the real mastery write.
// Titles resolved server-side; display-ephemeral -- shown once on
// SESSION_ENDED and discarded, never persisted.
export type RecapConcept = {
  conceptKey: string;
  title: string;
  turns: number;
  correct: number;
  incorrect: number;
  mastery: number;
  state: string;
};

export type RecapMisconception = {
  conceptKey: string;
  title: string;
  category: string;
  description: string;
};

export type RecapNextReview = {
  conceptKey: string;
  title: string;
  dueAt: string;
};

export type RecapTrend = {
  conceptKey: string;
  title: string;
  sessions: number;
  line: string;
};

export type SessionRecap = {
  concepts: RecapConcept[];
  misconceptionsAdded: RecapMisconception[];
  misconceptionsResolved: RecapMisconception[];
  nextReviews: RecapNextReview[];
  trends: RecapTrend[];
};

// Background -> ALL tabs (broadcastToAllTabs), fired once per actual session
// end from either surface. `recap` is omitted (not null) for a session with
// no gradable interactions -- the recap card then simply doesn't render
// (Task 8), same additive-omission discipline as annotations/profileTags/
// pings above.
export type SessionEndedPayload = { recap?: SessionRecap };

// The proactive opening scan (Sprint 14 Task 6, ADR-030): content ->
// background, no `messages` at all -- the content script only sends this
// after its own plausible-problem gate (content/index.ts's
// isPlausibleProblem) passes on the freshly captured PageContext.
export type OpeningScanPayload = { pageContext: PageContext };

// Mirrors the web route's opening-scan response shape exactly (ADR-030):
// `reply` may be an empty string -- the model's own "I'm not confident"
// signal, passed through as-is; the content script (not this type) decides
// what an empty reply means. NEVER carries assessment/pings/solutionProgress/
// session -- there is nothing yet to grade, score, or close.
export type OpeningScanReplyPayload =
  | { reply: string; annotations?: Annotation[]; profileTags?: ProfileTag[] }
  | { error: string };

export type VoiceSttPayload = {
  audio: string; // base64-encoded utterance bytes -- see the binary-over-messaging note above
  mimeType: string;
};

export type VoiceSttReplyPayload = { transcript: string; sttMs: number } | { error: string };

export type VoiceTtsPayload = {
  text: string;
};

export type VoiceTtsReplyPayload = { audio: string; ttsMs: number } | { error: string };

// VOICE_TTS_STREAM (Sprint 15 Task 6, ADR-033) -- a dedicated port (the
// AI_STREAM pattern, chrome.runtime.connect({name: 'VOICE_TTS_STREAM'})),
// content -> background, opened per utterance. content/index.ts posts one
// VoiceTtsPayload to start it; the background streams the route's response
// back as a sequence of VoiceTtsStreamChunkMessage, ending in exactly one
// VoiceTtsStreamDoneMessage (success) or VoiceTtsStreamErrorMessage
// (failure) and then disconnecting. `audio` is base64-encoded audio/mpeg
// bytes (the same binary-over-messaging caveat as VOICE_TTS_REPLY above --
// this crosses the SAME background<->content boundary) fed straight into a
// MediaSource SourceBuffer by the overlay's streaming playback path; never
// persisted (ADR-011). The existing one-shot VOICE_TTS/VOICE_TTS_REPLY pair
// above is KEPT as the buffered fallback for MediaSource/codec failures.
export type VoiceTtsStreamChunkMessage = { type: 'chunk'; audio: string };
export type VoiceTtsStreamDoneMessage = { type: 'done'; ttsMs: number };
export type VoiceTtsStreamErrorMessage = { type: 'error'; error: string };
export type VoiceTtsStreamMessage =
  | VoiceTtsStreamChunkMessage
  | VoiceTtsStreamDoneMessage
  | VoiceTtsStreamErrorMessage;

// VOICE_TURN_STREAM (Sprint 15 voice follow-on, ADR-033 amendment) -- a
// dedicated port (the AI_STREAM/VOICE_TTS_STREAM pattern), content ->
// background, opened per voice turn. content/index.ts posts one AiTurnPayload
// to start it; the background streams the spoken text back as a sequence of
// VoiceTurnStreamSayMessage (one per say-delta from /api/ai/turn/stream) so
// the overlay can start per-sentence TTS before the reply finishes, then
// exactly one VoiceTurnStreamDoneMessage carrying the FULL envelope (the same
// additive fields as AiReplyPayload's success shape) or a
// VoiceTurnStreamErrorMessage. The one-shot AI_TURN/AI_REPLY path is KEPT as
// the buffered fallback the overlay drops to on any streaming failure. No
// audio crosses this port -- it is text only (TTS still rides VOICE_TTS_STREAM).
export type VoiceTurnStreamSayMessage = { type: 'say'; text: string };
export type VoiceTurnStreamDoneMessage = {
  type: 'done';
  reply: string;
  annotations?: Annotation[];
  profileTags?: ProfileTag[];
  pings?: TurnPing[];
  solutionProgress?: number;
  session?: SessionCompletion;
};
export type VoiceTurnStreamErrorMessage = { type: 'error'; error: string };
export type VoiceTurnStreamMessage =
  | VoiceTurnStreamSayMessage
  | VoiceTurnStreamDoneMessage
  | VoiceTurnStreamErrorMessage;

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
