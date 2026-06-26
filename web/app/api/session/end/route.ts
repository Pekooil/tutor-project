import { NextResponse } from 'next/server'
import { clientFromBearer } from '@/lib/auth/bearer'
import { endSession } from '@/lib/tier/session-gate'

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

  return NextResponse.json({
    sessionId: ended.id,
    endedAt: ended.ended_at,
    interactionCount: ended.interaction_count,
  })
}
