import {
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react';
import { CalyxaMark } from '@calyxa/ui';
import './Overlay.css';
import type {
  AnswerField,
  Annotation,
  AssessmentItem,
  AssessmentResult,
  OnboardingStatusReplyPayload,
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
  TelemetryEvent,
  TurnMessage,
} from '../types/messages';
import { AnnotationLayer } from './AnnotationLayer';
import { CheckinCard, CheckinFallbackCard, CheckinScan } from './CheckinCard';
import { Composer } from './Composer';
import { Onboarding } from './Onboarding';
import { PingToast } from './PingToast';
import { MILESTONE_KINDS, PIN_TONE, milestoneLine, type MilestoneMeta } from './pings';
import { RecapCard } from './RecapCard';
import { ReframeTool } from './ReframeTool';
import { SectionBloomFrame } from './SectionBloom';
import { TitleBar, type HeaderAccessory, type HeaderChip, type SessionHeader } from './TitleBar';
import { Transcript, latestBoardEquation, tokenizeMathText } from './Transcript';
import { TUTOR_MODES, deriveTutorMode, formatElapsed, stageLabel, type TutorModeKey } from './tutor-modes';
import { prewarmMic, releaseWarmMic, startRecording, type RecordingHandle, type Utterance } from './VoiceController';
import { NOT_SURE_CHIP, buildStickingChips, bloomLine, formatRecapMeta } from './session-flow';
import { createSentenceAccumulator, micStateReducer, wordsDueByTime } from './voice-timing';

// The panel-close signal (Sprint 12 Task 6): dispatched from handleClose
// below so the annotation controller (content/annotations.ts, Task 7) can
// clearAnnotations() -- a dismissed tutor leaves a clean page, the same
// instinct as ephemeral page context. Mirrors the 'calyxa:toggle-panel'
// bridge pattern; this event only ever flows Overlay -> content, never back.
export const PANEL_CLOSED_EVENT = 'calyxa:panel-closed';

// The panel-EXPAND signal (Sprint 14 Task 6, the filed Sprint 13 live-find):
// dispatched below whenever `expanded` transitions to true, regardless of
// how it got there -- a direct pill click never reaches content/index.ts
// any other way (unlike the keyboard shortcut, which content itself
// dispatches 'calyxa:toggle-panel' for). content/index.ts listens for this
// to re-run extractPageContext() + the equation-registry refresh fresh on
// every real open (first time AND every re-expand after a minimize), fixing
// the Sprint 13 mount-time capture bug on SPA pages, and to run the
// opening-scan plausible-problem gate. Mirrors PANEL_CLOSED_EVENT's bridge
// pattern, reversed direction.
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
// drawing them via showTurnAnnotations) specifically so this file can
// compute the per-turn color assignment and Transcript can match
// `target.text` inside `say` -- the resolved DrawInstruction[] the layer
// draws from has already lost that exact text by the time it's dispatched
// as a window event.
export type TurnResult = {
  reply: string;
  pins?: StatusPin[];
  annotations?: Annotation[];
  solutionProgress?: number;
  session?: SessionCompletion;
  // Answer chips (design 8a): the turn's short tap-to-answer options,
  // validated/deduped/capped server-side (envelope.ts) and threaded through
  // additively like everything above. Display-ephemeral: they belong to the
  // LATEST tutor turn only (the `chips` state below), never to the message
  // list and never to the wire history.
  chips?: string[];
  // Multi-part answer fields (design 8d): the turn's labeled per-unknown
  // textbox spec, same additive/ephemeral discipline as `chips` and never
  // present alongside it (the server sends at most one of the two).
  answerFields?: AnswerField[];
};

// Local DISPLAY message type (Sprint 13, ADR-024; widened Sprint 14 Task 7;
// slimmed Sprint 15, ADR-034 -- the per-bubble tag pills are retired, their
// signal folded into the title card's status pins; widened again for
// design-08's milestone markers): the transcript the overlay renders
// carries each assistant bubble's annotations + the deterministic per-turn
// color assignment computed for them (assignAnnotationColors below) --
// both are needed at RENDER time, not just at commit time, since
// Transcript re-renders the whole message list on every change. An entry
// with `milestone` set is a MARKER, not a turn: Transcript renders the
// centered rule row from it (its `content` is the same line, for
// completeness) and stripHistory drops it from the wire outright -- a
// milestone is the session annotating itself, never something the model
// said or should be told it said. The history handed back to onSend is
// stripped to role/content (stripHistory below) -- none of this
// display-ephemeral state ever re-enters the wire request.
export type DisplayMessage = TurnMessage & {
  annotations?: Annotation[];
  annotationColors?: AnnotationColorMap;
  milestone?: MilestoneMeta;
};

// Client-side cap (defence in depth -- the delivery contract is server-side
// too): at most 2 pins SHOWN per turn (ADR-026's delivery cap, kept by
// ADR-034) -- the server may legitimately send more (learning events + a
// move + memory pins); the priority order below decides which two survive.
export const MAX_PINS_PER_TURN = 2;
// How long each ping toast holds the top-center of the header before the
// queue advances (design 8b: "pings hold for 3 seconds, one at a time").
export const PIN_DISPLAY_MS = 3000;

// ---- Pure display logic (exported for the Task 9 vitest/jsdom spec, the
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
// same window defensively, turn-request.ts). Today's history was unbounded up
// to the MAX_MESSAGES=40 abuse ceiling.
export const HISTORY_WINDOW_TURNS = 8;

/**
 * Keeps only the last `maxTurns` user-initiated turns of history (a user
 * message plus the assistant reply that follows it). Windowing by USER turn --
 * not raw message count -- guarantees the slice still BEGINS on a user message,
 * which the Anthropic API requires of the first message in the array. Applied
 * to the already-stripped history (stripHistory above) at each send site, BEFORE
 * the new user turn is appended, so the outbound request carries at most
 * ~`maxTurns` turns of prior context plus the current turn.
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

// ---- The session-start check-in (designated pre-conversation UI, design
// handoff state 05 -- replaces the Sprint 15 KickoffCard; later merged into
// a single confirm screen per Darcy's follow-up ask) ----

// What the opening scan resolves into: the scan's result is HELD here and
// feeds the check-in's confirm card (`topic`, the server's page-detected
// concept). The held `question` never enters the transcript OR the wire
// history as a turn (Darcy's follow-up ask -- no pre-seeded exchange, real
// or fabricated): on confirm it crosses the wire once as the structured
// sessionStart.question field (startSessionTurn below), the server renders
// it into the SESSION START MODE prompt block, and the tutor's first
// message responds directly to the confirmed misconception in it. A
// reframe (5a's "No, other" path) supersedes it with the student's own
// words -- the confirmed detection is dropped, and pageContext still
// grounds every turn.
// Display-ephemeral like the overview/recap: cleared on performClose, never
// persisted. (The server's `prediction` still rides the wire but the
// check-in doesn't render it -- the sticking-point chips are built from
// `stickingCandidates` instead, see buildStickingChips.)
export type HeldScan = {
  question: string;
  topic?: PageTopic;
  // The check-in's sticking-point candidates (design handoff feature): up
  // to 3 of the student's own recorded misconceptions for `topic`'s
  // concept, grounded server-side. The check-in only ever renders once
  // `topic` is present (see showCheckin below), so these always belong to
  // the topic on screen -- no separate topic-match guard needed.
  stickingCandidates?: StickingCandidate[];
  annotations?: Annotation[];
};

// The section-complete congratulation window: the glow holds for exactly 3s
// before the panel hands off to the summary (RecapCard). The cx-bloom-fade
// keyframe eases the glow in and back out within this same window, so the
// hand-off lands as the congratulation recedes.
export const BLOOM_MS = 3000;

// The panel card shell: outside a bloom it is the plain frosted card;
// during one (design 06) the SAME body is wrapped in SectionBloomFrame's
// rotating gradient border + burst ring instead -- the card never swaps
// out, it just lights up. Keeping the body a single `children` means the
// header/transcript/input are declared once and simply re-parented.
function BloomShell({ active, line, children }: { active: boolean; line: string; children: ReactNode }) {
  if (active) {
    return (
      <SectionBloomFrame line={line} durationMs={BLOOM_MS}>
        {children}
      </SectionBloomFrame>
    );
  }
  return (
    <div className="relative overflow-hidden rounded-lg border border-border bg-background/85 shadow-panel backdrop-blur-[18px] backdrop-saturate-[1.5]">
      {children}
    </div>
  );
}

// The check-in's auto-start window (design 5a: "Start session
// auto-proceeds in 5s"): the countdown arms when the check-in renders and
// fires handleCheckinStart unless the student takes the exit first
// ("No, other" -> the 5b reframe tool). The
// button's fill sweep (Overlay.css's cx-fill) reads this same constant, the
// close ring's shared-duration discipline.
export const AUTO_START_MS = 5000;

/**
 * The annotations/annotationColors extras every committed assistant
 * DisplayMessage carries (Sprint 14 Task 7) -- one place for the three
 * commit sites (text, voice, opening scan) so the color assignment is
 * computed the exact same way regardless of which turn kind produced it.
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

// Which pin wins the title card when a turn carries several (ADR-034): the
// rarest, most-earned signals first -- a broken pattern or a confirmed
// prediction is the product's whole thesis landing, a mastery crossing is a
// milestone, the moves are context, and the memory pins are a quiet nod.
// Lower number = shown first. Ties keep the server's own order
// (Array.prototype.sort is stable).
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
 * pattern-broken -- the looser thresholds (concept-understood's first-
 * contact transitions, progress, streak-progress) and the model-declared
 * moves can otherwise fire repeatedly across a long session, and this is
 * the client-side cap that keeps that from reading as spam. `shownPinKeys`
 * is the session-lifetime dedupe set, keyed `${kind}:${conceptKey ?? ''}`
 * (a concept-less move dedupes purely by kind -- once per session) so two
 * DIFFERENT kinds on the SAME concept each still get their own one-time
 * moment; mutated here, reset when a SESSION_RECAP_EVENT arrives (the
 * session is over). pattern-broken stays exempt, unchanged since Sprint 13
 * -- each completed streak is a distinct, real, non-repeating event.
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
 * never persisted). null when there is no baseline for the concept. The
 * floating recap window that rendered these arrows was replaced by the
 * in-panel RecapCard (design 6b), which shows recorded counts instead of
 * deltas -- kept exported (with DELTA_EPSILON and humanizeDue below) since
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

// ---- Sprint 14 Task 7: the solution-progress bar (ADR-028) ----

// "Model-emitted, client-clamped": the server already scores genuine
// reasoning steps and softens a wrong one (system-prompt.ts's SOLUTION
// PROGRESS rubric) -- this is the CLIENT half, a defence-in-depth bound so
// a misbehaving turn can never crater the bar to near-zero in one step,
// and a plain number->number jump never reads as jitter. Exported as a
// pure function for the Task 9 vitest spec (lifecycle.test.ts's "progress
// clamp/easing reducer").
export const PROGRESS_MAX_REGRESSION = 0.15;

/**
 * `solved` forces the bar to exactly 1 regardless of what solutionProgress
 * said this turn (the completion signal and the bar are ONE contract, per
 * the sprint plan -- "solved" IS "fully done", never "very close" rounded
 * up). `next === undefined` means the turn carried no solutionProgress at
 * all (a clarifying question, etc.) -- the bar holds its last value rather
 * than inventing movement. Otherwise: clamp to [0,1] (defence in depth --
 * envelope.ts already did this server-side), then bound a downward move to
 * at most PROGRESS_MAX_REGRESSION so one wrong step costs ground without
 * erasing the whole climb.
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

// The $$ math-block delimiters (Transcript.tsx's splitMathBlocks, Sprint 15
// fix pass) are a committed-bubble rendering instruction only -- every
// surface that consumes the raw `say` text transiently (streaming display
// tokens, the voice word reveal, the text handed to TTS) strips them first.
// Single `$`s are stripped too, not just paired `$$`s, so a delimiter split
// across two stream deltas can't leak half of itself into the reveal or the
// spoken audio.
export function stripMathDelimiters(text: string): string {
  return text.replace(/\$/g, '');
}

export type CloseChoreographyState = 'idle' | 'completing' | 'ringing' | 'closed';
export type CloseChoreographyEvent = 'complete' | 'recap-grace-elapsed' | 'ring-elapsed' | 'reset';

/**
 * idle -> completing (a turn's session.complete just arrived, or the
 * student clicked ✕ -- give the SESSION_ENDED recap broadcast a moment to
 * land) -> ringing (the ~10s green ring sweep) -> closed (Overlay.tsx's own
 * effect performs the actual teardown -- collapse, clear transcript, reset
 * the bar -- then fires 'reset' to return here to idle). A pure reducer
 * (Overlay.tsx drives it with real timers) so Task 9's vitest spec can
 * exercise the transitions with no timers/mocks at all. Any event that
 * doesn't match the current state is a no-op -- e.g. a stray 'ring-elapsed'
 * while still 'completing' (a timer race) changes nothing rather than
 * skipping a step.
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
// nextCloseState reducer + the ring machinery (TitleBar's cx-close-ring) that
// re-enabling auto-close would drive again. They are NOT scheduled anymore:
// beginCloseChoreography parks the panel in 'completing' and stops, so the
// recap never collapses on its own (auto-close disabled -- Darcy's call). Was:
// a RECAP_GRACE_MS head start for the SESSION_ENDED recap broadcast to land,
// then a CLOSE_RING_MS green ring sweep before the panel auto-collapsed.
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
 * DisplayMessage so it's stable across re-renders -- re-running this on
 * every render would still be deterministic for a fixed input, but storing
 * it once avoids recomputing it on every keystroke/re-render for no reason.
 * The SAME map is the one source of truth Transcript's color-linked
 * highlighting reads today; AnnotationLayer reads it too once Task 8 gives
 * that component a prop for it.
 */
export function assignAnnotationColors(annotations: Annotation[] | undefined): AnnotationColorMap {
  const map: AnnotationColorMap = {};
  (annotations ?? []).forEach((annotation, index) => {
    map[annotation.id] = ANNOTATION_COLOR_SLOTS[index % ANNOTATION_COLOR_SLOTS.length];
  });
  return map;
}

// (The Sprint 14 tag/ping kind->color maps lived here; ADR-034 retired both
// surfaces -- the design-08 redesign maps each pin KIND onto one of three
// toast tones instead, pings.ts's PIN_TONE.)

/**
 * The forward look's humanized due phrasing ("comes back Thursday", Task 8
 * spec). The dates ARE the FSRS schedule (ADR-026) -- only the phrasing is
 * client-side. `now` is injectable for the Task 9 spec.
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

// Calyxa overlay — Sprint 10 Task 6 (chat UI + real streaming + voice text sync).
//
// Layout (expanded):
//   header     — CalyxaMark + "Calyxa" + badge (or "Speaking" + interrupt)
//   chat area  — ONLY rendered when there is content; absent when empty so the
//                panel collapses to header + input row with no gap.
//   input row  — text input + mic + send
//
// Sprint 14 Task 2: the pieces of that layout now live in their own
// files (TitleBar, Composer, Transcript; Sprint 15's ADR-034 unified the
// transient signals into the status pins, and the design-08 redesign
// renders them as the PingToast over the header, with the tutor mode --
// tutor-modes.ts -- as the session identity) -- presentational components
// that take props/callbacks. Overlay.tsx keeps every state hook, effect,
// and handler (moved, not rewritten) and is the composition root that
// wires them together.
//
// Text turns: `onSend` receives an `onChunk` callback; each arriving token
// appends to `streamingContent`, which renders as a pending assistant bubble
// with a blinking cursor. On resolve, the full reply commits to `messages`
// and `streamingContent` clears.
//
// Voice turns: `onSend` is called without `onChunk` (TTS needs the full
// string). Once the audio is synthesised, `playAudioWithTextReveal` plays it
// while simultaneously revealing the reply word-by-word at a rate matched to
// the audio duration, so the text tracks the speech. The reply is committed
// to `messages` only after playback ends (or is interrupted).
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
  onFetchOnboardingStatus,
  onSubmitOnboarding,
  onGetActiveSessionId,
}: {
  // `sessionStart` rides ONLY the session's first turn (the check-in
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
  // generated (the ~4-5s turn leg the latency probe found). Resolves the SAME
  // TurnResult as onSend. onSend (buffered) is KEPT as the fallback the voice
  // path drops to on any streaming failure.
  onSendVoiceStreaming: (messages: TurnMessage[], onSayDelta: (text: string) => void) => Promise<TurnResult>;
  onTranscribe: (audio: Utterance) => Promise<{ transcript: string; sttMs: number }>;
  onSynthesize: (text: string) => Promise<{ audio: ArrayBuffer; ttsMs: number }>;
  // Task 6 (ADR-033): the streaming sibling of onSynthesize. handleMicStop
  // tries this first (MediaSource progressive playback -- audio starts at
  // the first buffered chunk instead of waiting for the whole reply); on a
  // MediaSource/codec failure for THIS utterance it falls back to
  // onSynthesize's buffered path, seamlessly (the buffered fallback is
  // first-class, not a degraded mode).
  onSynthesizeStream: (text: string, onChunk: (chunk: Uint8Array) => void) => Promise<{ ttsMs: number }>;
  // Called once synthesized speech actually starts playing, with its known
  // duration in ms -- content/index.ts uses this to reveal the turn's
  // annotations sequenced to playback instead of all at once (voice-mode
  // sub-term sequencing, Sprint 12 follow-up). Overlay itself does nothing
  // with annotations -- it just reports the moment/duration, same as every
  // other chrome.*-free callback here.
  onVoicePlaybackStart: (durationMs: number) => void;
  // Sprint 13 (ADR-025): sends the existing END_SESSION message -- the same
  // handler, RPC, and storage-clear the popup uses, no parallel path. The
  // recap does not come back through this promise -- it arrives via the
  // SESSION_ENDED broadcast so a popup-triggered end renders identically.
  onEndSession: () => Promise<void>;
  // Sprint 14 Task 6/7 (ADR-030): the proactive opening scan. Called on
  // panel expand while there are no messages yet -- content/index.ts runs
  // its own plausible-problem gate first and resolves
  // null when there's nothing to scan, the call failed, or the model found
  // nothing confident to say; a non-null result renders as the first
  // assistant bubble, no preceding student message. chrome.*-free, like
  // every prop here -- content/index.ts owns the OPENING_SCAN message and
  // drawing any annotations it carries; `annotations` also rides the
  // resolved result (Task 7) so this file can color-link the first bubble
  // exactly like every other turn. The check-in (design 05) routes the
  // result into the confirm card instead of a first transcript bubble;
  // `topic` is the server's page-detected concept that card names, and
  // `stickingCandidates` (also grounded server-side) feeds the pre-selected,
  // personalized top-3 chips (session-flow.ts's buildStickingChips).
  // `prediction` still rides the wire (predictLikelyStruggle, the
  // session-kickoff feature) but the check-in doesn't render it.
  onOpeningScan: () => Promise<{
    reply: string;
    annotations?: Annotation[];
    prediction?: StrugglePrediction;
    topic?: PageTopic;
    stickingCandidates?: StickingCandidate[];
  } | null>;
  // Sprint 17 Task 6 (ADR-043): fire-and-forget telemetry. Optional (a test
  // harness or a mount that predates this wiring can omit it); this file
  // only ever calls it once, on a real onboarding completion (never on skip).
  onSendTelemetry?: (events: TelemetryEvent[]) => Promise<void>;
  // Sprint 17 Task 6 (ADR-039): the feedback-affordance transport (Task 7's
  // TitleBar report/rate control). Rejects on a save failure so the popover
  // can surface a retry.
  onReportFeedback?: (payload: SendFeedbackPayload) => Promise<void>;
  // Sprint 17 Task 7 (ADR-042): the cold-start onboarding transports. Both
  // optional for the same reason as onSendTelemetry above.
  onFetchOnboardingStatus?: () => Promise<OnboardingStatusReplyPayload>;
  onSubmitOnboarding?: (results: AssessmentResult[]) => Promise<{ seededCount: number }>;
  // The feedback affordance's sessionId lookup (Task 7, ADR-039) -- read
  // fresh at submit time (handleFeedbackSubmit below), never cached.
  onGetActiveSessionId?: () => Promise<string | undefined>;
}) {
  const [expanded, setExpanded] = useState(false);
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
  // failure (ADR-033 Task 5; the reducer itself is pure and pinned by
  // voice-timing.test.ts, Task 8). `connecting` flips true SYNCHRONOUSLY on
  // mic click (the UI-ack budget, ≤100ms -- trivially met since dispatch is
  // a plain state update in the same handler tick); `recording` and
  // `connecting` are never true at once -- the composer renders one honest
  // state at a time: idle -> connecting -> listening.
  const [micState, dispatchMic] = useReducer(micStateReducer, 'idle' as const);
  const recording = micState === 'recording';
  const connecting = micState === 'connecting';
  const [playing, setPlaying] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [level, setLevel] = useState(0);

  const recordingRef = useRef<RecordingHandle | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const levelFrameRef = useRef<number | null>(null);
  const startingRef = useRef(false);
  const chatEndRef = useRef<HTMLDivElement | null>(null);
  const inputElRef = useRef<HTMLInputElement | null>(null);
  const measureElRef = useRef<HTMLSpanElement | null>(null);
  const speechRecRef = useRef<{ stop: () => void } | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  // Drag origin is a ref (not state) so the move handler never stales.
  const dragOriginRef = useRef<{ mouseX: number; mouseY: number; elemX: number; elemY: number } | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [dragPos, setDragPos] = useState<{ x: number; y: number } | null>(null);
  const [inputFocused, setInputFocused] = useState(false);
  const [caretLeft, setCaretLeft] = useState(0);
  // Idle pill starts as bare shape (no logo/text/dot, Wispr-Flow-style) and
  // only reveals that content on hover/focus; a plain click still opens the
  // full panel directly, so touch/keyboard users never need the peek step.
  const [pillHovered, setPillHovered] = useState(false);
  // Live interim transcript from SpeechRecognition, shown word-by-word during
  // recording. Kept non-empty until the accurate Whisper result is committed,
  // so there is no gap between "user stops speaking" and "message appears".
  const [liveTranscript, setLiveTranscript] = useState('');
  // The CURRENT turn's answer chips (design 8a): set when a tutor turn
  // commits carrying options, replaced wholesale by the next turn (a turn
  // with none clears them -- chips only ever belong to the LATEST tutor
  // line), and cleared the moment ANY student answer commits (tap, typed, or
  // voice), matching the prototype's hide-on-pick. Display-ephemeral: never
  // enters `messages` and stripHistory never sees it.
  const [chips, setChips] = useState<string[] | null>(null);
  // The CURRENT turn's multi-part answer fields (design 8d): same lifecycle as
  // `chips` above -- set when a tutor turn commits carrying fields, replaced
  // wholesale by the next turn, and cleared the moment any student answer
  // commits. Never present alongside `chips` (the server sends at most one),
  // and equally display-ephemeral: the labeled boxes are an INPUT convenience,
  // their filled values commit as one ordinary student turn, so nothing here
  // ever enters `messages` or the wire history.
  const [answerFields, setAnswerFields] = useState<AnswerField[] | null>(null);

  // ---- Sprint 13 profile-visibility state (all display-ephemeral, ADR-024) ----
  // The session recap, set by SESSION_RECAP_EVENT and discarded on panel
  // close / the next sent message (shown once, ADR-025). Renders as the
  // in-panel terminal state (RecapCard, design 6b); recapMeta is the header's
  // "18 min · 5 problems" line, computed once at arrival so it doesn't
  // re-derive on every render.
  const [recap, setRecap] = useState<SessionRecap | null>(null);
  const [recapMeta, setRecapMeta] = useState<string | null>(null);
  // The held opening-scan result (see HeldScan above): non-null from a
  // confident opening scan until the conversation starts or the panel
  // closes. Survives a minimize the same way messages do -- the scan won't
  // re-fire into an already-active session, so the held question IS that
  // session's opener.
  const [scan, setScan] = useState<HeldScan | null>(null);
  // The check-in flow (design 05, merged into one confirm screen): the
  // scanned topic and the pre-selected sticking point. Both are set the
  // moment the opening scan lands (see the opening-scan effect below) so
  // the confirm card renders already-selected, per Darcy's ask -- the
  // student only has to tap once to start. All display-ephemeral; the
  // answers reach the model only through the session-start turn
  // (buildSessionStartMessage) -- never a new wire field.
  const [checkinTopic, setCheckinTopic] = useState<string | null>(null);
  const [stickingPoint, setStickingPoint] = useState<string | null>(null);
  // The opening scan's in-flight window (design 5a's scanning state): true
  // from the moment the scan fires until it resolves either way -- the
  // panel body shows the orb + "Reading the page…" line and the header the
  // pulsing "Scanning" chip only inside this window.
  const [scanPending, setScanPending] = useState(false);
  // Whether the opening scan has actually RUN and settled this open (Sprint
  // 19 no-detection fallback fix): distinct from `!scanPending`, which is also true in the
  // window BEFORE the scan fires. The no-detection fallback (showCheckinFallback
  // below) keys on this so it never flashes in that pre-scan gap -- it only
  // appears once a scan has genuinely finished without naming a topic. Reset
  // when the panel collapses (the scan effect's `!expanded` branch).
  const [scanSettled, setScanSettled] = useState(false);
  // The 5b reframe tool: while open, the whole panel yields to the crop
  // layer; Back returns to the check-in, Start session fires the kickoff
  // turn with the student's own framing (startSessionTurn).
  const [reframeOpen, setReframeOpen] = useState(false);
  // The session-start kickoff (check-in confirm / reframe start): true from
  // the moment the first turn fires. That turn carries NO student message
  // (the confirmation travels as the structured sessionStart field), so
  // this -- not a user turn in the transcript -- is what flips the panel
  // into its live-session state on that path. Reset if the kickoff turn
  // fails (the composer takes over) and in performClose.
  const [kickoffStarted, setKickoffStarted] = useState(false);
  // The 5a auto-start countdown's arm state: disarmed the moment the
  // student takes any manual exit, so the session can never start under
  // them while they're correcting the prediction. Re-armed with the rest of
  // the check-in state in performClose.
  const [autoStartArmed, setAutoStartArmed] = useState(true);
  // When the conversation actually started (the first committed student
  // turn) -- the recap meta's duration baseline. A ref: read only at recap
  // arrival.
  const sessionStartRef = useRef<number | null>(null);
  // The ping queue (ADR-034; design-08 moves the surface): FIFO of the pins
  // that survived filterPinsForDisplay, shown ONE at a time as the toast
  // dropping into the top-center of the header (PingToast) for
  // PIN_DISPLAY_MS each (the advance effect below), plus the session-
  // lifetime kind:concept dedupe set (cleared when the session ends).
  const [pinQueue, setPinQueue] = useState<{ id: number; pin: StatusPin }[]>([]);
  const pinIdRef = useRef(0);
  const shownPinKeysRef = useRef<Set<string>>(new Set());
  // The live tutor mode (design 8c): derived client-side per turn from the
  // turn's own signals (tutor-modes.ts's deriveTutorMode) -- the header
  // identity recolors on every switch. Reset to Explore with the panel.
  const [tutorMode, setTutorMode] = useState<TutorModeKey>('explore');
  // Consecutive turns whose eased progress moved DOWN (a wrong step) --
  // deriveTutorMode's "two misses in a row" input. A ref: read/written only
  // at commit time (turns are serialized by `busy`).
  const missStreakRef = useRef(0);
  // The header clock (design 8a): elapsed m:ss since the first committed
  // student turn, ticked by the interval effect below.
  const [clockLabel, setClockLabel] = useState('0:00');
  // The client-derived final-step pin's once-per-problem latch (reset with
  // the progress bar in performClose).
  const finalStepFiredRef = useRef(false);
  // Mirror of solutionProgress for commit-time reads (applyProgressAndCompletion
  // computes the eased value once, uses it for the final-step threshold, and
  // sets state from it -- turns are serialized by `busy`, so this never races).
  const progressRef = useRef(0);
  const [ending, setEnding] = useState(false);

  // ---- Sprint 14 Task 7 state (ADR-027/028) ----
  // The solution-progress bar's CURRENT (eased/clamped) value -- see
  // easeProgress above. Reset to 0 once the close choreography actually
  // finishes (finishCloseChoreography below), same lifetime as the
  // transcript it describes.
  const [solutionProgress, setSolutionProgress] = useState(0);
  // The CURRENT turn's annotation-color assignment (Sprint 14 Task 8): the
  // same map assignAnnotationColors computed for the just-committed
  // DisplayMessage (assistantMessageExtras), held separately so it can be
  // handed to AnnotationLayer as a prop -- content/annotations.ts's active
  // draw list can be a REORDERED SUBSET of the turn's raw annotations (an
  // unresolvable target is dropped, per ADR-022's drop-don't-guess), so
  // AnnotationLayer recomputing its own order-based assignment from its own
  // (possibly-reduced) draw list would risk a DIFFERENT slot than the one
  // Transcript already committed for the same id. Passing the one map
  // computed here keyed by annotation id sidesteps that entirely -- one
  // source of truth, exactly as Task 7's own comment on
  // assignAnnotationColors anticipated ("AnnotationLayer reads it too once
  // Task 8 gives that component a prop for it").
  const [annotationColors, setAnnotationColors] = useState<AnnotationColorMap>({});
  // The close-choreography state machine (nextCloseState above) + the
  // pending grace/ring timers driving it, so they can be cleared on unmount
  // or if a fresh minimize/expand races them.
  const [closeState, setCloseState] = useState<CloseChoreographyState>('idle');
  // The section-complete congratulation (design 06): non-null for BLOOM_MS
  // from the moment a turn arrives with session.complete + reason "solved"
  // -- the panel's own frame lights up with the rotating gradient glow
  // (SectionBloomFrame) while the card stays readable, then hands off to the
  // summary. Only the solved close earns it; a follow-up-declined/corrected
  // close (and a manual ✕) closes plain.
  const [bloom, setBloom] = useState<{ line: string } | null>(null);
  const bloomTimerRef = useRef<number | null>(null);
  // The section-complete → summary hand-off: the recap (SESSION_ENDED) fires
  // as soon as the completing turn ends server-side, which can beat the ~3s
  // congratulation glow. When it lands mid-bloom it parks HERE instead of
  // switching the panel straight to the summary; the bloom timer applies it
  // the instant the congratulation finishes, so the sequence is always
  // congratulation (3s) → summary, never a summary that pops up under the
  // glow. { recap: null } is a real value (a recap-less end), so absence is
  // the null ref, not a null recap.
  const pendingRecapRef = useRef<{ recap: SessionRecap | null; meta: string | null } | null>(null);
  const closeTimersRef = useRef<number[]>([]);
  // The manual-end confirm dialog (Sprint 14 fix pass): clicking ✕ opens this
  // instead of ending immediately -- ending discards the live session, so it
  // asks first. Distinct from the automatic close: a confirmed manual end
  // skips the ring entirely (the ring is only for Calyxa's own "session over"
  // detection).
  const [showEndConfirm, setShowEndConfirm] = useState(false);

  // ---- Sprint 17 Task 7 state (ADR-042) ----
  // Cold-start onboarding. Checked ONCE per page load (onboardingCheckedRef
  // never resets, unlike the opening-scan's own ref below which re-arms on
  // collapse) -- this is "does this account need it", not "does this page
  // need it", so a re-open must never re-ask mid-page-load.
  // `onboardingItems` non-null is the render gate (showOnboarding below);
  // `onboardingResolved` gates the opening-scan effect until the check has
  // settled either way, so a brand-new user always sees the assessment
  // FIRST, never a live-calibrating scan racing it.
  const [onboardingItems, setOnboardingItems] = useState<AssessmentItem[] | null>(null);
  const [onboardingResolved, setOnboardingResolved] = useState(false);
  const onboardingCheckedRef = useRef(false);

  function clearCloseTimers() {
    for (const timer of closeTimersRef.current) window.clearTimeout(timer);
    closeTimersRef.current = [];
  }

  // The conversation is live once EITHER a student turn exists (a typed or
  // voice start) OR the kickoff fired (the check-in confirm path, which
  // produces no student turn at all). Gates the check-in, the session
  // header identity, the clock, and the board strip.
  const sessionLive = kickoffStarted || messages.some((message) => message.role === 'user');

  // The onboarding assessment (Sprint 17 Task 7, ADR-042): takes priority
  // over the check-in/scanning/composer -- a brand-new user answers this
  // ONCE before anything else. Yields the same way showCheckin does once a
  // session actually starts, a recap arrives, or the close choreography
  // begins.
  const showOnboarding = !!onboardingItems && !sessionLive && !recap && closeState === 'idle';

  // The check-in (design 5a, "one prediction, not a menu") shows until the
  // conversation starts. It only renders once the opening scan has
  // actually detected a topic (scan.topic) -- there is no more manual
  // topic entry, so with nothing detected the composer takes over
  // directly. It yields while a voice turn is in flight
  // (recording/connecting/liveTranscript/busy) and during the close
  // choreography/recap, both terminal.
  const showCheckin =
    !sessionLive &&
    !recap &&
    !busy &&
    !recording &&
    !connecting &&
    !liveTranscript &&
    closeState === 'idle' &&
    !!scan?.topic;

  // The 5a scanning body: only while the opening scan is genuinely in
  // flight and nothing else has claimed the panel (a voice turn started
  // mid-scan, a recap, the close choreography).
  const showScanning =
    scanPending &&
    !sessionLive &&
    !recap &&
    !busy &&
    !recording &&
    !connecting &&
    !liveTranscript &&
    closeState === 'idle' &&
    !showCheckin;

  // The no-detection fallback (Sprint 19): the opening scan finished
  // but named no topic -- either it resolved null (nothing plausible, the
  // request failed, or the model wasn't confident) or it returned a reply
  // without a structured topic to build the check-in from. Rather than drop
  // straight to the bare composer (the old behavior, which hid the whole
  // starting screen when "no obvious question is on the page"), we surface a
  // starting card that routes into the SAME screen-capture reframe tool the
  // check-in's "No, other" uses -- the student frames the exact spot
  // themselves -- with the composer still available below to just type.
  // Keyed on scanSettled (not merely !scanPending) so it never flashes in the
  // pre-scan window; the check-in (topic detected) always wins over it.
  const showCheckinFallback =
    scanSettled &&
    !scan?.topic &&
    !sessionLive &&
    !recap &&
    !busy &&
    !recording &&
    !connecting &&
    !liveTranscript &&
    closeState === 'idle' &&
    !showOnboarding &&
    !showCheckin;

  // The pre-session header chip (design 5a): "Scanning" with the pulsing
  // dot while the scan runs, "New session" while the check-in card (or the
  // no-detection fallback card) is up.
  const headerChip: HeaderChip | null = showScanning
    ? { label: 'Scanning', pulsing: true }
    : showCheckin || showCheckinFallback
      ? { label: 'New session', pulsing: false }
      : null;

  // True whenever the chat area should be rendered (no gap when empty).
  // The recap no longer rides this -- it renders as its own in-panel
  // terminal card (RecapCard, design 6b), replacing the chat area outright.
  const hasContent = messages.length > 0 || busy || !!notice || !!liveTranscript;

  // The header's right-side state slot (design's shared panel header): the
  // recap's muted meta, or null hands the header back to the live-
  // conversation treatments (Listening/Speaking) or the check-in's own
  // card (which has no header accessory now that it's a single screen).
  const headerAccessory: HeaderAccessory | null = recap ? { meta: recapMeta ?? '' } : null;

  // The live-session header identity (design 8c): the tutor mode takes the
  // logo's place from the first committed student turn until the recap's
  // terminal card (which returns the wordmark + its meta accessory). The
  // subtitle carries the topic (check-in confirmed, else the scan's own
  // detection) and the live stage label; the clock ticks alongside.
  const sessionActive = sessionLive && !recap;
  const topicTitle = checkinTopic ?? scan?.topic?.title ?? null;
  const stage = stageLabel(solutionProgress, closeState !== 'idle');
  const sessionHeader: SessionHeader | null = sessionActive
    ? {
        modeKey: tutorMode,
        modeName: TUTOR_MODES[tutorMode].name,
        modeGlyph: TUTOR_MODES[tutorMode].glyph,
        subtitle: topicTitle ? `${topicTitle} · ${stage}` : stage,
        clock: clockLabel,
      }
    : null;

  // The board strip's pinned equation (design 8a): the most recent $$ math
  // block the tutor put up -- pure derivation from the transcript, no new
  // state or wire field. Null (no equation yet) renders no strip.
  const boardEquation = useMemo(() => latestBoardEquation(messages), [messages]);

  function appendStreamToken(text: string) {
    // Strip the $$ math-block delimiters from the transient stream/reveal
    // tokens -- the committed bubble re-renders from the full reply, where
    // Transcript.tsx turns them into centered math blocks.
    const cleaned = stripMathDelimiters(text);
    if (!cleaned) return;
    const id = tokenIdRef.current++;
    setStreamingTokens((prev) => [...prev, { text: cleaned, id }]);
  }

  function clearStreamTokens() {
    setStreamingTokens([]);
  }

  function refreshCaret() {
    requestAnimationFrame(() => {
      const el = inputElRef.current;
      const measureEl = measureElRef.current;
      if (!el || !measureEl) return;
      const pos = el.selectionStart ?? el.value.length;
      measureEl.textContent = el.value.slice(0, pos);
      setCaretLeft(Math.max(0, measureEl.getBoundingClientRect().width - el.scrollLeft));
    });
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
      clearCloseTimers();
      if (bloomTimerRef.current !== null) window.clearTimeout(bloomTimerRef.current);
    };
  }, []);

  // Queues a turn's pins through the gate (priority + cap + dedupe). Called
  // at `done` for text turns (the promise resolve) and at reply-delivered
  // for voice turns (see handleMicStop) -- the advance effect below then
  // walks the queue one toast at a time. Milestone-worthy pins (pings.ts's
  // MILESTONE_KINDS) ALSO settle into the transcript as marker rows at the
  // same moment, so the signal stays readable after the toast fades
  // (design 8b: "wins and resolved patterns also settle into the
  // transcript"). Markers are display-only -- stripHistory drops them.
  function showPins(pins: StatusPin[] | undefined) {
    const shown = filterPinsForDisplay(pins, shownPinKeysRef.current);
    if (shown.length === 0) return;
    setPinQueue((prev) => [...prev, ...shown.map((pin) => ({ id: pinIdRef.current++, pin }))]);
    const milestones = shown.filter((pin) => MILESTONE_KINDS.has(pin.kind));
    if (milestones.length > 0) {
      setMessages((current) => [
        ...current,
        ...milestones.map((pin): DisplayMessage => {
          const line = milestoneLine(pin);
          return {
            role: 'assistant',
            content: line,
            milestone: { kind: pin.kind, tone: PIN_TONE[pin.kind], line },
          };
        }),
      ]);
    }
  }

  // The queue's advance clock: whichever pin is at the head holds the title
  // card for PIN_DISPLAY_MS, then the queue shifts (and, once empty, the
  // wordmark returns). Keyed on the head's id so a new head -- whether from
  // a shift or a fresh enqueue into an empty queue -- restarts the window,
  // and the effect cleanup clears the pending timer on unmount/close.
  const activePinId = pinQueue.length > 0 ? pinQueue[0].id : null;
  useEffect(() => {
    if (activePinId === null) return;
    const timer = window.setTimeout(() => {
      setPinQueue((prev) => prev.slice(1));
    }, PIN_DISPLAY_MS);
    return () => window.clearTimeout(timer);
  }, [activePinId]);

  // The header clock's tick (design 8a): once a session is live, the m:ss
  // label updates every second from the same baseline the recap meta uses
  // (sessionStartRef, the first committed student turn). Paused while
  // minimized -- the label catches back up on the first tick after
  // re-expand.
  useEffect(() => {
    if (!expanded || !sessionLive || recap) return;
    const tick = () => {
      if (sessionStartRef.current !== null) {
        setClockLabel(formatElapsed(Date.now() - sessionStartRef.current));
      }
    };
    tick();
    const interval = window.setInterval(tick, 1000);
    return () => window.clearInterval(interval);
  }, [expanded, sessionLive, recap]);

  // Enters the terminal "ending" state on a turn's session.complete: parks
  // the panel in 'completing' and STOPS there. AUTO-CLOSE IS DISABLED (Darcy's
  // call): the post-session recap (design 7b) is a screen the student dismisses
  // themselves via "Complete session" (handleRecapDone) -- it never collapses
  // out from under them. The old choreography timed a ~10s green ring sweep
  // (RECAP_GRACE_MS -> ringing -> CLOSE_RING_MS -> closed) and then tore the
  // panel down automatically; those timers are gone, so 'ringing'/'closed' are
  // no longer reached and the ring never sweeps. The nextCloseState reducer and
  // the 'closed' teardown effect are left intact (pure, tested, and the single
  // place re-enabling auto-close would hook back into) but simply not driven
  // here anymore. A no-op if already ending -- 'complete' only advances from
  // 'idle' -- so a stray second signal changes nothing.
  function beginCloseChoreography() {
    setCloseState((prev) => nextCloseState(prev, 'complete'));
  }

  // The choreography's actual teardown (Sprint 14 Task 7): fires exactly
  // once, when closeState reaches 'closed' -- collapse to the pill, clear
  // the transcript, reset the progress bar, drop the recap, and dispatch
  // PANEL_CLOSED_EVENT for the annotation controller, same as a manual
  // minimize. Then resets the
  // state machine back to idle for the next problem. Minimizing (−) never
  // reaches this path -- it stays handleMinimize below, unchanged from the
  // old handleClose.
  useEffect(() => {
    if (closeState !== 'closed') return;
    performClose();
    setCloseState((prev) => nextCloseState(prev, 'reset'));
    // performClose is a stable in-component helper (only calls setters +
    // dispatches an event); intentionally not a dep, same convention as the
    // other effects here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [closeState]);

  // The panel teardown itself (Sprint 14 Task 7 + fix pass): collapse to the
  // pill, clear the transcript, reset the progress bar, drop the recap, and
  // dispatch PANEL_CLOSED_EVENT for the annotation controller. Shared by TWO
  // paths: the automatic close choreography's final
  // step (after the green ring sweep) AND a confirmed manual ✕ end, which
  // runs this DIRECTLY with no ring (handleEndSessionConfirmed below).
  function performClose() {
    setExpanded(false);
    setMessages([]);
    setChips(null);
    setSolutionProgress(0);
    progressRef.current = 0;
    finalStepFiredRef.current = false;
    missStreakRef.current = 0;
    setTutorMode('explore');
    setClockLabel('0:00');
    setPinQueue([]);
    setAnnotationColors({});
    setRecap(null);
    setRecapMeta(null);
    setScan(null);
    // The check-in resets for the next problem -- a fresh open asks fresh.
    setCheckinTopic(null);
    setStickingPoint(null);
    setScanPending(false);
    setScanSettled(false);
    setReframeOpen(false);
    setAutoStartArmed(true);
    setKickoffStarted(false);
    sessionStartRef.current = null;
    // The bloom is transient (~3s) and usually gone long before the ring
    // finishes; clear it anyway so a manual end can't strand one.
    if (bloomTimerRef.current !== null) window.clearTimeout(bloomTimerRef.current);
    bloomTimerRef.current = null;
    pendingRecapRef.current = null;
    setBloom(null);
    setDragPos(null);
    setIsDragging(false);
    dragOriginRef.current = null;
    window.dispatchEvent(new CustomEvent(PANEL_CLOSED_EVENT));
  }

  // The panel-EXPAND signal (Sprint 14 Task 6): fires on EVERY transition to
  // expanded, regardless of message count -- content/index.ts's listener
  // re-captures PageContext fresh (first open AND every re-expand after a
  // minimize) so annotation targeting never runs against a stale capture.
  // Declared BEFORE the effects below so React runs it first within this
  // same commit: onOpeningScan (below) reads content/index.ts's freshly
  // captured PageContext, and that capture happens synchronously inside
  // this event's listener.
  useEffect(() => {
    if (!expanded) return;
    window.dispatchEvent(new CustomEvent(PANEL_EXPANDED_EVENT));
  }, [expanded]);

  // Mic pre-warm (Sprint 19 Task 8, ADR-033 amendment): while the panel is
  // open, hold a warm getUserMedia stream so the first (and every) voice turn
  // starts capturing in <500ms instead of the ~5s cold start. Guarded to fire
  // ONLY when mic permission is ALREADY granted -- opening the panel must never
  // trigger a permission prompt for a text-only or first-time user; the first
  // real mic click still prompts exactly as before, and after that grant the
  // stream stays warm for the rest of the session. Fully best-effort: a missing
  // Permissions API, a rejected query, a denied/absent mic -- all silently
  // no-op (prewarmMic never throws). The warm stream is RELEASED in this
  // effect's cleanup, which runs on collapse (expanded -> false) and on
  // unmount, so the mic (and its browser indicator) is only held while the
  // panel is actually open.
  useEffect(() => {
    if (!expanded) return;
    let cancelled = false;
    void (async () => {
      try {
        const perms = (navigator as Navigator & { permissions?: Permissions }).permissions;
        if (!perms?.query) return; // can't check without risking a prompt -- skip
        const status = await perms.query({ name: 'microphone' as PermissionName });
        if (cancelled || status.state !== 'granted') return;
        await prewarmMic();
      } catch {
        // Some browsers reject a 'microphone' permission query outright -- skip
        // pre-warm rather than risk a prompt; the mic-click path is unaffected.
      }
    })();
    return () => {
      cancelled = true;
      releaseWarmMic();
    };
  }, [expanded]);

  // The cold-start onboarding status check (Sprint 17 Task 7, ADR-042):
  // fires on the FIRST real expand only (onboardingCheckedRef never resets --
  // a genuine re-expand does not re-check, unlike the opening scan's own ref
  // below). Degrades to "not needed" on any failure or if the transport is
  // unwired at all (a test harness, or a mount that predates this wiring) --
  // never blocking the panel. `onboardingResolved` flips true either way, so
  // the opening-scan effect below (which must never race a not-yet-decided
  // onboarding gate) knows when it's safe to proceed.
  useEffect(() => {
    if (!expanded || onboardingCheckedRef.current) return;
    onboardingCheckedRef.current = true;
    if (!onFetchOnboardingStatus) {
      setOnboardingResolved(true);
      return;
    }
    let cancelled = false;
    onFetchOnboardingStatus()
      .then((status) => {
        if (cancelled) return;
        if (status.needed && status.items.length > 0) setOnboardingItems(status.items);
      })
      .catch(() => {
        // Degrade silently -- treated as not-needed, same posture as the
        // opening scan's own catch below.
      })
      .finally(() => {
        if (!cancelled) setOnboardingResolved(true);
      });
    return () => {
      cancelled = true;
    };
    // Deliberately fires at most once per page load; onFetchOnboardingStatus
    // is a stable prop, same convention as the other effects here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded]);

  // Dismisses the onboarding gate WITHOUT ever calling onSubmitOnboarding --
  // the plan's "skipping just leaves the profile empty and the tutor
  // calibrates live exactly as today" fallback. Client-side only for this
  // page's lifetime: onboarding_completed_at is never written, so a fresh
  // page load offers it again (no persisted "don't ask again").
  function handleOnboardingSkip() {
    setOnboardingItems(null);
  }

  // Fired ONLY on a real completion (never on skip, per ADR-043's "not on
  // skip -- a skip is simply the absence of this event"). onSendTelemetry is
  // fire-and-forget and optional; a missing transport just means no event.
  function handleOnboardingComplete(info: { itemCount: number; ms: number }) {
    setOnboardingItems(null);
    void onSendTelemetry?.([{ kind: 'onboarding_completed', itemCount: info.itemCount, ms: info.ms }]);
  }

  // The report/rate affordance's submit (Sprint 17 Task 7, ADR-039): looks up
  // the CURRENT active sessionId fresh (never cached -- a session can start
  // or end at any point in the panel's lifetime) and attaches it when one is
  // active, per the plan's "wired to the current sessionId when one is
  // active". Rethrows on failure so TitleBar's popover can show its own
  // retry state; a missing onReportFeedback transport (a test harness, or a
  // mount that predates this wiring) rejects the same way.
  async function handleFeedbackSubmit(payload: {
    kind: 'bug' | 'rating' | 'idea';
    rating?: number;
    message?: string;
  }): Promise<void> {
    if (!onReportFeedback) throw new Error('feedback unavailable');
    const sessionId = await onGetActiveSessionId?.();
    await onReportFeedback({ ...payload, ...(sessionId ? { sessionId } : {}) });
  }

  // Guards the opening scan (below) against React StrictMode's dev-only
  // double-invoke of effects (mount -> cleanup -> mount again, same
  // `expanded` value). onOpeningScan triggers a real, billable
  // api.startSession -- a duplicate there is a real session/quota bug, not
  // a cosmetic one, so unlike that effect this one needs an explicit
  // in-flight guard. Reset only when the panel actually closes (the effect
  // body's own `!expanded` branch, not the cleanup function, which also
  // runs on StrictMode's simulated remount and would otherwise defeat the
  // guard) -- a genuine re-expand after a minimize is still free to try again.
  const openingScanFiredRef = useRef(false);

  // The proactive opening scan (Sprint 14 Task 6, ADR-030): fires while
  // "expanded, and no conversation yet" -- since it is itself the session
  // start and must never fire a second time once a conversation exists. A
  // null result (the content script's plausible-problem gate found nothing,
  // the call failed, or the model declined to name a problem) renders
  // nothing, the empty state. A real result appends the FIRST assistant
  // bubble with no preceding student message -- the opening scan's whole
  // point.
  useEffect(() => {
    if (!expanded) {
      openingScanFiredRef.current = false;
      // A fresh open re-runs the scan, so the no-detection fallback must not
      // survive the collapse -- clear its "a scan settled without a topic"
      // signal here (the panel re-arms on the next expand).
      setScanSettled(false);
      return;
    }
    if (messages.length > 0) return;
    if (openingScanFiredRef.current) return;
    // Sprint 17 Task 7 (ADR-042): never race the onboarding gate -- wait
    // until the status check has settled, and never fire at all while
    // onboarding is actually showing (a completion/skip clears
    // onboardingItems, which re-runs this effect via the dependency below).
    if (!onboardingResolved || onboardingItems) return;
    openingScanFiredRef.current = true;
    let cancelled = false;
    // The 5a scanning state holds the panel body for exactly this window.
    setScanPending(true);
    onOpeningScan()
      .then((result) => {
        if (cancelled || !result) return;
        // The scan's result feeds the check-in, NOT a first transcript
        // bubble: `topic` becomes the confirm card's "spotted on this page"
        // display, and the held question (with its tags/annotations) enters
        // the transcript + wire history when the conversation actually
        // starts (takeScanPrefix below). The on-page annotation draw
        // already happened in content/index.ts, unchanged.
        setScan({
          question: result.reply,
          ...(result.topic ? { topic: result.topic } : {}),
          ...(result.stickingCandidates && result.stickingCandidates.length > 0
            ? { stickingCandidates: result.stickingCandidates }
            : {}),
          ...(result.annotations && result.annotations.length > 0 ? { annotations: result.annotations } : {}),
        });
        // Pre-select both check-in answers the moment the scan lands (design
        // follow-up: "confirm, not fill out a form") -- the topic is the
        // scan's own detected concept, and the sticking point is the top-
        // ranked chip buildStickingChips would show first (a real recorded
        // misconception when one exists, else the first generic chip). The
        // student can still tap a different chip before confirming.
        if (result.topic) {
          setCheckinTopic(result.topic.title);
          const topChip = buildStickingChips(result.stickingCandidates ?? [])[0];
          setStickingPoint(topChip?.value ?? null);
        }
        // Task 8: AnnotationLayer's box-stroke lookup reads the SAME map the
        // held bubble will carry once committed.
        setAnnotationColors(assignAnnotationColors(result.annotations));
      })
      .catch((error) => {
        console.debug('Calyxa overlay: opening scan unavailable, opening empty', error);
      })
      .finally(() => {
        // The scan has genuinely run and settled this open (whatever it
        // found) -- this, not merely `!scanPending`, is what arms the
        // no-detection fallback when no topic came back.
        if (!cancelled) {
          setScanPending(false);
          setScanSettled(true);
        }
      });
    return () => {
      cancelled = true;
      setScanPending(false);
    };
    // Keyed to `expanded` ("fresh on each panel open") PLUS the onboarding
    // gate (Task 7 addition) -- a completion/skip flips onboardingItems back
    // to null, which must re-run this effect so the scan can finally fire.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded, onboardingResolved, onboardingItems]);

  // The reframe tool never survives a collapse -- a re-expand lands back on
  // the check-in (the crop's viewport coordinates are stale by then anyway).
  useEffect(() => {
    if (!expanded) setReframeOpen(false);
  }, [expanded]);

  // The 5a auto-start countdown (AUTO_START_MS): armed while the check-in
  // is actually on screen and no exit was taken. The cleanup clears the
  // pending timer whenever any dependency flips (collapse, reframe, a voice
  // turn claiming the panel, the start itself flipping `busy`), so the
  // session can never start from a stale window.
  useEffect(() => {
    if (!expanded || !showCheckin || !autoStartArmed || reframeOpen) return;
    const timer = window.setTimeout(() => handleCheckinStart(), AUTO_START_MS);
    return () => window.clearTimeout(timer);
    // handleCheckinStart is a stable in-component helper reading current
    // state via closure per render; intentionally not a dep, same
    // convention as the other effects here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded, showCheckin, autoStartArmed, reframeOpen]);

  // Recap arrival (SESSION_ENDED -> content -> this event). A recap-less
  // end (no gradable interactions) sets null and renders nothing. The
  // session is over either way, so the per-session pin dedupe set resets
  // here, and any still-queued pins yield the header to the recap's own
  // accessory rather than talking over the terminal state.
  useEffect(() => {
    function onSessionRecap(event: Event) {
      const detail = (event as CustomEvent<{ recap?: SessionRecap }>).detail;
      const arrived = detail?.recap ?? null;
      // The header meta ("18 min · 5 problems") is computed ONCE at arrival
      // -- the duration is "how long the session ran", not a live counter.
      const meta = arrived
        ? formatRecapMeta(arrived, sessionStartRef.current !== null ? Date.now() - sessionStartRef.current : null)
        : null;
      // Hold the summary while the congratulation glow is still on screen
      // (bloomTimerRef non-null == the 3s bloom is running); the bloom timer
      // reveals it the moment the congratulation ends. Otherwise switch now.
      if (bloomTimerRef.current !== null) {
        pendingRecapRef.current = { recap: arrived, meta };
      } else {
        applyRecap(arrived, meta);
      }
    }
    window.addEventListener(SESSION_RECAP_EVENT, onSessionRecap);
    return () => window.removeEventListener(SESSION_RECAP_EVENT, onSessionRecap);
    // applyRecap only touches stable setters/refs, so the once-registered
    // listener closure is safe.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Switch the panel to the terminal summary state (design 7b). Split out of
  // the recap listener so the bloom timer can call it too -- the summary
  // arrives either immediately (no bloom) or when the congratulation glow
  // finishes (deferred via pendingRecapRef).
  function applyRecap(arrived: SessionRecap | null, meta: string | null) {
    setRecap(arrived);
    setRecapMeta(meta);
    shownPinKeysRef.current.clear();
    setPinQueue([]);
    // The session is over -- the mode walks to its terminal Reviewing
    // state (design 8c: "Enters: a section closes or the clock runs low").
    setTutorMode('review');
  }

  // Scroll to bottom when messages, streaming tokens, the live transcript,
  // or the answer-chip row / multi-part field panel (design 8a/8d -- each adds
  // height below the last tutor line) change.
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, streamingTokens, liveTranscript, chips, answerFields]);

  // The keyboard shortcut no longer mounts/unmounts the overlay (Sprint 10
  // Task 6 round 4 -- the idle pill's mount now tracks signedIn instead, see
  // content/index.ts). It opens/closes the panel on an already-mounted pill
  // via this window CustomEvent instead, dispatched from content/index.ts.
  useEffect(() => {
    function onTogglePanel() {
      setExpanded((prev) => {
        if (prev) {
          setDragPos(null);
          setIsDragging(false);
          dragOriginRef.current = null;
        }
        return !prev;
      });
    }
    window.addEventListener('calyxa:toggle-panel', onTogglePanel);
    return () => window.removeEventListener('calyxa:toggle-panel', onTogglePanel);
  }, []);

  // The threshold past which the client itself pins "Final step" (ADR-034's
  // one client-derived pin): the first time the eased progress crosses this
  // on a still-open problem. Well inside the prompt's own "close but not
  // done reads 0.8-0.9" band (system-prompt.ts's SOLUTION PROGRESS rubric).
  const FINAL_STEP_THRESHOLD = 0.85;

  // The progress bar + close choreography share one commit-time hook
  // (Sprint 14 Task 7): called at the moment each path's reply actually
  // becomes visible -- immediately for text (handleSubmit), after TTS
  // playback for voice (handleMicStop, matching where annotations already
  // commit there). `solved` forces the bar to 1 before the choreography's
  // own "Now closing tutoring session." bubble is even read.
  function applyProgressAndCompletion(result: TurnResult) {
    const previous = progressRef.current;
    const eased = easeProgress(previous, result.solutionProgress, result.session?.reason === 'solved');
    progressRef.current = eased;
    setSolutionProgress(eased);
    // The miss streak (design 8c's Recover trigger, "two misses in a row"):
    // an eased regression IS a wrong step (easeProgress only moves down when
    // the turn scored one); any forward movement resets the streak, and a
    // turn that carried no progress signal leaves it untouched.
    if (eased < previous) missStreakRef.current += 1;
    else if (eased > previous) missStreakRef.current = 0;
    // The client-derived final-step pin (ADR-034): fires ONCE per problem,
    // the first time the eased progress crosses the threshold while the
    // problem is still open -- a completing turn skips straight to the
    // bloom/close choreography instead ("final step" after "solved" would
    // read backwards). Deterministic from the progress signal; the server
    // never emits this kind.
    const finalStepPin: StatusPin | null =
      !result.session?.complete && eased >= FINAL_STEP_THRESHOLD && !finalStepFiredRef.current
        ? { category: 'progress', kind: 'final-step', conceptKey: null, label: 'Final step' }
        : null;
    if (finalStepPin) {
      finalStepFiredRef.current = true;
      showPins([finalStepPin]);
    }
    // The tutor mode (design 8c): derived once per turn, from the turn's
    // RAW pins (plus the client-derived final-step when it fired) -- a
    // signal the toast dedupe suppressed is still real evidence of where
    // the session is. The header recolors on the switch.
    setTutorMode((current) =>
      deriveTutorMode(current, {
        pins: [...(result.pins ?? []), ...(finalStepPin ? [finalStepPin] : [])],
        missStreak: missStreakRef.current,
        complete: !!result.session?.complete,
      }),
    );
    if (result.session?.complete) {
      // A correct answer earns the section-complete congratulation glow
      // (design 06). It holds for exactly BLOOM_MS, then hands off to the
      // summary: if the recap (SESSION_ENDED) already arrived it parked in
      // pendingRecapRef, and this timer reveals it -- so the sequence is
      // always congratulation (3s) → summary, never a summary popping up
      // under the glow. If the recap hasn't landed yet, the listener applies
      // it as soon as it does.
      if (result.session.reason === 'solved') {
        setBloom({ line: bloomLine(checkinTopic, stickingPoint) });
        if (bloomTimerRef.current !== null) window.clearTimeout(bloomTimerRef.current);
        bloomTimerRef.current = window.setTimeout(() => {
          setBloom(null);
          bloomTimerRef.current = null;
          if (pendingRecapRef.current !== null) {
            applyRecap(pendingRecapRef.current.recap, pendingRecapRef.current.meta);
            pendingRecapRef.current = null;
          }
        }, BLOOM_MS);
      }
      beginCloseChoreography();
    }
  }

  // The shared commit tail for a text-shaped turn's resolved result --
  // identical for a typed send and the session-start kickoff, so it lives
  // once: the assistant bubble (with its annotation extras), the color map
  // AnnotationLayer reads, the pin queue, and the progress/completion hook.
  function commitAssistantTurn(result: TurnResult) {
    clearStreamTokens();
    // Text path: annotations commit WITH the bubble at `done`, and the
    // turn's pins queue at the same moment (the promise resolves when
    // `done` arrives).
    setMessages((current) => [
      ...current,
      { role: 'assistant', content: result.reply, ...assistantMessageExtras(result) },
    ]);
    // The turn's answer chips (design 8a) commit with the bubble too --
    // REPLACING the previous turn's set either way, since chips only ever
    // belong to the latest tutor line. A completing turn never shows any
    // (the server already drops them there; this is belt-and-braces).
    setChips(result.session?.complete ? null : result.chips ?? null);
    // The turn's multi-part answer fields (design 8d) commit the same way --
    // same per-turn replacement and same never-on-a-closing-turn rule. The
    // server sends at most one of chips/fields, so a turn clears whichever it
    // didn't carry: the two never render at once.
    setAnswerFields(result.session?.complete ? null : result.answerFields ?? null);
    // Task 8: AnnotationLayer's box-stroke lookup reads the SAME map.
    setAnnotationColors(assignAnnotationColors(result.annotations));
    showPins(result.pins);
    applyProgressAndCompletion(result);
  }

  // ---- The check-in flow's handlers (design 5a/5b -> tutoring) ----

  // The session-start kickoff (Darcy's follow-up ask, superseding the
  // built-student-turn kickoff): NO turn enters the transcript or the wire
  // history -- the student only ever CONFIRMED the detected question and
  // the sticking point, so exactly that confirmation crosses the wire once,
  // as the structured sessionStart field on an empty-history first turn.
  // The server renders it into the SESSION START MODE prompt block and the
  // tutor's first message -- the first thing the student sees -- responds
  // directly to the misconception in the detected problem. The held scan is
  // consumed here (its question IS sessionStart.question); on failure the
  // kickoff flag resets so the composer takes over with a notice.
  async function startSessionTurn(start: SessionStartInfo) {
    if (busy) return;
    setScan(null);
    setKickoffStarted(true);
    // The conversation starts here -- the recap meta's duration baseline.
    if (sessionStartRef.current === null) sessionStartRef.current = Date.now();
    setRecap(null);
    setRecapMeta(null);
    setNotice(null);
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

  // Start session (the button, the topic card's tap-to-confirm, or the
  // auto-start countdown): the check-in answers -- the scan's detected
  // question and the top predicted sticking point, both pre-selected the
  // moment the scan landed -- fire the kickoff turn. The not-sure sentinel
  // maps to null: never echoed as if it were a named weakness.
  function handleCheckinStart() {
    if (busy || closeState !== 'idle' || !scan || !stickingPoint) return;
    void startSessionTurn({
      question: scan.question,
      stickingPoint: stickingPoint === NOT_SURE_CHIP ? null : stickingPoint,
    });
  }

  // "No, other" (design 5b): the sticking-point prediction was off -- open
  // the reframe tool so the student frames the exact spot themselves. The
  // countdown disarms first; correcting a prediction must never race the
  // auto-start.
  function handleCheckinReframe() {
    if (busy || closeState !== 'idle') return;
    setAutoStartArmed(false);
    setReframeOpen(true);
  }

  // The reframe tool's exits: Back returns to the check-in / no-detection
  // fallback (still disarmed -- the student was mid-correction, don't restart
  // a countdown under them); Start session fires the SAME structured kickoff
  // as the confirm button, with the student's own words as the sticking point
  // and the cropped snippet riding along when the crop found plain text.
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
    // no-detection fallback there is no scan, so the crop IS the problem: use
    // it as the question (the server requires a non-empty `question`), falling
    // back to the student's own words when the crop found no text (e.g. an
    // image). ReframeTool guarantees a non-empty struggle, so `question` is
    // always non-empty on that path.
    const question = scan?.question ?? (snippet || struggle);
    if (!question) return;
    void startSessionTurn({
      question,
      stickingPoint: struggle,
      // Only send the crop as a separate snippet when it's an addition to a
      // distinct scan question -- in the fallback the crop is already the
      // question, so don't duplicate it.
      ...(scan && snippet ? { snippet } : {}),
    });
  }

  // ---- The recap's exit (design 7b, the terminal state) ----

  // Complete session (7b's one exit; the earlier 6b pass's "One more pass"
  // is retired with it): the session is already over server-side (the recap
  // only ever arrives after SESSION_ENDED). With auto-close disabled this is
  // now the ONLY way the summary screen dismisses -- the student closes the
  // panel here, on their own time, rather than watching it collapse.
  // (clearCloseTimers is kept defensively; no timers are pending anymore.)
  function handleRecapDone() {
    clearCloseTimers();
    setCloseState((prev) => nextCloseState(prev, 'reset'));
    performClose();
  }

  // The typed-turn send (handleSubmit's body; the check-in start no longer
  // routes through here -- it fires startSessionTurn above with no student
  // turn at all).
  async function sendStudentMessage(text: string) {
    if (!text || busy) return;

    // A typed start supersedes any still-held scan detection -- the student
    // chose their own framing, so the detection is dropped, never replayed.
    setScan(null);
    // The conversation starts here if it hasn't already -- the recap meta's
    // duration baseline.
    if (sessionStartRef.current === null) sessionStartRef.current = Date.now();
    // The wire history is stripped to role/content (tags never re-enter the
    // request, ADR-024); the display list keeps its DisplayMessage shape.
    const outbound: TurnMessage[] = [...windowHistory(stripHistory(messages)), { role: 'user', content: text }];
    setMessages((current) => [...current, { role: 'user', content: text }]);
    // The student answered -- however they did it (chip tap, typed, spoken,
    // or multi-part fields), the offered options are consumed (design 8a:
    // chips hide on pick; design 8d: the field panel closes on submit).
    setChips(null);
    setAnswerFields(null);
    setRecap(null); // shown once -- a new conversation replaces it
    setRecapMeta(null);
    setNotice(null);
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

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = input.trim();
    if (!text || busy) return;
    setInput('');
    await sendStudentMessage(text);
  }

  // Answer-chip tap (design 8a): the tap COMMITS the chip text as a real
  // student turn -- same wire shape, same transcript bubble, same grading as
  // if they had typed it ("tap commits the answer as a student bubble and
  // advances or branches"). The raw chip text is sent verbatim (the model
  // wrote it in the same calculator notation it reads); the row itself
  // disappears via sendStudentMessage's setChips(null).
  function handleChipTap(text: string) {
    if (busy || closeState !== 'idle') return;
    void sendStudentMessage(text);
  }

  // Multi-part answer submit (design 8d: "Check answers"): the filled boxes
  // commit as ONE student turn -- the AnswerFields panel joins each field as
  // "<label> = <value>" (the same calculator notation the model reads and the
  // question named the unknowns in), so the tutor grades every value at once,
  // exactly as if the student had typed the whole line. The panel disappears
  // via sendStudentMessage's setAnswerFields(null), same as a chip tap. The
  // panel already gates the button on every field being filled, so `combined`
  // is never empty here.
  function handleAnswerFieldsSubmit(combined: string) {
    if (busy || closeState !== 'idle') return;
    void sendStudentMessage(combined);
  }

  // Best-effort live transcript (unchanged behavior/contract from before Task
  // 5): SpeechRecognition's interim results are intentionally low-accuracy;
  // Whisper's final transcript is the source of truth (see handleMicStop).
  // Extracted to its own function and called BEFORE `startRecording()` is
  // awaited (Task 5, ADR-033) -- previously this ran strictly AFTER
  // `startRecording()` resolved despite a comment claiming otherwise, so
  // SpeechRecognition's own async startup was serialized behind
  // getUserMedia/MediaRecorder setup instead of overlapping it.
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
    startingRef.current = true;
    // Task 5 (ADR-033): the UI acknowledges the click IMMEDIATELY, before any
    // async work -- never the fake "recording" state, but never silence
    // either. `recording` itself only flips once capture is actually live.
    dispatchMic('click');
    const clickAt = performance.now();

    // Parallelized with startRecording() below (Task 5) -- both do their own
    // async mic-related setup; sequencing them was one of the ~5s cold
    // start's contributors.
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
    // between "user stopped speaking" and "Whisper result appears".
    speechRecRef.current?.stop();
    speechRecRef.current = null;
    setBusy(true);
    clearStreamTokens();

    try {
      // Sprint 17 (ADR-043): felt-latency clock start -- the moment the
      // student finished speaking, through utterance finalization, STT, AI,
      // and TTS, to first audio. Used by the turn_latency telemetry event.
      const turnStartAt = performance.now();
      const utterance = await handle.stop();
      const sttStartAt = performance.now();
      const { transcript, sttMs } = await onTranscribe(utterance);
      // networkMs: the STT relay/upload overhead the server's own Whisper time
      // (`sttMs`) does NOT include -- the round-trip wall-clock minus the
      // server-measured leg. Never negative.
      const networkMs = Math.max(0, Math.round(performance.now() - sttStartAt) - sttMs);

      // Swap the live interim bubble for the accurate Whisper result atomically.
      setLiveTranscript('');
      // A voice turn starts the conversation too: any still-held scan
      // detection is dropped, same as a typed start (sendStudentMessage).
      setScan(null);
      if (sessionStartRef.current === null) sessionStartRef.current = Date.now();
      const outbound: TurnMessage[] = [...windowHistory(stripHistory(messages)), { role: 'user', content: transcript }];
      setMessages((current) => [...current, { role: 'user', content: transcript }]);
      // A spoken answer consumes the offered chips too (design 8a: chips
      // supplement voice, they never gate it).
      setChips(null);
      setRecap(null); // shown once -- a new conversation replaces it
      setRecapMeta(null);

      // Voice pins + annotation sequencing fire at REPLY-DELIVERED (ADR-026).
      // On the streamed path that is turn-done, which lands DURING playback
      // (text generates faster than it is spoken); on the buffered fallback it
      // is playback start, as before.
      // Sprint 17 (ADR-043): per-leg voice-latency capture for the
      // turn_latency event. These are INDEPENDENT honest measurements, NOT a
      // strict additive decomposition -- the streamed path overlaps AI
      // generation and TTS by design, so aiMs and ttsMs can overlap and the
      // fields deliberately need not sum to totalMs. Each is captured once, at
      // its natural moment, through the hooks that already exist here.
      let firstSayAt: number | null = null; // streamed: the first spoken-text delta
      let envelopeAt: number | null = null; // reply envelope delivered (both paths)
      let firstAudioAt: number | null = null; // first audio actually played (both paths)
      let bufferedTtsMs: number | null = null; // buffered path only: server-measured TTS ms
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
        onVoicePlaybackStart(durationMs);
      };

      // Streamed-envelope path first (Sprint 15 voice follow-on, ADR-033
      // amendment): stream the turn and synthesize TTS per sentence, so audio
      // starts after sentence 1 instead of the whole ~4-5s reply. On ANY
      // streaming/MediaSource/codec failure, fall back to the pre-follow-on
      // buffered turn + buffered playback -- byte-identical to the old path,
      // never a partial commit.
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
          // Turn-done, during playback: reveal duration estimated from the
          // final word count (real duration is unknown mid-stream, ADR-033).
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
        const { audio, ttsMs } = await onSynthesize(stripMathDelimiters(result.reply));
        bufferedTtsMs = ttsMs;
        // Buffered playback: onPlaybackStart fires showPins + onVoicePlaybackStart
        // at playback start with the real duration, exactly as the old path did.
        await playAudioWithTextReveal(audio, result.reply, appendStreamToken, setPlaying, audioRef, (durationMs) => {
          markFirstAudio('buffered fallback')();
          deliverEnvelope(result, durationMs);
        });
      }

      clearStreamTokens();
      // Voice annotations commit with the reply after playback -- they
      // don't pre-announce what the tutor hasn't said yet (Task 8 spec).
      // Progress/completion apply at the SAME moment, for the same reason.
      setMessages((current) => [
        ...current,
        { role: 'assistant', content: result.reply, ...assistantMessageExtras(result) },
      ]);
      // Voice chips commit with the reply after playback, same moment as the
      // annotations -- they don't pre-announce options the tutor hasn't
      // finished asking about yet (the Task 8 sequencing rule).
      setChips(result.session?.complete ? null : result.chips ?? null);
      // Task 8: AnnotationLayer's box-stroke lookup reads the SAME map.
      setAnnotationColors(assignAnnotationColors(result.annotations));
      applyProgressAndCompletion(result);

      // Sprint 17 (ADR-043): the LatencyTrace finally gets a sink. Emitted
      // ONLY when audio actually played (firstAudioAt) and the envelope was
      // delivered (envelopeAt) -- a failed or silent turn never reports a
      // bogus latency. ttsMs is the server-measured buffered value when the
      // fallback ran, else the streamed first-audio lag after the first
      // spoken delta (the TTS synthesis+buffer time), 0 only if neither is
      // observable. Fire-and-forget through the threaded telemetry prop;
      // content-free by construction (no field can hold text/URL/audio).
      if (firstAudioAt !== null && envelopeAt !== null) {
        const totalMs = Math.max(0, Math.round(firstAudioAt - turnStartAt));
        const aiMs = Math.max(0, Math.round(envelopeAt - aiStartAt));
        const ttsMs =
          bufferedTtsMs !== null
            ? bufferedTtsMs
            : firstSayAt !== null
              ? Math.max(0, Math.round(firstAudioAt - firstSayAt))
              : 0;
        // Sprint 18 Task 8 (ADR-043): `voice_used` rides the SAME completed-
        // voice-turn signal as turn_latency (audio actually played) -- one
        // batched emit, both content-free. voice_used is the usage-rate counter
        // (fired once per turn that used voice I/O); it carries no fields.
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
    }
  }

  function handleMicClick() {
    if (recording) void handleMicStop();
    else void handleMicStart();
  }

  function handleInterrupt() {
    audioRef.current?.pause();
  }

  // The − (minimize) control (Sprint 14 Task 7 -- this is the exact old ✕
  // handler, just relabeled/rewired to the new − button): collapse to the
  // pill, session continues untouched. Never ends the session -- that is
  // only ever an explicit END_SESSION (below) or the model's own
  // session.complete signal, both of which run the close choreography
  // instead of this.
  function handleMinimize() {
    setExpanded(false);
    setDragPos(null);
    setIsDragging(false);
    dragOriginRef.current = null;
    // The recap is shown once and discarded on panel close (ADR-025).
    // Minimizing does NOT end the session.
    setRecap(null);
    setRecapMeta(null);
    window.dispatchEvent(new CustomEvent(PANEL_CLOSED_EVENT));
  }

  // The ✕ (end session) control (Sprint 14 fix pass): clicking ✕ NO LONGER
  // ends the session outright and NO LONGER kicks off the green ring
  // countdown. The ring is reserved for Calyxa's OWN automatic "the session
  // is over" detection (applyProgressAndCompletion -> beginCloseChoreography);
  // a manual ✕ is a deliberate, destructive user action, so it opens a
  // confirmation first (the live session and transcript will be lost).
  function handleEndSessionClick() {
    if (busy || ending || recording || closeState !== 'idle') return;
    setShowEndConfirm(true);
  }

  // Confirmed manual end (Sprint 14 fix pass): reuses the popup's END_SESSION
  // path verbatim via onEndSession, then closes the panel DIRECTLY with
  // performClose -- NO ring choreography (the student asked to end; there is
  // nothing to count down). The recap still arrives via the SESSION_ENDED
  // broadcast, but the panel has already collapsed by then, matching the
  // "session will be lost" confirmation. A "no active session" error surfaces
  // as a notice and leaves the panel open, instead of collapsing on nothing.
  async function handleEndSessionConfirmed() {
    setShowEndConfirm(false);
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

  function handleHeaderPointerDown(event: React.PointerEvent<HTMLElement>) {
    // Let button clicks pass through without starting a drag.
    if ((event.target as Element).closest('button')) return;
    const panel = panelRef.current;
    if (!panel) return;
    const rect = panel.getBoundingClientRect();
    dragOriginRef.current = {
      mouseX: event.clientX,
      mouseY: event.clientY,
      elemX: rect.left,
      elemY: rect.top,
    };
    setDragPos({ x: rect.left, y: rect.top });
    setIsDragging(true);
    // Pointer capture routes all subsequent pointer events to this element
    // even when the cursor moves outside it during a fast drag.
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
  }

  function handleHeaderPointerMove(event: React.PointerEvent<HTMLElement>) {
    if (!dragOriginRef.current) return;
    const { mouseX, mouseY, elemX, elemY } = dragOriginRef.current;
    const newX = Math.max(0, Math.min(window.innerWidth - 420, elemX + (event.clientX - mouseX)));
    const newY = Math.max(0, Math.min(window.innerHeight - 48, elemY + (event.clientY - mouseY)));
    setDragPos({ x: newX, y: newY });
  }

  function handleHeaderPointerUp(event: React.PointerEvent<HTMLElement>) {
    if (!dragOriginRef.current) return;
    dragOriginRef.current = null;
    setIsDragging(false);
    event.currentTarget.releasePointerCapture(event.pointerId);
  }

  if (!expanded) {
    return (
      <>
        <AnnotationLayer annotationColors={annotationColors} />
        {/* The bloom is a frame glow now (design 06) -- if a completing turn
            lands while minimized (a voice turn finishing after a collapse),
            there is no live card to light up, so the frame wraps a compact
            completion card instead (its visual is aria-hidden -- the frame's
            own status line already announces it). */}
        {bloom ? (
          <div className="fixed bottom-7 left-1/2 z-[2147483647] w-[420px] -translate-x-1/2 font-sans text-base text-foreground">
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
        ) : (
        <div className="fixed bottom-6 left-1/2 z-[2147483647] -translate-x-1/2 font-sans motion-safe:animate-[cx-rise_0.42s_cubic-bezier(0.2,0.8,0.2,1)_both]">
          <div className="relative">
            <div
              aria-hidden="true"
              className={`calyxa-glow motion-safe:animate-[calyxa-breathe_2.7s_ease-in-out_infinite] pointer-events-none absolute rounded-full transition-all duration-300 ease-out ${
                pillHovered ? '-inset-2 blur-md opacity-100' : '-inset-1.5 blur-[3px] opacity-85'
              }`}
            />
            <button
              type="button"
              onClick={() => setExpanded(true)}
              onMouseEnter={() => setPillHovered(true)}
              onMouseLeave={() => setPillHovered(false)}
              onFocus={() => setPillHovered(true)}
              onBlur={() => setPillHovered(false)}
              aria-label="Open Calyxa"
              className={`relative flex items-center rounded-full border border-border bg-background shadow-panel outline-none transition-all duration-300 ease-out focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring ${
                pillHovered ? 'h-12 w-[140px] justify-start gap-2 px-4' : 'h-2 w-10 justify-center px-0'
              }`}
            >
              {pillHovered && (
                <>
                  <CalyxaMark className="h-[22px] w-[22px] flex-none" />
                  <span className="text-[15px] font-semibold tracking-tight text-foreground">calyxa</span>
                  <span
                    aria-hidden="true"
                    className="ml-auto h-[9px] w-[9px] flex-none rounded-full bg-accent-glow-strong shadow-[0_0_0_4px_rgba(134,239,172,0.4)] motion-safe:animate-[cx-dot_2.2s_ease-in-out_infinite]"
                  />
                </>
              )}
            </button>
          </div>
        </div>
        )}
      </>
    );
  }

  // The 5b reframe tool claims the whole surface while open -- the panel
  // yields entirely (the design's own frame: scrim + crop + compose card,
  // no panel behind it).
  if (reframeOpen) {
    return (
      <>
        <AnnotationLayer annotationColors={annotationColors} />
        <ReframeTool disabled={busy || ending} onCancel={handleReframeCancel} onStart={handleReframeStart} />
      </>
    );
  }

  return (
    <>
      <AnnotationLayer annotationColors={annotationColors} />
      <div
        ref={panelRef}
        className={`fixed z-[2147483647] w-[420px] font-sans text-base text-foreground${isDragging ? ' select-none' : ''}${!dragPos ? ' bottom-7 left-1/2 -translate-x-1/2' : ''}`}
        style={dragPos ? { top: `${dragPos.y}px`, left: `${dragPos.x}px` } : undefined}
      >
      <div className="relative">
      {/* The section-complete glow (design 06): the rotating gradient
          border + burst ring wraps the LIVE card for ~BLOOM_MS -- the
          header, last tutor line and input stay readable the whole time,
          then it recedes to whatever the close choreography has ready
          (usually the recap). Outside a bloom this is the plain frosted
          card; the body is identical either way. */}
      <BloomShell active={!!bloom} line={bloom?.line ?? ''}>
        <>

        {/* The ping toast (design 8a/8b): drops into the top-center of the
            header, one at a time, tone-tinted; the timing/queue lives above
            (PIN_DISPLAY_MS). The wrapper is a persistent aria-live region
            so each ping's label is announced without stealing focus --
            keyed by queue id so back-to-back pings of the same kind each
            re-run the drop-in. */}
        <span aria-live="polite">
          {pinQueue.length > 0 && <PingToast key={pinQueue[0].id} pin={pinQueue[0].pin} />}
        </span>

        <TitleBar
          playing={playing}
          isDragging={isDragging}
          recording={recording}
          busy={busy}
          ending={ending}
          closing={closeState !== 'idle'}
          ringing={closeState === 'ringing'}
          ringDurationMs={CLOSE_RING_MS}
          accessory={headerAccessory}
          chip={headerChip}
          session={sessionHeader}
          onHeaderPointerDown={handleHeaderPointerDown}
          onHeaderPointerMove={handleHeaderPointerMove}
          onHeaderPointerUp={handleHeaderPointerUp}
          onInterrupt={handleInterrupt}
          onMinimize={handleMinimize}
          onCloseSession={() => void handleEndSessionClick()}
          onSubmitFeedback={handleFeedbackSubmit}
        />

        {/* The board strip (design 8a): pins the current equation just
            below the header while a session is live -- the most recent
            $$ math block the tutor put up, rendered with the transcript's
            own superscript/symbol treatment. The trailing spacer matches
            the design (the equation centers against the BOARD label). */}
        {sessionActive && boardEquation && (
          <div className="flex items-center gap-2.5 border-b border-border bg-[var(--calyxa-board-bg)] px-3.5 py-[7px]">
            <span className="text-[10px] font-semibold tracking-[0.12em] text-muted-foreground">BOARD</span>
            <span className="flex-1 text-center text-[14.5px] tabular-nums text-foreground">
              {tokenizeMathText(boardEquation).map((token, tokenIndex) =>
                token.kind === 'sup' ? (
                  <sup key={tokenIndex}>{token.text}</sup>
                ) : (
                  <span key={tokenIndex}>{token.text}</span>
                ),
              )}
            </span>
            <span aria-hidden="true" className="w-[38px] flex-none" />
          </div>
        )}

        {recap ? (
          /* ── Post-session recap (design 7b) — the panel body's TERMINAL
              state: replaces the chat area AND the composer outright. It stays
              put until the student taps Complete session — auto-close is
              disabled, so the summary never collapses on its own. ── */
          <RecapCard
            recap={recap}
            topicTitle={checkinTopic}
            disabled={ending}
            onDone={handleRecapDone}
          />
        ) : (
          <>
            {/* ── Chat area — only rendered when there is something to show ── */}
            {hasContent && (
              <div
                aria-live="polite"
                className="flex max-h-[172px] flex-col gap-2 overflow-y-auto px-[13px] pb-[7px] pt-[11px] scroll-smooth"
              >
                <Transcript
                  messages={messages}
                  streamingTokens={streamingTokens}
                  busy={busy}
                  notice={notice}
                  liveTranscript={liveTranscript}
                  chips={chips}
                  chipsDisabled={busy || recording || connecting || closeState !== 'idle'}
                  onChipTap={handleChipTap}
                  answerFields={answerFields}
                  answerFieldsDisabled={busy || recording || connecting || closeState !== 'idle'}
                  onAnswerFieldsSubmit={handleAnswerFieldsSubmit}
                  chatEndRef={chatEndRef}
                />
              </div>
            )}

            {/* ── Session start (design 5a) — the scanning body while the
                opening scan is in flight, then the check-in card: the
                scanned topic and the TOP predicted sticking point arrive
                pre-selected (one prediction, not a menu) and Start session
                auto-proceeds after AUTO_START_MS. The composer is
                deliberately ABSENT while either shows; "No, other" opens the
                5b reframe tool (5a's single correction path), and any turn
                path still consumes the held scan question into the
                transcript the moment the conversation starts. When the scan
                names NO topic, the no-detection fallback card renders ABOVE
                the composer instead (routing into the same reframe tool) so
                the starting screen is never hidden — the student can frame the
                spot OR just type below. ── */}
            {showOnboarding ? (
              <Onboarding
                items={onboardingItems!}
                onSubmit={onSubmitOnboarding ?? (() => Promise.reject(new Error('onboarding submit unavailable')))}
                onSkip={handleOnboardingSkip}
                onComplete={handleOnboardingComplete}
              />
            ) : showScanning ? (
              <CheckinScan />
            ) : showCheckin && scan && scan.topic ? (
              <CheckinCard
                topic={scan.topic}
                sticking={buildStickingChips(scan.stickingCandidates ?? [])[0]}
                disabled={busy || ending || closeState !== 'idle'}
                autoStartActive={autoStartArmed}
                autoStartMs={AUTO_START_MS}
                onStart={handleCheckinStart}
                onReframe={handleCheckinReframe}
              />
            ) : (
              <>
                {showCheckinFallback && (
                  <CheckinFallbackCard
                    disabled={busy || ending || closeState !== 'idle'}
                    onFrame={handleCheckinReframe}
                  />
                )}
                {/* ── Input row — border-t only when chat area is present above ── */}
                <Composer
                hasContent={hasContent}
                recording={recording}
                connecting={connecting}
                level={level}
                input={input}
                busy={busy}
                closing={closeState !== 'idle'}
                placeholder={
                  /* Contextual hint (design 8a/8d): the chip row or the
                     multi-part field panel above changes what the composer is
                     FOR -- fill the boxes, tap, or answer your own way. */
                  sessionActive
                    ? answerFields && answerFields.length > 0
                      ? 'Fill the boxes above — or answer your way'
                      : chips && chips.length > 0
                        ? 'Tap an answer — or say it your way'
                        : 'Answer out loud or type here'
                    : 'Ask a math question…'
                }
                inputFocused={inputFocused}
                caretLeft={caretLeft}
                inputElRef={inputElRef}
                measureElRef={measureElRef}
                onSubmit={handleSubmit}
                onInputChange={(event) => {
                  setInput(event.target.value);
                  refreshCaret();
                }}
                onCaretRefresh={refreshCaret}
                onInputFocus={() => {
                  setInputFocused(true);
                  refreshCaret();
                }}
                onInputBlur={() => setInputFocused(false)}
                onMicClick={handleMicClick}
                />
              </>
            )}
          </>
        )}

        {/* ── End-session confirmation (Sprint 14 fix pass) — a small dialog
            over the panel, matching the panel's own surface. Only a manual ✕
            reaches here; the automatic close never asks. Confirming ends the
            session and closes directly (no ring); cancelling resumes. */}
        {showEndConfirm && (
          <div className="absolute inset-0 z-20 flex items-center justify-center bg-background/70 p-4 backdrop-blur-sm motion-safe:animate-[cx-annot-in_0.16s_ease-out_both]">
            <div className="w-full rounded-lg border border-border bg-background p-4 shadow-panel">
              <p className="m-0 text-[13.5px] font-semibold text-foreground">End this tutoring session?</p>
              <p className="mb-3.5 mt-1 text-[12.5px] leading-relaxed text-muted-foreground">
                Your current session will be lost and the conversation cleared.
              </p>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowEndConfirm(false)}
                  className="cursor-pointer rounded-full border border-border bg-background px-3.5 py-1.5 text-[12.5px] font-medium text-foreground outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
                >
                  Keep working
                </button>
                <button
                  type="button"
                  onClick={() => void handleEndSessionConfirmed()}
                  disabled={ending}
                  className="cursor-pointer rounded-full border-0 bg-danger px-3.5 py-1.5 text-[12.5px] font-semibold text-white outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring disabled:cursor-not-allowed disabled:opacity-50"
                >
                  End session
                </button>
              </div>
            </div>
          </div>
        )}

        </>
      </BloomShell>

      </div>
      </div>
    </>
  );
}

