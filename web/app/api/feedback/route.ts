import { NextResponse } from 'next/server'
import { clientFromBearerOrCookie } from '@/lib/auth/bearer'

// Sprint 17 / Task 4 (ADR-039): POST { kind, rating?, message?, sessionId? } --
// inserts one row into `feedback`, RLS-scoped to the caller (`user_id` is
// always the AUTHENTICATED caller's id, never read from the body). Capture
// only, per ADR-039: no status/workflow, no reply, no email -- a single
// insert-and-forget. `message` is the one deliberate user-authored free-text
// field this sprint (ADR-043); it is optional and passed through verbatim,
// exactly as the user typed it.
//
// No GET: feedback is write-then-manually-triaged (by Darcy, directly against
// the table); there is no client-facing read surface for it this sprint.
//
// `sessionId` is trusted the same way the turn route already trusts a
// client-supplied sessionId (web/app/api/ai/turn/route.ts): RLS + the
// `feedback.session_id` FK (on delete set null, migration 0017) are the
// enforcement, not an app-level "does this session belong to me" check -- the
// same posture the rest of this codebase already takes for session ids.

const FEEDBACK_KINDS = ['bug', 'rating', 'idea'] as const
type FeedbackKind = (typeof FEEDBACK_KINDS)[number]

// Matches the `rating smallint` column (migration 0017) -- no CHECK
// constraint on the DB side, so this bound is a DB-safety guard against a
// smallint overflow, not an assumption about what UI scale Task 7 ends up
// using.
const SMALLINT_MIN = -32768
const SMALLINT_MAX = 32767

function isValidKind(value: unknown): value is FeedbackKind {
  return typeof value === 'string' && (FEEDBACK_KINDS as readonly string[]).includes(value)
}

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

  const { kind, rating, message, sessionId } = (body ?? {}) as Record<string, unknown>

  if (!isValidKind(kind)) {
    return NextResponse.json({ error: "kind must be one of 'bug', 'rating', or 'idea'." }, { status: 400 })
  }

  if (rating !== undefined && rating !== null) {
    if (!Number.isInteger(rating) || (rating as number) < SMALLINT_MIN || (rating as number) > SMALLINT_MAX) {
      return NextResponse.json({ error: 'rating must be an integer.' }, { status: 400 })
    }
  }

  if (message !== undefined && message !== null && typeof message !== 'string') {
    return NextResponse.json({ error: 'message must be a string.' }, { status: 400 })
  }

  if (sessionId !== undefined && sessionId !== null && typeof sessionId !== 'string') {
    return NextResponse.json({ error: 'sessionId must be a string.' }, { status: 400 })
  }

  const { error } = await auth.supabase.from('feedback').insert({
    user_id: auth.user.id,
    session_id: sessionId ?? null,
    kind,
    rating: rating ?? null,
    message: message ?? null,
  })

  if (error) {
    // Server-side terminal only -- never relay the DB error text to the client.
    console.error('api/feedback: insert failed', error)
    return NextResponse.json({ error: 'Could not save your feedback right now.' }, { status: 502 })
  }

  return NextResponse.json({ ok: true })
}
