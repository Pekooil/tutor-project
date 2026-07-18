import {
  Fragment,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { CalyxaMark } from '@calyxa/ui';
import './Overlay.css';
import type {
  Annotation,
  AnswerField,
  PageTopic,
  ProfileOverview,
  SendFeedbackPayload,
  SessionCompletion,
  SessionRecap,
  SessionStartInfo,
  StatusPin,
  StatusPinKind,
  StickingCandidate,
  StrugglePrediction,
  StudyKitResult,
  TelemetryEvent,
  TurnMessage,
} from '../types/messages';
import { AnnotationLayer } from './AnnotationLayer';
import { CONCEPT_CARD_VARIANT, ConceptCard, ConceptFallbackCard } from './CheckinCard';
import { Composer } from './Composer';
import { FeedbackCard } from './FeedbackCard';
import { Tutorial } from './Tutorial';
import { PingToast } from './PingToast';
import { RecapCard } from './RecapCard';
import { ReframeTool } from './ReframeTool';
import { SectionBloomFrame } from './SectionBloom';
import {
  AnswerFields,
  highlightAnnotatedPhrases,
  splitMathBlocks,
  tokenizeMathText,
} from './Transcript';
import { TUTOR_MODES, deriveTutorMode, type TutorModeKey } from './tutor-modes';
import { prewarmMic, releaseWarmMic, startRecording, type RecordingHandle, type Utterance } from './VoiceController';
import { NOT_SURE_CHIP, buildStickingChips, bloomLine } from './session-flow';
import { createSentenceAccumulator, micStateReducer, wordsDueByTime } from './voice-timing';
import type { MilestoneMeta } from './pings';

// The panel-close signal (Sprint 12 Task 6): dispatched on an EXPLICIT
// collapse to idle (Escape, a confirmed session end, the recap's Complete
// session) so the annotation controller (content/annotations.ts) can
// clearAnnotations() -- a dismissed tutor leaves a clean page. The ambient
// pill's own quiet return to idle after a turn (the caption dissolving) is
// deliberately NOT a close: the turn's annotations are the student's working
// context and must outlive the 1.4s caption. Mirrors the
// 'calyxa:toggle-panel' bridge pattern; flows Overlay -> content only.
export const PANEL_CLOSED_EVENT = 'calyxa:panel-closed';

// The panel-EXPAND signal (Sprint 14 Task 6, the filed Sprint 13 live-find):
// dispatched whenever the pill leaves idle (idle -> hover/text/scan/listen,
// however it got there). content/index.ts listens for this to re-run
// extractPageContext() + the equation-registry refresh fresh on every real
// expansion, so annotation targeting and the opening scan never run against
// a stale capture. In the ambient model the pill returns to idle between
// turns, so this fires again on the next engagement -- context is captured
// per-approach, strictly fresher than the old once-per-panel-open. Mirrors
// PANEL_CLOSED_EVENT's bridge pattern, reversed direction.
export const PANEL_EXPANDED_EVENT = 'calyxa:panel-expanded';

// The session-recap signal (Sprint 13, ADR-025): content/index.ts forwards
// the background's SESSION_ENDED broadcast as this window CustomEvent (the
// 'calyxa:toggle-panel' bridge pattern, reversed direction), detail
// `{ recap?: SessionRecap }`. Flows content -> Overlay only.
export const SESSION_RECAP_EVENT = 'calyxa:session-recap';

// What one turn resolves to (Sprint 13; widened Sprint 14 Task 7; Sprint 15
// ADR-034 replaces the tags/pings pair with `pins`): the reply plus the
// turn's status pins, raw annotations, and progress/completion signal, when
// the wire carried any -- content/index.ts's sendAiTurn builds this from
// the `done` message / the AI_REPLY payload on both paths. The empty-reply
// guard keys on `reply` exactly as it did when onSend resolved a bare
// string. `annotations` rides here (in ADDITION to content/index.ts already
// drawing them via showTurnAnnotations) so this file can compute the
// per-turn color assignment and the caption's color-linked prose can match
// `target.text` inside `say`.
export type TurnResult = {
  reply: string;
  pins?: StatusPin[];
  annotations?: Annotation[];
  solutionProgress?: number;
  session?: SessionCompletion;
  // Answer chips (design 8a): the turn's short tap-to-answer options,
  // validated/deduped/capped server-side (envelope.ts). Display-ephemeral:
  // they belong to the LATEST tutor turn only, never to the message list
  // and never to the wire history.
  chips?: string[];
  // Multi-part answer fields (design 8d): the turn's labeled per-unknown
  // textbox spec, same additive/ephemeral discipline as `chips` and never
  // present alongside it (the server sends at most one of the two).
  answerFields?: AnswerField[];
  // The daily cost-cap signal (ADR-041 Decision 2, threaded through per the
  // 2026-07-15 cost-cap fix): the server flagged this turn as degraded, so
  // its voice legs returned nothing by DESIGN -- the reply is text-only.
  degraded?: true;
};

// Local DISPLAY message type (Sprint 13, ADR-024; slimmed by the ambient
// pill redesign -- there is no rendered transcript anymore, but the display
// list is still the wire history's source (stripHistory below) and the last
// user/assistant pair feeds the history card). `annotations` +
// `annotationColors` ride the assistant entries so the caption's
// color-linked prose renders from the same one-per-turn assignment. An
// entry with `milestone` set is a MARKER, not a turn -- retained in the
// type for wire-strip compatibility (stripHistory drops it; the history
// card skips it), though the ambient redesign no longer commits new ones.
export type DisplayMessage = TurnMessage & {
  annotations?: Annotation[];
  annotationColors?: AnnotationColorMap;
  milestone?: MilestoneMeta;
};

// Client-side cap (defence in depth -- the delivery contract is server-side
// too): at most 2 pins SHOWN per turn (ADR-026's delivery cap, kept by
// ADR-034) -- the priority order below decides which two survive.
export const MAX_PINS_PER_TURN = 2;
// How long each ping toast holds the surface slot before the queue advances
// (design 8b: "pings hold for 3 seconds, one at a time"). The queue only
// advances while the slot is actually free (see the advance effect below) --
// a caption or answer card outranks a ping, so a signal is never burned
// invisibly behind another surface.
export const PIN_DISPLAY_MS = 3000;

// ---- Pure display logic (exported for the vitest/jsdom specs, the
// annotations.ts testable-module precedent) ----

/**
 * The history sent to onSend is pure role/content -- display extras never
 * leave the overlay, and milestone MARKERS (design 8a) are dropped outright:
 * they're the session annotating itself, not something the model said.
 */
export function stripHistory(messages: readonly DisplayMessage[]): TurnMessage[] {
  return messages.filter((message) => !message.milestone).map(({ role, content }) => ({ role, content }));
}

// PLAN §2.5's context window: the tutor only needs the last 6-8 turns, so the
// client trims the prior history to this before every send (Sprint 19 Task 8)
// -- fewer input tokens each turn means lower cost and faster time-to-first-
// token, with NO pedagogy change (pure windowing; the server clamps to the
// same window defensively, turn-request.ts).
export const HISTORY_WINDOW_TURNS = 8;

/**
 * Keeps only the last `maxTurns` user-initiated turns of history (a user
 * message plus the assistant reply that follows it). Windowing by USER turn --
 * not raw message count -- guarantees the slice still BEGINS on a user message,
 * which the Anthropic API requires of the first message in the array.
 */
export function windowHistory(messages: TurnMessage[], maxTurns: number = HISTORY_WINDOW_TURNS): TurnMessage[] {
  let userTurnsSeen = 0;
  let startIndex = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user') {
      userTurnsSeen += 1;
      startIndex = i;
      if (userTurnsSeen >= maxTurns) break;
    }
  }
  return startIndex === 0 ? messages : messages.slice(startIndex);
}

// ---- The session-start detection (the opening scan feeding the concept
// card -- the ambient redesign of the 5a check-in) ----

// What the opening scan resolves into: the scan's result is HELD here and
// feeds the concept card (`topic`, the server's page-detected concept). The
// held `question` never enters the wire history as a turn: on confirm (tap
// or the drain bar's auto-start) it crosses the wire once as the structured
// sessionStart.question field (startSessionTurn below), and the tutor's
// first message responds directly to the confirmed misconception in it. A
// reframe (the "No, something else" path) supersedes it with the student's
// own words. Display-ephemeral like the recap: cleared on performClose /
// an Escape dismissal, never persisted.
export type HeldScan = {
  question: string;
  topic?: PageTopic;
  // The concept card's sticking-point candidates: up to 3 of the student's
  // own recorded misconceptions for `topic`'s concept, grounded server-side.
  stickingCandidates?: StickingCandidate[];
  annotations?: Annotation[];
};

// The section-complete congratulation window: the bloom card holds for
// exactly 3s before handing off to the recap. The cx-bloom-fade keyframe
// eases the glow in and back out within this same window.
export const BLOOM_MS = 3000;

// The concept card's auto-start window (the check-in's 5s countdown, resized
// to the handoff's 5.2s drain bar -- the bar and the timer are ONE window,
// the shared-duration discipline): armed while the card is on screen and no
// exit was taken; when it empties, the sessionStart kickoff fires exactly as
// the old Start button did (Darcy's call, 2026-07-13).
export const AUTO_START_MS = 5200;

// Transient-surface timing (handoff values, amended 2026-07-16 -- Darcy's
// ask): the committed caption no longer auto-dissolves. The tutor's reply
// HOLDS on screen until the student's next action -- an answer-chip tap, a
// multi-part submit, a new typed prompt, or the next voice turn (every one
// of those paths already clears captionHold before sending) -- or an
// explicit Escape/collapse. The history card still holds 6.5s; every card's
// exit animation runs 270ms before unmount; a no-detection fallback card
// and an error notice each hold long enough to read, then dissolve.
export const HISTORY_HOLD_MS = 6500;
export const SURFACE_EXIT_MS = 270;
const FALLBACK_HOLD_MS = 8000;
const NOTICE_HOLD_MS = 6000;

// The pill's shape map [width, height, radius] px (handoff §"The pill").
// The hover row grows past the design's fixed 284px when a session is live:
// end-session ✕ + the feedback affordance join behind a divider (Darcy's
// call, 2026-07-13 -- both needed a home once the panel header retired).
export type PillState = 'idle' | 'hover' | 'text' | 'scan' | 'think' | 'listen' | 'speak';
export const PILL_SHAPES: Record<PillState, [number, number, number]> = {
  idle: [39, 5, 3],
  hover: [284, 52, 26],
  text: [540, 54, 27],
  scan: [236, 48, 24],
  think: [152, 46, 23],
  listen: [204, 52, 26],
  speak: [216, 52, 26],
};
const HOVER_SESSION_WIDTH = 383;

/**
 * The annotations/annotationColors extras every committed assistant
 * DisplayMessage carries (Sprint 14 Task 7) -- one place for the commit
 * sites (text, voice, kickoff) so the color assignment is computed the
 * exact same way regardless of which turn kind produced it.
 */
function assistantMessageExtras(result: {
  annotations?: Annotation[];
}): Pick<DisplayMessage, 'annotations' | 'annotationColors'> {
  return {
    ...(result.annotations && result.annotations.length > 0
      ? { annotations: result.annotations, annotationColors: assignAnnotationColors(result.annotations) }
      : {}),
  };
}

// Which pin wins the slot when a turn carries several (ADR-034): the
// rarest, most-earned signals first. Lower number = shown first. Ties keep
// the server's own order (Array.prototype.sort is stable).
export const PIN_PRIORITY: Record<StatusPinKind, number> = {
  'pattern-broken': 0,
  'prediction-confirmed': 1,
  'concept-understood': 2,
  'self-caught': 3,
  'streak-progress': 4,
  progress: 5,
  'confidence-up': 6,
  'final-step': 7,
  'misconception-detected': 8,
  'pattern-detected': 8,
  'teaching-visual': 9,
  'teaching-decompose': 9,
  'pace-up': 9,
  'guidance-up': 9,
  'guidance-down': 9,
  'difficulty-up': 9,
  'difficulty-down': 9,
  callback: 10,
  'due-review': 11,
};

/**
 * The pin gate (ADR-034, inheriting ADR-026's delivery discipline):
 * priority-sort, then at most MAX_PINS_PER_TURN shown per turn, and at most
 * ONE pin of a given KIND per concept per session for every kind EXCEPT
 * pattern-broken. `shownPinKeys` is the session-lifetime dedupe set, keyed
 * `${kind}:${conceptKey ?? ''}`; mutated here, reset when a
 * SESSION_RECAP_EVENT arrives (the session is over).
 */
export function filterPinsForDisplay(
  pins: readonly StatusPin[] | undefined,
  shownPinKeys: Set<string>,
): StatusPin[] {
  const ordered = [...(pins ?? [])].sort((a, b) => PIN_PRIORITY[a.kind] - PIN_PRIORITY[b.kind]);
  const shown: StatusPin[] = [];
  for (const pin of ordered) {
    if (shown.length >= MAX_PINS_PER_TURN) break;
    if (pin.kind !== 'pattern-broken') {
      const key = `${pin.kind}:${pin.conceptKey ?? ''}`;
      if (shownPinKeys.has(key)) continue;
      shownPinKeys.add(key);
    }
    shown.push(pin);
  }
  return shown;
}

/**
 * Delta vs the panel-open overview snapshot (ADR-025: computed client-side,
 * never persisted). null when there is no baseline for the concept. Kept
 * exported (with DELTA_EPSILON and humanizeDue below) since
 * overlay-display.test.ts pins the math and a future recap pass may re-add
 * the arrows.
 */
export function masteryDelta(
  baseline: ProfileOverview | null,
  conceptKey: string,
  mastery: number,
): number | null {
  const node = baseline?.mastery.find((item) => item.conceptKey === conceptKey);
  return node ? mastery - node.mastery : null;
}

// Below this, a delta renders no arrow -- display precision, not model
// precision (a recap row is shown as a whole percent).
export const DELTA_EPSILON = 0.005;

// ---- Sprint 14 Task 7: the solution-progress signal (ADR-028) ----

// "Model-emitted, client-clamped": the server already scores genuine
// reasoning steps and softens a wrong one -- this is the CLIENT half, a
// defence-in-depth bound so a misbehaving turn can never crater the signal
// to near-zero in one step. Exported as a pure function for the vitest spec.
export const PROGRESS_MAX_REGRESSION = 0.15;

/**
 * `solved` forces the signal to exactly 1 regardless of what
 * solutionProgress said this turn. `next === undefined` means the turn
 * carried no solutionProgress at all -- the signal holds its last value
 * rather than inventing movement. Otherwise: clamp to [0,1], then bound a
 * downward move to at most PROGRESS_MAX_REGRESSION.
 */
export function easeProgress(previous: number, next: number | undefined, solved: boolean): number {
  if (solved) return 1;
  if (next === undefined) return previous;
  const clamped = Math.max(0, Math.min(1, next));
  if (clamped < previous) {
    return Math.max(clamped, previous - PROGRESS_MAX_REGRESSION);
  }
  return clamped;
}

