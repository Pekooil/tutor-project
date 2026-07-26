import { NextResponse, after } from 'next/server'
import { clientFromBearer } from '@/lib/auth/bearer'
import { endSession } from '@/lib/tier/session-gate'
import { reconcileSession } from '@/lib/learning/apply'
import { buildSessionRecap, type SessionRecap } from '@/lib/learning/recap'
import { generateAndPersistStudyKit } from '@/lib/study/generate-and-persist'
import { updateSessionNotebooks } from '@/lib/notebook/update'
import {
  diffScore,
  parseScoreSnapshot,
  readScoreSnapshot,
  type ScoreChange,
} from '@/lib/learning/score-snapshot'

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

  // Study kits now generate after EVERY session, not only one that spotted a
  // new misconception (2026-07-26, Darcy). A student who had a clean session
  // still practised something worth revising, and the extension's recap now
  // shows the kit being built rather than offering a button, so a session that
  // silently produced nothing read as the feature being broken.
  //
  // Moved into after(): the model call used to run BEFORE this response
  // returned, which delayed the recap card by the length of a generation. The
  // recap must appear the instant the session ends and report the kit as
  // in-progress, so the work happens after the response is sent.
  //
  // Guards, unchanged in spirit:
  //   1. kill switch (CALYXA_DISABLE_AUTO_STUDY_KIT=1) — the prod valve AND
  //      what the session-lifecycle integration tests set so they never call
  //      the model,
  //   2. only for a session with something gradable (recap.concepts),
  //   3. skip if a kit already exists (idempotent — the extension recap may
  //      have asked for one first),
  //   4. cost-guarded inside generateAndPersistStudyKit (hard cap → no-op).
  const autoKitEnabled = process.env.CALYXA_DISABLE_AUTO_STUDY_KIT !== '1'
  if (autoKitEnabled && recap && recap.concepts.length > 0) {
    after(async () => {
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
    })
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

  // What this session moved on the /data progress score. The "before" was
  // snapshotted when the session opened (migration 0028) because none of the
  // three signals can be reconstructed afterwards. Unlike the blocks above this
  // one IS awaited — the summary is part of what the recap renders, so it
  // cannot arrive later — but it degrades to omitted on any failure, and a
  // session that started before 0028 simply has no snapshot to diff.
  let scoreChange: ScoreChange | null = null
  if (recap && recap.concepts.length > 0) {
    try {
      // Read the snapshot directly: end_session is an RPC with a fixed row
      // shape, so widening it to carry this column would mean changing the
      // function. One indexed by-id select is cheaper than that risk.
      const { data: snapRow } = await auth.supabase
        .from('sessions')
        .select('score_at_start')
        .eq('id', body.sessionId)
        .maybeSingle()
      const before = parseScoreSnapshot(snapRow?.score_at_start ?? null)
      if (before) {
        scoreChange = diffScore(before, await readScoreSnapshot(auth.supabase))
      }
    } catch (err) {
      console.error('session/end: score diff failed', err)
    }
  }

  return NextResponse.json({
    sessionId: ended.id,
    endedAt: ended.ended_at,
    interactionCount: ended.interaction_count,
    ...(recap ? { recap } : {}),
    ...(scoreChange ? { scoreChange } : {}),
  })
}
