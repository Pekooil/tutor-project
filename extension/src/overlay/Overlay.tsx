import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
} from 'react';
import { Button, CalyxaMark, Card, VisuallyHidden } from '@calyxa/ui';
import './Overlay.css';
import type { TurnMessage } from '../types/messages';
import { startRecording, type RecordingHandle, type Utterance } from './VoiceController';

// Calyxa overlay — Sprint 10 Task 6 (chat UI + real streaming + voice text sync).
//
// Layout (expanded):
//   header     — CalyxaMark + "Calyxa" + badge (or "Speaking" + interrupt)
//   chat area  — ONLY rendered when there is content; absent when empty so the
//                panel collapses to header + input row with no gap.
//   input row  — text input + mic + send
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
}: {
  onSend: (messages: TurnMessage[], onChunk?: (chunk: string) => void) => Promise<string>;
  onTranscribe: (audio: Utterance) => Promise<{ transcript: string; sttMs: number }>;
  onSynthesize: (text: string) => Promise<{ audio: ArrayBuffer; ttsMs: number }>;
}) {
  const [expanded, setExpanded] = useState(false);
  const [messages, setMessages] = useState<TurnMessage[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  // Builds up during text streaming (text turns) or word-reveal (voice turns).
  // Rendered as a pending assistant bubble; committed to messages when done.
  const [streamingContent, setStreamingContent] = useState('');
  const [recording, setRecording] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [level, setLevel] = useState(0);

  const recordingRef = useRef<RecordingHandle | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const levelFrameRef = useRef<number | null>(null);
  const startingRef = useRef(false);
  const chatEndRef = useRef<HTMLDivElement | null>(null);

  // True whenever the chat area should be rendered (no gap when empty).
  const hasContent = messages.length > 0 || busy || !!notice;

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
    };
  }, []);

  // Scroll to bottom when messages or streaming content changes.
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, streamingContent]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = input.trim();
    if (!text || busy) return;

    const history: TurnMessage[] = [...messages, { role: 'user', content: text }];
    setMessages(history);
    setInput('');
    setNotice(null);
    setBusy(true);
    setStreamingContent('');

    try {
      const reply = await onSend(history, (chunk) => {
        setStreamingContent((prev) => prev + chunk);
      });
      if (!reply.trim()) throw new Error('The tutor returned an empty reply.');
      setStreamingContent('');
      setMessages((current) => [...current, { role: 'assistant', content: reply }]);
    } catch (error) {
      setStreamingContent('');
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
    if (!handle) return;
    recordingRef.current = null;
    setRecording(false);
    stopLevelMeter();
    setBusy(true);
    setStreamingContent('');

    try {
      const utterance = await handle.stop();
      const { transcript } = await onTranscribe(utterance);

      const history: TurnMessage[] = [...messages, { role: 'user', content: transcript }];
      setMessages(history);

      // Voice path: no onChunk because TTS needs the full reply before synthesis.
      const reply = await onSend(history);
      if (!reply.trim()) throw new Error('The tutor returned an empty reply.');

      const { audio } = await onSynthesize(reply);

      // Play audio and reveal the reply text word-by-word in sync with speech.
      // The reply is committed to messages only after playback ends so there is
      // no flash where the text appears twice.
      await playAudioWithTextReveal(audio, reply, setStreamingContent, setPlaying, audioRef);

      setStreamingContent('');
      setMessages((current) => [...current, { role: 'assistant', content: reply }]);
    } catch (error) {
      setStreamingContent('');
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

  return (
    <div className="fixed bottom-7 left-1/2 z-[2147483647] w-[420px] -translate-x-1/2 font-sans text-base text-foreground">
      <div className="overflow-hidden rounded-lg border border-border bg-background/85 shadow-panel backdrop-blur-[18px] backdrop-saturate-[1.5]">

        {/* ── Header ── */}
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
        ) : (
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
        )}

        {/* ── Chat area — only rendered when there is something to show ── */}
        {hasContent && (
          <div
            aria-live="polite"
            className="flex max-h-[272px] flex-col gap-3 overflow-y-auto px-4 py-3 scroll-smooth"
          >
            {messages.map((msg, index) =>
              msg.role === 'user' ? (
                <div key={index} className="flex justify-end">
                  <p className="m-0 max-w-[80%] rounded-2xl rounded-tr-sm bg-surface px-3.5 py-2 text-[13.5px] leading-relaxed text-foreground">
                    {msg.content}
                  </p>
                </div>
              ) : (
                <div key={index} className="flex justify-start">
                  <p className="m-0 max-w-[88%] whitespace-pre-wrap break-words text-[13.5px] leading-relaxed text-foreground">
                    {msg.content}
                  </p>
                </div>
              ),
            )}

            {/* Streaming text (text turns) or word-reveal (voice turns) */}
            {busy && (
              <div className="flex justify-start">
                {streamingContent ? (
                  <p className="m-0 max-w-[88%] whitespace-pre-wrap break-words text-[13.5px] leading-relaxed text-foreground">
                    {streamingContent}
                    <span
                      aria-hidden="true"
                      className="ml-0.5 inline-block h-[1em] w-[2px] translate-y-[1px] rounded-full bg-foreground opacity-70 motion-safe:animate-[cx-dot_0.8s_ease-in-out_infinite]"
                    />
                  </p>
                ) : (
                  <TypingIndicator />
                )}
              </div>
            )}

            {notice && (
              <Card role="alert" className="border-danger px-3 py-2 text-xs text-danger !shadow-none">
                {notice}
              </Card>
            )}

            <div ref={chatEndRef} />
          </div>
        )}

        {/* ── Input row — border-t only when chat area is present above ── */}
        <div className={`${hasContent ? 'border-t border-border' : ''} px-[18px] pb-[14px] pt-3`}>
          <form
            onSubmit={handleSubmit}
            className="flex items-center gap-2 rounded-full border border-border bg-background py-[7px] pr-[7px] pl-[18px] shadow-[0_1px_2px_rgba(15,23,42,0.03)]"
          >
            {recording ? (
              <div className="flex h-[34px] flex-1 items-center justify-center">
                <VisuallyHidden>Recording — click the square button to stop and send</VisuallyHidden>
                <WaveformBars count={24} barWidth={3} gap={3} gradientFrom="#4ade80" gradientTo="#86efac" durationBase={0.9} level={level} />
              </div>
            ) : (
              <input
                className="h-full flex-1 border-none bg-transparent text-[14.5px] text-foreground outline-none placeholder:text-muted-foreground"
                type="text"
                value={input}
                onChange={(event) => setInput(event.target.value)}
                placeholder="Ask a math question…"
                disabled={busy}
              />
            )}
            <button
              type="button"
              onClick={handleMicClick}
              disabled={busy && !recording}
              aria-label={recording ? 'Stop recording and send' : 'Switch to voice'}
              title={recording ? 'Stop and send' : 'Switch to voice'}
              className="flex h-[34px] w-[34px] flex-none cursor-pointer items-center justify-center rounded-full border border-border bg-background p-0 outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring disabled:cursor-not-allowed disabled:opacity-50"
            >
              {recording ? (
                <span aria-hidden="true" className="block h-2.5 w-2.5 rounded-[2px] bg-muted-foreground" />
              ) : (
                <span aria-hidden="true" className="block h-[13px] w-[7px] rounded-full bg-muted-foreground" />
              )}
            </button>
            <button
              type="submit"
              disabled={!input.trim() || recording || busy}
              className="h-[34px] flex-none cursor-pointer rounded-full border-0 bg-accent px-[17px] text-[13px] font-semibold text-accent-foreground outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring disabled:cursor-not-allowed disabled:opacity-50"
            >
              Send
            </button>
          </form>
        </div>

      </div>
    </div>
  );
}

// Three animated dots shown while waiting for the first streaming chunk.
function TypingIndicator() {
  return (
    <div aria-label="Calyxa is thinking" className="flex items-center gap-1 py-1">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          aria-hidden="true"
          className="block h-[6px] w-[6px] rounded-full bg-muted-foreground motion-safe:animate-[cx-dot_1.2s_ease-in-out_infinite]"
          style={{ animationDelay: `${i * 0.2}s` }}
        />
      ))}
    </div>
  );
}

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
        return (
          <span
            key={index}
            className={levelDriven ? 'block h-full rounded-full' : 'cx-bar block h-full rounded-full'}
            style={style}
          />
        );
      })}
    </div>
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
  setRevealedText: (updater: (prev: string) => string) => void,
  setPlaying: (playing: boolean) => void,
  audioRef: { current: HTMLAudioElement | null },
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

  // Reveal words at the computed rate.
  let wordIndex = 0;
  const intervalId = setInterval(() => {
    if (wordIndex < words.length) {
      const slice = words.slice(0, wordIndex + 1).join(' ');
      setRevealedText(() => slice);
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
