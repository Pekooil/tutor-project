import { NextResponse, after } from 'next/server'
import { clientFromBearer } from '@/lib/auth/bearer'
import { startSession, type SessionMode } from '@/lib/tier/session-gate'
import { reconcileUnappliedForUser } from '@/lib/learning/apply'
import { hashPageDomain } from '@/lib/privacy/url-hash'

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

  // Sprint 16 / Task 7 (ADR-036): hash immediately, discard the plaintext.
  // The extension only ever sends a registrable domain (deriveTabDomain),
  // never a full URL — this is the last step to page identifiers being
  // hashed at rest: the domain string is never passed on from here.
  //
  // hashPageDomain THROWS when URL_HASH_SALT is unset (the privacy fuse:
  // plaintext must never leak through as a "fallback"). A missing salt is a
  // deployment-config defect, not a reason to refuse every session: degrade
  // to a NULL hash — exactly what a domainless start already stores — so
  // sessions (and everything downstream: persistence, learning writes,
  // recaps) keep working while the loud log gets the env var restored.
  // Live incident 2026-07-15: the salt vanished from the prod environment
  // and every extension session start 500'd here for a day.
  let pageUrlHash: string | null = null
  try {
    pageUrlHash = hashPageDomain(pageDomain)
  } catch (err) {
    console.error('session/start: hashPageDomain failed — storing a NULL page hash; restore URL_HASH_SALT', err)
  }

  // The tier decision (free-quota check + degrade/remaining) is made entirely
  // inside the start_session RPC called here — this route only relays it.
  const { data, error } = await startSession(auth.supabase, { pageUrlHash, mode: mode as SessionMode })

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
