import { StrictMode, useEffect, useState, type FormEvent } from 'react';
import { createRoot } from 'react-dom/client';
import { Button, CalyxaMark, Card, Field, Spinner } from '@calyxa/ui';
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
//
// Sprint 10: restyled on @calyxa/ui tokens/primitives + Tailwind — message
// contract, handlers, and the single shared `busy` gate are unchanged from
// Sprint 09, only markup/styling moved.

const FALLBACK_ERROR: SessionStatePayload = {
  signedIn: false,
  user: null,
  activeSession: null,
  error: 'Extension service worker did not respond — reload the extension and try again.',
};

function sendMessage(message: CalyxaMessage): Promise<SessionStatePayload> {
  return chrome.runtime
    .sendMessage(message)
    .then((response: CalyxaMessage | undefined) => {
      if (!response) return FALLBACK_ERROR;
      return response.payload as SessionStatePayload;
    })
    .catch(() => FALLBACK_ERROR);
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

function Header() {
  return (
    <header className="flex items-center gap-2 border-b border-border px-4 py-3">
      <CalyxaMark className="h-5 w-5" />
      <span className="text-sm font-semibold text-foreground">Calyxa</span>
    </header>
  );
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <Card role="alert" className="border-danger bg-background px-3 py-2 text-sm text-danger !shadow-none">
      {message}
    </Card>
  );
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
    try {
      const payload: SignInPayload = { email, password };
      setState(await sendMessage({ type: 'SIGN_IN', payload }));
    } catch {
      setState(FALLBACK_ERROR);
    } finally {
      setBusy(false);
    }
  }

  async function handleSignOut() {
    setBusy(true);
    try {
      setState(await sendMessage({ type: 'SIGN_OUT' }));
    } catch {
      setState(FALLBACK_ERROR);
    } finally {
      setBusy(false);
    }
  }

  async function handleStart() {
    setBusy(true);
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const payload: StartSessionPayload = { pageDomain: deriveActiveTabDomain(tab?.url), mode: 'voice' };
      setState(await sendMessage({ type: 'START_SESSION', payload }));
    } catch {
      setState(FALLBACK_ERROR);
    } finally {
      setBusy(false);
    }
  }

  async function handleEnd() {
    setBusy(true);
    try {
      setState(await sendMessage({ type: 'END_SESSION' }));
    } catch {
      setState(FALLBACK_ERROR);
    } finally {
      setBusy(false);
    }
  }

  if (!state) {
    return (
      <div className="flex flex-col">
        <Header />
        <div aria-live="polite" className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
          <Spinner size="sm" label="Loading…" />
          <span>Loading…</span>
        </div>
      </div>
    );
  }

  if (!state.signedIn) {
    return (
      <div className="flex flex-col">
        <Header />
        <form className="flex flex-col gap-3 p-4" onSubmit={handleSignIn}>
          <Field label="Email">
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </Field>
          <Field label="Password">
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </Field>
          {state.error && <ErrorBanner message={state.error} />}
          <Button type="submit" variant="primary" loading={busy}>
            Sign in
          </Button>
        </form>
      </div>
    );
  }

  const { activeSession } = state;

  return (
    <div className="flex flex-col">
      <Header />
      <div className="flex flex-col gap-3 p-4">
        <p className="text-sm text-foreground">Signed in as {state.user?.email}</p>
        {activeSession && (
          <Card
            aria-live="polite"
            className={
              activeSession.degraded
                ? 'border-accent-subtle bg-accent-subtle px-3 py-2 text-xs text-accent-emphasis !shadow-none'
                : 'border-border bg-surface px-3 py-2 text-xs text-muted-foreground !shadow-none'
            }
          >
            {activeSession.degraded
              ? 'Free limit reached for this month — this session is on the house.'
              : `${activeSession.remaining ?? '—'} session${activeSession.remaining === 1 ? '' : 's'} left this month.`}
          </Card>
        )}
        {state.error && <ErrorBanner message={state.error} />}
        {activeSession ? (
          <Button variant="primary" onClick={handleEnd} loading={busy}>
            End session
          </Button>
        ) : (
          <Button variant="primary" onClick={handleStart} loading={busy}>
            Start tutor on this page
          </Button>
        )}
        <Button variant="secondary" onClick={handleSignOut} loading={busy}>
          Sign out
        </Button>
      </div>
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
