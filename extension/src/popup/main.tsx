import { StrictMode, useEffect, useState, type FormEvent } from 'react';
import { createRoot } from 'react-dom/client';
import './main.css';
import type { CalyxaMessage, SessionStatePayload, SignInPayload, StartSessionPayload } from '../types/messages';

// Calyxa popup — Sprint 04 Task 7 launcher (PLAN §2.2 popup scope).
//
// The popup holds no tokens and no session logic: every action sends a
// chrome.runtime message to the background worker and renders whatever
// SESSION_STATE it replies with. This file never imports lib/api.ts or
// lib/storage.ts's token-bearing helpers — it only knows the message
// contract in ../types/messages.
//
// The popup document is destroyed on blur (PLAN §2.2), so it re-mounts with
// no memory of prior state on every open. GET_STATE (a Task-7 addition, see
// types/messages.ts) asks the worker for the current state on mount instead
// of defaulting to "signed out".

function sendMessage(message: CalyxaMessage): Promise<SessionStatePayload> {
  return chrome.runtime.sendMessage(message).then((response: CalyxaMessage) => response.payload as SessionStatePayload);
}

// Two-part public suffixes this heuristic knows about. Not a full Public
// Suffix List implementation (no PSL dependency is in scope this sprint) --
// pageDomain is a display/grouping hint stored alongside a session row, not
// something the server gates access on, so an approximation is acceptable.
const TWO_LABEL_SUFFIXES = new Set([
  'co.uk', 'org.uk', 'gov.uk', 'ac.uk',
  'co.jp', 'co.nz', 'co.za', 'co.in',
  'com.au', 'com.br', 'com.mx',
]);

function toETldPlusOne(hostname: string): string {
  const labels = hostname.split('.');
  if (labels.length <= 2) return hostname;
  const lastTwo = labels.slice(-2).join('.');
  return TWO_LABEL_SUFFIXES.has(lastTwo) ? labels.slice(-3).join('.') : lastTwo;
}

function deriveActiveTabDomain(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return toETldPlusOne(new URL(url).hostname);
  } catch {
    return null;
  }
}

function App() {
  const [state, setState] = useState<SessionStatePayload | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void sendMessage({ type: 'GET_STATE' }).then(setState);
  }, []);

  async function handleSignIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    const payload: SignInPayload = { email, password };
    setState(await sendMessage({ type: 'SIGN_IN', payload }));
    setBusy(false);
  }

  async function handleSignOut() {
    setBusy(true);
    setState(await sendMessage({ type: 'SIGN_OUT' }));
    setBusy(false);
  }

  async function handleStart() {
    setBusy(true);
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const payload: StartSessionPayload = { pageDomain: deriveActiveTabDomain(tab?.url), mode: 'voice' };
    setState(await sendMessage({ type: 'START_SESSION', payload }));
    setBusy(false);
  }

  async function handleEnd() {
    setBusy(true);
    setState(await sendMessage({ type: 'END_SESSION' }));
    setBusy(false);
  }

  if (!state) {
    return <p className="calyxa-status">Loading…</p>;
  }

  if (!state.signedIn) {
    return (
      <form className="calyxa-form" onSubmit={handleSignIn}>
        <h1>Calyxa</h1>
        <label>
          Email
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>
        <label>
          Password
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </label>
        {state.error && <p className="calyxa-error">{state.error}</p>}
        <button type="submit" disabled={busy}>
          Sign in
        </button>
      </form>
    );
  }

  const { activeSession } = state;

  return (
    <div className="calyxa-panel">
      <h1>Calyxa</h1>
      <p className="calyxa-status">Signed in as {state.user?.email}</p>
      {activeSession && (
        <p className="calyxa-hint">
          {activeSession.degraded
            ? 'Free limit reached for this month — this session is on the house.'
            : `${activeSession.remaining ?? '—'} session${activeSession.remaining === 1 ? '' : 's'} left this month.`}
        </p>
      )}
      {state.error && <p className="calyxa-error">{state.error}</p>}
      {activeSession ? (
        <button onClick={handleEnd} disabled={busy}>
          End session
        </button>
      ) : (
        <button onClick={handleStart} disabled={busy}>
          Start tutor on this page
        </button>
      )}
      <button onClick={handleSignOut} disabled={busy}>
        Sign out
      </button>
    </div>
  );
}

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