// ---- Sprint 14 Task 7: the close-choreography state machine (ADR-027
// Decision 2, ADR-028) ----

// The $$ math-block delimiters are a committed-text rendering instruction
// only -- every surface that consumes the raw `say` text transiently
// (streaming display tokens, the voice word reveal, the text handed to TTS)
// strips them first. Single `$`s are stripped too, not just paired `$$`s,
// so a delimiter split across two stream deltas can't leak half of itself
// into the reveal or the spoken audio.
export function stripMathDelimiters(text: string): string {
  return text.replace(/\$/g, '');
}

export type CloseChoreographyState = 'idle' | 'completing' | 'ringing' | 'closed';
export type CloseChoreographyEvent = 'complete' | 'recap-grace-elapsed' | 'ring-elapsed' | 'reset';

/**
 * idle -> completing (a turn's session.complete just arrived -- give the
 * SESSION_ENDED recap broadcast a moment to land) -> ringing -> closed ->
 * (reset) -> idle. A pure reducer so the vitest spec can exercise the
 * transitions with no timers/mocks at all. Any event that doesn't match the
 * current state is a no-op. AUTO-CLOSE REMAINS DISABLED (Darcy's call):
 * beginCloseChoreography parks the overlay in 'completing' and stops, so
 * 'ringing'/'closed' are not reached in the shipped flow -- the reducer is
 * kept intact (pure, tested, and the single place re-enabling auto-close
 * would hook back into).
 */
export function nextCloseState(
  current: CloseChoreographyState,
  event: CloseChoreographyEvent,
): CloseChoreographyState {
  if (event === 'reset') return 'idle';
  if (current === 'idle' && event === 'complete') return 'completing';
  if (current === 'completing' && event === 'recap-grace-elapsed') return 'ringing';
  if (current === 'ringing' && event === 'ring-elapsed') return 'closed';
  return current;
}

// The old auto-close choreography's two timings, RETAINED for the pure
// nextCloseState reducer's documentation -- they are NOT scheduled anywhere.
export const RECAP_GRACE_MS = 400;
export const CLOSE_RING_MS = 10_000;

// ---- Sprint 14 Task 7: per-turn annotation color assignment (ADR-029
// amendment) ----

// The annotation-ordinal palette's slot NAMES (the actual color values are
// theme.css's --calyxa-annot-1..4 aliases, referenced by these names from
// Overlay.css) -- deliberately a small fixed set, cycling if a turn somehow
// exceeds it (the envelope's own ≤3-per-turn annotation cap means this
// should never actually wrap in practice).
const ANNOTATION_COLOR_SLOTS = ['annot-1', 'annot-2', 'annot-3', 'annot-4'] as const;
export type AnnotationColorSlot = (typeof ANNOTATION_COLOR_SLOTS)[number];
export type AnnotationColorMap = Record<string, AnnotationColorSlot>;

/**
 * Order-assigned, deterministic: the turn's annotations, in the order the
 * model emitted them, each get the next palette slot. Computed ONCE per
 * turn (when the turn's result is committed) and stored on the
 * DisplayMessage so it's stable across re-renders. The SAME map is the one
 * source of truth the caption's color-linked prose reads;
 * AnnotationLayer reads it too.
 */
export function assignAnnotationColors(annotations: Annotation[] | undefined): AnnotationColorMap {
  const map: AnnotationColorMap = {};
  (annotations ?? []).forEach((annotation, index) => {
    map[annotation.id] = ANNOTATION_COLOR_SLOTS[index % ANNOTATION_COLOR_SLOTS.length];
  });
  return map;
}

/**
 * The forward look's humanized due phrasing ("comes back Thursday", Task 8
 * spec). The dates ARE the FSRS schedule (ADR-026) -- only the phrasing is
 * client-side. `now` is injectable for the vitest spec.
 */
