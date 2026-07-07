import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from 'react';
import { CalyxaMark } from '@calyxa/ui';
import './Overlay.css';
import type {
  Annotation,
  ProfileOverview,
  ProfileTag,
  ProfileTagKind,
  SessionCompletion,
  SessionRecap,
  TurnMessage,
  TurnPing,
  TurnPingKind,
} from '../types/messages';
import { AnnotationLayer } from './AnnotationLayer';
import { Composer } from './Composer';
import { InsightStrip } from './InsightStrip';
import { PingToasts } from './PingToasts';
import { TitleBar } from './TitleBar';
import { Transcript } from './Transcript';
import { startRecording, type RecordingHandle, type Utterance } from './VoiceController';

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

// What one turn resolves to (Sprint 13; widened Sprint 14 Task 7): the
// reply plus the turn's grounded profile tags, computed event pings, raw
// annotations, and progress/completion signal, when the wire carried any --
// content/index.ts's sendAiTurn builds this from the `done` message / the
// AI_REPLY payload on both paths. The empty-reply guard keys on `reply`
// exactly as it did when onSend resolved a bare string. `annotations` rides
// here (in ADDITION to content/index.ts already drawing them via
// showTurnAnnotations) specifically so this file can compute the per-turn
// color assignment and Transcript can match `target.text` inside `say` --
// the resolved DrawInstruction[] the layer draws from has already lost that
// exact text by the time it's dispatched as a window event.
export type TurnResult = {
  reply: string;
  tags?: ProfileTag[];
  pings?: TurnPing[];
  annotations?: Annotation[];
  solutionProgress?: number;
  session?: SessionCompletion;
};

// Local DISPLAY message type (Sprint 13, ADR-024; widened Sprint 14 Task 7):
// the transcript the overlay renders carries each assistant bubble's tags
// AND (new) the turn's own annotations + the deterministic per-turn color
// assignment computed for them (assignAnnotationColors below) -- both are
// needed at RENDER time, not just at commit time, since Transcript
// re-renders the whole message list on every change. The history handed
// back to onSend is stripped to role/content (stripHistory below) -- none
// of this is display-ephemeral state ever re-enters the wire request.
export type DisplayMessage = TurnMessage & {
  tags?: ProfileTag[];
  annotations?: Annotation[];
  annotationColors?: AnnotationColorMap;
};

// Client-side caps (defence in depth -- the server already enforces both):
// ≤2 tags per bubble (envelope.ts's MAX_PROFILE_TAGS) and ≤2 pings per turn
// (ADR-026's delivery contract).
export const MAX_TAGS_PER_TURN = 2;
export const MAX_PINGS_PER_TURN = 2;
const PING_DISMISS_MS = 4000;
// The overview/recap strip's auto-dismiss sweep (Sprint 14 Task 7): shown
// expanded for this long, then folds to a compact one-line handle rather
// than disappearing -- hover/click re-expands it (InsightStrip.tsx).
// Exported so InsightStrip's own CSS sweep animation can share the exact
// same duration (via a --cx-strip-fold-duration custom property, the same
// technique TitleBar's ring uses) rather than a second, driftable copy.
export const STRIP_FOLD_MS = 6000;

// ---- Pure display logic (exported for the Task 9 vitest/jsdom spec, the
// annotations.ts testable-module precedent) ----

/** The history sent to onSend is pure role/content -- tags never leave the overlay. */
export function stripHistory(messages: readonly DisplayMessage[]): TurnMessage[] {
  return messages.map(({ role, content }) => ({ role, content }));
}

export function capTags(tags: ProfileTag[] | undefined): ProfileTag[] {
  return (tags ?? []).slice(0, MAX_TAGS_PER_TURN);
}

/**
 * The tags/annotations/annotationColors extras every committed assistant
 * DisplayMessage carries (Sprint 14 Task 7) -- one place for the three
 * commit sites (text, voice, opening scan) so the color assignment is
 * computed the exact same way regardless of which turn kind produced it.
 */
function assistantMessageExtras(result: {
  tags?: ProfileTag[];
  annotations?: Annotation[];
}): Pick<DisplayMessage, 'tags' | 'annotations' | 'annotationColors'> {
  return {
    ...(result.tags && result.tags.length > 0 ? { tags: capTags(result.tags) } : {}),
    ...(result.annotations && result.annotations.length > 0
      ? { annotations: result.annotations, annotationColors: assignAnnotationColors(result.annotations) }
      : {}),
  };
}