function describeError(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message : 'unknown error';
  return message === 'not signed in' ? 'Sign in from the Calyxa popup to start.' : fallback;
}

/**
 * Plays synthesized audio and simultaneously reveals `text` word-by-word at a
 * rate proportional to the audio's actual duration so the text tracks the
 * speech. Calls `setRevealedText` on each word reveal so the caller can update
 * a React state variable that renders the pending assistant bubble.
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
// duration -- see revealDueWords below for why that still tracks stalls.
const STREAM_REVEAL_MS_PER_WORD = 320;

function isTtsStreamingSupported(): boolean {
  return typeof MediaSource !== 'undefined' && MediaSource.isTypeSupported(TTS_STREAM_MIME_TYPE);
}

/**
 * Streaming sibling of playAudioWithTextReveal (Task 6, ADR-033): feeds
 * chunks from `synthesizeStream` into a MediaSource SourceBuffer as they
 * arrive instead of waiting for a full ArrayBuffer, so playback starts at
 * the first buffered chunk. Throws (synchronously, before any network call,
 * or from the MediaSource setup) when the browser can't play the format at
 * all -- the caller's job is to catch that and fall back to
 * playAudioWithTextReveal with the same text, same as a MediaSource error
 * fired after playback has (or hasn't yet) started.
 *
 * Word reveal is paced by `timeupdate`/`currentTime` (STREAM_REVEAL_MS_PER_WORD)
 * rather than a duration-derived setInterval: `audio.duration` is Infinity/NaN
 * until endOfStream() resolves it, and even a setInterval timer would drift
 * out of sync with real playback if the audio stalls waiting on the next
 * chunk. currentTime literally stops advancing during a stall, so pacing off
 * of it self-corrects for free -- exactly the property a wall-clock interval
 * doesn't have.
 */