export function humanizeDue(dueAt: string, now: Date = new Date()): string {
  const due = new Date(dueAt);
  if (Number.isNaN(due.getTime())) return 'coming back soon';
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((startOfDay(due) - startOfDay(now)) / 86400000);
  if (days <= 0) return 'due for review now';
  if (days === 1) return 'comes back tomorrow';
  if (days < 7) return `comes back ${due.toLocaleDateString(undefined, { weekday: 'long' })}`;
  return `comes back ${due.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
}

// The reference card's equation chain: EVERY $$ math block in the reply, in
// emission order -- rendered isolated and big above the prose, consecutive
// steps joined by a ↓ (e.g. x^2+5x+6 ↓ (x+2)(x+3)), the last step in
// accent-emphasis. One block renders alone; no block means the plain caption
// card. Widened from the old first/last pair (2026-07-16 ask): the worked
// math now lives ONLY in this big display -- the prose below drops the math
// blocks entirely (renderProse) -- so a middle step must not be silently
// lost. Pure + exported for the display spec.
export function mathChainFromReply(reply: string): string[] | null {
  const blocks = splitMathBlocks(reply)
    .filter((block) => block.kind === 'math')
    .map((block) => block.text);
  return blocks.length > 0 ? blocks : null;
}

// Which transient surface owns the single slot this render (exactly one at
// a time, never stacked -- handoff rule). Order IS the priority: an explicit
// dialog outranks the session's terminal states, which outrank the live
// turn surfaces, which outrank the ambient/idle ones. Exported for the
// display spec.
export type SurfaceKind =
  | 'endConfirm'
  | 'bloom'
  | 'recap'
  | 'feedback'
  | 'tutorial'
  | 'transcript'
  | 'caption'
  | 'notice'
  | 'concept'
  | 'conceptFallback'
  | 'history'
  | 'answer'
  | 'ping';

// Calyxa overlay — the "Calyxa Ambient Pill" redesign (2026-07-13).
//
// The two-shape model (idle pill → draggable chat panel) is replaced by ONE
// bottom-center morphing pill that surfaces exactly one transient element at
// a time and collapses back to a near-invisible 39×5 sliver. No persistent
// chat log, no draggable window. Every existing feature and transport stays
// — only the container and interaction model changed:
//
//   pill states   idle · hover (logomark + mic/Aa/scan/clock [+ ✕/feedback
//                 while a session is live]) · text (in-pill input) · scan
//                 (shimmer) · think (dots) · listen (level-driven waveform)
//                 · speak (mode-tinted waveform + mode name)
//   surfaces      live transcript · caption / reference (streamed reply) ·
//                 concept card (the check-in, auto-start drain kept) ·
//                 history (last exchange) · answer (chips / multi-part
//                 fields) · ping toasts · tutorial · recap · bloom ·
//                 end-confirm · feedback · error notice
//
// Text turns: `onSend` streams tokens into the caption card; on resolve the
// full reply holds ~2.4s, then dissolves. Voice turns: the streamed-envelope
// pipeline (ADR-033 + Sprint 15 follow-on) is UNCHANGED — per-sentence TTS,
// gapless MediaSource playback, currentTime-paced word reveal — it just
// feeds the caption/reference card instead of a transcript bubble, and the
// pill morphs listen → think → speak alongside it. Escape always returns to
// idle. Light/dark follows prefers-color-scheme (stamped as data-theme on
// the shadow-root container; theme.css's dark block carries the values).
export function Overlay({
  onSend,
  onSendVoiceStreaming,
  onTranscribe,
  onSynthesize,
  onSynthesizeStream,
  onVoicePlaybackStart,
  onEndSession,
  onOpeningScan,
  onSendTelemetry,
  onReportFeedback,
  onFetchTutorialSeen,
  onMarkTutorialSeen,
  onGetActiveSessionId,
  onGenerateStudyKit,
}: {
  // `sessionStart` rides ONLY the session's first turn (the concept card's
  // confirm / reframe start), always with an empty `messages` array: the
  // confirmation is structured wire data the server renders into the
  // prompt, never a fabricated student message (types/messages.ts's
  // SessionStartInfo).
  onSend: (
    messages: TurnMessage[],
    onChunk?: (chunk: string) => void,
    sessionStart?: SessionStartInfo,
  ) => Promise<TurnResult>;
  // Streamed-envelope VOICE turn (Sprint 15 voice follow-on, ADR-033
  // amendment): relays each spoken-text delta to `onSayDelta` as it streams,
  // so handleMicStop can start per-sentence TTS before the full reply is
  // generated. Resolves the SAME TurnResult as onSend. onSend (buffered) is
  // KEPT as the fallback the voice path drops to on any streaming failure.
  onSendVoiceStreaming: (messages: TurnMessage[], onSayDelta: (text: string) => void) => Promise<TurnResult>;
  // The voice transports resolve a `degraded` member instead of their normal
  // payload when the daily cost cap tripped that leg (ADR-041 Decision 2,
  // 2026-07-15 fix): STT then aborts the turn with a notice; TTS legs skip
  // audio and the reply commits as text.
  onTranscribe: (audio: Utterance) => Promise<{ transcript: string; sttMs: number } | { degraded: true }>;
  onSynthesize: (
    text: string,
  ) => Promise<{ audio: ArrayBuffer; ttsMs: number; degraded?: undefined } | { degraded: true; ttsMs: 0 }>;
  // Task 6 (ADR-033): the streaming sibling of onSynthesize. handleMicStop
  // tries this first; on a MediaSource/codec failure for THIS utterance it
  // falls back to onSynthesize's buffered path, seamlessly.
  onSynthesizeStream: (
    text: string,
    onChunk: (chunk: Uint8Array) => void,
  ) => Promise<{ ttsMs: number; degraded?: true }>;
  // Called once synthesized speech actually starts playing, with its known
  // duration in ms -- content/index.ts uses this to reveal the turn's
  // annotations sequenced to playback instead of all at once.
  onVoicePlaybackStart: (durationMs: number) => void;
  // Sprint 13 (ADR-025): sends the existing END_SESSION message -- the same
  // handler, RPC, and storage-clear the popup uses. The recap does not come
  // back through this promise -- it arrives via the SESSION_ENDED broadcast.
  onEndSession: () => Promise<void>;
  // Sprint 14 Task 6/7 (ADR-030): the proactive opening scan, now fired from
  // the hover row's viewfinder button (the ambient redesign's explicit scan
  // affordance) rather than automatically on panel expand -- a hover is too
  // transient a signal to bill a scan against. content/index.ts runs its own
  // plausible-problem gate first and resolves null when there's nothing to
  // scan; a topic-carrying result feeds the concept card.
  onOpeningScan: () => Promise<{
    reply: string;
    annotations?: Annotation[];
    prediction?: StrugglePrediction;
    topic?: PageTopic;
    stickingCandidates?: StickingCandidate[];
  } | null>;
  // Sprint 17 Task 6 (ADR-043): fire-and-forget telemetry. Optional; called
  // on a real onboarding completion (never on skip) and per completed voice
  // turn (turn_latency + voice_used).
  onSendTelemetry?: (events: TelemetryEvent[]) => Promise<void>;
  // Sprint 17 Task 6 (ADR-039): the feedback-affordance transport (the
  // hover row's feedback button -> FeedbackCard). Rejects on a save failure
  // so the card can surface a retry.
  onReportFeedback?: (payload: SendFeedbackPayload) => Promise<void>;
  // Public launch (2026-07-17): the first-run tutorial transports, replacing
  // the Sprint 17 diagnostic onboarding (ADR-042 surface retired). Whether
  // the tour was seen lives in chrome.storage.local (content/index.ts) —
  // no server round-trip. onFetchTutorialSeen resolves true when the tour
  // was already completed/skipped (and degrades to true on failure, so a
  // storage error never nags); onMarkTutorialSeen persists it.
  onFetchTutorialSeen?: () => Promise<boolean>;
  onMarkTutorialSeen?: () => Promise<void>;
  // The feedback affordance's sessionId lookup (ADR-039) -- read fresh at
  // submit time, never cached.
  onGetActiveSessionId?: () => Promise<string | undefined>;
  // Sprint 21 Task 5 (ADR-049): the recap card's study-kit generation
  // transport. Optional (like the telemetry/feedback transports) so a mount
  // predating this wiring, or a test harness, still renders -- the recap card
  // falls back to its placeholder tiles when it (or the ended sessionId) is
  // absent. Called with the just-ended session's id (captured from the recap
  // broadcast below); resolves { kit } / { refused }, rejects on failure.
  onGenerateStudyKit?: (sessionId: string) => Promise<StudyKitResult>;
}) {
  // ---- Shell + theme (the ambient pill's own state) ----
  // The user-driven base state: hover/text are chosen expansions; every
  // other pill state is derived from the live turn machinery below.
  const [shell, setShell] = useState<'idle' | 'hover' | 'text'>('idle');
  // Light/dark: follows the system (prefers-color-scheme) live, stamped as
  // data-theme on the root container -- theme.css's dark block + the
  // Overlay.css component vars key on it. jsdom has no matchMedia; light is
  // the safe default there.
  const [theme, setTheme] = useState<'light' | 'dark'>(() =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light'
      : 'light',
  );
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => setTheme(query.matches ? 'dark' : 'light');
    query.addEventListener?.('change', onChange);
    return () => query.removeEventListener?.('change', onChange);
  }, []);

  // ---- Conversation + turn state (unchanged machinery) ----
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  // Each streaming chunk (text turn) or word-reveal step (voice turn) becomes
  // a token with a stable id. Rendering as individual <span key={id}> elements
  // means React only mounts NEW spans for new tokens — already-visible ones
  // never re-trigger the cx-word-in entry animation.
  const [streamingTokens, setStreamingTokens] = useState<{ text: string; id: number }[]>([]);
  const tokenIdRef = useRef(0);
  // idle -> connecting -> recording, and back to idle on stop or capture
  // failure (ADR-033 Task 5; the reducer is pure, voice-timing.test.ts).
  const [micState, dispatchMic] = useReducer(micStateReducer, 'idle' as const);
  const recording = micState === 'recording';
  const connecting = micState === 'connecting';
  const [playing, setPlaying] = useState(false);
  // The voice turn's think window: true from mic stop until the turn
  // settles -- with `playing` it drives the pill's think -> speak morph
  // (playing outranks it below, so the pill flips to speak at first audio).
  const [voiceThinking, setVoiceThinking] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [level, setLevel] = useState(0);
  // Live interim transcript from SpeechRecognition, shown word-by-word in
  // the transcript card during recording. Kept non-empty until the accurate
  // Whisper result is committed, so there is no gap between "user stops
  // speaking" and the think state.
  const [liveTranscript, setLiveTranscript] = useState('');
  // The CURRENT turn's answer chips / multi-part fields (design 8a/8d):
  // display-ephemeral, replaced wholesale per turn, cleared the moment any
  // student answer commits. They render as the `answer` transient card once
  // the caption dissolves.
  const [chips, setChips] = useState<string[] | null>(null);
  const [answerFields, setAnswerFields] = useState<AnswerField[] | null>(null);

  // ---- Caption/reference surface state ----
  // After a turn commits, the full reply HOLDS in the caption until the
  // student's next action clears it (chip tap / answer submit / new typed
  // prompt / next voice turn / Escape) -- it never auto-dissolves (Darcy's
  // 2026-07-16 ask, superseding the handoff's 1.4s/2.4s windows: a student
  // can't re-read a reply that vanished while they were still thinking).
  const [captionHold, setCaptionHold] = useState<{ text: string } | null>(null);
  // Non-null upgrades the caption to the reference card (any turn whose reply
  // carries $$ math blocks): the equation chain renders isolated and big above
  // the caption prose. Set at envelope delivery for voice turns and at commit
  // for text turns (the 2026-07-16 ask -- the big isolated display must fire
  // on EVERY math-carrying reply, not just spoken ones), cleared with the hold.
  const [captionMath, setCaptionMath] = useState<string[] | null>(null);
  // The shared exit-animation flag (one surface at a time means one flag):
  // true for the SURFACE_EXIT_MS window before a dismissal actually clears
  // the underlying state (the prototype's own dismiss()).
  const [surfaceLeaving, setSurfaceLeaving] = useState(false);
  const dismissTimerRef = useRef<number | null>(null);
  // The departing surface's ghost (2026-07-16 ask: EVERY surface leaves with
  // the same fade, never a sudden pop-out): whenever the surface slot's kind
  // changes or empties WITHOUT having gone through dismissSurface (a swap, an
  // Escape collapse, a state clear on send), the previous render's node is
  // held here for SURFACE_EXIT_MS and replayed with cx-surface-out --
  // absolutely positioned over the slot so the incoming card never jumps.
  // dismissSurface-driven exits already animate in place (surfaceLeaving), so
  // those are excluded to avoid a double fade.
  const [surfaceGhost, setSurfaceGhost] = useState<{ node: ReactNode; id: number } | null>(null);
  const surfaceGhostIdRef = useRef(0);
  const prevSurfaceRef = useRef<{ kind: SurfaceKind; node: ReactNode; leaving: boolean } | null>(null);

  // ---- User-opened surfaces ----
  const [historyOpen, setHistoryOpen] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [endConfirmOpen, setEndConfirmOpen] = useState(false);

  // ---- Session flow state (ADR-024/025/030, unchanged semantics) ----
  const [recap, setRecap] = useState<SessionRecap | null>(null);
  // The just-ended session's id (Sprint 21 Task 5, ADR-049), captured from the
  // recap broadcast so the recap card can generate a study kit for it -- the
  // active session is already cleared by the time the recap renders, so this is
  // the only place the id is still known. null when the broadcast carried none.
  const [endedSessionId, setEndedSessionId] = useState<string | null>(null);
  // The held opening-scan result: non-null from a confident scan until the
  // conversation starts, the card is dismissed, or the session closes.
  const [scan, setScan] = useState<HeldScan | null>(null);
  const [checkinTopic, setCheckinTopic] = useState<string | null>(null);
  const [stickingPoint, setStickingPoint] = useState<string | null>(null);
  const [scanPending, setScanPending] = useState(false);
  // Whether a scan has RUN and settled without a topic this approach -- the
  // no-detection fallback card keys on this (never on the pre-scan gap).
  const [scanSettled, setScanSettled] = useState(false);
  const [reframeOpen, setReframeOpen] = useState(false);
  const [kickoffStarted, setKickoffStarted] = useState(false);
  const [autoStartArmed, setAutoStartArmed] = useState(true);
  const sessionStartRef = useRef<number | null>(null);
  const [pinQueue, setPinQueue] = useState<{ id: number; pin: StatusPin }[]>([]);
  const pinIdRef = useRef(0);
  const shownPinKeysRef = useRef<Set<string>>(new Set());
  // The live tutor mode (design 8c): derived client-side per turn from the
  // turn's own signals (tutor-modes.ts's deriveTutorMode) -- visible only
  // via the caption chip, the speak-state waveform/label, and the pill glow
  // tint (handoff: "no extra UI region").
  const [tutorMode, setTutorMode] = useState<TutorModeKey>('explore');
  const missStreakRef = useRef(0);
  const finalStepFiredRef = useRef(false);
  // The eased solution-progress value lives in a ref only now: the bar that
  // rendered it retired with the panel, but the signal still drives the
  // final-step pin, the miss streak, and the mode derivation.
  const progressRef = useRef(0);
  const [ending, setEnding] = useState(false);
  const [annotationColors, setAnnotationColors] = useState<AnnotationColorMap>({});
  const [closeState, setCloseState] = useState<CloseChoreographyState>('idle');
  const [bloom, setBloom] = useState<{ line: string } | null>(null);
  const bloomTimerRef = useRef<number | null>(null);
  const pendingRecapRef = useRef<{ recap: SessionRecap | null; sessionId: string | null } | null>(null);

  // ---- First-run tutorial state (public launch, 2026-07-17) ----
  const [tutorialOpen, setTutorialOpen] = useState(false);
  const [tutorialResolved, setTutorialResolved] = useState(false);
  const tutorialCheckedRef = useRef(false);

  // ---- Voice plumbing refs (unchanged) ----
  const recordingRef = useRef<RecordingHandle | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const levelFrameRef = useRef<number | null>(null);
  const startingRef = useRef(false);
  const speechRecRef = useRef<{ stop: () => void } | null>(null);
  const inputElRef = useRef<HTMLInputElement | null>(null);

  // ---- Derived session facts ----
  // The conversation is live once EITHER a student turn exists (a typed or
  // voice start) OR the kickoff fired (the concept-card confirm path, which
  // produces no student turn at all).
  const sessionLive = kickoffStarted || messages.some((message) => message.role === 'user');

  // The first-run tutorial: takes priority over the concept card and the
  // scan -- a brand-new user sees the tour ONCE before anything else.
  // Yields once a session starts, a recap arrives, or the close
  // choreography begins.
  const showTutorial = tutorialOpen && !sessionLive && !recap && closeState === 'idle';

  // ---- The pill's derived state ----
  const pill: PillState =
    recording || connecting
      ? 'listen'
      : playing
        ? 'speak'
        : voiceThinking
          ? 'think'
          : scanPending
            ? 'scan'
            : shell === 'text'
              ? 'text'
              : busy
                ? 'think'
                : shell === 'hover'
                  ? 'hover'
                  : 'idle';
  const expanded = pill !== 'idle';
  const hoverExtras = sessionLive;
  const [pillW, pillH, pillR] =
    pill === 'hover' && hoverExtras ? [HOVER_SESSION_WIDTH, 52, 26] : PILL_SHAPES[pill];

  // ---- The single transient surface (priority order, one at a time) ----
  const surfaceKind: SurfaceKind | null = endConfirmOpen
    ? 'endConfirm'
    : bloom
      ? 'bloom'
      : recap
        ? 'recap'
        : feedbackOpen
          ? 'feedback'
          : showTutorial
            ? 'tutorial'
            : liveTranscript
              ? 'transcript'
              // notice + history sit ABOVE the caption now that a committed
              // reply holds indefinitely: an error notice must never be
              // buried behind a held reply (it still auto-dissolves and
              // yields back), and the Last-exchange card must stay reachable
              // while a reply is up (it covers the caption for its 6.5s
              // window, then the held reply resurfaces).
              : notice
                ? 'notice'
                : historyOpen
                  ? 'history'
                  : streamingTokens.length > 0 || playing || captionHold
                    ? 'caption'
                    : !sessionLive && closeState === 'idle' && !busy && scan?.topic
                      ? 'concept'
                      : !sessionLive && closeState === 'idle' && !busy && scanSettled && !scan?.topic
                        ? 'conceptFallback'
                        : ((chips && chips.length > 0) || (answerFields && answerFields.length > 0)) &&
                            !busy &&
                            closeState === 'idle'
                          ? 'answer'
                          : pinQueue.length > 0
                            ? 'ping'
                            : null;

  // ---- Small shared helpers ----
  function appendStreamToken(text: string) {
    // Strip the $$ math-block delimiters from the transient stream/reveal
    // tokens -- the committed caption re-renders from the full reply, where
    // renderSay turns them into centered math.
    const cleaned = stripMathDelimiters(text);
    if (!cleaned) return;
    const id = tokenIdRef.current++;
    setStreamingTokens((prev) => [...prev, { text: cleaned, id }]);
  }

  function clearStreamTokens() {
    setStreamingTokens([]);
  }

  // The shared dismiss window (the prototype's dismiss()): the current
  // surface plays cx-out for SURFACE_EXIT_MS, THEN the underlying state
  // clears. One timer -- a newer dismissal supersedes an in-flight one.
  function dismissSurface(cb: () => void) {
    setSurfaceLeaving(true);
    if (dismissTimerRef.current !== null) window.clearTimeout(dismissTimerRef.current);
    dismissTimerRef.current = window.setTimeout(() => {
      dismissTimerRef.current = null;
      setSurfaceLeaving(false);
      cb();
    }, SURFACE_EXIT_MS);
  }

  function stopLevelMeter() {
    if (levelFrameRef.current !== null) {
      cancelAnimationFrame(levelFrameRef.current);
      levelFrameRef.current = null;
    }
    setLevel(0);
  }

  function startLevelMeter() {
    const tick = () => {
      const handle = recordingRef.current;
      if (!handle) return;
      setLevel(handle.getLevel());
      levelFrameRef.current = requestAnimationFrame(tick);
    };
    levelFrameRef.current = requestAnimationFrame(tick);
  }

  useEffect(() => {
    return () => {
      recordingRef.current?.cancel();
      recordingRef.current = null;
      stopLevelMeter();
      speechRecRef.current?.stop();
      speechRecRef.current = null;
      if (dismissTimerRef.current !== null) window.clearTimeout(dismissTimerRef.current);
      if (bloomTimerRef.current !== null) window.clearTimeout(bloomTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Queues a turn's pins through the gate (priority + cap + dedupe). Called
  // at `done` for text turns and at reply-delivered for voice turns; the
  // advance effect below then walks the queue one toast at a time, only
  // while the surface slot is actually free. (The old transcript milestone
  // markers retired with the transcript -- the toast is the signal now.)
  function showPins(pins: StatusPin[] | undefined) {
    const shown = filterPinsForDisplay(pins, shownPinKeysRef.current);
    if (shown.length === 0) return;
    setPinQueue((prev) => [...prev, ...shown.map((pin) => ({ id: pinIdRef.current++, pin }))]);
  }

  // The queue's advance clock: the head pin holds the slot for
  // PIN_DISPLAY_MS *of visible time* -- the timer only runs while the ping
  // toast is actually on screen, so a pin queued behind a LIVE turn surface
  // waits its turn instead of expiring unseen. Now that a committed reply
  // holds indefinitely, a settled (non-live) caption would starve the queue
  // forever -- so while one is held, the toast renders STACKED above the
  // caption card (the one sanctioned two-element case; see the render) and
  // counts as visible here.
  const activePinId = pinQueue.length > 0 ? pinQueue[0].id : null;
  const pingStackedOnCaption =
    surfaceKind === 'caption' && !busy && !playing && !surfaceLeaving && pinQueue.length > 0;
  const pingVisible = surfaceKind === 'ping' || pingStackedOnCaption;
  useEffect(() => {
    if (activePinId === null || !pingVisible) return;
    const timer = window.setTimeout(() => {
      setPinQueue((prev) => prev.slice(1));
    }, PIN_DISPLAY_MS);
    return () => window.clearTimeout(timer);
  }, [activePinId, pingVisible]);

  // No caption-dissolve timer: a committed reply holds until the student's
  // next action (see the captionHold state comment above). Every send path
  // clears it before dispatching, so the swap to the next turn's stream is
  // still immediate.

  // The history card's window: 6.5s or a click, whichever first.
  useEffect(() => {
    if (!historyOpen) return;
    const timer = window.setTimeout(() => dismissSurface(() => setHistoryOpen(false)), HISTORY_HOLD_MS);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [historyOpen]);

  // The no-detection fallback's window: long enough to read + act, then the
  // pill goes quiet again (the reframe path stays one scan away).
  const fallbackVisible = surfaceKind === 'conceptFallback';
  useEffect(() => {
    if (!fallbackVisible) return;
    const timer = window.setTimeout(() => dismissSurface(() => setScanSettled(false)), FALLBACK_HOLD_MS);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fallbackVisible]);

  // Error notices dissolve on their own (they also yield to any newer
  // surface, and Escape clears them immediately).
  const noticeVisible = surfaceKind === 'notice';
  useEffect(() => {
    if (!noticeVisible) return;
    const timer = window.setTimeout(() => dismissSurface(() => setNotice(null)), NOTICE_HOLD_MS);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noticeVisible, notice]);

  // The concept card's auto-start (the check-in's countdown, kept -- the
  // drain bar mirrors this exact window): armed while the card is visibly
  // up and no exit was taken. The cleanup clears the pending timer whenever
  // any dependency flips, so the session can never start from a stale
  // window.
  const conceptVisible = surfaceKind === 'concept' && !surfaceLeaving;
  useEffect(() => {
    if (!conceptVisible || !autoStartArmed || reframeOpen || busy) return;
    const timer = window.setTimeout(() => handleCheckinStart(), AUTO_START_MS);
    return () => window.clearTimeout(timer);
    // handleCheckinStart is a stable in-component helper reading current
    // state via closure per render; intentionally not a dep.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conceptVisible, autoStartArmed, reframeOpen, busy]);

  // ---- Expansion signals + lifecycle bridges ----

  // The panel-EXPAND signal: fires on every idle -> non-idle transition
  // (hover, text, scan, listen -- however entered). content/index.ts's
  // listener re-captures PageContext synchronously inside this event, so
  // the scan/turn that follows always reads a fresh capture.
  const prevExpandedRef = useRef(false);
  useEffect(() => {
    if (expanded && !prevExpandedRef.current) {
      // Re-sample the color scheme on each engagement: the 'change' listener
      // above covers live OS theme flips, but some environments update
      // matchMedia.matches without dispatching the event (devtools/emulation,
      // embedders) -- one cheap read per expansion keeps the stamp honest.
      if (typeof window.matchMedia === 'function') {
        setTheme(window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
      }
      window.dispatchEvent(new CustomEvent(PANEL_EXPANDED_EVENT));
    }
    prevExpandedRef.current = expanded;
  }, [expanded]);

  // Mic pre-warm (Sprint 19 Task 8, ADR-033 amendment): hold a warm
  // getUserMedia stream while the pill is engaged OR a session is live, so
  // every voice turn starts capturing in <500ms. Guarded to fire ONLY when
  // mic permission is ALREADY granted -- expanding the pill must never
  // trigger a permission prompt. Fully best-effort; released when the
  // engagement ends and on unmount.
  const warmWanted = expanded || sessionLive;
  useEffect(() => {
    if (!warmWanted) return;
    let cancelled = false;
    void (async () => {
      try {
        const perms = (navigator as Navigator & { permissions?: Permissions }).permissions;
        if (!perms?.query) return; // can't check without risking a prompt -- skip
        const status = await perms.query({ name: 'microphone' as PermissionName });
        if (cancelled || status.state !== 'granted') return;
        await prewarmMic();
      } catch {
        // Some browsers reject a 'microphone' permission query outright --
        // skip pre-warm rather than risk a prompt.
      }
    })();
    return () => {
      cancelled = true;
      releaseWarmMic();
    };
  }, [warmWanted]);

  // The first-run tutorial check (public launch): fires on the FIRST real
  // expansion only (tutorialCheckedRef never resets). Reads the persisted
  // seen flag from chrome.storage.local via the transport; degrades to
  // "seen" on any failure or an unwired transport -- never blocking the
  // pill. `tutorialResolved` gates the scan button until the check has
  // settled either way, so the tour isn't raced by a scan.
  useEffect(() => {
    if (!expanded || tutorialCheckedRef.current) return;
    tutorialCheckedRef.current = true;
    if (!onFetchTutorialSeen) {
      setTutorialResolved(true);
      return;
    }
    let cancelled = false;
    onFetchTutorialSeen()
      .then((seen) => {
        if (cancelled) return;
        if (!seen) setTutorialOpen(true);
      })
      .catch(() => {
        // Degrade silently -- treated as already seen.
      })
      .finally(() => {
        if (!cancelled) setTutorialResolved(true);
      });
    return () => {
      cancelled = true;
    };
    // Deliberately fires at most once per page load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded]);

  // The keyboard shortcut ('calyxa:toggle-panel', dispatched from
  // content/index.ts): toggles hover-expanded <-> idle (the handoff's
  // remapping of the old panel toggle). Collapsing this way is an explicit
  // dismissal, so it runs the same full collapse as Escape.
  useEffect(() => {
    function onTogglePanel() {
      if (collapseRef.current.isOpen()) {
        collapseRef.current.collapse();
      } else {
        setShell('hover');
      }
    }
    window.addEventListener('calyxa:toggle-panel', onTogglePanel);
    return () => window.removeEventListener('calyxa:toggle-panel', onTogglePanel);
  }, []);

  // Escape always returns to idle (handoff rule). Registered once; reads
  // fresh state through collapseRef. While the reframe tool is open it owns
  // Escape itself (its own listener calls onCancel), so this one defers.
  const collapseRef = useRef<{ isOpen: () => boolean; collapse: () => void }>({
    isOpen: () => false,
    collapse: () => {},
  });
  collapseRef.current = {
    isOpen: () => expanded || surfaceKind !== null,
    collapse: collapseToIdle,
  };
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape') return;
      collapseRef.current.collapse();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // The explicit collapse (Escape / shortcut-toggle): cancel anything
  // transient -- a recording is discarded un-sent, playback stops, every
  // ephemeral surface clears -- and return to the bare sliver. The SESSION
  // is untouched (this is the old minimize, not an end); in-flight turns
  // settle in the background and their caption simply pops when they do.
  // Fires PANEL_CLOSED_EVENT so the annotation controller clears the page
  // (handoff: "PANEL_CLOSED_EVENT + annotation clearing on collapse").
  function collapseToIdle() {
    if (reframeOpen) return; // the reframe tool owns its own Escape/Back
    if (!expanded && surfaceKind === null && shell === 'idle') return;
    if (recording) {
      recordingRef.current?.cancel();
      recordingRef.current = null;
      dispatchMic('stop');
      stopLevelMeter();
    }
    speechRecRef.current?.stop();
    speechRecRef.current = null;
    setLiveTranscript('');
    audioRef.current?.pause();
    setShell('idle');
    setInput('');
    setHistoryOpen(false);
    setFeedbackOpen(false);
    setEndConfirmOpen(false);
    setCaptionHold(null);
    setCaptionMath(null);
    setNotice(null);
    // A dismissed concept card is consumed -- the student declined the
    // detection, so it never re-pops on the next hover (typing/speaking
    // still starts a session normally).
    setScan(null);
    setScanSettled(false);
    setAutoStartArmed(true);
    window.dispatchEvent(new CustomEvent(PANEL_CLOSED_EVENT));
  }

  // Recap arrival (SESSION_ENDED -> content -> this event). A recap-less
  // end (no gradable interactions) sets null and renders nothing. The
  // session is over either way, so the per-session pin dedupe set resets
  // here, and any still-queued pins yield to the terminal state.
  useEffect(() => {
    function onSessionRecap(event: Event) {
      const detail = (event as CustomEvent<{ recap?: SessionRecap; sessionId?: string }>).detail;
      const arrived = detail?.recap ?? null;
      // The ended session's id (Sprint 21 Task 5, ADR-049) rides the same
      // event so the recap card can generate a study kit for it.
      const sessionId = detail?.sessionId ?? null;
      // Hold the summary while the congratulation bloom is still on screen;
      // the bloom timer reveals it the moment the congratulation ends.
      if (bloomTimerRef.current !== null) {
        pendingRecapRef.current = { recap: arrived, sessionId };
      } else {
        applyRecap(arrived, sessionId);
      }
    }
    window.addEventListener(SESSION_RECAP_EVENT, onSessionRecap);
    return () => window.removeEventListener(SESSION_RECAP_EVENT, onSessionRecap);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function applyRecap(arrived: SessionRecap | null, sessionId: string | null = null) {
    setRecap(arrived);
    setEndedSessionId(sessionId);
    shownPinKeysRef.current.clear();
    setPinQueue([]);
    // The session is over -- the mode walks to its terminal Reviewing state.
    setTutorMode('review');
  }

  // The in-pill input autofocuses ~400ms after the morph starts (the
  // handoff's own timing -- focusing mid-morph would scroll-jank the pill).
  useEffect(() => {
    if (shell !== 'text') return;
    const timer = window.setTimeout(() => inputElRef.current?.focus(), 420);
    return () => window.clearTimeout(timer);
  }, [shell]);

  // ---- Close choreography (auto-close remains disabled) ----
  function beginCloseChoreography() {
    setCloseState((prev) => nextCloseState(prev, 'complete'));
  }

  useEffect(() => {
    if (closeState !== 'closed') return;
    performClose();
    setCloseState((prev) => nextCloseState(prev, 'reset'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [closeState]);

  // The full teardown: shared by the recap's Complete session and a
  // confirmed manual end. Collapses to the sliver, clears the conversation
  // and every per-session signal, and dispatches PANEL_CLOSED_EVENT for the
  // annotation controller.
  function performClose() {
    setShell('idle');
    setInput('');
    setMessages([]);
    setChips(null);
    setAnswerFields(null);
    setCaptionHold(null);
    setCaptionMath(null);
    setHistoryOpen(false);
    setFeedbackOpen(false);
    setEndConfirmOpen(false);
    progressRef.current = 0;
    finalStepFiredRef.current = false;
    missStreakRef.current = 0;
    setTutorMode('explore');
    setPinQueue([]);
    setAnnotationColors({});
    setRecap(null);
    setScan(null);
    setCheckinTopic(null);
    setStickingPoint(null);
    setScanPending(false);
    setScanSettled(false);
    setReframeOpen(false);
    setAutoStartArmed(true);
    setKickoffStarted(false);
    setNotice(null);
    setLiveTranscript('');
    clearStreamTokens();
    sessionStartRef.current = null;
    if (bloomTimerRef.current !== null) window.clearTimeout(bloomTimerRef.current);
    bloomTimerRef.current = null;
    pendingRecapRef.current = null;
    setBloom(null);
    window.dispatchEvent(new CustomEvent(PANEL_CLOSED_EVENT));
  }

  // ---- Tutorial handler (public launch, 2026-07-17) ----
  // "Seen" persists on BOTH finish and skip (unlike the retired diagnostic's
  // skip, which never persisted): a usage tour must never nag on every page
  // load. The onboarding_completed telemetry kind is reused for a full
  // step-through — it still means "the first-run flow was completed", with
  // itemCount now the tour's step count (never emitted on skip, as before).
  function handleTutorialDone(info: { completed: boolean; stepCount: number; ms: number }) {
    setTutorialOpen(false);
    void onMarkTutorialSeen?.().catch(() => {});
    if (info.completed) {
      void onSendTelemetry?.([{ kind: 'onboarding_completed', itemCount: info.stepCount, ms: info.ms }]);
    }
  }

  // The report/rate affordance's submit (ADR-039): looks up the CURRENT
  // active sessionId fresh and attaches it when one is active. Rethrows on
  // failure so FeedbackCard can show its retry state.
  async function handleFeedbackSubmit(payload: {
    kind: 'bug' | 'rating' | 'idea';
    rating?: number;
    message?: string;
  }): Promise<void> {
    if (!onReportFeedback) throw new Error('feedback unavailable');
    const sessionId = await onGetActiveSessionId?.();
    await onReportFeedback({ ...payload, ...(sessionId ? { sessionId } : {}) });
  }

  // ---- The opening scan (ADR-030), now the viewfinder button's action ----
  // Same call, same gate posture as the old on-expand effect -- the trigger
  // moved to an explicit tap (a hover is too transient to bill against).
  // The scan is a session-start read, so it stays pre-session-only; the
  // in-flight guard replaces the old StrictMode-double-invoke ref (a click
  // can't double-fire an effect).
  function startScan() {
    if (scanPending || busy || sessionLive || closeState !== 'idle') return;
    if (!tutorialResolved || tutorialOpen) return;
    setShell('idle');
    setScan(null);
    setScanSettled(false);
    setAutoStartArmed(true);
    setScanPending(true);
    onOpeningScan()
      .then((result) => {
        if (!result) return;
        setScan({
          question: result.reply,
          ...(result.topic ? { topic: result.topic } : {}),
          ...(result.stickingCandidates && result.stickingCandidates.length > 0
            ? { stickingCandidates: result.stickingCandidates }
            : {}),
          ...(result.annotations && result.annotations.length > 0 ? { annotations: result.annotations } : {}),
        });
        // Pre-select both answers the moment the scan lands ("confirm, not
        // fill out a form"): the topic is the scan's own detection, the
        // sticking point the top-ranked chip.
        if (result.topic) {
          setCheckinTopic(result.topic.title);
          const topChip = buildStickingChips(result.stickingCandidates ?? [])[0];
          setStickingPoint(topChip?.value ?? null);
        }
        // AnnotationLayer's box-stroke lookup reads the SAME map the
        // committed turn will carry.
        setAnnotationColors(assignAnnotationColors(result.annotations));
      })
      .catch((error) => {
        console.debug('Calyxa overlay: opening scan unavailable', error);
      })
      .finally(() => {
        setScanPending(false);
        setScanSettled(true);
      });
  }

  // ---- The session-start kickoff (unchanged wire semantics) ----
  // NO turn enters the wire history -- the confirmation crosses once as the
  // structured sessionStart field on an empty-history first turn; the
  // tutor's first message responds directly to the detected misconception.
  async function startSessionTurn(start: SessionStartInfo) {
    if (busy) return;
    setScan(null);
    setScanSettled(false);
    setKickoffStarted(true);
    if (sessionStartRef.current === null) sessionStartRef.current = Date.now();
    setRecap(null);
    setNotice(null);
    setCaptionHold(null);
    setCaptionMath(null);
    setBusy(true);
    clearStreamTokens();

    try {
      const result = await onSend([], (chunk) => appendStreamToken(chunk), start);
      if (!result.reply.trim()) throw new Error('The tutor returned an empty reply.');
      commitAssistantTurn(result);
    } catch (error) {
      setKickoffStarted(false);
      clearStreamTokens();
      setNotice(describeError(error, "Couldn't reach the tutor — try again."));
    } finally {
      setBusy(false);
    }
  }

  // Confirm (a tap on the concept card, or the drain bar emptying): the
  // scan's detected question and the top predicted sticking point fire the
  // kickoff. The not-sure sentinel maps to null.
  function handleCheckinStart() {
    if (busy || closeState !== 'idle' || !scan || !stickingPoint) return;
    void startSessionTurn({
      question: scan.question,
      stickingPoint: stickingPoint === NOT_SURE_CHIP ? null : stickingPoint,
    });
  }

  // "No, something else": the prediction was off -- open the reframe tool so
  // the student frames the exact spot themselves. The countdown disarms
  // first; correcting a prediction must never race the auto-start.
  function handleCheckinReframe() {
    if (busy || closeState !== 'idle') return;
    setAutoStartArmed(false);
    setReframeOpen(true);
  }

  function handleReframeCancel() {
    setReframeOpen(false);
  }

  function handleReframeStart(framing: { snippet: string; struggle: string }) {
    if (busy || closeState !== 'idle') return;
    setReframeOpen(false);
    const snippet = framing.snippet.trim();
    const struggle = framing.struggle.trim();
    // With a held scan (topic detected), the scan's own one-line read is the
    // question and the crop is the exact spot WITHIN it. Reached from the
    // no-detection fallback there is no scan, so the crop IS the problem,
    // falling back to the student's own words when the crop found no text.
    const question = scan?.question ?? (snippet || struggle);
    if (!question) return;
    void startSessionTurn({
      question,
      stickingPoint: struggle,
      ...(scan && snippet ? { snippet } : {}),
    });
  }

  // ---- The recap's exit (design 7b): the one way the summary dismisses ----
  function handleRecapDone() {
    setCloseState((prev) => nextCloseState(prev, 'reset'));
    performClose();
  }

  // ---- Progress / completion / mode (unchanged commit logic) ----
  const FINAL_STEP_THRESHOLD = 0.85;

  function applyProgressAndCompletion(result: TurnResult) {
    const previous = progressRef.current;
    const eased = easeProgress(previous, result.solutionProgress, result.session?.reason === 'solved');
    progressRef.current = eased;
    if (eased < previous) missStreakRef.current += 1;
    else if (eased > previous) missStreakRef.current = 0;
    const finalStepPin: StatusPin | null =
      !result.session?.complete && eased >= FINAL_STEP_THRESHOLD && !finalStepFiredRef.current
        ? { category: 'progress', kind: 'final-step', conceptKey: null, label: 'Final step' }
        : null;
    if (finalStepPin) {
      finalStepFiredRef.current = true;
      showPins([finalStepPin]);
    }
    setTutorMode((current) =>
      deriveTutorMode(current, {
        pins: [...(result.pins ?? []), ...(finalStepPin ? [finalStepPin] : [])],
        missStreak: missStreakRef.current,
        complete: !!result.session?.complete,
      }),
    );
    if (result.session?.complete) {
      // A correct answer earns the section-complete bloom card, which holds
      // BLOOM_MS then hands off to the summary (pendingRecapRef when the
      // recap already landed).
      if (result.session.reason === 'solved') {
        setBloom({ line: bloomLine(checkinTopic, stickingPoint) });
        if (bloomTimerRef.current !== null) window.clearTimeout(bloomTimerRef.current);
        bloomTimerRef.current = window.setTimeout(() => {
          setBloom(null);
          bloomTimerRef.current = null;
          if (pendingRecapRef.current !== null) {
            applyRecap(pendingRecapRef.current.recap, pendingRecapRef.current.sessionId);
            pendingRecapRef.current = null;
          }
        }, BLOOM_MS);
      }
      beginCloseChoreography();
    }
  }

  // The shared commit tail for a text-shaped turn's resolved result --
  // identical for a typed send and the session-start kickoff: the display
  // message (with its annotation extras), the color map AnnotationLayer
  // reads, the pin queue, the progress/completion hook, and the caption
  // hold that shows the reply.
  function commitAssistantTurn(result: TurnResult) {
    clearStreamTokens();
    setMessages((current) => [
      ...current,
      { role: 'assistant', content: result.reply, ...assistantMessageExtras(result) },
    ]);
    setChips(result.session?.complete ? null : result.chips ?? null);
    setAnswerFields(result.session?.complete ? null : result.answerFields ?? null);
    setAnnotationColors(assignAnnotationColors(result.annotations));
    showPins(result.pins);
    applyProgressAndCompletion(result);
    // A math-carrying reply upgrades to the reference card on TEXT turns too
    // (2026-07-16 ask): the worked equation renders isolated and big above
    // the prose, exactly as the voice path's envelope delivery already does.
    setCaptionMath(mathChainFromReply(result.reply));
    setCaptionHold({ text: result.reply });
  }

  // ---- Student sends (typed, chip tap, multi-part) ----
  async function sendStudentMessage(text: string) {
    if (!text || busy) return;

    // A typed start supersedes any still-held scan detection.
    setScan(null);
    setScanSettled(false);
    if (sessionStartRef.current === null) sessionStartRef.current = Date.now();
    const outbound: TurnMessage[] = [...windowHistory(stripHistory(messages)), { role: 'user', content: text }];
    setMessages((current) => [...current, { role: 'user', content: text }]);
    setChips(null);
    setAnswerFields(null);
    setRecap(null); // shown once -- a new conversation replaces it
    setHistoryOpen(false);
    setNotice(null);
    setCaptionHold(null);
    setCaptionMath(null);
    setBusy(true);
    clearStreamTokens();

    try {
      const result = await onSend(outbound, (chunk) => {
        appendStreamToken(chunk);
      });
      if (!result.reply.trim()) throw new Error('The tutor returned an empty reply.');
      commitAssistantTurn(result);
    } catch (error) {
      clearStreamTokens();
      setNotice(describeError(error, "Couldn't reach the tutor — try again."));
    } finally {
      setBusy(false);
    }
  }

  function handleTextSubmit() {
    const text = input.trim();
    if (!text || busy) return;
    setInput('');
    void sendStudentMessage(text);
  }

  // Answer-chip tap (design 8a): the tap COMMITS the chip text as a real
  // student turn -- same wire shape, same grading as if typed.
  function handleChipTap(text: string) {
    if (busy || closeState !== 'idle') return;
    void sendStudentMessage(text);
  }

  // Multi-part answer submit (design 8d): the filled boxes commit as ONE
  // student turn -- AnswerFields joins each field as "<label> = <value>".
  function handleAnswerFieldsSubmit(combined: string) {
    if (busy || closeState !== 'idle') return;
    void sendStudentMessage(combined);
  }

  // ---- Voice (pipeline unchanged; the pill/surfaces are the new display) ----

  // Best-effort live transcript: SpeechRecognition's interim results are
  // intentionally low-accuracy; Whisper's final transcript is the source of
  // truth (handleMicStop). Started BEFORE startRecording() is awaited so its
  // async startup overlaps getUserMedia/MediaRecorder setup (ADR-033).
  function startLiveTranscript() {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const SR = (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition;
    if (!SR) return;
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sr: any = new SR();
      sr.continuous = true;
      sr.interimResults = true;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      sr.onresult = (event: any) => {
        let text = '';
        for (let i = 0; i < event.results.length; i++) {
          text += event.results[i][0].transcript;
        }
        setLiveTranscript((text as string).trim());
      };
      sr.onerror = () => {};
      sr.start();
      speechRecRef.current = sr as { stop: () => void };
    } catch {
      // SpeechRecognition unavailable in this context — no live preview.
    }
  }

  async function handleMicStart() {
    if (busy || recording || startingRef.current) return;
    setNotice(null);
    setShell('idle');
    setHistoryOpen(false);
    setCaptionHold(null);
    setCaptionMath(null);
    startingRef.current = true;
    // The UI acknowledges the click IMMEDIATELY (ADR-033's ≤100ms budget):
    // the pill morphs to listen on `connecting`, honest since `recording`
    // itself only flips once capture is actually live.
    dispatchMic('click');
    const clickAt = performance.now();

    startLiveTranscript();

    try {
      const handle = await startRecording();
      if (import.meta.env.DEV) {
        console.debug(`[calyxa voice] click→capturing (outer): ${Math.round(performance.now() - clickAt)}ms`);
      }
      recordingRef.current = handle;
      dispatchMic('capture-started');
      startLevelMeter();
    } catch (error) {
      speechRecRef.current?.stop();
      speechRecRef.current = null;
      setLiveTranscript('');
      dispatchMic('capture-failed');
      const message = error instanceof Error ? error.message : 'Microphone is unavailable.';
      setNotice(`${message} Use the text input instead.`);
    } finally {
      startingRef.current = false;
    }
  }

  async function handleMicStop() {
    const handle = recordingRef.current;
    if (!handle) return;
    recordingRef.current = null;
    dispatchMic('stop');
    stopLevelMeter();
    // Stop SR updates but keep liveTranscript visible so there is no gap
    // between "user stopped speaking" and the think state.
    speechRecRef.current?.stop();
    speechRecRef.current = null;
    setBusy(true);
    setVoiceThinking(true);
    clearStreamTokens();

    try {
      // Sprint 17 (ADR-043): felt-latency clock start -- the moment the
      // student finished speaking, through utterance finalization, STT, AI,
      // and TTS, to first audio. Used by the turn_latency telemetry event.
      const turnStartAt = performance.now();
      const utterance = await handle.stop();
      const sttStartAt = performance.now();
      const sttResult = await onTranscribe(utterance);
      // Cost-capped STT (ADR-041 Decision 2, 2026-07-15 fix): the route
      // returned no transcript by design. There is no message to send, so
      // this is the one voice outcome that ends the turn -- with a notice
      // pointing at the text input, not a broken-turn error.
      if ('degraded' in sttResult) {
        dismissSurface(() => setLiveTranscript(''));
        setNotice("Calyxa's voice is resting for today — type your question instead.");
        return;
      }
      const { transcript, sttMs } = sttResult;
      // networkMs: the STT relay/upload overhead the server's own Whisper
      // time (`sttMs`) does NOT include. Never negative.
      const networkMs = Math.max(0, Math.round(performance.now() - sttStartAt) - sttMs);

      // The transcript card dissolves the moment the accurate result lands
      // (handoff: "disappears the moment the student stops") -- the pill's
      // think state carries the wait from here.
      dismissSurface(() => setLiveTranscript(''));
      // A voice turn starts the conversation too: any still-held scan
      // detection is dropped, same as a typed start.
      setScan(null);
      setScanSettled(false);
      if (sessionStartRef.current === null) sessionStartRef.current = Date.now();
      const outbound: TurnMessage[] = [...windowHistory(stripHistory(messages)), { role: 'user', content: transcript }];
      setMessages((current) => [...current, { role: 'user', content: transcript }]);
      setChips(null);
      setAnswerFields(null);
      setRecap(null); // shown once -- a new conversation replaces it
      setHistoryOpen(false);

      // Voice pins + annotation sequencing fire at REPLY-DELIVERED (ADR-026).
      // On the streamed path that is turn-done, which lands DURING playback;
      // on the buffered fallback it is playback start, as before.
      // Per-leg voice-latency capture (ADR-043): INDEPENDENT honest
      // measurements, NOT a strict additive decomposition.
      let firstSayAt: number | null = null;
      let envelopeAt: number | null = null;
      let firstAudioAt: number | null = null;
      let bufferedTtsMs: number | null = null;
      const aiStartAt = performance.now();

      const ttsRequestAt = performance.now();
      const markFirstAudio = (label: string) => () => {
        if (firstAudioAt === null) firstAudioAt = performance.now();
        if (import.meta.env.DEV) {
          console.debug(`[calyxa voice] tts request→first audio (${label}): ${Math.round(performance.now() - ttsRequestAt)}ms`);
        }
      };
      const deliverEnvelope = (delivered: TurnResult, durationMs: number) => {
        if (envelopeAt === null) envelopeAt = performance.now();
        showPins(delivered.pins);
        // The reference card (handoff surface 4): a reply that carries $$
        // math upgrades the caption to the equation card while Calyxa talks.
        setCaptionMath(mathChainFromReply(delivered.reply));
        onVoicePlaybackStart(durationMs);
      };

      // Streamed-envelope path first (Sprint 15 voice follow-on, ADR-033
      // amendment): stream the turn and synthesize TTS per sentence. On ANY
      // streaming/MediaSource/codec failure, fall back to the buffered turn
      // + buffered playback -- byte-identical to the old path, never a
      // partial commit.
      let result: TurnResult;
      try {
        result = await playVoiceTurnStreamedEnvelope(
          (onSayDelta) =>
            onSendVoiceStreaming(outbound, (text) => {
              if (firstSayAt === null) firstSayAt = performance.now();
              onSayDelta(text);
            }),
          onSynthesizeStream,
          appendStreamToken,
          setPlaying,
          audioRef,
          (delivered) => deliverEnvelope(delivered, delivered.reply.trim().split(/\s+/).length * STREAM_REVEAL_MS_PER_WORD),
          markFirstAudio('streamed'),
        );
      } catch (streamError) {
        if (import.meta.env.DEV) {
          console.debug('[calyxa voice] streamed voice turn unavailable, falling back to buffered turn + playback', streamError);
        }
        clearStreamTokens();
        result = await onSend(outbound);
        if (!result.reply.trim()) throw new Error('The tutor returned an empty reply.');
        const synth = await onSynthesize(stripMathDelimiters(result.reply));
        bufferedTtsMs = synth.ttsMs;
        if (synth.degraded) {
          // Cost-capped TTS (ADR-041 Decision 2, 2026-07-15 fix): no audio
          // this leg by design. Commit the reply as text -- caption + the
          // envelope delivery (pins/annotation sequencing) fire exactly as
          // they would at playback start, just without audio. Previously
          // this leg tried to play zero bytes and threw, losing the whole
          // turn (annotations/chips included) to the outer catch.
          appendStreamToken(result.reply);
          deliverEnvelope(result, result.reply.trim().split(/\s+/).length * STREAM_REVEAL_MS_PER_WORD);
        } else {
          await playAudioWithTextReveal(synth.audio, result.reply, appendStreamToken, setPlaying, audioRef, (durationMs) => {
            markFirstAudio('buffered fallback')();
            deliverEnvelope(result, durationMs);
          });
        }
      }

      clearStreamTokens();
      // Voice annotations/chips/progress commit with the reply after
      // playback -- they don't pre-announce what the tutor hasn't said yet
      // (the Task 8 sequencing rule). The caption holds the full reply
      // briefly, then dissolves (handoff: ~1.4s after playback ends).
      setMessages((current) => [
        ...current,
        { role: 'assistant', content: result.reply, ...assistantMessageExtras(result) },
      ]);
      setChips(result.session?.complete ? null : result.chips ?? null);
      setAnswerFields(result.session?.complete ? null : result.answerFields ?? null);
      setAnnotationColors(assignAnnotationColors(result.annotations));
      applyProgressAndCompletion(result);
      setCaptionHold({ text: result.reply });

      // Sprint 17 (ADR-043) + Sprint 18 Task 8: turn_latency + voice_used,
      // emitted ONLY when audio actually played and the envelope was
      // delivered -- a failed or silent turn never reports a bogus latency.
      if (firstAudioAt !== null && envelopeAt !== null) {
        const totalMs = Math.max(0, Math.round(firstAudioAt - turnStartAt));
        const aiMs = Math.max(0, Math.round(envelopeAt - aiStartAt));
        const ttsMs =
          bufferedTtsMs !== null
            ? bufferedTtsMs
            : firstSayAt !== null
              ? Math.max(0, Math.round(firstAudioAt - firstSayAt))
              : 0;
        void onSendTelemetry?.([
          { kind: 'turn_latency', sttMs, aiMs, ttsMs, networkMs, totalMs },
          { kind: 'voice_used' },
        ]);
      }
    } catch (error) {
      setLiveTranscript('');
      clearStreamTokens();
      setNotice(
        describeError(
          error,
          "Couldn't complete the voice turn — try again or use text.",
        ),
      );
    } finally {
      setBusy(false);
      setVoiceThinking(false);
    }
  }

  function handleInterrupt() {
    audioRef.current?.pause();
  }

  // The hover row's ✕ (present only while a session is live): a deliberate,
  // destructive action, so it opens the confirmation card first.
  function handleEndSessionClick() {
    if (busy || ending || recording || closeState !== 'idle') return;
    setShell('idle');
    setEndConfirmOpen(true);
  }

  // Confirmed manual end: reuses the popup's END_SESSION path verbatim via
  // onEndSession, then closes directly with performClose. A "no active
  // session" error surfaces as a notice instead of collapsing on nothing.
  async function handleEndSessionConfirmed() {
    setEndConfirmOpen(false);
    if (busy || ending || recording) return;
    setEnding(true);
    setNotice(null);
    try {
      await onEndSession();
      performClose();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown error';
      setNotice(
        message === 'no active session'
          ? 'No active session to end — start one from the Calyxa popup.'
          : describeError(error, "Couldn't end the session — try again."),
      );
    } finally {
      setEnding(false);
    }
  }

  // ---- Pill interaction handlers ----
  // Hover-expansion is blocked only while a surface that OWNS the flow is
  // up (a live turn, a dialog, a terminal state). The ambient/answer cards
  // (chips, concept, history, ping, notice) never gate the pill — the
  // handoff's own rule for chips is "they supplement voice, they never gate
  // it", and the same reasoning covers the rest.
  const hoverBlocked =
    surfaceKind === 'transcript' ||
    // A caption blocks the pill only while the turn is LIVE (streaming or
    // speaking). A HELD reply must not lock the pill shut -- it now persists
    // until the student's next action, and that next action (voice / text /
    // history) starts from this very hover row.
    (surfaceKind === 'caption' && (busy || playing)) ||
    surfaceKind === 'bloom' ||
    surfaceKind === 'recap' ||
    surfaceKind === 'tutorial' ||
    surfaceKind === 'endConfirm' ||
    surfaceKind === 'feedback';

  function handlePillEnter() {
    if (pill === 'idle' && !hoverBlocked) setShell('hover');
  }

  function handlePillLeave() {
    // Mouse-out with nothing active collapses to idle (handoff rule). A
    // quiet collapse -- no PANEL_CLOSED_EVENT; a hover is too transient to
    // clear the page's annotations over.
    if (pill === 'hover') setShell('idle');
  }

  function openHistory() {
    setShell('idle');
    setHistoryOpen(true);
  }

  function openFeedback() {
    setShell('idle');
    setFeedbackOpen(true);
  }

  // ---- Render helpers ----

  // The committed caption/history text, rendered math-aware: prose runs get
  // the color-linked highlighting (same one-per-turn assignment the on-page
  // marks use); $$ blocks render centered with real superscripts/symbols.
  function renderSay(text: string, annotations?: Annotation[], colorMap?: AnnotationColorMap): ReactNode {
    return splitMathBlocks(text).map((block, blockIndex) =>
      block.kind === 'math' ? (
        <span key={blockIndex} className="my-1.5 block text-center">
          <span className="inline-block max-w-full rounded-lg bg-accent-subtle px-2.5 py-0.5 text-[14.5px] font-semibold leading-relaxed text-accent-emphasis">
            {renderMathTokens(block.text)}
          </span>
        </span>
      ) : (
        <span key={blockIndex}>
          {highlightAnnotatedPhrases(block.text, annotations, colorMap).map((segment, segmentIndex) =>
            segment.colorClass ? (
              <span key={segmentIndex} className={segment.colorClass}>
                {segment.text}
              </span>
            ) : (
              <span key={segmentIndex}>{segment.text}</span>
            ),
          )}
        </span>
      ),
    );
  }

  // The reference card's caption: prose runs ONLY, color-linked highlighting
  // kept -- the reply's $$ math blocks already render isolated and big in the
  // equation chain above, so repeating them inline in the caption would put
  // the math back in the transcript (the exact thing the 2026-07-16 ask
  // removes). Prose runs are joined with a space (splitMathBlocks trims the
  // whitespace that sat around each block).
  function renderProse(text: string, annotations?: Annotation[], colorMap?: AnnotationColorMap): ReactNode {
    return splitMathBlocks(text)
      .filter((block) => block.kind === 'text')
      .map((block, blockIndex) => (
        <span key={blockIndex}>
          {blockIndex > 0 ? ' ' : ''}
          {highlightAnnotatedPhrases(block.text, annotations, colorMap).map((segment, segmentIndex) =>
            segment.colorClass ? (
              <span key={segmentIndex} className={segment.colorClass}>
                {segment.text}
              </span>
            ) : (
              <span key={segmentIndex}>{segment.text}</span>
            ),
          )}
        </span>
      ));
  }

  const lastAssistant = [...messages].reverse().find((message) => message.role === 'assistant' && !message.milestone);
  const lastUser = [...messages].reverse().find((message) => message.role === 'user');
  const topicTitle = checkinTopic ?? scan?.topic?.title ?? null;

  const mode = TUTOR_MODES[tutorMode];
  const modeTextVar = `var(--calyxa-mode-${tutorMode}-text)`;
  const modeBgVar = `var(--calyxa-mode-${tutorMode}-bg)`;
  const modeBorderVar = `var(--calyxa-mode-${tutorMode}-border)`;

  // The breathing glow behind the pill: opacity steps with attention state;
  // the gradient tints to the tutor mode while speaking (handoff §glow).
  const glowOpacity =
    pill === 'listen' || pill === 'speak' ? 0.8 : pill === 'scan' || pill === 'think' ? 0.62 : 0.42;
  const glowBackground =
    pill === 'speak'
      ? `radial-gradient(closest-side, ${modeBorderVar} 0%, ${modeBorderVar} 48%, transparent 74%)`
      : 'radial-gradient(closest-side, var(--color-accent-glow) 0%, var(--color-accent-glow-strong) 48%, transparent 74%)';

  const captionLive = busy || playing;
  const conceptSticking = useMemo(
    () => (scan ? buildStickingChips(scan.stickingCandidates ?? [])[0] : undefined),
    [scan],
  );

  // The held reply's in-card answer affordances (Darcy's 2026-07-16 ask):
  // once the reply is committed and holding, the turn's chips / multi-part
  // fields render INSIDE the caption card, under the tutor's words -- the
  // student answers with the reply still on screen instead of waiting for a
  // dissolve that no longer happens. The standalone 'answer' surface below
  // is kept for the post-Escape case (reply dismissed, answer still pending).
  const answerControlsDisabled = busy || recording || connecting || closeState !== 'idle';
  const inlineAnswer: ReactNode =
    captionHold && !captionLive && streamingTokens.length === 0 ? (
      answerFields && answerFields.length > 0 ? (
        <div className="mt-1 border-t border-border pt-2.5">
          <AnswerFields
            key={answerFields.map((field) => field.label).join('|')}
            fields={answerFields}
            disabled={answerControlsDisabled}
            onSubmit={handleAnswerFieldsSubmit}
          />
        </div>
      ) : chips && chips.length > 0 ? (
        <div className="mt-1 flex flex-wrap items-center gap-[7px] border-t border-border pt-2.5">
          <AnswerChips chips={chips} disabled={answerControlsDisabled} onTap={handleChipTap} />
        </div>
      ) : null
    ) : null;

  // ---- The transient surface node (exactly one) ----
  let surfaceNode: ReactNode = null;
  if (surfaceKind === 'endConfirm') {
    surfaceNode = (
      <div
        role="alertdialog"
        aria-label="End this tutoring session?"
        className="cx-card w-[320px] max-w-[calc(100vw-48px)] p-4 text-foreground"
      >
        <p className="m-0 text-[13.5px] font-semibold">End this tutoring session?</p>
        <p className="mb-3.5 mt-1 text-[12.5px] leading-relaxed text-muted-foreground">
          Your current session will be lost and the conversation cleared.
        </p>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={() => setEndConfirmOpen(false)}
            className="cursor-pointer rounded-full border border-border bg-transparent px-3.5 py-1.5 text-[12.5px] font-medium text-foreground outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
          >
            Keep working
          </button>
          <button
            type="button"
            onClick={() => void handleEndSessionConfirmed()}
            disabled={ending}
            className="cursor-pointer rounded-full border-0 bg-danger px-3.5 py-1.5 text-[12.5px] font-semibold text-danger-foreground outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring disabled:cursor-not-allowed disabled:opacity-50"
          >
            End session
          </button>
        </div>
      </div>
    );
  } else if (surfaceKind === 'bloom' && bloom) {
    surfaceNode = (
      <div className="w-[420px] max-w-[calc(100vw-48px)]">
        <SectionBloomFrame line={bloom.line} durationMs={BLOOM_MS}>
          <div aria-hidden="true" className="flex items-center gap-2.5 px-3.5 py-3">
            <span className="flex h-[30px] w-[30px] flex-none items-center justify-center rounded-[9px] border border-[var(--calyxa-sage-border)] bg-background">
              <CalyxaMark className="h-[18px] w-[18px]" />
            </span>
            <span className="flex min-w-0 flex-col gap-px">
              <span className="text-[13.5px] font-semibold leading-tight text-foreground">Section complete</span>
              <span className="truncate text-[11.5px] leading-tight text-muted-foreground">{bloom.line}</span>
            </span>
          </div>
        </SectionBloomFrame>
      </div>
    );
  } else if (surfaceKind === 'recap' && recap) {
    surfaceNode = (
      <div className="cx-card w-[400px] max-w-[calc(100vw-48px)] text-foreground">
        <RecapCard
          recap={recap}
          topicTitle={checkinTopic}
          disabled={ending}
          onDone={handleRecapDone}
          sessionId={endedSessionId}
          onGenerateStudyKit={onGenerateStudyKit}
        />
      </div>
    );
  } else if (surfaceKind === 'feedback') {
    surfaceNode = <FeedbackCard onSubmit={handleFeedbackSubmit} onClose={() => setFeedbackOpen(false)} />;
  } else if (surfaceKind === 'tutorial') {
    surfaceNode = (
      <div className="cx-card w-[400px] max-w-[calc(100vw-48px)] text-foreground">
        <Tutorial onDone={handleTutorialDone} />
      </div>
    );
  } else if (surfaceKind === 'transcript') {
    surfaceNode = (
      <div className="cx-card flex max-w-[440px] items-start gap-2.5 px-[17px] py-[13px] text-foreground">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="var(--color-muted-foreground)"
          strokeWidth="1.8"
          strokeLinecap="round"
          className="mt-[3px] h-[15px] w-[15px] flex-none"
          aria-hidden="true"
        >
          <path d="M12 3a3 3 0 0 1 3 3v5a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3Z" />
          <path d="M6 11a6 6 0 0 0 12 0" />
          <path d="M12 17v3" />
        </svg>
        <div className="flex flex-col gap-[3px]">
          <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">You</span>
          <p className="m-0 text-[14px] leading-[1.55]">
            {liveTranscript}
            {recording && <StreamCaret />}
          </p>
        </div>
      </div>
    );
  } else if (surfaceKind === 'caption') {
    const holdText = captionHold?.text ?? null;
    if (captionMath) {
      // Reference pop-up (handoff surface 4): the full equation chain set in
      // the system sans at 500 -- each worked step isolated and big, joined
      // by ↓, the final step in accent-emphasis -- with the caption's PROSE
      // below (renderProse: the math lives only up here, never restated
      // inline in the caption).
      surfaceNode = (
        <div className="cx-card flex w-[380px] max-w-[calc(100vw-48px)] flex-col gap-3 px-[19px] pb-4 pt-[15px] text-foreground">
          <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            {topicTitle ? `${topicTitle} · on your sheet` : 'On your sheet'}
          </span>
          <div className="flex flex-col items-center gap-[7px] pb-1.5 pt-2.5 font-medium tracking-[-0.01em]">
            {captionMath.map((block, blockIndex) => (
              <Fragment key={blockIndex}>
                {blockIndex > 0 && (
                  <span aria-hidden="true" className="text-[13px] text-muted-foreground">
                    ↓
                  </span>
                )}
                <span
                  className={`text-center text-[21px]${
                    blockIndex === captionMath.length - 1 && captionMath.length > 1 ? ' text-accent-emphasis' : ''
                  }`}
                >
                  {renderMathTokens(block)}
                </span>
              </Fragment>
            ))}
          </div>
          <div className="flex items-start gap-2 border-t border-border pt-[11px]">
            <CalyxaMark aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 flex-none" />
            <p className="m-0 text-[13px] leading-[1.55]" aria-live="polite">
              {holdText && streamingTokens.length === 0 ? (
                renderProse(holdText, lastAssistant?.annotations, lastAssistant?.annotationColors)
              ) : (
                <StreamTokens tokens={streamingTokens} />
              )}
              {captionLive && <StreamCaret />}
            </p>
          </div>
          {inlineAnswer}
        </div>
      );
    } else {
      surfaceNode = (
        <div className="cx-card flex max-w-[460px] items-start gap-2.5 px-[17px] py-[13px] text-foreground">
          <CalyxaMark aria-hidden="true" className="mt-0.5 h-[17px] w-[17px] flex-none" />
          <div className="flex min-w-0 flex-col gap-1.5">
            <span
              className="flex items-center gap-[5px] self-start rounded-full px-[9px] py-[3px] text-[10px] font-semibold uppercase tracking-[0.09em]"
              style={{ color: modeTextVar, background: modeBgVar }}
            >
              {mode.glyph}&nbsp;{mode.name}
            </span>
            <p className="m-0 text-[14px] leading-[1.55]" aria-live="polite">
              {holdText && streamingTokens.length === 0 ? (
                renderSay(holdText, lastAssistant?.annotations, lastAssistant?.annotationColors)
              ) : (
                <StreamTokens tokens={streamingTokens} />
              )}
              {captionLive && <StreamCaret />}
            </p>
            {inlineAnswer}
          </div>
        </div>
      );
    }
  } else if (surfaceKind === 'notice' && notice) {
    surfaceNode = (
      <div
        role="alert"
        className="cx-card max-w-[420px] px-[17px] py-[11px] text-[13px] leading-[1.5] text-danger"
      >
        {notice}
      </div>
    );
  } else if (surfaceKind === 'concept' && scan?.topic && conceptSticking) {
    surfaceNode = (
      <ConceptCard
        variant={CONCEPT_CARD_VARIANT}
        topic={scan.topic}
        sticking={conceptSticking}
        disabled={busy || ending || closeState !== 'idle'}
        autoStartActive={autoStartArmed}
        autoStartMs={AUTO_START_MS}
        onStart={handleCheckinStart}
        onReframe={handleCheckinReframe}
      />
    );
  } else if (surfaceKind === 'conceptFallback') {
    surfaceNode = (
      <ConceptFallbackCard disabled={busy || ending || closeState !== 'idle'} onFrame={handleCheckinReframe} />
    );
  } else if (surfaceKind === 'history') {
    surfaceNode = (
      <div
        role="button"
        tabIndex={0}
        title="Dismiss"
        onClick={() => dismissSurface(() => setHistoryOpen(false))}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            dismissSurface(() => setHistoryOpen(false));
          }
        }}
        className="cx-card flex w-[400px] max-w-[calc(100vw-48px)] cursor-pointer flex-col gap-2.5 px-[17px] pb-[15px] pt-3.5 text-foreground outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
      >
        <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
          Last exchange
        </span>
        {lastUser || lastAssistant ? (
          <>
            {lastUser && (
              <div className="flex flex-col gap-0.5">
                <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                  You
                </span>
                <p className="m-0 text-[13px] leading-[1.55]">{lastUser.content}</p>
              </div>
            )}
            {lastUser && lastAssistant && <span aria-hidden="true" className="block h-px bg-border" />}
            {lastAssistant && (
              <div className="flex items-start gap-2">
                <CalyxaMark aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 flex-none" />
                <p className="m-0 text-[13px] leading-[1.55]">
                  {renderSay(lastAssistant.content, lastAssistant.annotations, lastAssistant.annotationColors)}
                </p>
              </div>
            )}
          </>
        ) : (
          <p className="m-0 text-[13px] leading-[1.55] text-muted-foreground">Nothing yet — say hi.</p>
        )}
      </div>
    );
  } else if (surfaceKind === 'answer') {
    surfaceNode =
      answerFields && answerFields.length > 0 ? (
        <div className="cx-card w-[400px] max-w-[calc(100vw-48px)] px-[17px] py-3.5 text-foreground">
          <AnswerFields
            key={answerFields.map((field) => field.label).join('|')}
            fields={answerFields}
            disabled={busy || recording || connecting || closeState !== 'idle'}
            onSubmit={handleAnswerFieldsSubmit}
          />
        </div>
      ) : (
        <div className="cx-card flex max-w-[460px] flex-wrap items-center gap-[7px] px-[15px] py-3 text-foreground">
          <AnswerChips chips={chips ?? []} disabled={answerControlsDisabled} onTap={handleChipTap} />
        </div>
      );
  } else if (surfaceKind === 'ping' && pinQueue.length > 0) {
    // The persistent aria-live wrapper announces each ping without stealing
    // focus; keying the toast by queue id re-runs the entry for
    // back-to-back pins of the same kind.
    surfaceNode = (
      <span aria-live="polite">
        <PingToast key={pinQueue[0].id} pin={pinQueue[0].pin} />
      </span>
    );
  }

  // Ghost bookkeeping (the 2026-07-16 all-surfaces fade): after every render,
  // remember what the slot showed; when the kind changed or the slot emptied
  // WITHOUT a dismissSurface exit (which already fades in place), replay the
  // previous node as a fading ghost for SURFACE_EXIT_MS. Runs without a dep
  // array on purpose -- it must see the node exactly as the last render drew
  // it; the guard (kind unchanged -> no-op) keeps it from looping.
  useEffect(() => {
    const prev = prevSurfaceRef.current;
    if (prev && prev.kind !== surfaceKind && !prev.leaving) {
      setSurfaceGhost({ node: prev.node, id: ++surfaceGhostIdRef.current });
    }
    prevSurfaceRef.current =
      surfaceNode !== null && surfaceKind !== null
        ? { kind: surfaceKind, node: surfaceNode, leaving: surfaceLeaving }
        : null;
  });

  useEffect(() => {
    if (!surfaceGhost) return;
    const timer = window.setTimeout(() => setSurfaceGhost(null), SURFACE_EXIT_MS);
    return () => window.clearTimeout(timer);
  }, [surfaceGhost]);

  // ---- The pill's contents per state ----
  let pillContent: ReactNode;
  if (pill === 'idle') {
    pillContent = (
      <button
        type="button"
        onClick={() => {
          if (!hoverBlocked) setShell('hover');
        }}
        aria-label="Open Calyxa"
        className="cx-pill-content block h-full w-full cursor-pointer rounded-[inherit] border-0 p-0 outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
        style={{ background: 'var(--cx-sheen)' }}
      />
    );
  } else if (pill === 'hover') {
    pillContent = (
      <div className="cx-pill-content flex items-center gap-2 whitespace-nowrap">
        <CalyxaMark aria-hidden="true" className="h-[21px] w-[21px] flex-none" />
        <span aria-hidden="true" className="mx-0.5 h-5 w-px flex-none bg-border" />
        <HoverButton label="Voice" title="Talk to Calyxa" onClick={() => void handleMicStart()}>
          <MicIcon />
        </HoverButton>
        <HoverButton label="Text" title="Type instead" onClick={() => setShell('text')}>
          <span className="text-[14px] font-semibold tracking-[-0.02em] text-accent-emphasis">Aa</span>
        </HoverButton>
        <HoverButton
          label="Analyze screen"
          title={sessionLive ? 'Scanning is a session-start step' : 'Read my screen'}
          disabled={sessionLive || scanPending || !tutorialResolved}
          onClick={startScan}
        >
          <ViewfinderIcon />
        </HoverButton>
        <HoverButton label="Last exchange" title="Last exchange" onClick={openHistory}>
          <ClockIcon />
        </HoverButton>
        {hoverExtras && (
          <>
            <span aria-hidden="true" className="mx-0.5 h-5 w-px flex-none bg-border" />
            <HoverButton label="Send feedback" title="Send feedback" onClick={openFeedback}>
              <FeedbackIcon />
            </HoverButton>
            <HoverButton
              label="End tutoring session"
              title="End session"
              danger
              disabled={busy || ending || recording || closeState !== 'idle'}
              onClick={handleEndSessionClick}
            >
              <CloseIcon />
            </HoverButton>
          </>
        )}
      </div>
    );
  } else if (pill === 'text') {
    pillContent = (
      <Composer
        inputRef={inputElRef}
        value={input}
        busy={busy}
        disabled={closeState !== 'idle'}
        placeholder={sessionLive ? 'Answer here — or ask anything…' : 'Ask about this problem…'}
        onChange={setInput}
        onSubmit={handleTextSubmit}
        onClose={() => {
          setShell('idle');
          setInput('');
        }}
      />
    );
  } else if (pill === 'scan') {
    pillContent = (
      <>
        <div className="cx-pill-content flex items-center gap-2.5 whitespace-nowrap">
          <span className="flex-none text-accent-emphasis" aria-hidden="true">
            <ViewfinderIcon size={16} />
          </span>
          <span className="cx-shimmer-text text-[13.5px] font-medium" aria-live="polite">
            Reading your screen
          </span>
        </div>
        <span
          aria-hidden="true"
          className="cx-sweep-bar pointer-events-none absolute inset-y-0 w-[46px] opacity-50"
          style={{ background: 'linear-gradient(90deg, transparent, var(--color-accent-glow), transparent)' }}
        />
      </>
    );
  } else if (pill === 'think') {
    pillContent = (
      <div className="cx-pill-content flex items-center gap-[9px] whitespace-nowrap">
        <span className="flex items-center gap-1" aria-hidden="true">
          <span className="cx-think-dot h-[5px] w-[5px] rounded-full bg-accent-emphasis" />
          <span className="cx-think-dot h-[5px] w-[5px] rounded-full bg-accent-emphasis" style={{ animationDelay: '0.18s' }} />
          <span className="cx-think-dot h-[5px] w-[5px] rounded-full bg-accent-emphasis" style={{ animationDelay: '0.36s' }} />
        </span>
        <span className="text-[13px] font-medium text-muted-foreground" role="status">
          Thinking
        </span>
      </div>
    );
  } else if (pill === 'listen') {
    pillContent = (
      <button
        type="button"
        onClick={() => void handleMicStop()}
        disabled={!recording}
        aria-label="Stop recording and send"
        title="Stop and send"
        className="cx-pill-content flex h-full w-full cursor-pointer items-center justify-center gap-[11px] whitespace-nowrap border-0 bg-transparent p-0 outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring disabled:cursor-default"
      >
        <PillWave color="var(--color-foreground)" level={level} durationS={1} />
        <span className="text-[13px] font-medium text-muted-foreground">
          {connecting ? 'Connecting…' : 'Listening'}
        </span>
      </button>
    );
  } else {
    // speak
    pillContent = (
      <button
        type="button"
        onClick={handleInterrupt}
        aria-label="Stop speaking"
        title="Stop speaking"
        className="cx-pill-content flex h-full w-full cursor-pointer items-center justify-center gap-[11px] whitespace-nowrap border-0 bg-transparent p-0 outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
      >
        <PillWave color={modeBorderVar} durationS={0.85} />
        <span className="text-[13px] font-medium" style={{ color: modeTextVar }}>
          {mode.glyph}&nbsp;&nbsp;{mode.name}
        </span>
      </button>
    );
  }

  // ---- Render ----
  return (
    <div className="cx-root font-sans text-base text-foreground" data-theme={theme}>
      <AnnotationLayer annotationColors={annotationColors} />
      {reframeOpen ? (
        <ReframeTool disabled={busy || ending} onCancel={handleReframeCancel} onStart={handleReframeStart} />
      ) : (
        <div className="pointer-events-none fixed inset-x-0 bottom-7 z-[2147483647] flex flex-col items-center gap-3.5">
          {/* The one sanctioned second element: a ping toast stacked above a
              HELD (settled) caption -- the persistent reply would otherwise
              starve the pin queue forever. Live surfaces still get the slot
              to themselves. */}
          {pingStackedOnCaption && (
            <span aria-live="polite" className="pointer-events-auto cx-surface-in">
              <PingToast key={pinQueue[0].id} pin={pinQueue[0].pin} />
            </span>
          )}
          {/* The single transient surface slot -- exactly one LIVE surface at
              a time, keyed by kind so a swap re-runs the spring entry. The
              ghost (bottom-anchored where the departed card's bottom edge
              sat, absolutely positioned so the incoming card never jumps) is
              the same card fading out -- every surface now leaves with the
              cx-out fade instead of popping off (2026-07-16 ask). */}
          {(surfaceNode || surfaceGhost) && (
            <div className="relative flex flex-col items-center">
              {surfaceGhost && (
                <div
                  key={surfaceGhost.id}
                  aria-hidden="true"
                  className="pointer-events-none absolute bottom-0 left-1/2 -translate-x-1/2"
                >
                  <div className="cx-surface-out">{surfaceGhost.node}</div>
                </div>
              )}
              {surfaceNode && (
                <div
                  key={surfaceKind}
                  className={`pointer-events-auto ${surfaceLeaving ? 'cx-surface-out' : 'cx-surface-in'}`}
                >
                  {surfaceNode}
                </div>
              )}
            </div>
          )}

          {/* The pill, inside its invisible ~10px hit halo (a 5px sliver is
              too small a target; hover/leave live on the padded wrapper). */}
          <div
            className="pointer-events-auto relative"
            style={{ padding: 10, margin: -10 }}
            onMouseEnter={handlePillEnter}
            onMouseLeave={handlePillLeave}
          >
            <div
              aria-hidden="true"
              className="pointer-events-none absolute rounded-full"
              style={{
                inset: -1,
                background: glowBackground,
                filter: 'blur(10px)',
                opacity: glowOpacity,
                transition: 'opacity 0.6s ease',
              }}
            >
              <span className="cx-glow-breathe block h-full w-full" />
            </div>
            <div
              className="cx-pill relative flex items-center justify-center"
              style={{ width: pillW, height: pillH, borderRadius: pillR }}
            >
              {/* The tutor-mode frame (2026-07-16 ask): while a session is
                  live, the expanded text bar wears a light, breathing
                  gradient ring in the ACTIVE mode's color -- the mode reads
                  ambiently on the pill itself, in every expanded state, not
                  only while speaking. Skipped on the idle sliver (nothing to
                  frame at 39x5). */}
              {sessionLive && pill !== 'idle' && (
                <span
                  aria-hidden="true"
                  className="cx-mode-frame"
                  style={{ '--cx-mode-frame-color': modeBorderVar } as CSSProperties}
                />
              )}
              {pillContent}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---- Presentational bits (pill-local, no state) ----

// One hover-row control: 36px circle, accent-emphasis glyph, sage hover
// (accent-subtle), warm-red hover for the destructive ✕.
function HoverButton({
  label,
  title,
  onClick,
  disabled,
  danger,
  children,
}: {
  label: string;
  title: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={title}
      className={`flex h-9 w-9 flex-none cursor-pointer items-center justify-center rounded-full border-0 bg-transparent p-0 outline-none transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring disabled:cursor-not-allowed disabled:opacity-40 ${
        danger
          ? 'hover:bg-[var(--calyxa-close-hover-bg)] hover:text-[var(--calyxa-close-hover-text)]'
          : 'hover:bg-accent-subtle'
      }`}
    >
      {children}
    </button>
  );
}

// The answer-chip row (design 8a), shared by the standalone answer surface
// and the held caption's in-card answer block (the 2026-07-16 persistence
// change) so a chip renders and behaves identically wherever it appears.
function AnswerChips({
  chips,
  disabled,
  onTap,
}: {
  chips: string[];
  disabled: boolean;
  onTap: (chip: string) => void;
}) {
  return (
    <>
      {chips.map((chip) => (
        <button
          key={chip}
          type="button"
          disabled={disabled}
          onClick={() => onTap(chip)}
          className="cursor-pointer rounded-full border border-border bg-background px-[11px] py-[5px] text-[12px] leading-normal text-[var(--calyxa-chip-text)] outline-none transition-colors hover:border-accent hover:bg-accent-subtle focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring disabled:cursor-default disabled:opacity-50"
        >
          {renderMathTokens(chip)}
        </button>
      ))}
    </>
  );
}

// The 17px / 1.8-stroke icon set (handoff's hover row), stroke = the
// accent-emphasis token (#166534 light / #86EFAC dark).
function MicIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="var(--color-accent-emphasis)" strokeWidth="1.8" strokeLinecap="round" className="h-[17px] w-[17px]" aria-hidden="true">
      <path d="M12 3a3 3 0 0 1 3 3v5a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3Z" />
      <path d="M6 11a6 6 0 0 0 12 0" />
      <path d="M12 17v3" />
    </svg>
  );
}

function ViewfinderIcon({ size = 17 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ width: size, height: size }} className="text-accent-emphasis" aria-hidden="true">
      <path d="M4 9V6a2 2 0 0 1 2-2h3" />
      <path d="M15 4h3a2 2 0 0 1 2 2v3" />
      <path d="M20 15v3a2 2 0 0 1-2 2h-3" />
      <path d="M9 20H6a2 2 0 0 1-2-2v-3" />
      <path d="M7 12h10" />
    </svg>
  );
}

function ClockIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="var(--color-accent-emphasis)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-[17px] w-[17px]" aria-hidden="true">
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 1.8" />
    </svg>
  );
}

function FeedbackIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="var(--color-accent-emphasis)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-[17px] w-[17px]" aria-hidden="true">
      <path d="M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v7a2.5 2.5 0 0 1-2.5 2.5H10l-4.5 4v-4h-1A2.5 2.5 0 0 1 4 13.5v-7Z" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" className="h-[15px] w-[15px] text-accent-emphasis" aria-hidden="true">
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

// The 5-bar waveform (handoff: 3px bars, heights 9–22px). While listening
// the amplitude is driven from the live AnalyserNode level (per the
// handoff's "instead of pure keyframes where practical"), each bar with a
// slightly different gain so the meter reads organic; while speaking the
// staggered cx-wave keyframes carry it.
const WAVE_HEIGHTS = [11, 18, 22, 15, 9] as const;

function PillWave({ color, level, durationS }: { color: string; level?: number; durationS: number }) {
  return (
    <span aria-hidden="true" className="flex h-[22px] items-center gap-[3px]">
      {WAVE_HEIGHTS.map((height, index) => {
        const style: CSSProperties = {
          width: 3,
          height,
          borderRadius: 2,
          background: color,
          transformOrigin: 'center',
        };
        if (level !== undefined) {
          const gain = 0.55 + ((index * 37) % 100) / 100;
          style.transform = `scaleY(${Math.max(0.3, Math.min(1, level * gain))})`;
          style.transition = 'transform 80ms ease-out';
          return <span key={index} className="block" style={style} />;
        }
        return (
          <span
            key={index}
            className="cx-wave-bar block"
            style={{
              ...style,
              animationDuration: `${durationS}s`,
              animationDelay: `${(index * (durationS < 1 ? 0.1 : 0.12)).toFixed(2)}s`,
            }}
          />
        );
      })}
    </span>
  );
}

// The streaming word tokens (existing machinery: stable ids so only new
// words run the cx-word-in entry).
function StreamTokens({ tokens }: { tokens: { text: string; id: number }[] }) {
  return (
    <>
      {tokens.map((token) => (
        <span key={token.id} className="cx-word-in inline-block whitespace-pre-wrap">
          {token.text}
        </span>
      ))}
    </>
  );
}

// The streaming caret (handoff: 2.5×13px, r2, accent, step-end blink) --
// hidden by the callers once the stream completes.
function StreamCaret() {
  return (
    <span
      aria-hidden="true"
      className="inline-block w-[2.5px] rounded-[2px] bg-accent"
      style={{ height: 13, marginLeft: 3, verticalAlign: -2, animation: 'cx-caret 1s step-end infinite' }}
    />
  );
}

// Calculator-notation math rendered with real superscripts/symbols
// (Transcript.tsx's tokenizer -- the caption, reference equations, and chip
// labels all share it).
function renderMathTokens(text: string): ReactNode {
  return tokenizeMathText(text).map((token, index) =>
    token.kind === 'sup' ? <sup key={index}>{token.text}</sup> : <span key={index}>{token.text}</span>,
  );
}

function describeError(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message : 'unknown error';
  return message === 'not signed in' ? 'Sign in from the Calyxa popup to start.' : fallback;
}

/**
 * Plays synthesized audio and simultaneously reveals `text` word-by-word at a
 * rate proportional to the audio's actual duration so the text tracks the
 * speech. Calls `appendToken` on each word reveal so the caller can update
 * the caption's streaming tokens.
 *
 * Uses the blob URL's loadedmetadata event for accurate timing; falls back to
 * 350 ms/word if duration is unavailable. On interrupt (audio.pause()) the
 * text reveal stops and the promise resolves, exactly like natural completion.
 */
async function playAudioWithTextReveal(
  buffer: ArrayBuffer,
  text: string,
  appendToken: (text: string) => void,
  setPlaying: (playing: boolean) => void,
  audioRef: { current: HTMLAudioElement | null },
  onPlaybackStart: (durationMs: number) => void,
): Promise<void> {
  const url = URL.createObjectURL(new Blob([buffer], { type: 'audio/mpeg' }));
  const audio = new Audio(url);
  audioRef.current = audio;

  // Resolve duration from loadedmetadata; use fallback if unavailable.
  const duration = await new Promise<number>((resolve) => {
    if (audio.readyState >= 1 && isFinite(audio.duration)) {
      resolve(audio.duration);
      return;
    }
    const onMeta = () => {
      audio.removeEventListener('error', onError);
      resolve(isFinite(audio.duration) ? audio.duration : 0);
    };
    const onError = () => {
      audio.removeEventListener('loadedmetadata', onMeta);
      resolve(0);
    };
    audio.addEventListener('loadedmetadata', onMeta, { once: true });
    audio.addEventListener('error', onError, { once: true });
  });

  const words = text.trim().split(/\s+/);
  const FALLBACK_MS_PER_WORD = 350;
  const intervalMs = words.length > 0 && duration > 0
    ? Math.max(60, (duration * 1000) / words.length)
    : FALLBACK_MS_PER_WORD;

  setPlaying(true);
  try {
    await audio.play();
  } catch {
    setPlaying(false);
    audioRef.current = null;
    URL.revokeObjectURL(url);
    return;
  }

  // Only reported once playback has actually started (not merely
  // requested) -- a rejected/aborted play() above returns before this,
  // so a failed voice turn never kicks off an annotation sequence with no
  // audio behind it. `duration` is in seconds; the controller wants ms.
  onPlaybackStart(duration * 1000);

  // Append one word token per interval tick so each gets the cx-word-in
  // entry animation, matching the text-streaming path's visual behaviour.
  let wordIndex = 0;
  const intervalId = setInterval(() => {
    if (wordIndex < words.length) {
      // Space prefix on all words after the first so the reconstructed
      // text matches the original when the tokens are read as plain text.
      appendToken(wordIndex === 0 ? words[wordIndex] : ' ' + words[wordIndex]);
      wordIndex++;
    } else {
      clearInterval(intervalId);
    }
  }, intervalMs);

  try {
    await new Promise<void>((resolve) => {
      audio.addEventListener('ended', () => resolve(), { once: true });
      audio.addEventListener('error', () => resolve(), { once: true });
      audio.addEventListener('pause', () => resolve(), { once: true });
    });
  } finally {
    clearInterval(intervalId);
    setPlaying(false);
    audioRef.current = null;
    URL.revokeObjectURL(url);
  }
}

// ElevenLabs streams mp3 (Content-Type: audio/mpeg, matching the route) --
// this is the one MIME MediaSource actually needs to accept for the
// streamed path to work at all.
const TTS_STREAM_MIME_TYPE = 'audio/mpeg';

// Timeupdate-driven reveal pacing target (Task 6, ADR-033): close to the
// buffered path's FALLBACK_MS_PER_WORD above, so a turn that falls back
// mid-setup doesn't visibly change reveal speed. Real duration is unknown
// mid-stream (no Content-Length on a live TTS stream) so, unlike the
// buffered path, this is a fixed rate rather than one derived from a known
// duration.
const STREAM_REVEAL_MS_PER_WORD = 320;

function isTtsStreamingSupported(): boolean {
  return typeof MediaSource !== 'undefined' && MediaSource.isTypeSupported(TTS_STREAM_MIME_TYPE);
}

// The words of `sayText` that are DEFINITELY complete: if the accumulated
// streamed text does not end in whitespace, its last token may still be
// growing (a delta can split mid-word), so it is excluded until a following
// space confirms it. This keeps already-revealed word indices stable as the
// say text streams in (Sprint 15 voice follow-on).
function completedWords(sayText: string): string[] {
  const leading = sayText.replace(/^\s+/, '');
  if (leading.length === 0) return [];
  const endsWithSpace = /\s$/.test(sayText);
  const tokens = leading.split(/\s+/);
  if (!endsWithSpace) tokens.pop();
  return tokens;
}

/**
 * Streamed-envelope voice turn with per-sentence TTS and gapless playback
 * (Sprint 15 voice follow-on, ADR-033 amendment). Drives `runTurn` (which
 * streams the spoken text delta-by-delta) and, as each SENTENCE completes,
 * synthesizes it via `synthesizeStream` and appends its MP3 chunks into ONE
 * MediaSource SourceBuffer -- so audio starts after sentence 1 instead of the
 * whole reply, and consecutive sentences play back-to-back with no gap. Word
 * reveal paces off `audio.currentTime` against the completed words known so
 * far, so the text tracks the speech.
 *
 * `onEnvelopeReady` fires at turn-done (the full validated envelope) -- which
 * lands DURING playback, since text generates faster than it is spoken -- so
 * the caller can fire pings/annotation-sequencing against the audio.
 * `onFirstAudio` fires once, at the first playable audio. Throws on any
 * MediaSource/codec/stream failure so the caller can fall back to the
 * buffered turn+playback path; it never partially commits.
 */
async function playVoiceTurnStreamedEnvelope(
  runTurn: (onSayDelta: (text: string) => void) => Promise<TurnResult>,
  synthesizeStream: (
    text: string,
    onChunk: (chunk: Uint8Array) => void,
  ) => Promise<{ ttsMs: number; degraded?: true }>,
  appendToken: (text: string) => void,
  setPlaying: (playing: boolean) => void,
  audioRef: { current: HTMLAudioElement | null },
  onEnvelopeReady: (result: TurnResult) => void,
  onFirstAudio: () => void,
): Promise<TurnResult> {
  if (!isTtsStreamingSupported()) {
    throw new Error('MediaSource streaming for audio/mpeg is not supported in this browser.');
  }

  const mediaSource = new MediaSource();
  const audio = new Audio();
  const url = URL.createObjectURL(mediaSource);
  audio.src = url;
  audioRef.current = audio;

  // Reveal state: the full accumulated say text, and how many words we've
  // already revealed. Reveal is capped by BOTH audio.currentTime and the
  // completed-word count, so it never reveals a still-growing final token.
  let sayText = '';
  let revealedCount = 0;
  let playbackStarted = false;

  function revealDue() {
    const words = completedWords(sayText);
    const due = wordsDueByTime(audio.currentTime * 1000, STREAM_REVEAL_MS_PER_WORD, words.length);
    while (revealedCount < due) {
      appendToken(revealedCount === 0 ? words[revealedCount] : ' ' + words[revealedCount]);
      revealedCount++;
    }
  }

  function onTimeUpdate() {
    if (!playbackStarted) {
      playbackStarted = true;
      setPlaying(true);
      onFirstAudio();
    }
    revealDue();
  }
  audio.addEventListener('timeupdate', onTimeUpdate);

  // Single rejecting funnel for every failure mode: a SourceBuffer append
  // error, a MediaSource error, an audio-element error, or the setup
  // timeout all reject `failed`, so the caller falls back the SAME way
  // regardless of which fired.
  let failNow: (error: Error) => void = () => {};
  const failed = new Promise<never>((_, reject) => {
    failNow = reject;
  });
  mediaSource.addEventListener('error', () => failNow(new Error('MediaSource failed to open')), { once: true });
  audio.addEventListener('error', () => failNow(new Error('Audio element playback failed')), { once: true });

  const playbackEnded = new Promise<void>((resolve) => {
    audio.addEventListener('ended', () => resolve(), { once: true });
    audio.addEventListener('pause', () => resolve(), { once: true });
  });

  // Two bounded setup legs, each with its own fuse: (a) call -> MediaSource
  // sourceopen (local, normally milliseconds) and (b) first TTS request ->
  // first playable audio. The stretch BETWEEN them -- the model producing its
  // first complete sentence -- is deliberately unbounded here: a single fuse
  // spanning the whole setup used to fire at 6s while a normal turn's first
  // audio lands at ~4.5-5.5s, so any slightly slow turn was abandoned and
  // re-run in FULL through the buffered fallback (a second model call),
  // turning a slow reply into a doubly slow one plus a console error
  // (live-found 2026-07-15). runTurn rejects on its own transport failures,
  // so a genuinely dead stream still fails the turn race below.
  const SETUP_LEG_MS = 6000;
  let setupTimeout = setTimeout(() => {
    failNow(new Error('TTS streaming setup timed out (MediaSource open)'));
  }, SETUP_LEG_MS);

  try {
    const sourceBuffer = await Promise.race([
      new Promise<SourceBuffer>((resolve, reject) => {
        mediaSource.addEventListener(
          'sourceopen',
          () => {
            try {
              resolve(mediaSource.addSourceBuffer(TTS_STREAM_MIME_TYPE));
            } catch (error) {
              reject(error instanceof Error ? error : new Error('addSourceBuffer failed'));
            }
          },
          { once: true },
        );
      }),
      failed,
    ]);
    // Leg (a) done -- the MediaSource opened. The next fuse arms when the
    // first sentence is handed to TTS (ttsWorker below).
    clearTimeout(setupTimeout);
    sourceBuffer.addEventListener('error', () => failNow(new Error('SourceBuffer append failed')));

    // Append queue -- a SourceBuffer accepts one appendBuffer at a time; chunks
    // from every sentence's synthesis funnel through here in arrival order, so
    // the sentences concatenate seamlessly. play() starts after the FIRST chunk.
    const pending: Uint8Array[] = [];
    let appending = false;
    let playCalled = false;

    function pump() {
      if (appending || pending.length === 0 || sourceBuffer.updating) return;
      appending = true;
      sourceBuffer.appendBuffer(pending.shift()! as BufferSource);
    }

    sourceBuffer.addEventListener('updateend', () => {
      appending = false;
      if (!playCalled) {
        playCalled = true;
        clearTimeout(setupTimeout);
        audio.play().catch((error) => failNow(error instanceof Error ? error : new Error('audio.play() rejected')));
      }
      pump();
    });

    // Sentence queue: the turn stream pushes complete sentences; a single
    // worker synthesizes them one at a time (awaiting each so their chunks stay
    // contiguous in the SourceBuffer) and stops once the turn is done and the
    // queue is drained.
    const sentenceQueue: string[] = [];
    let turnDone = false;
    let ttsFuseArmed = false;
    // Cost-capped TTS (ADR-041 Decision 2, 2026-07-15 fix): a capped leg
    // resolves with `degraded` and NO chunks. Set once, this stops further
    // synthesis and (if no audio ever started) skips the playback waits so
    // the turn completes as text instead of timing out into the buffered
    // fallback's second model call.
    let ttsDegraded = false;
    let wake: (() => void) | null = null;
    function signalSentence() {
      const w = wake;
      wake = null;
      if (w) w();
    }
    async function ttsWorker(): Promise<void> {
      for (;;) {
        if (sentenceQueue.length === 0) {
          if (turnDone) return;
          await Promise.race([new Promise<void>((r) => (wake = r)), failed]);
          continue;
        }
        // The spoken text never carries the $$ math-block delimiters (they
        // are display-rendering syntax); a sentence that strips to nothing
        // is skipped rather than synthesized as silence.
        const sentence = stripMathDelimiters(sentenceQueue.shift()!);
        if (!sentence.trim()) continue;
        // Leg (b): first TTS request -> first playable audio. Armed once, at
        // the first real synthesis; cleared when audio.play() fires
        // (updateend above). Catches a wedged TTS leg (e.g. the route
        // returning no chunks) without ever penalizing a slow model turn.
        if (!ttsFuseArmed) {
          ttsFuseArmed = true;
          setupTimeout = setTimeout(() => {
            failNow(new Error('TTS streaming setup timed out (first audio)'));
          }, SETUP_LEG_MS);
        }
        const synth = await Promise.race([
          synthesizeStream(sentence, (chunk) => {
            pending.push(chunk);
            pump();
          }),
          failed,
        ]);
        if (synth.degraded) {
          ttsDegraded = true;
          clearTimeout(setupTimeout); // no first audio is coming -- not a failure
          return;
        }
      }
    }

    const accumulator = createSentenceAccumulator();
    const worker = ttsWorker();
    // The worker races `failed` internally, so a setup-fuse rejection that
    // throws this function out of the turn race BELOW (before `worker` is
    // awaited) would otherwise surface as an uncaught promise rejection in
    // the page console -- the "Uncaught (in promise) Error: TTS streaming
    // setup timed out" live-find (2026-07-15). Pre-attaching a no-op handler
    // marks it observed; the `await Promise.race([worker, failed])` later
    // still rethrows for the real control flow.
    void worker.catch(() => {});

    const result = await Promise.race([
      runTurn((delta) => {
        sayText += delta;
        for (const sentence of accumulator.push(delta)) {
          sentenceQueue.push(sentence);
          signalSentence();
        }
      }),
      failed,
    ]);

    if (!result.reply.trim()) {
      throw new Error('The tutor returned an empty reply.');
    }

    // Turn done: flush the trailing sentence, let the caller fire pings/
    // annotation sequencing against the (already-playing) audio, and release
    // the worker to drain and finish.
    const tail = accumulator.flush();
    if (tail) sentenceQueue.push(tail);
    turnDone = true;
    signalSentence();
    onEnvelopeReady(result);

    await Promise.race([worker, failed]);

    // A cost-capped TTS leg that never produced audio has nothing to drain
    // or play -- skip straight to the full-text reveal below (the reply
    // commits as text; the caller's UI flow is otherwise identical). If some
    // audio DID play before the cap tripped mid-turn, let it finish normally.
    if (!ttsDegraded || playCalled) {
      // Drain any in-flight/queued appends before closing the stream --
      // endOfStream() throws if called mid-update.
      while (appending || pending.length > 0) {
        await Promise.race([
          new Promise<void>((resolve) => sourceBuffer.addEventListener('updateend', () => resolve(), { once: true })),
          failed,
        ]);
      }
      if (mediaSource.readyState === 'open') mediaSource.endOfStream();

      await Promise.race([playbackEnded, failed]);
    }

    // Reveal any words the audio finished before the reveal ladder reached
    // (short audio vs. the fixed per-word rate) so the caption is whole
    // before it commits.
    const finalWords = result.reply.trim().split(/\s+/);
    while (revealedCount < finalWords.length) {
      appendToken(revealedCount === 0 ? finalWords[revealedCount] : ' ' + finalWords[revealedCount]);
      revealedCount++;
    }

    return result;
  } finally {
    clearTimeout(setupTimeout);
    setPlaying(false);
    audioRef.current = null;
    URL.revokeObjectURL(url);
    audio.removeEventListener('timeupdate', onTimeUpdate);
  }
}
