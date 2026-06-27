import { useEffect, useRef, useState, type FormEvent } from 'react';
import './Overlay.css';
import type { TurnMessage, LatencyTrace } from '../types/messages';
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
// All styling lives in Overlay.css, which the content script injects INTO the
// shadow root (cssInjectionMode: 'ui', Task 3) so nothing bleeds onto — or in
// from — the host page. See /docs/adr/ADR-002-overlay-shadow-dom.md.
export function Overlay({
  onSend,
  onTranscribe,
  onSynthesize,
}: {
  onSend: (messages: TurnMessage[]) => Promise<string>;
  onTranscribe: (audio: Utterance) => Promise<{ transcript: string; sttMs: number }>;
  onSynthesize: (text: string) => Promise<{ audio: ArrayBuffer; ttsMs: number }>;
}) {
  const [messages, setMessages] = useState<TurnMessage[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [recording, setRecording] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [latency, setLatency] = useState<LatencyTrace | null>(null);

  const recordingRef = useRef<RecordingHandle | null>(null);

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

    const t0 = performance.now();
    let replyDelivered = false;

    try {
      const utterance = await handle.stop();
      const { transcript, sttMs } = await onTranscribe(utterance);

      const history: TurnMessage[] = [...messages, { role: 'user', content: transcript }];
      setMessages(history);

      const aiStart = performance.now();
      const reply = await onSend(history);
      const aiMs = Math.round(performance.now() - aiStart);
      setMessages((current) => [...current, { role: 'assistant', content: reply }]);
      replyDelivered = true;

      const { audio, ttsMs } = await onSynthesize(reply);
      const totalMs = Math.round(performance.now() - t0);
      const networkMs = Math.max(0, totalMs - sttMs - aiMs - ttsMs);
      setLatency({ sttMs, aiMs, ttsMs, networkMs, totalMs });

      await playAudio(audio, setPlaying);
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

  return (
    <div className="mm-overlay">
      <div className="mm-transcript">
        {messages.length === 0 && <p className="mm-empty">Ask a math question to get started.</p>}
        {messages.map((message, index) => (
          <p key={index} className={`mm-message mm-message--${message.role}`}>
            {message.content}
          </p>
        ))}
        {playing && <p className="mm-playing">🔊 Speaking…</p>}
        {notice && <p className="mm-notice">{notice}</p>}
        {latency && (
          <p className="mm-latency">
            Voice turn: {latency.totalMs}ms (stt {latency.sttMs} · ai {latency.aiMs} · tts {latency.ttsMs})
          </p>
        )}
      </div>
      <form className="mm-form" onSubmit={handleSubmit}>
        <input
          className="mm-input"
          type="text"
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder="Ask a math question…"
          disabled={busy}
        />
        <button
          type="button"
          className={`mm-mic${recording ? ' mm-mic--recording' : ''}`}
          onMouseDown={() => void handleMicDown()}
          onMouseUp={() => void handleMicUp()}
          onMouseLeave={() => {
            if (recording) void handleMicUp();
          }}
          onTouchStart={(event) => {
            event.preventDefault();
            void handleMicDown();
          }}
          onTouchEnd={(event) => {
            event.preventDefault();
            void handleMicUp();
          }}
          disabled={busy && !recording}
          aria-pressed={recording}
          aria-label={recording ? 'Recording — release to send' : 'Press and hold to speak'}
        >
          {recording ? '●' : '🎤'}
        </button>
        <button className="mm-send" type="submit" disabled={busy || !input.trim()}>
          {busy ? '…' : 'Send'}
        </button>
      </form>
    </div>
  );
}

function describeError(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message : 'unknown error';
  return message === 'not signed in' ? 'Sign in from the Calyxa popup to start.' : fallback;
}

/** Plays one synthesized reply via a Blob URL, revoked once playback ends. */
async function playAudio(buffer: ArrayBuffer, setPlaying: (playing: boolean) => void): Promise<void> {
  const url = URL.createObjectURL(new Blob([buffer], { type: 'audio/mpeg' }));
  const audio = new Audio(url);
  setPlaying(true);
  try {
    await audio.play();
    await new Promise<void>((resolve) => {
      audio.addEventListener('ended', () => resolve(), { once: true });
      audio.addEventListener('error', () => resolve(), { once: true });
    });
  } finally {
    setPlaying(false);
    URL.revokeObjectURL(url);
  }
}
