import type { ActiveSession, AuthUser } from '../lib/storage';
import type { ScrubbedErrorEvent } from '../lib/monitoring';

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
//                  (SESSION_STATE/GET_STATE's request/reply convention):
//                  OpeningScanReplyPayload ({reply,
//                  annotations?, profileTags?} on success -- reply is ""
//                  when the model found nothing confident to say, passed
//                  through as-is; {error} on failure). The background calls
//                  api.startSession BEFORE the AI call (ADR-030 Decision 3)
//                  and degrades silently -- an empty/whitespace reply here
//                  is the content script's cue to open with no message.
//   SEND_TELEMETRY (Sprint 17 Task 6, ADR-043) — overlay/content ->
//                  background, no reply awaited: SendTelemetryPayload
//                  ({events}). The background is the sole network-egress
//                  context (ADR-006), so the overlay never posts to
//                  /api/telemetry itself -- it hands the typed, content-free
//                  events here and the worker BATCHES them (flush on N or on
//                  an age interval) and swallows any POST failure (a lost
//                  telemetry event never affects the student). Fire-and-forget
//                  by design: nothing is returned and the sender never awaits
//                  a result.
//   SEND_FEEDBACK  (Sprint 17 Task 6, ADR-039) — overlay -> background:
//                  SendFeedbackPayload ({kind, rating?, message?, sessionId?}).
//                  Unlike telemetry this is USER-initiated, so it is
//                  request/reply (SendFeedbackReplyPayload {ok}|{error}) --
//                  the affordance (Task 7) can surface a save failure. The
//                  worker owns the /api/feedback call; `message` is the one
//                  deliberate user-authored free-text field this sprint
//                  (ADR-043), RLS-scoped + export/erasure-covered server-side.
//   LOG_ERROR      (Sprint 17 Task 6, ADR-043) — content -> background, no
//                  reply awaited: LogErrorPayload (a ScrubbedErrorEvent,
//                  ALREADY scrubbed by monitoring.ts's scrubError in the
//                  content script before it ever crosses this boundary). The
//                  content script cannot reach the network (ADR-006), so it
//                  relays the scrubbed shape here and the background forwards
//                  it to POST /api/errors -- the extension holds no monitoring
//                  secret/DSN of any kind (the locked "no key in the extension
//                  bundle" rule). Fire-and-forget, like SEND_TELEMETRY.
//   ONBOARDING_STATUS (Sprint 17 Task 7, ADR-042) — overlay -> background, no
//                  payload: GET /api/onboarding via the worker. Reply
//                  (OnboardingStatusReplyPayload) is `{needed:false}` on
//                  either a genuinely-not-needed profile OR any failure
//                  (auth/network) -- the background degrades silently, same
//                  posture as OPENING_SCAN's EMPTY_REPLY, so a hiccup here
//                  never blocks the tutor's existing live-calibration
//                  fallback. `{needed:true, items}` carries the 8-12
//                  assessment items -- the extension has no
//                  @calyxa/curriculum dependency, so this is the one place
//                  the item bank's output crosses the wire (web/app/api/
//                  onboarding/route.ts's Task 7 addition).
//   ONBOARDING_SUBMIT (Sprint 17 Task 7, ADR-042) — overlay -> background:
//                  OnboardingSubmitPayload ({results}). POSTs to
//                  /api/onboarding, which seeds the graph through the
//                  existing FSRS apply path and writes
//                  onboarding_completed_at. Request/reply (unlike
//                  telemetry): a failure IS surfaced
//                  (OnboardingSubmitReplyPayload's {error} variant) so
//                  Onboarding.tsx can offer a retry rather than silently
//                  losing the student's answers.
//   GENERATE_STUDY_KIT (Sprint 21 Task 5, ADR-049) — overlay -> background:
//                  GenerateStudyKitPayload ({sessionId}). POSTs to
//                  /api/study/generate (the worker is the sole egress,
//                  ADR-006). Request/reply, like ONBOARDING_SUBMIT: study-kit
//                  generation is a USER-initiated action off the recap card,
//                  so a failure IS surfaced. Reply (STUDY_KIT_REPLY /
//                  StudyKitReplyPayload) is {kit} on success, {refused:'cost'}
//                  when the route hit the hard cost cap without a Claude call
//                  (ADR-041), {refused:'empty'} when the session had nothing
//                  worth generating (never persists a half-kit, ADR-049), or
//                  {error} on any failure. The recap card degrades to its
//                  placeholder tiles on refused/error (Task 5).
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
  | 'SESSION_ENDED'
  | 'OPENING_SCAN'
  | 'SEND_TELEMETRY'
  | 'SEND_FEEDBACK'
  | 'LOG_ERROR'
  | 'ONBOARDING_STATUS'
  | 'ONBOARDING_SUBMIT'
  | 'GENERATE_STUDY_KIT'
  | 'STUDY_KIT_REPLY';

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

