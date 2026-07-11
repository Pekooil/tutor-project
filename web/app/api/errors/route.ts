import { NextResponse } from 'next/server'
import { clientFromBearerOrCookie } from '@/lib/auth/bearer'
import { captureError } from '@/lib/monitoring/init'
import { createAdminClient } from '@/lib/supabase/admin'
import { checkRateLimit, clientBucket, tooManyRequests } from '@/lib/rate-limit/limiter'

// Sprint 17 / Task 5 (ADR-043): the relay for extension-originated errors.
// The background worker (sole egress, ADR-006) scrubs an error CLIENT-SIDE
// (extension/src/lib/monitoring.ts's scrubError) before it ever leaves the
// extension, then POSTs the already-scrubbed shape here; this route
// re-validates that shape (never trusting a client body, same posture as
// every other route in this codebase) and relays it to the real sink via
// captureError -- the extension itself holds no monitoring secret/DSN of
// any kind (the locked "no key in the extension bundle" rule); only this
// route does, server-side only.
//
// Deliberately does NOT require auth to succeed, unlike every other route in
// this codebase: the whole point of error monitoring is to see failures
// that happen WITHOUT a valid session too -- a crashed background worker on
// startup, a failed token refresh, a content-script error on a page the
// user never signed in on -- and 401-ing here would silently blackhole
// exactly the errors most worth seeing. When a session IS present, its
// user id rides along as the same "coarse id at most" context captureError
// already accepts for web-originated errors; when it isn't, the event is
// still captured with no user id at all, same as an anonymous SDK event.
//
// Known, accepted risk (same posture as the anonymous-write waitlist
// route, migration 0012): this endpoint is reachable without auth, so it
// inherits the generic public-endpoint abuse surface any error-ingestion
// endpoint has. Strict shape validation below bounds the worst case;
// rate-limiting is not built this sprint (not asked for, and would need
// real traffic data to size sensibly).

const MAX_CONTEXT_LEN = 100

type ExtensionErrorEvent = {
  message: string
  stack?: string
  context?: string
}

// Same allow-list discipline as telemetry/events.ts's validateEvent: an
// unrecognized property is rejected, not silently ignored -- this is what
// keeps "the extension can only ever send message/stack/context" a
// structural property of the route, not a review convention.
function isValidEvent(value: unknown): value is ExtensionErrorEvent {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Record<string, unknown>

  if (typeof record.message !== 'string') return false
  if ('stack' in record && typeof record.stack !== 'string') return false
  if ('context' in record && typeof record.context !== 'string') return false

  const allowedKeys = new Set(['message', 'stack', 'context'])
  return Object.keys(record).every((key) => allowedKeys.has(key))
}

export async function POST(request: Request) {
  // Rate-limit first (Sprint 18 security review §7.1 follow-up). This route
  // never 401s, so the per-IP limit is its only bound on repeated posts. Fails
  // OPEN on any RPC error — a limiter fault must not blackhole real error
  // reports, the exact thing this route exists to capture.
  const rate = await checkRateLimit(createAdminClient(), 'errors', clientBucket(request, 'errors'))
  if (!rate.allowed) return tooManyRequests(rate.retryAfterSeconds)

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 })
  }

  if (!isValidEvent(body)) {
    return NextResponse.json({ error: 'Malformed error event.' }, { status: 400 })
  }

  // Best-effort auth only -- see the file comment above for why this route
  // never 401s on a missing/invalid session.
  const auth = await clientFromBearerOrCookie(request)
  const userId = 'error' in auth ? undefined : auth.user.id

  // Reconstructed so captureError's own scrub (message/stack length caps)
  // applies identically to extension-relayed errors as to a real thrown
  // server Error -- one scrub implementation, not two.
  const reconstructed = new Error(body.message)
  if (body.stack) reconstructed.stack = body.stack

  captureError(reconstructed, {
    route: body.context ? `extension:${body.context.slice(0, MAX_CONTEXT_LEN)}` : 'extension',
    ...(userId ? { userId } : {}),
  })

  return NextResponse.json({ ok: true })
}
