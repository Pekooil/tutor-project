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
  // The callback receives the extension's reply, or undefined when the
  // extension returned no response (the not-installed / fire-and-forget case).
  sendMessage?: (
    extensionId: string,
    message: unknown,
    callback?: (reply?: unknown) => void
  ) => void
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
    payload: {
      session: {
        access_token: session.access_token,
        refresh_token: session.refresh_token,
        expires_at: session.expires_at ?? undefined,
        user: { id: session.user.id, email: session.user.email ?? null },
      },
    },
  })
}

/** Tell the extension to clear its stored session (AUTH_SIGNED_OUT). */
export function pushSignOutToExtension(): void {
  send({ type: 'AUTH_SIGNED_OUT' })
}

/**
 * Ask the extension to open its in-extension lesson (OPEN_ONBOARDING).
 *
 * A web page cannot navigate to a chrome-extension:// URL, so the "Show me how
 * it works" button relays through the same externally_connectable channel the
 * session bridge uses. Fire-and-forget: if the extension is not installed the
 * message simply goes nowhere, and the button is only rendered once EXT_PING
 * has confirmed it is.
 */
export function openExtensionOnboarding(): void {
  send({ type: 'OPEN_ONBOARDING' })
}

export type ExtensionStatus = { installed: boolean; signedIn: boolean }

/**
 * Ask the extension whether it is installed and holding a session (EXT_PING).
 *
 * Chrome only delivers to an installed, externally_connectable-matching
 * extension, so "no reply" IS the not-installed answer — that arrives as
 * runtime.lastError, which we read to swallow, resolving { installed: false }.
 * Never rejects and never blocks: the install step treats an unknown as "not
 * connected yet" and keeps polling.
 */
export function pingExtension(): Promise<ExtensionStatus> {
  return new Promise((resolve) => {
    const miss: ExtensionStatus = { installed: false, signedIn: false }
    if (!EXTENSION_ID) return resolve(miss)
    const runtime = externalRuntime()
    if (!runtime?.sendMessage) return resolve(miss)
    try {
      runtime.sendMessage(EXTENSION_ID, { type: 'EXT_PING' }, (reply?: unknown) => {
        // MUST read lastError inside the callback, or Chrome logs the benign
        // "Could not establish connection" for every not-installed visitor.
        if (runtime.lastError || !reply || typeof reply !== 'object') return resolve(miss)
        const signedIn = (reply as { signedIn?: unknown }).signedIn
        resolve({ installed: true, signedIn: signedIn === true })
      })
    } catch {
      resolve(miss)
    }
  })
}