/**
 * The ping dedupe gate: ≤2 per turn, and (Sprint 14 Task 7, widened from
 * Sprint 13's mastery-up-only rule) at most ONE ping of a given KIND per
 * concept per session for every kind EXCEPT misconception-resolved -- the
 * looser Task 5 thresholds (mastery-up's two new transitions, mastery-
 * progress, streak-progress) can otherwise fire repeatedly for the same
 * concept across a long session, and this is the client-side cap that
 * keeps that from reading as spam. `shownPingKeys` is the session-lifetime
 * dedupe set, keyed `${kind}:${conceptKey}` so two DIFFERENT kinds on the
 * SAME concept (e.g. a mastery-up then, later, a mastery-progress) each
 * still get their own one-time celebration; mutated here, reset when a
 * SESSION_RECAP_EVENT arrives (the session is over). misconception-resolved
 * stays exempt, unchanged from Sprint 13 -- each completed streak is a
 * distinct, real, non-repeating event (Task 5 didn't loosen its threshold).
 */
export function filterPingsForDisplay(
  pings: readonly TurnPing[] | undefined,
  shownPingKeys: Set<string>,
): TurnPing[] {
  const shown: TurnPing[] = [];
  for (const ping of pings ?? []) {
    if (shown.length >= MAX_PINGS_PER_TURN) break;
    if (ping.kind !== 'misconception-resolved') {
      const key = `${ping.kind}:${ping.conceptKey}`;
      if (shownPingKeys.has(key)) continue;
      shownPingKeys.add(key);
    }
    shown.push(ping);
  }
  return shown;
}

