import { NextResponse } from 'next/server'
import { clientFromBearer } from '@/lib/auth/bearer'
import { endSession } from '@/lib/tier/session-gate'
import { reconcileSession } from '@/lib/learning/apply'
import { buildSessionRecap, type SessionRecap } from '@/lib/learning/recap'

// Ends a session (Sprint 04 behaviour, unchanged). ADR-019 retires the
// end-of-session summariser Anthropic call (ADR-015) -- learning state is
// now written per turn by /api/ai/turn's off-critical-path apply, so this
// route's only remaining learning-state job is a RECONCILE sweep: apply
// any session_interactions rows that hook didn't finish before the session
// ended. No transcript is accepted or needed anymore -- the transcript IS
// already persisted, per turn, in session_interactions.

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

  // The open->ended transition above is the idempotency guard: a repeat
  // end for this sessionId matches no open row and 404s above, so this
  // point -- and the reconcile sweep below -- is reached at most once per
  // session. A reconcile failure is logged but never turns this
  // already-successful end into an error response (best-effort, matching
  // ADR-015's original posture for the now-retired summariser write).
  try {
    await reconcileSession(auth.supabase, body.sessionId)
  } catch (err) {
    console.error('session/end: reconcile failed', err)
  }

  // The recap (Sprint 13, ADR-025): a read of the tables the awaited
  // reconcile above just finished writing -- built here, in the same
  // request, so it cannot disagree with the real mastery write. Additive
  // and best-effort, the same posture as the reconcile: a recap failure is
  // logged and the field omitted, never an error on an already-successful
  // end; a session with no gradable interactions returns undefined and the
  // response stays byte-identical to Sprint 11.
  let recap: SessionRecap | undefined
  try {
    recap = await buildSessionRecap(auth.supabase, auth.user.id, body.sessionId)
  } catch (err) {
    console.error('session/end: recap build failed', err)
  }

  return NextResponse.json({
    sessionId: ended.id,
    endedAt: ended.ended_at,
    interactionCount: ended.interaction_count,
    ...(recap ? { recap } : {}),
  })
}
