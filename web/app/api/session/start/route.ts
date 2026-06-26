import { NextResponse } from 'next/server'
import { clientFromBearer } from '@/lib/auth/bearer'
import { startSession, type SessionMode } from '@/lib/tier/session-gate'

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

  return NextResponse.json({
    sessionId: data.id,
    mode: data.mode,
    degraded: data.degraded,
    countsAgainstFree: data.counts_against_free,
    remaining: data.remaining,
  })
}