// The check-in confirmation as STRUCTURED wire data (Darcy's design
// follow-up, replacing the built session-start student turn entirely): the
// tutor must never receive a fabricated student message -- topic phrasing
// can drift from the actual detected question. The student only ever
// CONFIRMED the detected question and the predicted sticking point, so
// exactly that confirmation crosses the wire; the server renders it into
// the system prompt (SESSION START MODE), never into the transcript, and
// the tutor's first message dives straight into the problem at the
// sticking point.
export type SessionStartInfo = {
  // The opening scan's own one-line read of the detected problem
  // (HeldScan.question) -- the thing the student confirmed.
  question: string;
  // The confirmed sticking point: the predicted-misconception card the
  // student accepted, or their own words from the 5b reframe tool. null =
  // the honest "not sure" -- the tutor finds the weak spot while working.
  stickingPoint: string | null;
  // The reframe tool's cropped page snippet, when the student framed the
  // exact spot themselves.
  snippet?: string;
};

export type AiTurnPayload = {
  messages: TurnMessage[];
  // A single bounded PageContext snapshot, captured fresh by
  // pageExtractor.ts on overlay open and re-captured on every open -- never
  // cached across turns, never persisted (ADR-012/ADR-013). Absent when
  // extraction found nothing (e.g. an image-only page); the server falls
  // back to the empty-slot prompt wording in that case.
  pageContext?: PageContext;
  // Present ONLY on a session's first turn (the check-in confirm / reframe
  // start), always with `messages: []` -- there is no student message; the
  // server builds its own API placeholder turn and the SESSION START MODE
  // prompt block from this instead.
  sessionStart?: SessionStartInfo;
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
  note?: string;
  step?: number;
  ttlMs?: number;
};

// Mirrors /web/lib/learning/events.ts's StatusPin exactly (Sprint 15,
// ADR-034 -- the unified transient-signal surface, replacing Sprint 13's
// ProfileTag pills + TurnPing toasts) -- the same by-convention
// re-declaration as Annotation above. `label` is already the route's
// server-rendered display copy (grounded/title-resolved for learning and
// memory pins, fixed product copy for the model-declared tutor moves) --
// the extension never re-derives or re-validates it, it only maps `kind` to
// an icon and `category` to a color. 'final-step' is the ONE kind the
// extension itself constructs (from the solution-progress signal crossing
// its threshold, Overlay.tsx); the server never emits it. Shown once in the
// title card and discarded; never persisted.
export type StatusPinCategory =
  | 'prediction'
  | 'progress'
  | 'teaching'
  | 'guidance'
  | 'difficulty'
  | 'memory'
  | 'confidence'
  | 'independence';

export type StatusPinKind =
  | 'prediction-confirmed'
  | 'misconception-detected'
  | 'pattern-detected'
  | 'pattern-broken'
  | 'streak-progress'
  | 'concept-understood'
  | 'progress'
  | 'final-step'
  | 'teaching-visual'
  | 'teaching-decompose'
  | 'pace-up'
  | 'guidance-up'
  | 'guidance-down'
  | 'difficulty-up'
  | 'difficulty-down'
  | 'callback'
  | 'due-review'
  | 'confidence-up'
  | 'self-caught';

