import 'server-only'
import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertCronSecret } from '@/lib/cron/auth'
import { updateSessionNotebooks } from '@/lib/notebook/update'
import { generateAndPersistStudyKit } from '@/lib/study/generate-and-persist'

// Backfills Personal Notebooks for an EXISTING account by replaying its real
// finished sessions through the ordinary session-end generator
// (`updateSessionNotebooks`). Its purpose is making a demo/test account fully
// previewable: an account can have hundreds of sessions and still show an empty
// Notes view, because notebooks only started being written when ADR-054 landed.
//
// This deliberately generates from the REAL transcripts rather than inserting
// fabricated rows: the notebooks then carry the student's actual mistakes and the
// tutor's actual annotations, which is the whole point of the view. Nothing here
// is mock data.
//
// Service-role + CRON_SECRET-gated, the same bearer gate /api/cron/* and
// /api/admin/invite use (proxy.ts exempts /api/admin from the cookie gate so a
// bearer request isn't redirected to /login; THIS check is the real gate).
//
// Cost: one model call per concept per session, capped at
// MAX_NOTEBOOK_CONCEPTS_PER_SESSION (3) inside updateSessionNotebooks, and every
// call passes the same cost guard as a live session. `sessions` is capped hard
// below so a mistyped body cannot walk an entire account.
//
// Usage:
//   curl -X POST .../api/admin/seed-notebooks \
//     -H "Authorization: Bearer $CRON_SECRET" -H 'content-type: application/json' \
//     -d '{"email":"test@gmail.com","sessions":6,"dryRun":true}'
const MAX_SESSIONS = 25

export async function POST(request: Request) {
  const denied = assertCronSecret(request)
  if (denied) return denied

  let body: { email?: unknown; sessions?: unknown; dryRun?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 })
  }

  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
  if (!email) {
    return NextResponse.json({ error: 'email must be a non-empty string.' }, { status: 400 })
  }

  // Defaults to a dry run, like the notebook backfill: a bare call never spends.
  const dryRun = body.dryRun !== false
  const requested = typeof body.sessions === 'number' ? Math.floor(body.sessions) : 5
  if (!Number.isFinite(requested) || requested < 1) {
    return NextResponse.json({ error: 'sessions must be a positive number.' }, { status: 400 })
  }
  const limit = Math.min(requested, MAX_SESSIONS)

  const admin = createAdminClient()

  const { data: user, error: userError } = await admin
    .from('users')
    .select('id')
    .eq('email', email)
    .maybeSingle()

  if (userError) {
    console.error('seed-notebooks: user lookup failed', userError)
    return NextResponse.json({ error: 'Could not look up that account.' }, { status: 502 })
  }
  if (!user) {
    return NextResponse.json({ error: `No account for ${email}.` }, { status: 404 })
  }
  const userId = (user as { id: string }).id

  // Newest sessions first: the most recent work is what a preview should show,
  // and a notebook revised by several sessions ends up reflecting the latest.
  // Only ENDED sessions — an unfinished one has no recap to generate from.
  const { data: sessions, error: sessionError } = await admin
    .from('sessions')
    .select('id, started_at')
    .eq('user_id', userId)
    .not('ended_at', 'is', null)
    .order('started_at', { ascending: false })
    .limit(limit)

  if (sessionError || !sessions) {
    console.error('seed-notebooks: session read failed', sessionError)
    return NextResponse.json({ error: 'Could not read that account’s sessions.' }, { status: 502 })
  }

  const rows = sessions as { id: string; started_at: string }[]
  if (dryRun) {
    return NextResponse.json({
      dryRun: true,
      email,
      wouldReplay: rows.map((s) => ({ sessionId: s.id, startedAt: s.started_at })),
    })
  }

  // Oldest-first when actually generating, so each notebook is revised in the
  // order the student lived it and the newest session has the last word.
  const results: {
    sessionId: string
    updated: string[]
    skipped: string[]
    deferred: string[]
    kit: 'created' | 'existed' | 'refused-cost' | 'nothing-to-generate' | 'failed'
  }[] = []

  for (const session of [...rows].reverse()) {
    const outcome = await updateSessionNotebooks(admin, userId, session.id)

    // Also give the session a study kit, so the concept's Quiz and Flashcards
    // views have something to show. `study_artifact` is append-only with no
    // uniqueness constraint, so the existence check is what stops a re-run
    // stacking duplicate kits on the same session (the session-end route does
    // the same check for the same reason).
    let kit: (typeof results)[number]['kit']
    const { count: existing } = await admin
      .from('study_artifact')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('session_id', session.id)

    if (existing) {
      kit = 'existed'
    } else {
      const generated = await generateAndPersistStudyKit(admin, userId, session.id)
      kit =
        'kit' in generated
          ? 'created'
          : 'refused' in generated
            ? generated.refused === 'cost'
              ? 'refused-cost'
              : 'nothing-to-generate'
            : 'failed'
    }

    results.push({ sessionId: session.id, ...outcome, kit })
  }

  const [{ count: notebooks }, { count: artifacts }] = await Promise.all([
    admin.from('concept_notebook').select('id', { count: 'exact', head: true }).eq('user_id', userId),
    admin.from('study_artifact').select('id', { count: 'exact', head: true }).eq('user_id', userId),
  ])

  return NextResponse.json({
    dryRun: false,
    email,
    sessionsReplayed: results.length,
    conceptsWritten: [...new Set(results.flatMap((r) => r.updated))],
    notebooksNow: notebooks ?? null,
    studyArtifactsNow: artifacts ?? null,
    kitOutcomes: results.reduce<Record<string, number>>((acc, r) => {
      acc[r.kit] = (acc[r.kit] ?? 0) + 1
      return acc
    }, {}),
    results,
  })
}