async function playAudioStreamWithTextReveal(
  synthesizeStream: (text: string, onChunk: (chunk: Uint8Array) => void) => Promise<{ ttsMs: number }>,
  text: string,
  appendToken: (text: string) => void,
  setPlaying: (playing: boolean) => void,
  audioRef: { current: HTMLAudioElement | null },
  onPlaybackStart: (durationMs: number) => void,
): Promise<void> {
  if (!isTtsStreamingSupported()) {
    throw new Error('MediaSource streaming for audio/mpeg is not supported in this browser.');
  }

  const words = text.trim().split(/\s+/);
  const mediaSource = new MediaSource();
  const audio = new Audio();
  const url = URL.createObjectURL(mediaSource);
  audio.src = url;
  audioRef.current = audio;

  let wordIndex = 0;
  let playbackStarted = false;

  function revealDueWords() {
    const dueCount = wordsDueByTime(audio.currentTime * 1000, STREAM_REVEAL_MS_PER_WORD, words.length);
    while (wordIndex < dueCount) {
      // Space prefix on all words after the first, same reconstruction
      // contract as the buffered path's reveal loop above.
      appendToken(wordIndex === 0 ? words[wordIndex] : ' ' + words[wordIndex]);
      wordIndex++;
    }
  }

  function onTimeUpdate() {
    if (!playbackStarted) {
      playbackStarted = true;
      setPlaying(true);
      // Real duration is unknown mid-stream (ADR-033) -- the word-count
      // estimate is the same honest fallback the buffered path already uses
      // when ITS duration probe comes back unavailable, so annotation
      // sequencing (which consumes this ms figure) degrades identically on
      // both paths rather than gaining a third behavior to reason about.
      onPlaybackStart(words.length * STREAM_REVEAL_MS_PER_WORD);
    }
    revealDueWords();
  }
  audio.addEventListener('timeupdate', onTimeUpdate);

  // Every failure mode below funnels through failNow instead of being
  // handled locally. A prior version of this function only listened for
  // 'error' on the MediaSource itself -- a SourceBuffer append/decode
  // failure (the far more common real-world failure) fires 'error' on the
  // SourceBuffer instead, which was NOT listened for: `appending` stayed
  // true forever, `updateend` never came, and the drain loop further down
  // spun waiting on an event that would never fire -- a multi-second (or
  // indefinite) stall that looked like "it's just slow" rather than a
  // clean, fast fallback. Likewise a mid-stream `audio` 'error' used to
  // just quietly resolve `playbackEnded`, silently truncating the reply
  // with no fallback attempted. Routing all three through one rejecting
  // promise means every failure path now hits the SAME catch block below
  // and falls back the SAME way, instead of three different degraded
  // behaviors.
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

  // Bounds the SETUP phase only (call -> first playable audio), not total
  // playback -- a long reply legitimately takes a while to finish
  // streaming, but time-to-FIRST-audio is exactly the metric this task is
  // supposed to hit a ≤2.5s p50 on, so setup itself must never be allowed
  // to hang past a fixed budget waiting on a browser/network condition
  // that isn't coming. Cleared the moment audio.play() actually fires.
  const setupTimeout = setTimeout(() => {
    failNow(new Error('TTS streaming setup timed out'));
  }, 4000);

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
    sourceBuffer.addEventListener('error', () => failNow(new Error('SourceBuffer append failed')));

    // A SourceBuffer accepts exactly one appendBuffer at a time -- a second
    // call before 'updateend' fires for the first throws. Chunks queue here
    // and drain one at a time; play() starts after the FIRST chunk lands so
    // there is always at least a little buffered before playback begins.
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

    const { ttsMs } = await Promise.race([
      synthesizeStream(text, (chunk) => {
        pending.push(chunk);
        pump();
      }),
      failed,
    ]);
    void ttsMs; // surfaced for future latency telemetry; the route's x-tts-ms header is the source of truth today

    // Don't close the stream while a chunk is still mid-append or queued --
    // endOfStream() throws if called during an in-flight update.
    while (appending || pending.length > 0) {
      await Promise.race([
        new Promise<void>((resolve) => sourceBuffer.addEventListener('updateend', () => resolve(), { once: true })),
        failed,
      ]);
    }
    if (mediaSource.readyState === 'open') mediaSource.endOfStream();

    await Promise.race([playbackEnded, failed]);
  } catch (error) {
    throw error instanceof Error ? error : new Error('TTS streaming failed');
  } finally {
    clearTimeout(setupTimeout);
    setPlaying(false);
    audioRef.current = null;
    URL.revokeObjectURL(url);
    audio.removeEventListener('timeupdate', onTimeUpdate);
  }
}