export type StatusPin = {
  category: StatusPinCategory;
  kind: StatusPinKind;
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

// Multi-part answer fields (design 8d): when the tutor's question carries more
// than one unknown ("what's the adjacent side, and the hypotenuse?"), the
// model emits one AnswerField per value instead of a flat chip row -- the
// overlay renders a labeled textbox per field and commits every value as one
// student turn (the model grades it like any typed answer). Same additive,
// server-validated, display-ephemeral discipline as `chips`, and mutually
// exclusive with it: a turn carries at most one of the two. `label` is the
// short field name shown above the box ("Adjacent"); `placeholder` an optional
// example value ("e.g. 8.66"). Mirrors /web/lib/ai/envelope.ts's AnswerField.
export type AnswerField = {
  label: string;
  placeholder?: string;
};

// Sprint 12 / ADR-023 + Sprint 13 / ADR-024/025/026 + Sprint 14 / ADR-027/028
// + Sprint 15 / ADR-034: `annotations`, `pins`, `solutionProgress`, and
// `session` all ride the existing AI_REPLY payload ADDITIVELY -- each
// present only when the turn actually produced one (never `null`, never an
// empty array/default), so a turn with none of the four is byte-identical
// to Sprint 11's `{ reply }`. None of the four is ever persisted anywhere.
// `pins` REPLACES Sprint 13's separate `profileTags` + `pings` fields
// (ADR-034 -- the extension and the web routes ship together, so this is a
// clean rename, not a deprecation dance).
export type AiReplyPayload =
  | {
      reply: string;
      annotations?: Annotation[];
      pins?: StatusPin[];
      solutionProgress?: number;
      session?: SessionCompletion;
      // Answer chips (design 8a): the turn's short tap-to-answer options,
      // already validated/deduped/capped server-side (envelope.ts) -- same
      // additive discipline as the fields above (present only when the turn
      // carried any, never []), same thread-through-only rule client-side.
      chips?: string[];
      // Multi-part answer fields (design 8d): the labeled per-unknown textbox
      // spec, same additive/validated/ephemeral discipline as `chips` and
      // never present alongside it (the server sends at most one of the two).
      answerFields?: AnswerField[];
    }
  | { error: string };

// Mirrors /web/app/api/profile/overview/route.ts's response shape exactly
// (Sprint 13, ADR-024/025) -- the source of truth for this shape; titles
// are resolved server-side (@calyxa/curriculum never ships in this bundle).
// Kept only for Overlay.tsx's masteryDelta helper (a future recap pass may
// re-add mastery-change arrows); nothing in the extension fetches this
// shape over the wire anymore.
export type ProfileOverview = {
  calibrating: boolean;
  // lastPracticedAt (Sprint 15 fix pass round 2): recency for the overview
  // card's "top 3 recently updated" sort; optional for wire back-compat.
  mastery: Array<{ conceptKey: string; title: string; mastery: number; state: string; confidenceBand: string; lastPracticedAt?: string | null }>;
  weakSpots: Array<{ conceptKey: string; title: string; category: string; description: string }>;
  dueForReview: Array<{ conceptKey: string; title: string; reason: string }>;
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
// pings above. `sessionId` (Sprint 21 Task 5, ADR-049) is the ended
// session's id, added so the recap card can generate a study kit FOR that
// session -- the recap arrives after the active session is already cleared
// (handleEndSession), so onGetActiveSessionId would return undefined by then;
// carrying the id on the broadcast is the only place it's still known. Absent
// only in the degenerate "ended with no active session" path.
export type SessionEndedPayload = { recap?: SessionRecap; sessionId?: string };

// Sprint 21 / Task 5 (ADR-049): the study kit as it crosses the wire back to
// the recap card -- the client-side mirror of the /api/study/generate + /list
// response shapes (the same by-convention re-declaration as SessionRecap
// above; no shared module spans the extension/web boundary). The web
// StudyProblem additionally carries a `conceptKey`; the extension doesn't
// render it, so it's an ignored wire field here (not declared), the same
// posture as the opening scan's dropped `profileTags`.
export type StudyProblem = { statement: string; solution: string };
export type StudyFlashcard = { front: string; back: string };
export type StudyKit = {
  notes: string[];
  problems: StudyProblem[];
  flashcards: StudyFlashcard[];
};

// One persisted artifact row from GET /api/study/list (one per artifact kind,
// ADR-049 decision 3). Consumed by listStudyKits() in lib/api.ts -- the
// transport for the future dashboard/past-kits surface (Sprint 22); the recap
// card this sprint is generate-on-click and does not read this. `payload` is
// the kind-specific shape (string[] for notes, StudyProblem[] for problems,
// StudyFlashcard[] for flashcards) -- untyped here since a single row's kind
// isn't known at the type level.
export type StudyArtifact = {
  id: string;
  sessionId: string | null;
  kind: 'notes' | 'problems' | 'flashcards';
  payload: unknown;
  conceptKeys: string[] | null;
  createdAt: string;
};

// GENERATE_STUDY_KIT payload (overlay -> background). `sessionId` is the ended
// session (from the SESSION_ENDED broadcast above) the kit is generated for.
export type GenerateStudyKitPayload = { sessionId: string };

// STUDY_KIT_REPLY payload (background -> caller). Mirrors /api/study/generate's
// discriminated response: {kit} on success; {refused} when the route
// gracefully declined (hard cost cap, or nothing worth generating) WITHOUT an
// error; {error} on a real failure. The recap card renders the kit, shows a
// gentle message + its placeholder on `refused`, and offers a retry on `error`.
export type StudyKitReplyPayload =
  | { kit: StudyKit }
  | { refused: 'cost' | 'empty' }
  | { error: string };

// The non-error outcome of a generation, shared by the whole transport chain
// (lib/api.ts -> background -> content relay -> the overlay's onGenerateStudyKit
// prop -> RecapCard). The transport resolves this and THROWS on { error } (or an
// unreachable worker), so the recap card's single try/catch treats every
// failure as one case, then branches kit-vs-refused on success.
export type StudyKitResult = { kit: StudyKit } | { refused: 'cost' | 'empty' };

// The proactive opening scan (Sprint 14 Task 6, ADR-030): content ->
// background, no `messages` at all -- the content script only sends this
// after its own plausible-problem gate (content/index.ts's
// isPlausibleProblem) passes on the freshly captured PageContext.
export type OpeningScanPayload = { pageContext: PageContext };

// The session-kickoff struggle prediction (mirrors the web route's
// `prediction` field exactly -- computed server-side by predictLikelyStruggle
// from the profile's ACTIVE misconceptions, grounded and title-resolved, no
// model involvement). Rides the opening scan additively: present only when
// the student's recorded history actually carries an unresolved
// misconception to predict from. Display-ephemeral, like every profile
// surface here -- the kickoff card renders it and the student's yes/no
// choice flows back through the normal turn pipeline (never a new write
// path; misconception recording/resolution stays the existing
// assessment-driven machinery).
export type StrugglePrediction = {
  conceptKey: string;
  title: string;
  category: string;
  description: string;
};

// The opening scan's detected page topic (check-in state 5a's "spotted on
// this page" suggestion card): the first topic key the route's own
// detectTopicKeys resolved from the pageContext, title-resolved server-side
// (@calyxa/curriculum never ships in this bundle) -- deterministic keyword
// match, no model involvement, same grounding discipline as `prediction`
// below. Display-ephemeral like every profile surface here.
export type PageTopic = {
  conceptKey: string;
  title: string;
};

// The check-in's 5b sticking-point candidates (design handoff feature): up
// to 3 of the student's OWN recorded misconceptions for the check-in's
// CONFIRMED topic -- grounded server-side (the misconceptions table,
// ranked occurrence/recency-first, scoped to one conceptKey via predict.ts's
// pickStickingCandidates), never model-generated. `category`/`description`
// mirror ActiveMisconception's own fields (web/lib/ai/profile.ts); the
// overlay humanizes them into a chip label (session-flow.ts's
// humanizeMisconceptionLabel). Rides the SAME opening-scan response as
// `topic`/`prediction`, additive; empty/absent when the profile carries
// nothing recorded for that concept -- the check-in then fills 5b's chips
// from its fixed generic set (session-flow.ts's buildStickingChips).
export type StickingCandidate = {
  category: string;
  description: string;
};

// Mirrors the web route's opening-scan response shape (ADR-030): `reply`
// may be an empty string -- the model's own "I'm not confident" signal,
// passed through as-is; the content script (not this type) decides what an
// empty reply means. NEVER carries assessment/pins/solutionProgress/
// session -- there is nothing yet to grade, score, or close. `prediction`
// (session-kickoff feature), `topic` (check-in 5a), and `stickingCandidates`
// (check-in 5b) ride additively, same omission discipline as annotations.
// The route still sends `profileTags` on this reply; the extension stopped
// consuming them when the transcript's tag pills were retired (ADR-034), so
// the field is simply not declared here -- an ignored wire field, not an
// error.
export type OpeningScanReplyPayload =
  | {
      reply: string;
      annotations?: Annotation[];
      prediction?: StrugglePrediction;
      topic?: PageTopic;
      stickingCandidates?: StickingCandidate[];
    }
  | { error: string };

export type VoiceSttPayload = {
  audio: string; // base64-encoded utterance bytes -- see the binary-over-messaging note above
  mimeType: string;
};

// The `degraded` members (cost-cap fix, 2026-07-15): when the daily soft/hard
// cap is crossed, /api/voice/stt and /api/voice/tts return
// `{ degraded, degradedCap }` with NO transcript/audio (ADR-041 Decision 2).
// The background used to strip that signal, so the overlay saw an undefined
// transcript / zero audio chunks and the voice turn broke messily instead of
// degrading to text. These explicit members let the overlay skip the voice
// legs gracefully.
export type VoiceSttReplyPayload =
  | { transcript: string; sttMs: number }
  | { degraded: true; degradedCap: 'soft' | 'hard' }
  | { error: string };

export type VoiceTtsPayload = {
  text: string;
};

export type VoiceTtsReplyPayload =
  | { audio: string; ttsMs: number }
  | { degraded: true; degradedCap: 'soft' | 'hard' }
  | { error: string };

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
// `degraded` (cost-cap fix, 2026-07-15): a capped TTS leg posts NO chunk
// messages -- this flag on the terminal 'done' is how the overlay's streaming
// player learns no audio is coming and reveals the reply as text instead of
// waiting for a first chunk that never arrives.
export type VoiceTtsStreamDoneMessage = { type: 'done'; ttsMs: number; degraded?: true };
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
  pins?: StatusPin[];
  solutionProgress?: number;
  session?: SessionCompletion;
  chips?: string[];
  answerFields?: AnswerField[];
  // Cost-cap signal (ADR-041/043, threaded through per the 2026-07-15 fix):
  // present when the turn route flagged the day as capped, so the overlay
  // knows this reply is text-only by design, not by failure.
  degraded?: true;
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

// Sprint 17 / Task 6 (ADR-043): the client-side mirror of
// web/lib/telemetry/events.ts's TelemetryEvent union -- the same
// by-convention re-declaration as LatencyTrace/PageContext/Annotation above
// (no shared module spans the extension/web boundary). This is what the
// overlay/content build and SEND_TELEMETRY carries to the background, which
// relays it to POST /api/telemetry; the route re-validates every event
// against ITS own copy of the union (validateEvent), so this mirror is a
// convenience type for the client, never the trust boundary.
//
// Like the web copy, EVERY field below is a number, a boolean, or a closed
// string-literal enum -- there is deliberately NO free-text field anywhere in
// the union (the ADR-043 privacy guarantee), so a transcript, a page URL, or
// any student/tutor string literally cannot be attached to a telemetry event
// without changing this type (and its web source of truth, and tripping the
// telemetry test). Keep this union field-for-field identical to
// web/lib/telemetry/events.ts.
export type TelemetryEvent =
  | { kind: 'onboarding_completed'; itemCount: number; ms: number }
  | { kind: 'session_started'; mode: 'voice' | 'text' }
  | { kind: 'turn_latency'; sttMs: number; aiMs: number; ttsMs: number; networkMs: number; totalMs: number }
  | { kind: 'annotation_rendered'; count: number; fallback: boolean }
  | { kind: 'voice_used' }
  | { kind: 'degraded_hit'; cap: 'soft' | 'hard'; source: 'claude_turn' | 'whisper_stt' | 'elevenlabs_tts' };

// SEND_TELEMETRY payload (overlay/content -> background). A batch of one or
// more events; the background accumulates across messages and flushes on N or
// on an age interval (background/index.ts), so callers can send singly.
export type SendTelemetryPayload = { events: TelemetryEvent[] };

// SEND_FEEDBACK payload (overlay -> background). Mirrors /api/feedback's
// accepted body exactly (web/app/api/feedback/route.ts): `kind` is required,
// the rest optional. `message` is the one deliberate user-authored free-text
// field this sprint (ADR-043) -- passed through verbatim, RLS-scoped +
// export/erasure-covered server-side. `sessionId`, when present, is the
// active session the feedback is about (wired by Task 7's affordance).
export type SendFeedbackPayload = {
  kind: 'bug' | 'rating' | 'idea';
  rating?: number;
  message?: string;
  sessionId?: string;
};

// SEND_FEEDBACK reply (background -> caller). Feedback is user-initiated, so
// unlike telemetry a failure IS surfaced -- the affordance (Task 7) shows a
// retry on { error }. `{ ok: true }` on a successful insert.
export type SendFeedbackReplyPayload = { ok: true } | { error: string };

// LOG_ERROR payload (content -> background). Exactly the already-scrubbed
// shape monitoring.ts's scrubError produces in the content script -- the
// scrub happens BEFORE this crosses the boundary (there is nothing to scrub
// on the background side, only relay). The background forwards it to
// POST /api/errors, which alone holds the monitoring secret (ADR-043); the
// route accepts only {message, stack?, context?}, so the scrub's `timestamp`
// is dropped by the api.ts relay, not sent.
export type LogErrorPayload = ScrubbedErrorEvent;

// Sprint 17 / Task 7 (ADR-042): the client-side mirror of
// web/lib/onboarding/item-bank.ts's AssessmentItem/AssessmentChoiceOption/
// AssessmentResult -- the same by-convention re-declaration as TelemetryEvent
// above (no shared module spans the extension/web boundary, and the
// extension deliberately has no @calyxa/curriculum dependency). Keep
// field-for-field identical to the web source of truth.
export type Outcome = 'correct' | 'partial' | 'incorrect';
export type SelfConfidence = 'low' | 'med' | 'high' | 'unknown';
export type AssessmentItemKind = 'choice' | 'free';

export type AssessmentChoiceOption = {
  label: string;
  outcome: Outcome;
  selfConfidence: SelfConfidence;
};

export type AssessmentItem = {
  conceptKey: string;
  strand: string;
  strandLabel: string;
  title: string;
  prompt: string;
  kind: AssessmentItemKind;
  options?: AssessmentChoiceOption[];
};

// The graded result Onboarding.tsx POSTs per answered item (ONBOARDING_SUBMIT).
export type AssessmentResult = {
  conceptKey: string;
  outcome: Outcome;
  selfConfidence: SelfConfidence;
};

// ONBOARDING_STATUS reply (background -> caller). See the header comment
// above for the degrade-to-{needed:false} discipline -- there is no error
// variant; a failed check is indistinguishable from "not needed" by design,
// since onboarding is a nice-to-have gate, not a hard requirement (the tutor's
// live-calibration fallback is preserved either way, ADR-042).
export type OnboardingStatusReplyPayload = { needed: false } | { needed: true; items: AssessmentItem[] };

// ONBOARDING_SUBMIT payload/reply (overlay -> background -> caller).
export type OnboardingSubmitPayload = { results: AssessmentResult[] };
export type OnboardingSubmitReplyPayload = { seededCount: number } | { error: string };
