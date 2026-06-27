import { useState, type FormEvent } from 'react';
import './Overlay.css';
import type { TurnMessage } from '../types/messages';

// Calyxa overlay — Sprint 05 text chat (grew from the Sprint 02 placeholder).
//
// Presentational only. This component knows nothing about chrome.* APIs,
// messaging, or the keyboard shortcut — those live in the content and
// background scripts. `onSend` is the one seam to the outside world: the
// content script supplies it (threaded through mount.tsx) and is the
// transport for a single AI_TURN round trip.
//
// History lives here, in React state, not in the background worker: the
// overlay/content-script context lives for the page's lifetime, while the
// worker is ephemeral and holds no conversation memory (ADR-008 history
// model) — so every onSend() call below carries the full transcript so far.
//
// All styling lives in Overlay.css, which the content script injects INTO the
// shadow root (cssInjectionMode: 'ui', Task 3) so nothing bleeds onto — or in
// from — the host page. See /docs/adr/ADR-002-overlay-shadow-dom.md.
export function Overlay({ onSend }: { onSend: (messages: TurnMessage[]) => Promise<string> }) {
  const [messages, setMessages] = useState<TurnMessage[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

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
      const message = error instanceof Error ? error.message : 'unknown error';
      setNotice(
        message === 'not signed in' ? 'Sign in from the Calyxa popup to start.' : "Couldn't reach the tutor — try again.",
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
        {notice && <p className="mm-notice">{notice}</p>}
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
        <button className="mm-send" type="submit" disabled={busy || !input.trim()}>
          {busy ? '…' : 'Send'}
        </button>
      </form>
    </div>
  );
}
