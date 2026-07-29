import { NextResponse } from 'next/server'
import { clientFromBearerOrCookie } from '@/lib/auth/bearer'
import { parseSyncBody, toRow } from '@/lib/homework/sync-shape'

// POST { sessions: SyncedHomeworkSession[] } — the v4 homework session's
// server half (ADR-057).
//
// This route is a MIRROR, never the source of truth. The extension owns the
// live set in chrome.storage.local and a tap is acknowledged locally in under
// 100ms whether or not this succeeds; this exists so the Studio v4 dashboard
// can show sets that outlive one browser profile. That posture is why:
//
//   - it upserts on the CLIENT-MINTED id (idempotent: a set syncs on
//     completion and again on every pause, and a retry must not pile up rows),
//   - `user_id` is always the AUTHENTICATED caller's, never read from the body
//     (the feedback-route posture), and
//   - a malformed entry is DROPPED and the rest of the batch still lands --
//     one bad row in a retry queue must not cost the student every other set
//     in it. The response reports what was accepted so the extension can clear
//     exactly those from its queue.
//
// No GET: the dashboard reads through its own server components with the RLS-
// scoped client (ADR-047's per-request-fresh discipline), not through here.

export async function POST(request: Request) {
  const auth = await clientFromBearerOrCookie(request)

  if ('error' in auth) {
    return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 })
  }

  const sessions = parseSyncBody(body)
  if (sessions.length === 0) {
    // Nothing usable is not an error -- an extension with an empty queue and
    // an extension that sent junk both get the same "nothing to do" answer,
    // and neither should trigger a retry loop.
    return NextResponse.json({ ok: true, synced: [] })
  }

  const rows = sessions.map((session) => ({ ...toRow(session), user_id: auth.user.id }))

  const { error } = await auth.supabase.from('homework_session').upsert(rows, { onConflict: 'id' })

  if (error) {
    // Server-side terminal only -- never relay the DB error text to the client.
    console.error('api/homework/sync: upsert failed', error)
    return NextResponse.json({ error: 'Could not save your homework session right now.' }, { status: 502 })
  }

  return NextResponse.json({ ok: true, synced: sessions.map((session) => session.id) })
}
