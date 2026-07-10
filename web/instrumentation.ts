// Sprint 17 / Task 5 (ADR-043): Next.js's own instrumentation hook.
// `onRequestError` is called automatically by Next for any server-side
// rendering/route/action error, so a genuinely uncaught bug surfaces here
// project-wide with no per-route retrofitting. This codebase's existing
// routes already catch their own expected failures internally (console.error
// + a generic client message -- the established convention) and so never
// reach this hook today; wiring captureError into every existing catch
// block is a separate, larger change outside Task 5's file list, not done
// here (flagged in the sprint-17-plan.md Task 5 done-notes).
//
// Only the error and `errorContext.routePath`/`routeType` are read here.
// `errorRequest.headers` (can carry cookies/Authorization) and its resolved
// `.path` (can carry a query string) are deliberately never touched --
// `routePath` is the templated route ("/api/onboarding"), exactly the
// "route name" ADR-043 asks the sink to keep, with nothing request-specific
// riding along.
import { captureError } from '@/lib/monitoring/init'

export async function register() {
  // No boot-time setup needed -- captureError reads MONITORING_DSN lazily,
  // at call time. This function exists for the file-convention Next.js
  // looks for, and as the seam a future startup check would hang off.
}

export async function onRequestError(
  error: unknown,
  _request: { path: string; method: string; headers: Record<string, unknown> },
  errorContext: { routePath: string; routeType: string }
): Promise<void> {
  captureError(error, { route: errorContext.routePath, routeType: errorContext.routeType })
}
