import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Button, CalyxaMark, Card } from '@calyxa/ui';
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
// Voice turn (ADR-010, sequential + measured): mic press -> VoiceController
// captures one push-to-talk utterance -> onTranscribe -> the transcript is
// appended as the user turn -> onSend(history) (the SAME AI leg text turns
// use, unchanged) -> the reply is appended -> onSynthesize(reply) -> the
// audio plays. Text input is the always-available fallback (ADR-011): if
// getUserMedia is unavailable/denied or any voice leg throws, a notice is
// shown and the turn degrades to text-in/text-out, exactly the Sprint 05
// path, never a dead end.
//
// Sprint 10 Task 6 round 3 (Calyxa Overlay.dc.html — the locked design
// handoff): the round-2 capsule + persistent Gemini-style input bar is
// replaced by four composed moments, all in this one component —
//   idle   : a 140x48 pill (mark + wordmark + a breathing "ready" dot).
//   asking : the 420px panel's default body — text input, press-and-hold
//            mic to switch into the full "listening" waveform view for the
//            duration of the hold.
//   thinking: the input/reply is swapped for a single breathing orb while
//            onSend/onTranscribe is in flight.
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
// pageContextSummary (Sprint 07) is purely presentational: a count, not the
// raw PageContext. This component never imports pageExtractor.ts or
// chrome.* — the content script captures the page and passes down only
// this small summary (ADR-012/ADR-013), surfaced as a hint under the input
// row when there's no error notice to show instead.
export type PageContextSummary = {
  equationCount: number;
};

