import 'server-only'

// Sprint 17 / Task 5 (ADR-043): a minimal, dependency-free error reporter --
// NOT a vendor SDK. Darcy's call (2026-07-10): no @sentry/nextjs this
// sprint. An absent-DSN no-op behaves identically to a real SDK's own
// absent-DSN no-op, and a custom reporter avoids a build-pipeline rewrite
// (next.config wrapping, sentry.server/client.config.ts) plus the known
// friction of @sentry/browser inside an MV3 service worker (extension/src/
// lib/monitoring.ts). If a real vendor is wanted later, captureError below
// is the one call site the whole integration seam funnels through.
//
// The scrub is STRUCTURAL, not review-based -- same discipline as
// telemetry/events.ts's validateEvent. MonitoringContext is a closed
// allow-list of three fields (route, routeType, userId); a caller passing
// anything else -- a transcript, a page URL, a request body -- has it
// silently dropped, never forwarded. The error's own message/stack are
// length-capped as defense-in-depth: every throw site in this codebase is a
// static developer string today, but a future one that accidentally
// embeds dynamic content is still bounded rather than unbounded.

const MAX_MESSAGE_LEN = 500
const MAX_STACK_LEN = 4000

export type MonitoringContext = {
  route?: string
  routeType?: string
  // A coarse identifier ONLY -- the caller's own auth.user.id, never an
  // email, session token, or any other further-identifying field.
  userId?: string
}

export type ScrubbedMonitoringEvent = {
  message: string
  stack?: string
  route?: string
  routeType?: string
  userId?: string
  timestamp: string
}

// Exported so Task 8's monitoring.test.ts (and this task's own verification)
// can assert directly on the scrub's output -- "content stripped, route
// name kept" -- without needing to mock fetch just to exercise it.
export function scrubForMonitoring(error: unknown, context?: MonitoringContext): ScrubbedMonitoringEvent {
  const message = error instanceof Error ? error.message : String(error)
  const stack = error instanceof Error ? error.stack : undefined

  return {
    message: message.slice(0, MAX_MESSAGE_LEN),
    ...(stack ? { stack: stack.slice(0, MAX_STACK_LEN) } : {}),
    ...(context?.route ? { route: context.route } : {}),
    ...(context?.routeType ? { routeType: context.routeType } : {}),
    ...(context?.userId ? { userId: context.userId } : {}),
    timestamp: new Date().toISOString(),
  }
}

// Absent-tolerant: MONITORING_DSN is read at CALL time, not module load, so
// a boot with no env configured never throws -- captureError simply becomes
// a no-op, exactly like a real SDK with no DSN configured. Fire-and-forget:
// a monitoring POST must never throw back into the caller's own request
// path, and a failed send is simply lost -- this is observability tooling,
// never a user-facing dependency.
export function captureError(error: unknown, context?: MonitoringContext): void {
  const dsn = process.env.MONITORING_DSN
  if (!dsn) return

  const event = scrubForMonitoring(error, context)

  fetch(dsn, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(event),
  }).catch(() => {})
}
