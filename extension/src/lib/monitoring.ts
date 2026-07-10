// Sprint 17 / Task 5 (ADR-043): the extension-side error-capture module --
// usable by BOTH the background service worker and the content script (Task
// 6 wires each in). Deliberately dependency/transport-agnostic: `send` is
// injected by the caller, never implemented here, so this file never touches
// `fetch` or `chrome.runtime` itself. That is what keeps it safe to reuse
// unmodified in both contexts -- the background is the extension's sole
// network-egress context (ADR-006, ./api.ts), so ONLY the background's
// `send` may ever call fetch (directly, or via api.ts's authorizedFetch, at
// Task 6's discretion); the content script's `send` must relay a
// chrome.runtime message to the background instead, never touch the
// network itself.
//
// No monitoring secret/DSN lives anywhere in this file or ships in the
// extension bundle (the locked "no key in the extension bundle" rule) --
// the background relays through POST /api/errors (web/app/api/errors/
// route.ts), which alone holds MONITORING_DSN, server-side only.
//
// The scrub is the SAME structural allow-list discipline as the web half
// (web/lib/monitoring/init.ts): only `context` (a short, developer-supplied
// label -- e.g. 'background' or a message-handler name -- never user-
// authored text) rides alongside the error; message/stack are length-capped
// defense-in-depth.

const MAX_MESSAGE_LEN = 500;
const MAX_STACK_LEN = 4000;

export type MonitoringContext = {
  context?: string;
};

export type ScrubbedErrorEvent = {
  message: string;
  stack?: string;
  context?: string;
  timestamp: string;
};

export function scrubError(error: unknown, context?: MonitoringContext): ScrubbedErrorEvent {
  const message = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? error.stack : undefined;

  return {
    message: message.slice(0, MAX_MESSAGE_LEN),
    ...(stack ? { stack: stack.slice(0, MAX_STACK_LEN) } : {}),
    ...(context?.context ? { context: context.context } : {}),
    timestamp: new Date().toISOString(),
  };
}

/**
 * Installs `error`/`unhandledrejection` listeners on whatever global scope
 * it is called from -- works unmodified for both the background worker's
 * `self` and the content script's `window`, since both implement
 * EventTarget the same way. `send` is the one seam Task 6 wires: the
 * background's send POSTs (directly, or via api.ts) to /api/errors; the
 * content script's send calls chrome.runtime.sendMessage(LOG_ERROR, ...)
 * instead, never fetch.
 */
export function installGlobalErrorCapture(
  target: EventTarget,
  send: (event: ScrubbedErrorEvent) => void,
  context?: MonitoringContext,
): void {
  target.addEventListener('error', (event) => {
    const err = (event as ErrorEvent).error ?? event;
    send(scrubError(err, context));
  });

  target.addEventListener('unhandledrejection', (event) => {
    send(scrubError((event as PromiseRejectionEvent).reason, context));
  });
}
