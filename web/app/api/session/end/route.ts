import { NextResponse } from 'next/server'
import { clientFromBearer } from '@/lib/auth/bearer'
import { endSession } from '@/lib/tier/session-gate'
import { reconcileSession } from '@/lib/learning/apply'
import { buildSessionRecap, type SessionRecap } from '@/lib/learning/recap'
import { generateAndPersistStudyKit } from '@/lib/study/generate-and-persist'
import { updateSessionNotebooks } from '@/lib/notebook/update'

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

  // Misconception → study-kit workflow: when this session SPOTTED a new
  // misconception, auto-generate its study kit so the student can practice it
  // on the web dashboard (there is no spaced-repetition review flow anymore).
  // Best-effort, the same posture as the reconcile/recap above — it never
  // blocks or alters the already-successful end response. Guarded four ways:
  //   1. a kill switch (CALYXA_DISABLE_AUTO_STUDY_KIT=1) — a prod safety valve
  //      AND the isolation session-lifecycle integration tests set so they never
  //      exercise generation (mirrors the COST_*_OVERRIDE test convention),
  //   2. only when `recap.misconceptionsAdded` is non-empty (a NEW misconception),
  //   3. skip if a kit already exists for this session (idempotent; session/end
  //      is itself once-per-session via the open→ended guard, but a manual
  //      extension-recap generation may have beaten us to it),
  //   4. cost-guarded inside generateAndPersistStudyKit (hard cap → silent no-op).
  const autoKitEnabled = process.env.CALYXA_DISABLE_AUTO_STUDY_KIT !== '1'
  if (autoKitEnabled && recap && recap.misconceptionsAdded.length > 0) {
    try {
      const { count } = await auth.supabase
        .from('study_artifact')
        .select('id', { count: 'exact', head: true })
        .eq('session_id', body.sessionId)
      if (!count) {
        await generateAndPersistStudyKit(auth.supabase, auth.user.id, body.sessionId)
      }
    } catch (err) {
      console.error('session/end: auto study-kit generation failed', err)
    }
  }

  // Personal Notebook (ADR-054): after EVERY session that practiced a concept,
  // revise that concept's running notebook. updateSessionNotebooks loads the
  // session source once, ranks the practiced concepts, caps to the most-worked
  // few, and cost-guards each revision — so this block just gates on the kill
  // switch and delegates. Best-effort, the same posture as the reconcile / recap
  // / study-kit blocks above: a failure is logged and never alters the
  // already-successful end response. The `recap.concepts` check is an early skip
  // for sessions with nothing gradable (updateSessionNotebooks re-derives the
  // same set from its own source read and no-ops safely either way). The kill
  // switch is the prod valve AND the opt-out the session-lifecycle integration
  // tests set so they never call the model (the CALYXA_DISABLE_AUTO_STUDY_KIT
  // convention).
  const notebooksEnabled = process.env.CALYXA_DISABLE_NOTEBOOK !== '1'
  if (notebooksEnabled && recap && recap.concepts.length > 0) {
    try {
      await updateSessionNotebooks(auth.supabase, auth.user.id, body.sessionId)
    } catch (err) {
      console.error('session/end: notebook update failed', err)
    }
  }

  return NextResponse.json({
    sessionId: ended.id,
    endedAt: ended.ended_at,
    interactionCount: ended.interaction_count,
    ...(recap ? { recap } : {}),
  })
}