export function Overlay({
  onSend,
  onTranscribe,
  onSynthesize,
  pageContextSummary,
}: {
  onSend: (messages: TurnMessage[]) => Promise<string>;
  onTranscribe: (audio: Utterance) => Promise<{ transcript: string; sttMs: number }>;
  onSynthesize: (text: string) => Promise<{ audio: ArrayBuffer; ttsMs: number }>;
  pageContextSummary?: PageContextSummary;
}) {
  const [expanded, setExpanded] = useState(false);
  const [messages, setMessages] = useState<TurnMessage[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [recording, setRecording] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const recordingRef = useRef<RecordingHandle | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Stop and release the mic if the overlay is dismissed mid-press (ADR-011
  // — no lingering capture).
  useEffect(() => {
    return () => {
      recordingRef.current?.cancel();
      recordingRef.current = null;
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

  async function handleMicDown() {
    if (busy) return;
    setNotice(null);
    setBusy(true);
    try {
      recordingRef.current = await startRecording();
      setRecording(true);
    } catch (error) {
      setBusy(false);
      const message = error instanceof Error ? error.message : 'Microphone is unavailable.';
      setNotice(`${message} Use the text input instead.`);
    }
  }

  async function handleMicUp() {
    const handle = recordingRef.current;
    recordingRef.current = null;
    if (!handle) return; // mic press never started a recording (e.g. permission denied)
    setRecording(false);

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
        <header className="flex items-center gap-2 border-b border-border px-4 py-3">
          <CalyxaMark className="h-[19px] w-[19px] flex-none" />
          <span className="text-[13.5px] font-semibold">Calyxa</span>

          {recording && (
            <span className="ml-auto flex items-center gap-1.5 rounded-full bg-accent-subtle px-2.5 py-1 text-[11.5px] font-semibold text-accent-emphasis">
              <span
                aria-hidden="true"
                className="h-[7px] w-[7px] flex-none rounded-full bg-accent-glow-strong motion-safe:animate-[cx-dot_1.4s_ease-in-out_infinite]"
              />
              Listening
            </span>
          )}

          {!recording && playing && (
            <span className="ml-auto flex items-center gap-2">
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
          )}

          {!recording && !busy && !playing && !lastReply && (
            <span className="ml-auto rounded-full border border-border bg-surface px-2.5 py-1 text-[11.5px] font-semibold text-muted-foreground">
              Typing
            </span>
          )}
        </header>

        <div aria-live="polite" className="px-[18px] py-4">
          {recording ? (
            <div className="flex flex-col items-center gap-4">
              <div className="flex h-12 w-full items-center justify-center">
                <WaveformBars count={22} barWidth={4} gap={4} gradientFrom="#4ade80" gradientTo="#86efac" durationBase={0.9} />
              </div>
              <p className="m-0 text-center text-[14.5px] leading-relaxed text-muted-foreground">Listening…</p>
              <div className="pt-0.5 text-xs tracking-wide text-muted-foreground/70">release to send</div>
            </div>
          ) : busy ? (
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
                <input
                  className="h-full flex-1 border-none bg-transparent text-[14.5px] text-foreground outline-none placeholder:text-muted-foreground"
                  type="text"
                  value={input}
                  onChange={(event) => setInput(event.target.value)}
                  placeholder="Ask a math question…"
                />
                <Button
                  type="button"
                  variant="icon"
                  onMouseDown={() => void handleMicDown()}
                  onMouseUp={() => void handleMicUp()}
                  onMouseLeave={() => {
                    if (recordingRef.current) void handleMicUp();
                  }}
                  onTouchStart={(event) => {
                    event.preventDefault();
                    void handleMicDown();
                  }}
                  onTouchEnd={(event) => {
                    event.preventDefault();
                    void handleMicUp();
                  }}
                  aria-label="Press and hold to speak"
                  className="h-[34px] w-[34px] flex-none rounded-full border border-border"
                >
                  🎤
                </Button>
                <Button type="submit" variant="primary" disabled={!input.trim()} className="h-[34px] flex-none rounded-full px-4 text-[13px]">
                  Send
                </Button>
              </form>

              <div className="flex items-center justify-center gap-2.5 text-xs text-muted-foreground">
                {notice ? null : pageContextSummary ? (
                  <span>
                    {pageContextSummary.equationCount > 0
                      ? `👁 ${pageContextSummary.equationCount} equation${pageContextSummary.equationCount === 1 ? '' : 's'} detected`
                      : 'No equations detected — type or paste your problem'}
                  </span>
                ) : (
                  <>
                    <span>↵ to send</span>
                    <span>·</span>
                    <span>hold the mic to speak instead</span>
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// One reactive waveform, two contexts: the listening view (large, 22 bars)
// and the TTS-playback header indicator (small, 7 bars) — same bar/gradient
// shape, different count/size/speed (Calyxa Overlay.dc.html's mkBars). Each
// bar needs a per-instance animation-duration/delay, which Tailwind's
// arbitrary-value `animate-[...]` syntax can't express (it's resolved at
// build time, not per-render) — so this is the one animation in the file
// driven by a plain CSS class + inline style instead of motion-safe:animate.
// The `.cx-bar` rule itself only exists inside a
// `prefers-reduced-motion: no-preference` block (Overlay.css), so it's
// reduced-motion-safe by the same construction as everywhere else.
function WaveformBars({
  count,
  barWidth,
  gap,
  gradientFrom,
  gradientTo,
  durationBase,
}: {
  count: number;
  barWidth: number;
  gap: number;
  gradientFrom: string;
  gradientTo: string;
  durationBase: number;
}) {
  return (
    <div aria-hidden="true" className="flex h-full items-center" style={{ gap }}>
      {Array.from({ length: count }, (_, index) => (
        <span
          key={index}
          className="cx-bar block h-full rounded-full"
          style={{
            width: barWidth,
            background: `linear-gradient(180deg, ${gradientFrom}, ${gradientTo})`,
            transformOrigin: 'center',
            animationDuration: `${(durationBase + (index % 5) * 0.12).toFixed(2)}s`,
            animationDelay: `${((index * 0.13) % 1).toFixed(2)}s`,
          }}
        />
      ))}
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
