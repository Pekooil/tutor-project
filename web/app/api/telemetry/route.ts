import { NextResponse } from 'next/server'
import { clientFromBearerOrCookie } from '@/lib/auth/bearer'
import { validateEvent, type TelemetryEvent } from '@/lib/telemetry/events'

// Sprint 17 / Task 4 (ADR-043): POST { events: TelemetryEvent[] } -- validates
// each event against the union (rejecting unknown kinds and any event
// carrying a field outside its kind's exact shape, e.g. a smuggled string),
// and inserts only the valid ones into `telemetry_event` (kind + payload
// jsonb). `user_id` is always the AUTHENTICATED caller's id -- never read
// from the body -- and every insert runs under that caller's RLS-scoped
// client, so the DB's own `telemetry_event_insert_own` policy
// (`auth.uid() = user_id`, migration 0017) enforces the same rule structurally
// underneath this route.
//
// No GET: telemetry_event is insert-only from the owner by design (ADR-043)
// -- analysis reads are service-role only, not a client-facing endpoint.
//
// A malformed event is DROPPED, not a reason to fail the whole batch -- this
// mirrors the background worker's batching/swallow-failures posture (Task 6):
// one bad event in a batch of otherwise-good ones should not cost the rest.
// Only a structurally malformed REQUEST (no `events` array at all) is a 400.

export async function POST(request: Request) {
  const auth = await clientFromBearerOrCookie(request)

  if ('error' in auth) {
    return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 })
  }

  const rawEvents = (body as { events?: unknown })?.events
  if (!Array.isArray(rawEvents)) {
    return NextResponse.json({ error: 'Expected { events: [...] }.' }, { status: 400 })
  }

  const validEvents = rawEvents.filter(validateEvent) as TelemetryEvent[]
  const rejected = rawEvents.length - validEvents.length

  if (validEvents.length === 0) {
    return NextResponse.json({ inserted: 0, rejected })
  }

  const rows = validEvents.map(({ kind, ...payload }) => ({
    user_id: auth.user.id,
    kind,
    payload,
  }))

  const { error } = await auth.supabase.from('telemetry_event').insert(rows)

  if (error) {
    // Server-side terminal only -- never relay the DB error text to the
    // client. A telemetry-insert failure must never surface to the student;
    // the extension side (Task 6) already swallows a failed POST outright.
    console.error('api/telemetry: insert failed', error)
    return NextResponse.json({ error: 'Could not record telemetry right now.' }, { status: 502 })
  }

  return NextResponse.json({ inserted: validEvents.length, rejected })
}
