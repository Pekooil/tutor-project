import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
} from 'react';
import { CalyxaMark, Card, VisuallyHidden } from '@calyxa/ui';
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

  // True whenever the chat area should be rendered (no gap when empty).
  const hasContent = messages.length > 0 || busy || !!notice || !!liveTranscript;

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
    };
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

    const history: TurnMessage[] = [...messages, { role: 'user', content: text }];
    setMessages(history);
    setInput('');
    setNotice(null);
    setBusy(true);
    clearStreamTokens();

    try {
      const reply = await onSend(history, (chunk) => {
        appendStreamToken(chunk);
      });
      if (!reply.trim()) throw new Error('The tutor returned an empty reply.');
      clearStreamTokens();
      setMessages((current) => [...current, { role: 'assistant', content: reply }]);
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
      const history: TurnMessage[] = [...messages, { role: 'user', content: transcript }];
      setMessages(history);

      // Voice path: no onChunk because TTS needs the full reply before synthesis.
      const reply = await onSend(history);
      if (!reply.trim()) throw new Error('The tutor returned an empty reply.');

      const { audio } = await onSynthesize(reply);

      // Play audio and reveal the reply word-by-word in sync with speech.
      // Each word is appended as a new token so it gets the cx-word-in
      // entry animation. The reply commits to messages after playback ends.
      await playAudioWithTextReveal(audio, reply, appendStreamToken, setPlaying, audioRef);

      clearStreamTokens();
      setMessages((current) => [...current, { role: 'assistant', content: reply }]);
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
    );
  }

  return (
    <div
      ref={panelRef}
      className={`fixed z-[2147483647] w-[420px] font-sans text-base text-foreground${isDragging ? ' select-none' : ''}${!dragPos ? ' bottom-7 left-1/2 -translate-x-1/2' : ''}`}
      style={dragPos ? { top: `${dragPos.y}px`, left: `${dragPos.x}px` } : undefined}
    >
      <div className="overflow-hidden rounded-lg border border-border bg-background/85 shadow-panel backdrop-blur-[18px] backdrop-saturate-[1.5]">

        {/* ── Header ── */}
        {playing ? (
          <header
            className={`flex items-center gap-[9px] border-b border-border px-4 pb-3 pt-[14px] ${isDragging ? 'cursor-grabbing' : 'cursor-grab'}`}
            onPointerDown={handleHeaderPointerDown}
            onPointerMove={handleHeaderPointerMove}
            onPointerUp={handleHeaderPointerUp}
          >
            <CalyxaMark className="h-[19px] w-[19px] flex-none" />
            <span className="text-[13.5px] font-semibold text-foreground">Calyxa</span>
            <span className="ml-auto flex items-center gap-2">
              <span className="flex h-4 items-center">
                <WaveformBars count={7} barWidth={3} gap={3} gradientFrom="#22a06b" gradientTo="#4ade80" durationBase={0.65} />
              </span>
              <span className="text-[11.5px] text-muted-foreground">Speaking</span>
              <button
                type="button"
                onClick={handleInterrupt}
                aria-label="Stop speaking"
                className="flex h-7 w-7 flex-none cursor-pointer items-center justify-center rounded-full border border-border bg-background p-0 outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
              >
                <span aria-hidden="true" className="block h-2.5 w-2.5 rounded-[2px] bg-foreground" />
              </button>
            </span>
            <button
              type="button"
              onClick={handleClose}
              aria-label="Close Calyxa"
              className="flex h-7 w-7 flex-none cursor-pointer items-center justify-center rounded-full border border-border bg-background p-0 outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
            >
              <svg aria-hidden="true" width="10" height="10" viewBox="0 0 10 10" fill="none">
                <path d="M1.5 1.5L8.5 8.5M8.5 1.5L1.5 8.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </button>
          </header>
        ) : (
          <header
            className={`flex items-center gap-[9px] border-b border-border px-4 pb-3 pt-[14px] ${isDragging ? 'cursor-grabbing' : 'cursor-grab'}`}
            onPointerDown={handleHeaderPointerDown}
            onPointerMove={handleHeaderPointerMove}
            onPointerUp={handleHeaderPointerUp}
          >
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
            <button
              type="button"
              onClick={handleClose}
              aria-label="Close Calyxa"
              className="flex h-7 w-7 flex-none cursor-pointer items-center justify-center rounded-full border border-border bg-background p-0 outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
            >
              <svg aria-hidden="true" width="10" height="10" viewBox="0 0 10 10" fill="none">
                <path d="M1.5 1.5L8.5 8.5M8.5 1.5L1.5 8.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </button>
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

            {/* Live interim transcript from SpeechRecognition, updated word-by-word
                as the user speaks. Kept visible after recording stops until the
                accurate Whisper result is committed, to avoid a visible gap. */}
            {liveTranscript && (
              <div className="flex justify-end">
                <p className="m-0 max-w-[80%] rounded-2xl rounded-tr-sm bg-surface px-3.5 py-2 text-[13.5px] leading-relaxed text-foreground">
                  {liveTranscript}
                </p>
              </div>
            )}

            {/* Streaming text (text turns) or word-reveal (voice turns).
                Each token is a separate <span key={id}> so only newly
                appended tokens trigger the cx-word-in entry animation. */}
            {busy && (
              <div className="flex justify-start">
                {streamingTokens.length > 0 ? (
                  <p className="m-0 max-w-[88%] whitespace-pre-wrap break-words text-[13.5px] leading-relaxed text-foreground">
                    {streamingTokens.map((token) => (
                      <span key={token.id} className="inline-block cx-word-in">
                        {token.text}
                      </span>
                    ))}
                    {/* Green step-blink cursor matching step 04 of the design. */}
                    <span
                      aria-hidden="true"
                      className="inline-block w-[2px] bg-accent-glow-strong ml-[2px]"
                      style={{ height: '1.05em', verticalAlign: '-0.18em', animation: 'cx-caret 1s step-end infinite' }}
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
              <div className="relative flex flex-1 items-center overflow-hidden">
                {/* Hidden span with the same font as the input. getBoundingClientRect()
                    on it gives the text-before-cursor width, letting us position the
                    fake caret without caret-width (not supported in Chrome). */}
                <span
                  ref={measureElRef}
                  aria-hidden="true"
                  className="pointer-events-none invisible absolute whitespace-pre text-[14.5px]"
                />
                <input
                  ref={inputElRef}
                  className="w-full border-none bg-transparent text-[14.5px] text-foreground outline-none placeholder:text-muted-foreground caret-transparent"
                  type="text"
                  value={input}
                  onChange={(event) => { setInput(event.target.value); refreshCaret(); }}
                  onKeyDown={refreshCaret}
                  onKeyUp={refreshCaret}
                  onMouseDown={refreshCaret}
                  onClick={refreshCaret}
                  onSelect={refreshCaret}
                  onScroll={refreshCaret}
                  onFocus={() => { setInputFocused(true); refreshCaret(); }}
                  onBlur={() => setInputFocused(false)}
                  placeholder="Ask a math question…"
                  disabled={busy}
                />
                {inputFocused && !busy && (
                  <span
                    aria-hidden="true"
                    className="pointer-events-none absolute top-1/2 w-[2px] -translate-y-1/2 bg-accent-glow-strong"
                    style={{ left: caretLeft, height: '1.05em', animation: 'cx-caret 1s step-end infinite' }}
                  />
                )}
              </div>
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

// Small breathing orb shown while waiting for the first streaming chunk.
// Uses the same cx-orb / cx-ring keyframes as the old full-size thinking
// state but scaled down to ~20 px so it sits inline in the chat bubble row,
// matching the ChatGPT-style pulsing dot pattern.
function TypingIndicator() {
  return (
    <div aria-label="Calyxa is thinking" className="flex items-center py-1">
      <div className="relative flex h-5 w-5 items-center justify-center">
        <div
          aria-hidden="true"
          className="absolute h-5 w-5 rounded-full border border-accent motion-safe:animate-[cx-ring_2.6s_ease-out_infinite]"
        />
        <div
          aria-hidden="true"
          className="h-3.5 w-3.5 rounded-full shadow-[0_0_6px_rgba(74,222,128,0.45)] motion-safe:animate-[cx-orb_2.8s_ease-in-out_infinite]"
          style={{ background: 'radial-gradient(circle at 38% 32%, #dcfce7 0%, #86efac 45%, #4ade80 100%)' }}
        />
      </div>
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
  appendToken: (text: string) => void,
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
