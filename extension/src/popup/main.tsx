import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Button, CalyxaMark, Card, Spinner } from '@calyxa/ui';
import './main.css';
import type { CalyxaMessage, SessionStatePayload } from '../types/messages';

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
// Sprint 14 Task 6 (ADR-027 Decision 3): Start/End session controls were
// removed -- sessions are tutor-initiated or auto-started in the background.
//
// Web→extension bridge (Part 2/3): the popup is now a PASSIVE receiver and no
// longer an auth surface. The signed-out state links out to the website's
// unified sign-in page instead of hosting an email/password form; the session
// arrives from the web bridge (background onMessageExternal → storage). This
// file sends only GET_STATE and SIGN_OUT (a local session clear) -- never
// SIGN_IN. It remains quota display + sign-out.

// Sprint 23 / Task 7 (ADR-050/006): the degraded (free-limit) state links out
// to the web billing page to upgrade. Stripe is server/web-only — the extension
// NEVER imports the SDK or handles checkout in-bundle; it opens /billing in a
// new tab and the whole flow lives on the web. This mirrors API_BASE
// ('https://calyxa.app' in lib/api.ts) but is duplicated as a plain string
// rather than imported, because this file deliberately pulls in NONE of
// lib/api.ts's token-bearing helpers (see the header note above).
const BILLING_URL = 'https://calyxa.app/billing';

// Web→extension session bridge (Part 2/3): the popup is a PASSIVE receiver, no
// longer an auth surface. Once the website has a session, the bridge pushes it
// and this popup flips to signed-in automatically (GET_STATE on next open, or
// the storage.onChanged listener below if it's already open).
//
// This points at /install, NOT /signup (2026-07-25). Sending a signed-out popup
// to /signup produced a loop for anyone who already had an account: the site
// showed "Sign in or create your account" to someone who had just done that,
// and nothing pushed the session back here, so the popup kept saying "sign up
// on the website" forever. /install is the page that RE-PUSHES the browser's
// existing session until the extension confirms it (EXT_PING), and only falls
// back to /signup when there genuinely is no session. Same plain-string
// discipline as BILLING_URL.
const CONNECT_URL = 'https://calyxa.app/install?src=extension';

// ADR-053: the free-limit state also offers the referral path — the dashboard
// referral page holds the shareable link (3 friends join → 10 more free
// sessions). Same plain-string discipline as BILLING_URL above.
const REFERRAL_URL = 'https://calyxa.app/referral';

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
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void sendMessage({ type: 'GET_STATE' }).then(setState);

    // Live pickup of a session pushed from the website while this popup is
    // OPEN (Part 3). The background stores the bridged tokens under 'calyxa_auth'
    // in chrome.storage.session; when that key changes we re-read state so the
    // popup flips from the "sign up on the website" screen to signed-in without
    // the student closing and reopening it. GET_STATE-on-mount above covers the
    // reopen case; this covers the already-open case.
    const storageChanged = chrome.storage?.onChanged;
    if (!storageChanged) return;
    function onStorageChanged(
      changes: Record<string, chrome.storage.StorageChange>,
      area: string,
    ) {
      if (area === 'session' && 'calyxa_auth' in changes) {
        void sendMessage({ type: 'GET_STATE' }).then(setState);
      }
    }
    storageChanged.addListener(onStorageChanged);
    return () => storageChanged.removeListener(onStorageChanged);
  }, []);

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
    // Passive receiver: NEVER an in-extension auth form. Sign-up/sign-in happens
    // entirely on the website; once it does, the bridge signs this popup in.
    return (
      <div className="flex flex-col">
        <Header />
        <div className="flex flex-col gap-3 p-4">
          <p className="m-0 text-sm text-foreground">Not connected to your account yet.</p>
          <p className="m-0 text-xs text-muted-foreground">
            Open calyxa.app and Calyxa signs itself in here — you won&rsquo;t be asked for a password
            again. (Your session is kept in memory only, so this can happen again after a browser
            restart.)
          </p>
          <Button
            type="button"
            variant="primary"
            onClick={() => void chrome.tabs.create({ url: CONNECT_URL })}
          >
            Connect to my account
          </Button>
          {state.error && <ErrorBanner message={state.error} />}
        </div>
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
            {activeSession.degraded ? (
              <span className="flex flex-col gap-2">
                <span>Free limit reached for this month — this session is on the house.</span>
                <a
                  href={BILLING_URL}
                  target="_blank"
                  rel="noreferrer"
                  className="font-semibold text-accent-emphasis underline underline-offset-2"
                >
                  Upgrade to Pro for unlimited sessions →
                </a>
                <a
                  href={REFERRAL_URL}
                  target="_blank"
                  rel="noreferrer"
                  className="font-medium text-accent-emphasis underline underline-offset-2"
                >
                  Or invite 3 friends — earn 10 free sessions →
                </a>
              </span>
            ) : (
              `${activeSession.remaining ?? '—'} session${activeSession.remaining === 1 ? '' : 's'} left this month.`
            )}
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