/**
 * Delta vs the panel-open overview snapshot (ADR-025: computed client-side,
 * never persisted). null when there is no baseline for the concept -- the
 * recap then shows the absolute value with no arrow, by design.
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

export type CloseChoreographyState = 'idle' | 'completing' | 'ringing' | 'closed';
export type CloseChoreographyEvent = 'complete' | 'recap-grace-elapsed' | 'ring-elapsed' | 'reset';

/**
 * idle -> completing (a turn's session.complete just arrived, or the
 * student clicked ✕ -- give the SESSION_ENDED recap broadcast a moment to
 * land) -> ringing (the ~4s green ring sweep) -> closed (Overlay.tsx's own
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

// A short head start for the SESSION_ENDED recap broadcast (fired
// unawaited by the background the moment it sees session.complete, Sprint
// 14 Task 6) to land before the ring starts sweeping -- so the recap card
// is already visible for the whole ~4s sweep rather than popping in
// mid-ring. Not a promise race against the broadcast (there's no promise to
// await here, it's a separate chrome.runtime message) -- just a fixed,
// generous buffer.
export const RECAP_GRACE_MS = 400;
export const CLOSE_RING_MS = 4000;

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

// ---- Sprint 14 Task 7: kind -> color mappings (ADR-018 discipline: no new
// colors, just naming which existing alias each kind reads) ----

// Reused by Transcript's tag pills AND (for known-gap/due-review)
// InsightStrip's weak-spot/due-for-review lines -- "kind->color mapping
// shared with the strip" from the sprint plan. `reviewing` and `strength`
// intentionally share one color (green): the brand has exactly four
// non-neutral hues (green/red/amber/blue) and amber fails AA as small TEXT
// on the panel's light surface (~2.97:1, measured against #f7f7f5 --
// verified while building this, not assumed), so it's reserved for the
// annotation layer's existing non-text fill/stroke use and excluded from
// every NEW text-colored alias here. Five kinds, four AA-safe hues:
// reviewing/strength share green (both a "you're doing fine here" framing,
// disambiguated by their own text prefixes), known-gap is red, due-review
// is blue, callback is a quieter neutral (a factual nod to history, not an
// urgent signal).
export const TAG_KIND_COLOR_CLASS: Record<ProfileTagKind, string> = {
  reviewing: 'cx-tag-reviewing',
  strength: 'cx-tag-reviewing',
  'known-gap': 'cx-tag-gap',
  'due-review': 'cx-tag-due',
  callback: 'cx-tag-callback',
};

// Ping-kind colors: the two mastery kinds (a state crossing, or a real
// in-state jump) read as the same positive green as a resolved gap
// (closing a gap is equally good news); streak-progress (not yet resolved,
// still in progress) reads blue -- distinct from "already achieved" green,
// consistent with due-review's blue above ("something in motion, not done
// yet").
export const PING_KIND_COLOR_CLASS: Record<TurnPingKind, string> = {
  'mastery-up': 'cx-ping-green',
  'mastery-progress': 'cx-ping-green',
  'misconception-resolved': 'cx-ping-green',
  'streak-progress': 'cx-ping-blue',
};

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
// Sprint 14 Task 2: the five pieces of that layout now live in their own
// files (TitleBar, Composer, InsightStrip, Transcript, PingToasts) --
// presentational components that take props/callbacks. Overlay.tsx keeps
// every state hook, effect, and handler (moved, not rewritten) and is the
// composition root that wires them together; behavior is unchanged.
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
  onTranscribe,
  onSynthesize,
  onVoicePlaybackStart,
  onLoadOverview,
  onEndSession,
  onOpeningScan,
}: {
  onSend: (messages: TurnMessage[], onChunk?: (chunk: string) => void) => Promise<TurnResult>;
  onTranscribe: (audio: Utterance) => Promise<{ transcript: string; sttMs: number }>;
  onSynthesize: (text: string) => Promise<{ audio: ArrayBuffer; ttsMs: number }>;
  // Called once synthesized speech actually starts playing, with its known
  // duration in ms -- content/index.ts uses this to reveal the turn's
  // annotations sequenced to playback instead of all at once (voice-mode
  // sub-term sequencing, Sprint 12 follow-up). Overlay itself does nothing
  // with annotations -- it just reports the moment/duration, same as every
  // other chrome.*-free callback here.
  onVoicePlaybackStart: (durationMs: number) => void;
  // Sprint 13 (ADR-024/025): fetches the read-only profile overview
  // (GET_PROFILE_OVERVIEW via content -> background). Called on panel
  // expand when no messages exist yet; a rejection renders nothing (the
  // Sprint 10 empty state, unchanged). chrome.*-free, like every prop here.
  onLoadOverview: () => Promise<ProfileOverview>;
  // Sprint 13 (ADR-025): sends the existing END_SESSION message -- the same
  // handler, RPC, and storage-clear the popup uses, no parallel path. The
  // recap does not come back through this promise -- it arrives via the
  // SESSION_ENDED broadcast so a popup-triggered end renders identically.
  onEndSession: () => Promise<void>;
  // Sprint 14 Task 6/7 (ADR-030): the proactive opening scan. Called on
  // panel expand under the SAME guard as onLoadOverview (no messages yet) --
  // content/index.ts runs its own plausible-problem gate first and resolves
  // null when there's nothing to scan, the call failed, or the model found
  // nothing confident to say; a non-null result renders as the first
  // assistant bubble, no preceding student message. chrome.*-free, like
  // every prop here -- content/index.ts owns the OPENING_SCAN message and
  // drawing any annotations it carries; `annotations` also rides the
  // resolved result (Task 7) so this file can color-link the first bubble
  // exactly like every other turn.
  onOpeningScan: () => Promise<{ reply: string; tags?: ProfileTag[]; annotations?: Annotation[] } | null>;
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
  const [recording, setRecording] = useState(false);
  // Task 5 (ADR-033): flips true SYNCHRONOUSLY on mic click (the UI-ack
  // budget, ≤100ms -- trivially met since it's a plain setState in the same
  // handler tick), false again once `recording` goes true OR on any error.
  // Never true at the same time as `recording` -- the composer renders one
  // honest state at a time: idle -> connecting -> listening.
  const [connecting, setConnecting] = useState(false);
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

  // ---- Sprint 13 profile-visibility state (all display-ephemeral, ADR-024) ----
  // The "where you are" overview, fetched fresh on every panel open and held
  // in overlay state only. baselineRef keeps the last successful snapshot as
  // the recap's client-side delta baseline (ADR-025) -- a ref, not state,
  // because nothing re-renders when it changes; it is only read at recap
  // render time.
  const [overview, setOverview] = useState<ProfileOverview | null>(null);
  const baselineRef = useRef<ProfileOverview | null>(null);
  // The session recap, set by SESSION_RECAP_EVENT and discarded on panel
  // close / the next sent message (shown once, ADR-025).
  const [recap, setRecap] = useState<SessionRecap | null>(null);
  // Active ping toasts + their auto-dismiss timers, and the one-mastery-up-
  // per-concept-per-session dedupe map (cleared when the session ends).
  const [activePings, setActivePings] = useState<{ id: number; ping: TurnPing }[]>([]);
  const pingIdRef = useRef(0);
  const pingTimersRef = useRef<number[]>([]);
  const shownMasteryUpRef = useRef<Set<string>>(new Set());
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
  const closeTimersRef = useRef<number[]>([]);
  // The manual-end confirm dialog (Sprint 14 fix pass): clicking ✕ opens this
  // instead of ending immediately -- ending discards the live session, so it
  // asks first. Distinct from the automatic close: a confirmed manual end
  // skips the ring entirely (the ring is only for Calyxa's own "session over"
  // detection).
  const [showEndConfirm, setShowEndConfirm] = useState(false);

  function clearCloseTimers() {
    for (const timer of closeTimersRef.current) window.clearTimeout(timer);
    closeTimersRef.current = [];
  }

  // The strip's (InsightStrip) auto-dismiss fold: expanded while a fresh
  // overview/recap is showing, folds to a one-line handle after
  // STRIP_FOLD_MS -- unless the close choreography is already running, in
  // which case the recap holds through the ring (the sprint plan's own
  // phrasing) rather than folding mid-sweep. stripHovered is a transient
  // peek (same pattern as the idle pill's pillHovered above); clicking the
  // folded handle un-folds it more durably via setStripFolded directly.
  const [stripFolded, setStripFolded] = useState(false);
  const [stripHovered, setStripHovered] = useState(false);

  // The overview card renders whenever there's no STUDENT message yet --
  // not "zero messages" -- so it renders ALONGSIDE the opening scan's own
  // assistant-first bubble, not instead of it (ADR-030 Decision 4): the
  // scan's message doesn't answer "where do I generally stand", the two
  // surfaces answer different questions and both belong on screen together.
  const hasStudentMessage = messages.some((message) => message.role === 'user');
  const showOverviewCard = overview !== null && !hasStudentMessage && !busy && !liveTranscript && !recap;

  // True whenever the chat area should be rendered (no gap when empty).
  const hasContent =
    messages.length > 0 || busy || !!notice || !!liveTranscript || !!recap;

  function appendStreamToken(text: string) {
    const id = tokenIdRef.current++;
    setStreamingTokens((prev) => [...prev, { text, id }]);
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
      for (const timer of pingTimersRef.current) clearTimeout(timer);
      pingTimersRef.current = [];
      clearCloseTimers();
    };
  }, []);

  // Shows a turn's pings through the dedupe gate and schedules each one's
  // ~4s auto-dismiss. Called at `done` for text turns (the promise resolve)
  // and at playback start for voice turns (see handleMicStop).
  function showPings(pings: TurnPing[] | undefined) {
    const shown = filterPingsForDisplay(pings, shownMasteryUpRef.current);
    if (shown.length === 0) return;
    const entries = shown.map((ping) => ({ id: pingIdRef.current++, ping }));
    setActivePings((prev) => [...prev, ...entries]);
    for (const entry of entries) {
      const timer = window.setTimeout(() => {
        setActivePings((prev) => prev.filter((item) => item.id !== entry.id));
      }, PING_DISMISS_MS);
      pingTimersRef.current.push(timer);
    }
  }

  // Drives nextCloseState with real timers (Sprint 14 Task 7): called
  // whenever a turn's session.complete arrives (automatic) or the student
  // clicks ✕ (manual, handleEndSessionClick below) -- both converge on the
  // SAME visible choreography. A no-op if the choreography is already
  // running (idle is the only state 'complete' does anything from), so a
  // stray second signal can't restart the ring mid-sweep.
  function beginCloseChoreography() {
    setCloseState((prev) => {
      const next = nextCloseState(prev, 'complete');
      if (next === prev) return prev;
      const graceTimer = window.setTimeout(() => {
        setCloseState((state) => nextCloseState(state, 'recap-grace-elapsed'));
        const ringTimer = window.setTimeout(() => {
          setCloseState((state) => nextCloseState(state, 'ring-elapsed'));
        }, CLOSE_RING_MS);
        closeTimersRef.current.push(ringTimer);
      }, RECAP_GRACE_MS);
      closeTimersRef.current.push(graceTimer);
      return next;
    });
  }

  // The choreography's actual teardown (Sprint 14 Task 7): fires exactly
  // once, when closeState reaches 'closed' -- collapse to the pill, clear
  // the transcript, reset the progress bar, drop the recap/overview (a
  // fresh open re-fetches), and dispatch PANEL_CLOSED_EVENT for the
  // annotation controller, same as a manual minimize. Then resets the
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
  // pill, clear the transcript, reset the progress bar, drop the
  // recap/overview, and dispatch PANEL_CLOSED_EVENT for the annotation
  // controller. Shared by TWO paths: the automatic close choreography's final
  // step (after the green ring sweep) AND a confirmed manual ✕ end, which
  // runs this DIRECTLY with no ring (handleEndSessionConfirmed below).
  function performClose() {
    setExpanded(false);
    setMessages([]);
    setSolutionProgress(0);
    setAnnotationColors({});
    setRecap(null);
    setOverview(null);
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

  // Overview fetch: on every panel expand while the conversation is still
  // empty ("before the first question"). Fresh per open, never cached
  // (the capturedPageContext discipline applied to profile data, ADR-024);
  // a failure renders nothing -- the Sprint 10 empty state, unchanged --
  // and never blocks asking a question.
  useEffect(() => {
    if (!expanded) return;
    if (messages.length > 0) return;
    let cancelled = false;
    onLoadOverview()
      .then((data) => {
        if (cancelled) return;
        setOverview(data);
        baselineRef.current = data;
      })
      .catch((error) => {
        console.debug('Calyxa overlay: overview unavailable, rendering empty state', error);
      });
    return () => {
      cancelled = true;
    };
    // Deliberately keyed to `expanded` alone: "fresh on each panel open",
    // not on every message-list change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded]);

  // Guards the opening scan (below) against React StrictMode's dev-only
  // double-invoke of effects (mount -> cleanup -> mount again, same
  // `expanded` value). onLoadOverview above tolerates that harmlessly (a
  // duplicate GET), but onOpeningScan triggers a real, billable
  // api.startSession -- a duplicate there is a real session/quota bug, not
  // a cosmetic one, so unlike that effect this one needs an explicit
  // in-flight guard. Reset only when the panel actually closes (the effect
  // body's own `!expanded` branch, not the cleanup function, which also
  // runs on StrictMode's simulated remount and would otherwise defeat the
  // guard) -- a genuine re-expand after a minimize is still free to try again.
  const openingScanFiredRef = useRef(false);

  // The proactive opening scan (Sprint 14 Task 6, ADR-030): fires under the
  // EXACT same guard as the overview fetch above -- "expanded, and no
  // conversation yet" -- since it is itself the session start and must
  // never fire a second time once a conversation exists. A null result (the
  // content script's plausible-problem gate found nothing, the call
  // failed, or the model declined to name a problem) renders nothing, the
  // empty state, same as a failed overview fetch. A real result appends the
  // FIRST assistant bubble with no preceding student message -- the
  // opening scan's whole point.
  useEffect(() => {
    if (!expanded) {
      openingScanFiredRef.current = false;
      return;
    }
    if (messages.length > 0) return;
    if (openingScanFiredRef.current) return;
    openingScanFiredRef.current = true;
    let cancelled = false;
    onOpeningScan()
      .then((result) => {
        if (cancelled || !result) return;
        // Task 7: the opening scan's own bubble gets the same per-turn
        // annotation-color assignment as any other turn (its "say" line is
        // held to the same exact-target.text-reuse discipline).
        setMessages((current) => [
          ...current,
          { role: 'assistant', content: result.reply, ...assistantMessageExtras(result) },
        ]);
        // Task 8: AnnotationLayer's box-stroke lookup reads the SAME map.
        setAnnotationColors(assignAnnotationColors(result.annotations));
      })
      .catch((error) => {
        console.debug('Calyxa overlay: opening scan unavailable, opening empty', error);
      });
    return () => {
      cancelled = true;
    };
    // Deliberately keyed to `expanded` alone, matching the overview effect above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded]);

  // Recap arrival (SESSION_ENDED -> content -> this event). A recap-less
  // end (no gradable interactions) sets null and renders nothing. The
  // session is over either way, so the per-session mastery-up dedupe map
  // resets here.
  useEffect(() => {
    function onSessionRecap(event: Event) {
      const detail = (event as CustomEvent<{ recap?: SessionRecap }>).detail;
      setRecap(detail?.recap ?? null);
      shownMasteryUpRef.current.clear();
    }
    window.addEventListener(SESSION_RECAP_EVENT, onSessionRecap);
    return () => window.removeEventListener(SESSION_RECAP_EVENT, onSessionRecap);
  }, []);

  // The strip's auto-dismiss fold (Sprint 14 Task 7): expands fresh
  // whenever a NEW overview or recap object lands (both are replaced
  // wholesale, never mutated, so a reference change here always means
  // "something new to show"), then folds to the one-line handle after
  // STRIP_FOLD_MS -- unless the close choreography is already running, in
  // which case the recap holds through the ring rather than folding
  // mid-sweep (the panel closes well before the fold timer would fire
  // anyway, since CLOSE_RING_MS < STRIP_FOLD_MS, but this is the
  // defensive, correct-by-construction version of that fact rather than a
  // lucky timing coincidence).
  useEffect(() => {
    if (!overview && !recap) return;
    setStripFolded(false);
    if (closeState !== 'idle') return;
    const timer = window.setTimeout(() => setStripFolded(true), STRIP_FOLD_MS);
    return () => window.clearTimeout(timer);
  }, [overview, recap, closeState]);

  // Scroll to bottom when messages, streaming tokens, or live transcript change.
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, streamingTokens, liveTranscript]);

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

  // The progress bar + close choreography share one commit-time hook
  // (Sprint 14 Task 7): called at the moment each path's reply actually
  // becomes visible -- immediately for text (handleSubmit), after TTS
  // playback for voice (handleMicStop, matching where tags already commit
  // there). `solved` forces the bar to 1 before the choreography's own
  // "Now closing tutoring session." bubble is even read.
  function applyProgressAndCompletion(result: TurnResult) {
    setSolutionProgress((prev) => easeProgress(prev, result.solutionProgress, result.session?.reason === 'solved'));
    if (result.session?.complete) beginCloseChoreography();
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = input.trim();
    if (!text || busy) return;

    // The wire history is stripped to role/content (tags never re-enter the
    // request, ADR-024); the display list keeps its DisplayMessage shape.
    const outbound: TurnMessage[] = [...stripHistory(messages), { role: 'user', content: text }];
    setMessages((current) => [...current, { role: 'user', content: text }]);
    setRecap(null); // shown once -- a new conversation replaces it
    setInput('');
    setNotice(null);
    setBusy(true);
    clearStreamTokens();

    try {
      const result = await onSend(outbound, (chunk) => {
        appendStreamToken(chunk);
      });
      if (!result.reply.trim()) throw new Error('The tutor returned an empty reply.');
      clearStreamTokens();
      // Text path: tags/annotations commit WITH the bubble at `done`, and
      // pings show at the same moment (the promise resolves when `done`
      // arrives).
      setMessages((current) => [
        ...current,
        { role: 'assistant', content: result.reply, ...assistantMessageExtras(result) },
      ]);
      // Task 8: AnnotationLayer's box-stroke lookup reads the SAME map.
      setAnnotationColors(assignAnnotationColors(result.annotations));
      showPings(result.pings);
      applyProgressAndCompletion(result);
    } catch (error) {
      clearStreamTokens();
      setNotice(describeError(error, "Couldn't reach the tutor — try again."));
    } finally {
      setBusy(false);
    }
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
    setConnecting(true);
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
      setRecording(true);
      setConnecting(false);
      startLevelMeter();
    } catch (error) {
      speechRecRef.current?.stop();
      speechRecRef.current = null;
      setLiveTranscript('');
      setConnecting(false);
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
    setRecording(false);
    stopLevelMeter();
    // Stop SR updates but keep liveTranscript visible so there is no gap
    // between "user stopped speaking" and "Whisper result appears".
    speechRecRef.current?.stop();
    speechRecRef.current = null;
    setBusy(true);
    clearStreamTokens();

    try {
      const utterance = await handle.stop();
      const { transcript } = await onTranscribe(utterance);

      // Swap the live interim bubble for the accurate Whisper result atomically.
      setLiveTranscript('');
      const outbound: TurnMessage[] = [...stripHistory(messages), { role: 'user', content: transcript }];
      setMessages((current) => [...current, { role: 'user', content: transcript }]);
      setRecap(null); // shown once -- a new conversation replaces it

      // Voice path: no onChunk because TTS needs the full reply before synthesis.
      const result = await onSend(outbound);
      if (!result.reply.trim()) throw new Error('The tutor returned an empty reply.');

      const { audio } = await onSynthesize(result.reply);

      // Play audio and reveal the reply word-by-word in sync with speech.
      // Each word is appended as a new token so it gets the cx-word-in
      // entry animation. The reply commits to messages after playback ends.
      // Voice pings show at PLAYBACK START (ADR-026's delivery moment for
      // voice turns) -- piggybacked on the same playback-start signal the
      // annotation sequencing already uses.
      await playAudioWithTextReveal(audio, result.reply, appendStreamToken, setPlaying, audioRef, (durationMs) => {
        showPings(result.pings);
        onVoicePlaybackStart(durationMs);
      });

      clearStreamTokens();
      // Voice tags/annotations commit with the reply after playback -- they
      // don't pre-announce what the tutor hasn't said yet (Task 8 spec).
      // Progress/completion apply at the SAME moment, for the same reason.
      setMessages((current) => [
        ...current,
        { role: 'assistant', content: result.reply, ...assistantMessageExtras(result) },
      ]);
      // Task 8: AnnotationLayer's box-stroke lookup reads the SAME map.
      setAnnotationColors(assignAnnotationColors(result.annotations));
      applyProgressAndCompletion(result);
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
    // The recap is shown once and discarded on panel close (ADR-025); the
    // overview is refetched fresh on the next open. Minimizing does NOT
    // end the session.
    setRecap(null);
    setOverview(null);
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
      <PingToasts pings={activePings} />

      {/* ── Overview/recap summary (Sprint 14 fix pass) — a small floating
          WINDOW ABOVE the whole extension, not a strip wedged inside the
          panel. It animates in on session start (overview) and session end
          (recap), and auto-dismisses with a smooth exit after STRIP_FOLD_MS
          (held open while hovered, and held through the close ring). Renders
          alongside the opening scan's own bubble, not instead of it. */}
      {(showOverviewCard || recap) && (
        <div
          className={`cx-strip-window mb-2${stripFolded && !stripHovered ? ' cx-strip-window--hidden' : ''}`}
          onMouseEnter={() => setStripHovered(true)}
          onMouseLeave={() => setStripHovered(false)}
        >
          <InsightStrip
            {...(recap ? { kind: 'recap', recap, baseline: baselineRef.current } : { kind: 'overview', overview: overview! })}
            foldDurationMs={STRIP_FOLD_MS}
            onMouseEnter={() => setStripHovered(true)}
            onMouseLeave={() => setStripHovered(false)}
          />
        </div>
      )}

      <div className="relative overflow-hidden rounded-lg border border-border bg-background/85 shadow-panel backdrop-blur-[18px] backdrop-saturate-[1.5]">

        <TitleBar
          playing={playing}
          isDragging={isDragging}
          recording={recording}
          busy={busy}
          ending={ending}
          closing={closeState !== 'idle'}
          ringing={closeState === 'ringing'}
          ringDurationMs={CLOSE_RING_MS}
          onHeaderPointerDown={handleHeaderPointerDown}
          onHeaderPointerMove={handleHeaderPointerMove}
          onHeaderPointerUp={handleHeaderPointerUp}
          onInterrupt={handleInterrupt}
          onMinimize={handleMinimize}
          onCloseSession={() => void handleEndSessionClick()}
        />

        {/* ── Chat area — only rendered when there is something to show ── */}
        {hasContent && (
          <div
            aria-live="polite"
            className="flex max-h-[272px] flex-col gap-3 overflow-y-auto px-4 py-3 scroll-smooth"
          >
            <Transcript
              messages={messages}
              streamingTokens={streamingTokens}
              busy={busy}
              notice={notice}
              liveTranscript={liveTranscript}
              chatEndRef={chatEndRef}
            />
          </div>
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
          solutionProgress={solutionProgress}
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
