import { StrictMode, useEffect, useState, type FormEvent } from 'react';
import { createRoot } from 'react-dom/client';
import { Button, CalyxaMark, Card, Field, Spinner } from '@calyxa/ui';
import './main.css';
import type { CalyxaMessage, SessionStatePayload, SignInPayload } from '../types/messages';

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
//
// Sprint 14 Task 6 (ADR-027 Decision 3): Start/End session controls and
// their tab-domain derivation are REMOVED -- sessions are now tutor-
// initiated (the opening scan on panel expand) or auto-started on the
// student's first sent turn, both handled entirely in the background
// worker. The tab-domain heuristic moved there too (it now derives the
// SENDER tab's domain for those two triggers instead of the popup's active
// tab). The popup is now sign-in + quota display only -- START_SESSION/
// END_SESSION message handlers stay in background/index.ts (still valid,
// still used internally by those two triggers), but nothing in this file
// sends either one anymore.

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

// Exported for the Sprint 18 Task 4 a11y spec (extension/tests/a11y-overlay.
// test.ts) — the same "export internals for the test task" convention this
// repo already uses (Overlay.tsx's stripHistory, background's reduceTelemetry
// Batch). The auto-mount below is unchanged; App renders identically.
export function App() {
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