// The words of `sayText` that are DEFINITELY complete: if the accumulated
// streamed text does not end in whitespace, its last token may still be
// growing (a delta can split mid-word), so it is excluded until a following
// space confirms it. This keeps already-revealed word indices stable as the
// say text streams in -- a word only becomes revealable once it can no longer
// change (Sprint 15 voice follow-on).
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
 * whole reply (the ~4-5s turn leg the latency probe found), and consecutive
 * sentences play back-to-back with no gap (MP3 frames concatenate). Word
 * reveal paces off `audio.currentTime` against the completed words known so
 * far, so the text tracks the speech exactly as the Task 6 streamed path did.
 *
 * `onEnvelopeReady` fires at turn-done (the full validated envelope) -- which
 * lands DURING playback, since text generates faster than it is spoken -- so
 * the caller can fire pings/annotation-sequencing against the audio.
 * `onFirstAudio` fires once, at the first playable audio (the DEV latency
 * mark). Throws on any MediaSource/codec/stream failure so the caller can fall
 * back to the buffered turn+playback path; it never partially commits.
 */
async function playVoiceTurnStreamedEnvelope(
  runTurn: (onSayDelta: (text: string) => void) => Promise<TurnResult>,
  synthesizeStream: (text: string, onChunk: (chunk: Uint8Array) => void) => Promise<{ ttsMs: number }>,
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

  // Single rejecting funnel for every failure mode (same discipline as
  // playAudioStreamWithTextReveal): a SourceBuffer append error, a MediaSource
  // error, an audio-element error, or the setup timeout all reject `failed`,
  // so the caller falls back the SAME way regardless of which fired.
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

  // Bounds SETUP only (call -> first playable audio); a long reply legitimately
  // takes a while to finish speaking. Cleared once audio.play() fires.
  const setupTimeout = setTimeout(() => {
    failNow(new Error('TTS streaming setup timed out'));
  }, 6000);

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
        // are transcript-rendering syntax); a sentence that was ONLY a math
        // block still has its symbols to speak, but one that strips to
        // nothing is skipped rather than synthesized as silence.
        const sentence = stripMathDelimiters(sentenceQueue.shift()!);
        if (!sentence.trim()) continue;
        await Promise.race([
          synthesizeStream(sentence, (chunk) => {
            pending.push(chunk);
            pump();
          }),
          failed,
        ]);
      }
    }

    const accumulator = createSentenceAccumulator();
    const worker = ttsWorker();

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

    // Reveal any words the audio finished before the reveal ladder reached
    // (short audio vs. the fixed per-word rate) so the transcript is whole
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
