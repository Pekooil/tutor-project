import { NextResponse } from 'next/server'
import { clientFromBearer } from '@/lib/auth/bearer'
import { endSession } from '@/lib/tier/session-gate'
import { summariseSession } from '@/lib/ai/summarise'
import { applySessionSummary } from '@/lib/learning/apply'
import type { TurnMessage } from '@/lib/ai/claude'

// Ends a session (Sprint 04 behaviour, unchanged) and, when the caller
// supplies the session's transcript, performs this sprint's ONLY new DB
// write: one end-of-session summariser call (ADR-015) whose structured
// SessionSummary is applied to knowledge_nodes/misconceptions (ADR-014).
// /api/ai/turn still writes nothing (ADR-013) -- this route is the sole
// write path for learning state, and only at session end.

// Mirrors /api/ai/turn's parseMessages caps -- the transcript is untrusted
// client input. Unlike that route, a missing/malformed/oversized transcript
// degrades to "no transcript" (skip the summary) rather than 400ing the
// request: ending the session must never be blocked by a bad summary input.
const MAX_MESSAGES = 40
const MAX_MESSAGE_LENGTH = 4000

function parseTranscript(body: unknown): TurnMessage[] | undefined {
  if (typeof body !== 'object' || body === null) {
    return undefined
  }

  const { transcript } = body as { transcript?: unknown }

  if (transcript === undefined) {
    return undefined
  }

  if (!Array.isArray(transcript) || transcript.length === 0 || transcript.length > MAX_MESSAGES) {
    return undefined
  }

  const parsed: TurnMessage[] = []

  for (const raw of transcript) {
    if (typeof raw !== 'object' || raw === null) {
      return undefined
    }

    const { role, content } = raw as { role?: unknown; content?: unknown }

    if (
      (role !== 'user' && role !== 'assistant') ||
      typeof content !== 'string' ||
      content.length === 0 ||
      content.length > MAX_MESSAGE_LENGTH
    ) {
      return undefined
    }

    parsed.push({ role, content })
  }

  return parsed
}

export async function POST(request: Request) {
  const auth = await clientFromBearer(request)

  if ('error' in auth) {
    return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })
  }

  const body = await request.json().catch(() => ({}))

  if (typeof body.sessionId !== 'string' || !body.sessionId) {
    return NextResponse.json({ error: 'sessionId is required.' }, { status: 400 })
  }

  const { data, error } = await endSession(auth.supabase, body.sessionId)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 })
  }

  // RLS + the `user_id = auth.uid()` predicate in end_session mean a
  // forged/cross-user sessionId matches zero rows here, not an error.
  const ended = data?.[0]
  if (!ended) {
    return NextResponse.json({ error: 'no such open session' }, { status: 404 })
  }

  // The open->ended transition above is the idempotency guard (ADR-015): a
  // repeat end for this sessionId matches no open row and 404s above, so
  // this point -- and the summary write below -- is reached at most once
  // per session. A summariser/apply failure is logged but never turns this
  // already-successful end into an error response (best-effort, ADR-015).
  const transcript = parseTranscript(body)

  if (transcript) {
    try {
      const summary = await summariseSession({ transcript })
      await applySessionSummary(auth.supabase, summary)
    } catch (err) {
      console.error('session/end: summary write failed', err)
    }
  }

  return NextResponse.json({
    sessionId: ended.id,
    endedAt: ended.ended_at,
    interactionCount: ended.interaction_count,
  })
}
