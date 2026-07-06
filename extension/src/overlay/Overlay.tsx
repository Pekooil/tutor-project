import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from 'react';
import { CalyxaMark } from '@calyxa/ui';
import './Overlay.css';
import type {
  ProfileOverview,
  ProfileTag,
  SessionRecap,
  TurnMessage,
  TurnPing,
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

// The session-recap signal (Sprint 13, ADR-025): content/index.ts forwards
// the background's SESSION_ENDED broadcast as this window CustomEvent (the
// 'calyxa:toggle-panel' bridge pattern, reversed direction), detail
// `{ recap?: SessionRecap }`. Flows content -> Overlay only.
export const SESSION_RECAP_EVENT = 'calyxa:session-recap';

// What one turn resolves to (Sprint 13): the reply plus the turn's grounded
// profile tags and computed event pings, when the wire carried any --
// content/index.ts's sendAiTurn builds this from the `done` message / the
// AI_REPLY payload on both paths. The empty-reply guard keys on `reply`
// exactly as it did when onSend resolved a bare string.
export type TurnResult = { reply: string; tags?: ProfileTag[]; pings?: TurnPing[] };

// Local DISPLAY message type (Sprint 13, ADR-024): the transcript the
// overlay renders carries each assistant bubble's tags, but the history
// handed back to onSend is stripped to role/content (stripHistory below) --
// tags are display-ephemeral and never re-enter the wire request.
export type DisplayMessage = TurnMessage & { tags?: ProfileTag[] };

// Client-side caps (defence in depth -- the server already enforces both):
// ≤2 tags per bubble (envelope.ts's MAX_PROFILE_TAGS) and ≤2 pings per turn
// (ADR-026's delivery contract).
export const MAX_TAGS_PER_TURN = 2;
export const MAX_PINGS_PER_TURN = 2;
const PING_DISMISS_MS = 4000;

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
 * The ping dedupe gate: ≤2 per turn, and at most ONE mastery-up per concept
 * per session (a state oscillating across a boundary doesn't re-celebrate,
 * ADR-026). `shownMasteryUpConcepts` is the session-lifetime dedupe map,
 * mutated here; it resets when a SESSION_RECAP_EVENT arrives (the session
 * is over). Resolved pings are not deduped -- each completed streak is a
 * distinct, real event.
 */
export function filterPingsForDisplay(
  pings: readonly TurnPing[] | undefined,
  shownMasteryUpConcepts: Set<string>,
): TurnPing[] {
  const shown: TurnPing[] = [];
  for (const ping of pings ?? []) {
    if (shown.length >= MAX_PINGS_PER_TURN) break;
    if (ping.kind === 'mastery-up') {
      if (shownMasteryUpConcepts.has(ping.conceptKey)) continue;
      shownMasteryUpConcepts.add(ping.conceptKey);
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

  // The overview card renders only in the true empty state -- the Sprint 10
  // empty panel's upgrade, never competing with a conversation or the recap.
  const showOverviewCard =
    overview !== null && messages.length === 0 && !busy && !liveTranscript && !recap;

  // True whenever the chat area should be rendered (no gap when empty).
  const hasContent =
    messages.length > 0 || busy || !!notice || !!liveTranscript || showOverviewCard || !!recap;

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
      // Text path: tags commit WITH the bubble at `done`, and pings show at
      // the same moment (the promise resolves when `done` arrives).
      setMessages((current) => [
        ...current,
        {
          role: 'assistant',
          content: result.reply,
          ...(result.tags && result.tags.length > 0 ? { tags: capTags(result.tags) } : {}),
        },
      ]);
      showPings(result.pings);
    } catch (error) {
      clearStreamTokens();
      setNotice(describeError(error, "Couldn't reach the tutor — try again."));
    } finally {
      setBusy(false);
    }
  }

  async function handleMicStart() {
    if (busy || recording || startingRef.current) return;
    setNotice(null);
    startingRef.current = true;
    try {
      const handle = await startRecording();
      recordingRef.current = handle;
      setRecording(true);
      startLevelMeter();

      // Best-effort live transcript: run SpeechRecognition in parallel with
      // MediaRecorder so words appear in the bubble as the user speaks.
      // SpeechRecognition's interim results are intentionally low-accuracy;
      // Whisper's final transcript is the source of truth (see handleMicStop).
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const SR = (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition;
      if (SR) {
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
    } catch (error) {
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
      // Voice tags commit with the reply after playback -- they don't
      // pre-announce what the tutor hasn't said yet (Task 8 spec).
      setMessages((current) => [
        ...current,
        {
          role: 'assistant',
          content: result.reply,
          ...(result.tags && result.tags.length > 0 ? { tags: capTags(result.tags) } : {}),
        },
      ]);
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

  function handleClose() {
    setExpanded(false);
    setDragPos(null);
    setIsDragging(false);
    dragOriginRef.current = null;
    // The recap is shown once and discarded on panel close (ADR-025); the
    // overview is refetched fresh on the next open. Panel close does NOT
    // end the session -- that is only ever an explicit END_SESSION.
    setRecap(null);
    setOverview(null);
    window.dispatchEvent(new CustomEvent(PANEL_CLOSED_EVENT));
  }

  // The overlay's End-session control (Sprint 13, ADR-025): reuses the
  // popup's END_SESSION path verbatim via the onEndSession callback. The
  // recap does not come back through this promise -- it arrives via the
  // SESSION_ENDED broadcast so a popup-triggered end renders identically.
  async function handleEndSession() {
    if (busy || ending || recording) return;
    setEnding(true);
    setNotice(null);
    try {
      await onEndSession();
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
        <AnnotationLayer />
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
      <AnnotationLayer />
      <div
        ref={panelRef}
        className={`fixed z-[2147483647] w-[420px] font-sans text-base text-foreground${isDragging ? ' select-none' : ''}${!dragPos ? ' bottom-7 left-1/2 -translate-x-1/2' : ''}`}
        style={dragPos ? { top: `${dragPos.y}px`, left: `${dragPos.x}px` } : undefined}
      >
      <PingToasts pings={activePings} />
      <div className="overflow-hidden rounded-lg border border-border bg-background/85 shadow-panel backdrop-blur-[18px] backdrop-saturate-[1.5]">

        <TitleBar
          playing={playing}
          isDragging={isDragging}
          recording={recording}
          busy={busy}
          ending={ending}
          onHeaderPointerDown={handleHeaderPointerDown}
          onHeaderPointerMove={handleHeaderPointerMove}
          onHeaderPointerUp={handleHeaderPointerUp}
          onInterrupt={handleInterrupt}
          onClose={handleClose}
          onEndSession={() => void handleEndSession()}
        />

        {/* ── Chat area — only rendered when there is something to show ── */}
        {hasContent && (
          <div
            aria-live="polite"
            className="flex max-h-[272px] flex-col gap-3 overflow-y-auto px-4 py-3 scroll-smooth"
          >
            {/* The "where you are" overview card (Sprint 13, ADR-024) --
                the empty state's upgrade, rendered before the first
                question and only then. */}
            {showOverviewCard && overview && <InsightStrip kind="overview" overview={overview} />}

            <Transcript
              messages={messages}
              streamingTokens={streamingTokens}
              busy={busy}
              notice={notice}
              liveTranscript={liveTranscript}
              recap={recap}
              baseline={baselineRef.current}
              chatEndRef={chatEndRef}
            />
          </div>
        )}

        {/* ── Input row — border-t only when chat area is present above ── */}
        <Composer
          hasContent={hasContent}
          recording={recording}
          level={level}
          input={input}
          busy={busy}
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
