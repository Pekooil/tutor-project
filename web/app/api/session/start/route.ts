import { NextResponse, after } from 'next/server'
import { clientFromBearer } from '@/lib/auth/bearer'
import { startSession, type SessionMode } from '@/lib/tier/session-gate'
import { reconcileUnappliedForUser } from '@/lib/learning/apply'
import { hashPageDomain } from '@/lib/privacy/url-hash'
import { readScoreSnapshot } from '@/lib/learning/score-snapshot'
import { resolveEntitlements, FREE_ENTITLEMENTS } from '@/lib/entitlements/resolve'

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
  // inside the start_session RPC called here — this route only relays it. The
  // caller's billing columns are read in PARALLEL (Sprint 23 / Task 6): the
  // entitlements attached below are a DISPLAY hint and must not add a serial
  // round-trip to the start latency. Both reads are RLS-scoped to the caller.
  const [{ data, error }, billing] = await Promise.all([
    startSession(auth.supabase, { pageUrlHash, mode: mode as SessionMode }),
    auth.supabase
      .from('users')
      .select('subscription_tier, subscription_status')
      .eq('id', auth.user.id)
      .maybeSingle(),
  ])

  if (error || !data) {
    return NextResponse.json({ error: error?.message ?? 'Could not start session.' }, { status: 400 })
  }

  // Entitlements ride the response for DISPLAY only (the extension caches them
  // in ActiveSession for UX); every Pro path RE-DERIVES them server-side via
  // assertEntitlement — the cached value never authorizes (ADR-051). If the
  // billing read failed, fall back to the free set: display defaults to free,
  // never accidentally grants Pro. Resolved from tier (the grace authority) +
  // status.
  const entitlements = billing.data
    ? resolveEntitlements(billing.data.subscription_tier, billing.data.subscription_status)
    : FREE_ENTITLEMENTS

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

  // Progress-score snapshot (migration 0028), for the end-of-session "what
  // changed" summary. Taken HERE because none of the three signals can be
  // reconstructed after the fact: mastery only moves on the daily cron, and
  // accuracy/consistency are windowed over activity days that this session is
  // about to alter.
  //
  // after() for the same reason as the reconcile above — start latency is felt
  // by a student waiting for the pill, and two extra reads are never worth it.
  // The write races this session's first interaction in principle; in practice
  // a turn takes seconds and this takes milliseconds, and losing the race costs
  // one summary, not correctness. Failures are swallowed: no snapshot simply
  // means the recap shows no summary.
  after(async () => {
    try {
      const snapshot = await readScoreSnapshot(auth.supabase)
      if (!snapshot) return
      await auth.supabase.from('sessions').update({ score_at_start: snapshot }).eq('id', data.id)
    } catch (err) {
      console.error('session/start: score snapshot failed', err)
    }
  })

  return NextResponse.json({
    sessionId: data.id,
    mode: data.mode,
    degraded: data.degraded,
    countsAgainstFree: data.counts_against_free,
    remaining: data.remaining,
    entitlements,
  })
}
