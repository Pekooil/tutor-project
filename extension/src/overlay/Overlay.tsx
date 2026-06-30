import { useEffect, useRef, useState, type CSSProperties, type FormEvent } from 'react';
import { Button, CalyxaMark, Card, VisuallyHidden } from '@calyxa/ui';
import './Overlay.css';
import type { TurnMessage } from '../types/messages';
import { startRecording, type RecordingHandle, type Utterance } from './VoiceController';

// Calyxa overlay — Sprint 06 voice turn (grew from the Sprint 05 text chat).
//
// Presentational only. This component knows nothing about chrome.* APIs,
// messaging, or the keyboard shortcut — those live in the content and
// background scripts. `onSend`/`onTranscribe`/`onSynthesize` are the three
// seams to the outside world: the content script supplies them (threaded
// through mount.tsx) for one AI_TURN / VOICE_STT / VOICE_TTS round trip each.
//
// History lives here, in React state, not in the background worker: the
// overlay/content-script context lives for the page's lifetime, while the
// worker is ephemeral and holds no conversation memory (ADR-008 history
// model) — so every onSend() call below carries the full transcript so far,
// voice turn or text turn alike.
//
// Voice turn (ADR-010): click the mic button to start capture -> it keeps
// recording until the mic button (now shown white with a black frame and a
// black square, matching the TTS "Stop speaking" control) is clicked again
// -> stop resolves one utterance -> onTranscribe -> the
// transcript is appended as the user turn -> onSend(history) (the SAME AI
// leg text turns use, unchanged) -> the reply is appended ->
// onSynthesize(reply) -> the audio plays. Click-to-toggle, not
// press-and-hold, and no keyboard chord: round 4 (this round) removed both
// the press-and-hold mic button and the Option+Shift+V shortcut in favor of
// a single click-to-start/click-to-stop control, and removed the dedicated
// full-panel "listening" view — recording now happens inline, in the same
// input row (see "asking" below). Text input is the always-available
// fallback (ADR-011): if getUserMedia is unavailable/denied or any voice leg
// throws, a notice is shown and the turn degrades to text-in/text-out,
// exactly the Sprint 05 path, never a dead end.
//
// Sprint 10 Task 6 (Calyxa Overlay.dc.html — the locked design handoff):
// three composed moments, all in this one component —
//   idle   : a 140x48 pill (mark + wordmark + a breathing "ready" dot).
//   asking : the 420px panel — header (mark + "Calyxa" + "Typing" badge),
//            text input + mic-switch + send, hint row "↵ to send · tap the
//            mic to speak instead". Clicking the mic-switch starts recording:
//            the header badge switches to a green "Listening" dot + label,
//            the input swaps for the live waveform, the mic button shows a
//            black stop square, and the hint row is hidden.
//   thinking: the input/reply is swapped for a single breathing orb while
//            onTranscribe/onSend/onSynthesize is in flight.
//   reply  : the most recent assistant turn renders inline, above the input
//            row — never a scrollback list. Derived from the tail of
//            `messages`, not separate state, so it updates and clears
//            itself for free as the conversation continues.
// `expanded` still gates idle vs. open exactly as round 2 did: the keyboard
// shortcut's mount/remove toggle (content/index.ts, untouched) still owns
// fully opening/closing the overlay — ADR-002's zero-footprint-while-closed
// guarantee is unchanged, and there is still deliberately no in-panel close
// affordance (same "no new dismiss" rule as round 2).
//
// No visible message history or turn-timing panel this round (design
// explicitly drops both) — only the single latest assistant reply is ever
// shown. The full transcript is still threaded through every onSend() call
// exactly as before (ADR-008); this is a display choice, not a data one.
//
// Interrupt (new behavior, explicitly requested): raise-hand stops AI
// playback early via audioRef + a 'pause' listener in playAudio — see there.
//
// All styling lives in Overlay.css, which the content script injects INTO the
// shadow root (cssInjectionMode: 'ui', Task 3) so nothing bleeds onto — or in
// from — the host page. See /docs/adr/ADR-002-overlay-shadow-dom.md.
//
export function Overlay({
  onSend,
  onTranscribe,
  onSynthesize,
}: {
  onSend: (messages: TurnMessage[]) => Promise<string>;
  onTranscribe: (audio: Utterance) => Promise<{ transcript: string; sttMs: number }>;
  onSynthesize: (text: string) => Promise<{ audio: ArrayBuffer; ttsMs: number }>;
}) {
  const [expanded, setExpanded] = useState(false);
  const [messages, setMessages] = useState<TurnMessage[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [recording, setRecording] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  // Live mic input level (0 silence – 1 loud) while recording, polled off
  // VoiceController's AnalyserNode so the inline listening waveform sits at
  // rest until the user actually makes sound instead of animating
  // unconditionally.
  const [level, setLevel] = useState(0);

  const recordingRef = useRef<RecordingHandle | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const levelFrameRef = useRef<number | null>(null);
  // Guards a double-click on the mic from starting two overlapping
  // recordings: true from the moment it's clicked until startRecording()
  // (getUserMedia) resolves or fails.
  const startingRef = useRef(false);

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

  // Stop and release the mic if the overlay is dismissed mid-recording
  // (ADR-011 — no lingering capture).
  useEffect(() => {
    return () => {
      recordingRef.current?.cancel();
      recordingRef.current = null;
      stopLevelMeter();
    };
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = input.trim();
    if (!text || busy) return;

    const history: TurnMessage[] = [...messages, { role: 'user', content: text }];
    setMessages(history);
    setInput('');
    setNotice(null);
    setBusy(true);

    try {
      const reply = await onSend(history);
      if (!reply.trim()) {
        throw new Error('The tutor returned an empty reply.');
      }
      setMessages((current) => [...current, { role: 'assistant', content: reply }]);
    } catch (error) {
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
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Microphone is unavailable.';
      setNotice(`${message} Use the text input instead.`);
    } finally {
      startingRef.current = false;
    }
  }

  async function handleMicStop() {
    const handle = recordingRef.current;
    if (!handle) return; // nothing to stop (e.g. start() was still failing/initializing)
    recordingRef.current = null;
    setRecording(false);
    stopLevelMeter();
    setBusy(true);

    let replyDelivered = false;

    try {
      const utterance = await handle.stop();
      const { transcript } = await onTranscribe(utterance);

      const history: TurnMessage[] = [...messages, { role: 'user', content: transcript }];
      setMessages(history);

      const reply = await onSend(history);
      if (!reply.trim()) {
        throw new Error('The tutor returned an empty reply.');
      }
      setMessages((current) => [...current, { role: 'assistant', content: reply }]);
      replyDelivered = true;

      const { audio } = await onSynthesize(reply);
      await playAudio(audio, setPlaying, audioRef);
    } catch (error) {
      setNotice(
        describeError(
          error,
          replyDelivered
            ? "Got the reply, but couldn't speak it — shown as text above."
            : "Couldn't complete the voice turn — try again or use text.",
        ),
      );
    } finally {
      setBusy(false);
    }
  }

  function handleMicClick() {
    if (recording) {
      void handleMicStop();
    } else {
      void handleMicStart();
    }
  }

  // Raise-hand: stop playback early. audio.pause() alone never fires
  // 'ended'/'error', so playAudio's awaited promise also listens for
  // 'pause' — calling pause() here resolves it exactly like natural
  // playback completion would, running the same cleanup (setPlaying(false),
  // revoking the blob URL).
  function handleInterrupt() {
    audioRef.current?.pause();
  }

  if (!expanded) {
    return (
      <div className="fixed bottom-7 left-1/2 z-[2147483647] -translate-x-1/2 font-sans motion-safe:animate-[cx-rise_0.42s_cubic-bezier(0.2,0.8,0.2,1)_both]">
        <div className="relative">
          <div
            aria-hidden="true"
            className="calyxa-glow motion-safe:animate-[calyxa-breathe_2.7s_ease-in-out_infinite] pointer-events-none absolute -inset-2 rounded-full blur-md"
          />
          <button
            type="button"
            onClick={() => setExpanded(true)}
            aria-label="Open Calyxa"
            className="relative flex h-12 w-[140px] items-center gap-2 rounded-full border border-border bg-background px-4 shadow-panel outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
          >
            <CalyxaMark className="h-[22px] w-[22px] flex-none" />
            <span className="text-[15px] font-semibold tracking-tight text-foreground">calyxa</span>
            <span
              aria-hidden="true"
              className="ml-auto h-[9px] w-[9px] flex-none rounded-full bg-accent-glow-strong shadow-[0_0_0_4px_rgba(134,239,172,0.4)] motion-safe:animate-[cx-dot_2.2s_ease-in-out_infinite]"
            />
          </button>
        </div>
      </div>
    );
  }

  // Only the most recent assistant turn is ever shown — derived from the
  // tail of `messages`, not separate state (round 3, see top-of-file note).
  const lastTurn = messages[messages.length - 1];
  const lastReply = lastTurn?.role === 'assistant' ? lastTurn.content : null;

  return (
    <div className="fixed bottom-7 left-1/2 z-[2147483647] w-[420px] -translate-x-1/2 font-sans text-base text-foreground">
      <div className="overflow-hidden rounded-lg border border-border bg-background/85 shadow-panel backdrop-blur-[18px] backdrop-saturate-[1.5]">
        {playing ? (
          <header className="flex items-center justify-end gap-2 border-b border-border px-4 py-3">
            <span className="flex items-center gap-2">
              <span className="flex h-4 items-center">
                <WaveformBars count={7} barWidth={3} gap={3} gradientFrom="#22a06b" gradientTo="#4ade80" durationBase={0.65} />
              </span>
              <span className="text-[11.5px] text-muted-foreground">Speaking</span>
              <Button
                type="button"
                variant="icon"
                onClick={handleInterrupt}
                aria-label="Stop speaking"
                className="h-7 w-7 flex-none rounded-full border border-border"
              >
                <span aria-hidden="true" className="block h-2.5 w-2.5 rounded-[2px] bg-foreground" />
              </Button>
            </span>
          </header>
        ) : !busy ? (
          <header className="flex items-center gap-[9px] border-b border-border px-4 pb-3 pt-[14px]">
            <CalyxaMark className="h-[19px] w-[19px] flex-none" />
            <span className="text-[13.5px] font-semibold text-foreground">Calyxa</span>
            {recording ? (
              <span className="ml-auto flex items-center gap-1.5 rounded-full bg-accent-subtle px-[10px] py-1 text-[11.5px] font-semibold text-accent-emphasis">
                <span aria-hidden="true" className="h-[7px] w-[7px] rounded-full bg-accent-glow-strong motion-safe:animate-[cx-dot_1.4s_ease-in-out_infinite]" />
                Listening
              </span>
            ) : (
              <span className="ml-auto rounded-full border border-border bg-surface px-[10px] py-1 text-[11.5px] font-semibold text-muted-foreground">
                Typing
              </span>
            )}
          </header>
        ) : null}

        <div aria-live="polite" className="px-[18px] py-4">
          {busy ? (
            <div className="flex flex-col items-center gap-5 py-3.5">
              <div className="relative flex h-[76px] w-[76px] items-center justify-center">
                <div
                  aria-hidden="true"
                  className="absolute h-[76px] w-[76px] rounded-full border-2 border-accent motion-safe:animate-[cx-ring_2.6s_ease-out_infinite]"
                />
                <div
                  aria-hidden="true"
                  className="h-16 w-16 rounded-full shadow-[0_0_22px_rgba(74,222,128,0.5)] motion-safe:animate-[cx-orb_2.8s_ease-in-out_infinite]"
                  style={{ background: 'radial-gradient(circle at 38% 32%, #dcfce7 0%, #86efac 45%, #4ade80 100%)' }}
                />
              </div>
              <span className="text-[14.5px] text-muted-foreground">Thinking…</span>
            </div>
          ) : (
            <div className="flex flex-col gap-3.5">
              {lastReply && <p className="m-0 whitespace-pre-wrap break-words text-sm leading-relaxed text-foreground">{lastReply}</p>}

              {notice && (
                <Card role="alert" className="border-danger px-3 py-2 text-xs text-danger !shadow-none">
                  {notice}
                </Card>
              )}

              <form
                onSubmit={handleSubmit}
                className="flex items-center gap-2 rounded-full border border-border bg-background py-[7px] pr-[7px] pl-[18px] shadow-[0_1px_2px_rgba(15,23,42,0.03)]"
              >
                {recording ? (
                  // Explicit height, not h-full: the form row's own height is
                  // auto (only the <input> below has the intrinsic
                  // line-height that happens to size the row) — h-full on
                  // this plain div would resolve against that auto-height
                  // ancestor as 0, collapsing every bar (and this container)
                  // to nothing.
                  <div className="flex h-[34px] flex-1 items-center justify-center">
                    <VisuallyHidden>Recording — click the black square button to stop and send</VisuallyHidden>
                    <WaveformBars count={24} barWidth={3} gap={3} gradientFrom="#4ade80" gradientTo="#86efac" durationBase={0.9} level={level} />
                  </div>
                ) : (
                  <input
                    className="h-full flex-1 border-none bg-transparent text-[14.5px] text-foreground outline-none placeholder:text-muted-foreground"
                    type="text"
                    value={input}
                    onChange={(event) => setInput(event.target.value)}
                    placeholder="Ask a math question…"
                  />
                )}
                <button
                  type="button"
                  onClick={handleMicClick}
                  aria-label={recording ? 'Stop recording and send' : 'Switch to voice'}
                  title={recording ? 'Stop and send' : 'Switch to voice'}
                  className="flex h-[34px] w-[34px] flex-none cursor-pointer items-center justify-center rounded-full border border-border bg-background p-0 outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
                >
                  {recording ? (
                    <span aria-hidden="true" className="block h-2.5 w-2.5 rounded-[2px] bg-muted-foreground" />
                  ) : (
                    <span aria-hidden="true" className="block h-[13px] w-[7px] rounded-full bg-muted-foreground" />
                  )}
                </button>
                <button
                  type="submit"
                  disabled={!input.trim() || recording}
                  className="h-[34px] flex-none cursor-pointer rounded-full border-0 bg-accent px-[17px] text-[13px] font-semibold text-accent-foreground outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Send
                </button>
              </form>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// One reactive waveform, two contexts: the inline listening view (large, 24
// bars) and the TTS-playback header indicator (small, 7 bars) — same
// bar/gradient shape, different count/size/speed (Calyxa Overlay.dc.html's
// mkBars).
//
// The two contexts drive the bars differently, because only one of them has
// a real signal to follow:
//   - TTS playback (no `level` passed) has no live amplitude available, so
//     it keeps the original always-on loop: a per-bar animation-duration/
//     delay via the `.cx-bar` CSS class + inline style (Tailwind's
//     arbitrary-value `animate-[...]` can't express per-element timing,
//     resolved once at build time).
//   - Mic listening (`level` passed, 0 silence – 1 loud, from
//     VoiceController's AnalyserNode) is level-driven instead: each bar's
//     height is `level` times a fixed per-bar multiplier, floored so the row
//     sits visibly at rest during silence rather than animating regardless
//     of input. No CSS animation/keyframe involved, so there's nothing for
//     prefers-reduced-motion to gate.
function WaveformBars({
  count,
  barWidth,
  gap,
  gradientFrom,
  gradientTo,
  durationBase,
  level,
}: {
  count: number;
  barWidth: number;
  gap: number;
  gradientFrom: string;
  gradientTo: string;
  durationBase: number;
  level?: number;
}) {
  const levelDriven = level !== undefined;
  return (
    <div aria-hidden="true" className="flex h-full items-center" style={{ gap }}>
      {Array.from({ length: count }, (_, index) => {
        const style: CSSProperties = {
          width: barWidth,
          background: `linear-gradient(180deg, ${gradientFrom}, ${gradientTo})`,
          transformOrigin: 'center',
        };
        if (levelDriven) {
          const restFloor = 0.12;
          const perBarGain = 0.55 + ((index * 37) % 100) / 100;
          const scale = Math.max(restFloor, Math.min(1, level * perBarGain));
          style.transform = `scaleY(${scale})`;
          style.transition = 'transform 80ms ease-out';
        } else {
          style.animationDuration = `${(durationBase + (index % 5) * 0.12).toFixed(2)}s`;
          style.animationDelay = `${((index * 0.13) % 1).toFixed(2)}s`;
        }
        return <span key={index} className={levelDriven ? 'block h-full rounded-full' : 'cx-bar block h-full rounded-full'} style={style} />;
      })}
    </div>
  );
}

function describeError(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message : 'unknown error';
  return message === 'not signed in' ? 'Sign in from the Calyxa popup to start.' : fallback;
}

/**
 * Plays one synthesized reply via a Blob URL, revoked once playback ends.
 * Exposes the live Audio element via `audioRef` so a caller (the raise-hand
 * interrupt) can stop it early: audio.pause() fires a native 'pause' event,
 * which resolves the awaited promise below exactly like natural completion,
 * running the same cleanup.
 */
async function playAudio(
  buffer: ArrayBuffer,
  setPlaying: (playing: boolean) => void,
  audioRef: { current: HTMLAudioElement | null },
): Promise<void> {
  const url = URL.createObjectURL(new Blob([buffer], { type: 'audio/mpeg' }));
  const audio = new Audio(url);
  audioRef.current = audio;
  setPlaying(true);
  try {
    await audio.play();
    await new Promise<void>((resolve) => {
      audio.addEventListener('ended', () => resolve(), { once: true });
      audio.addEventListener('error', () => resolve(), { once: true });
      audio.addEventListener('pause', () => resolve(), { once: true });
    });
  } finally {
    setPlaying(false);
    audioRef.current = null;
    URL.revokeObjectURL(url);
  }
}
