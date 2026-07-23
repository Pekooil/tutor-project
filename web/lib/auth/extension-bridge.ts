// Web → extension session bridge (Part 2). Runs ONLY in the browser (called
// from the AuthBridge client component). Pushes the Supabase session to the
// Calyxa extension via `chrome.runtime.sendMessage(EXTENSION_ID, …)`, which is
// only deliverable because the extension declares `externally_connectable` for
// https://calyxa.app/* (see extension/wxt.config.ts). The message contract is
// deliberately provider-agnostic: the same { access_token, refresh_token,
// expires_at, user } shape whether the web sign-in was email/password or Google.
//
// The extension stores these in chrome.storage.session and keeps refreshing via
// the backend proxy (ADR-006) — it never receives or uses any Supabase key.
import type { Session } from '@supabase/supabase-js'

// The published/pinned Calyxa extension id. Set NEXT_PUBLIC_CALYXA_EXTENSION_ID
// to the id derived from the manifest `key` (deterministic across unpacked-dev
// and the store build). Absent → the bridge is a no-op (e.g. preview deploys
// that don't target an extension), never an error.
const EXTENSION_ID = process.env.NEXT_PUBLIC_CALYXA_EXTENSION_ID

// Minimal shape of the `chrome.runtime` an ordinary web page sees. It exists on
// the page ONLY when a matching `externally_connectable` extension is installed;
// otherwise `window.chrome` is undefined and every call below no-ops.
type ExternalRuntime = {
  sendMessage?: (extensionId: string, message: unknown, callback?: () => void) => void
  lastError?: { message?: string }
}

function externalRuntime(): ExternalRuntime | null {
  if (typeof window === 'undefined') return null
  const runtime = (window as unknown as { chrome?: { runtime?: ExternalRuntime } }).chrome?.runtime
  return runtime && typeof runtime.sendMessage === 'function' ? runtime : null
}

function send(message: unknown): void {
  if (!EXTENSION_ID) return
  const runtime = externalRuntime()
  if (!runtime?.sendMessage) return
  try {
    // Reading runtime.lastError inside the callback swallows the benign
    // "Could not establish connection" Chrome logs when the extension is not
    // installed — a signed-out visitor with no extension is the common case.
    runtime.sendMessage(EXTENSION_ID, message, () => {
      void runtime.lastError
    })
  } catch {
    // window.chrome present but messaging unavailable (e.g. the extension was
    // just uninstalled) — the bridge is best-effort, never blocks auth.
  }
}

/** Push the current session so the extension signs itself in (AUTH_SESSION). */
export function pushSessionToExtension(session: Session): void {
  send({
    type: 'AUTH_SESSION',
    session: {
      access_token: session.access_token,
      refresh_token: session.refresh_token,
      expires_at: session.expires_at ?? undefined,
      user: { id: session.user.id, email: session.user.email ?? null },
    },
  })
}

/** Tell the extension to clear its stored session (AUTH_SIGNED_OUT). */
export function pushSignOutToExtension(): void {
  send({ type: 'AUTH_SIGNED_OUT' })
}
