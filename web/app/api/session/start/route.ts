import { NextResponse, after } from 'next/server'
import { clientFromBearer } from '@/lib/auth/bearer'
import { startSession, type SessionMode } from '@/lib/tier/session-gate'
import { reconcileUnappliedForUser } from '@/lib/learning/apply'

export async function POST(request: Request) {
  const auth = await clientFromBearer(request)

  if ('error' in auth) {
    return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })
  }

  const body = await request.json().catch(() => ({}))

  const mode = body.mode ?? 'voice'
  if (mode !== 'voice' && mode !== 'text') {
    return NextResponse.json({ error: 'mode must be "voice" or "text".' }, { status: 400 })
  }

  const pageDomain = typeof body.pageDomain === 'string' ? body.pageDomain : null

  // The tier decision (free-quota check + degrade/remaining) is made entirely
  // inside the start_session RPC called here — this route only relays it.
  const { data, error } = await startSession(auth.supabase, { pageDomain, mode: mode as SessionMode })

  if (error || !data) {
    return NextResponse.json({ error: error?.message ?? 'Could not start session.' }, { status: 400 })
  }

  // Cross-session reconcile sweep (ADR-019 safety net, Sprint 11 audit):
  // /api/session/end reconciles a session that ENDS, but a session the
  // client abandoned (crash, closed tab) never reaches that route and its
  // unapplied session_interactions rows would stay stranded forever. The
  // next session start is the natural, once-per-session point to sweep
  // them -- off the critical path (after()), best-effort, and safe against
  // the just-started session (its rows don't exist yet) and any in-flight
  // apply (applyInteraction's claimed_at lease).
  after(() =>
    reconcileUnappliedForUser(auth.supabase, auth.user.id).catch((err) => {
      console.error('session/start: cross-session reconcile failed', err)
    })
  )

  return NextResponse.json({
    sessionId: data.id,
    mode: data.mode,
    degraded: data.degraded,
    countsAgainstFree: data.counts_against_free,
    remaining: data.remaining,
  })
}
