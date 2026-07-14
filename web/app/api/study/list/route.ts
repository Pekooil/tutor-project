import { NextResponse } from 'next/server'
import { clientFromBearerOrCookie } from '@/lib/auth/bearer'

// Sprint 21 / Task 4 (ADR-049): GET the caller's persisted study-kit artifacts,
// newest first, RLS-scoped. Two consumers:
//   - the extension recap card (Task 5) fetches the kit for the just-ended
//     session -> `?sessionId=<id>` filters to that session (served by
//     idx_study_artifact_user_session, migration 0021).
//   - a future dashboard "Study kits" list (Sprint 22, deferred) -> no filter,
//     the caller's whole history (served by idx_study_artifact_user_created).
//
// Returns one entry per PERSISTED ROW (one per artifact kind, ADR-049 decision
// 3) -- the client assembles the notes/problems/flashcards of one session into
// a single card (Task 5's pure mapping helper). RLS is the isolation guarantee;
// the explicit user_id filter is there so the composite index is used and a
// second user's rows are never even scanned, not as the security boundary.

type ArtifactEntry = {
  id: string
  sessionId: string | null
  kind: string
  payload: unknown
  conceptKeys: string[] | null
  createdAt: string
}

type ArtifactRow = {
  id: string
  session_id: string | null
  kind: string
  payload: unknown
  concept_keys: string[] | null
  created_at: string
}

export async function GET(request: Request) {
  const auth = await clientFromBearerOrCookie(request)

  if ('error' in auth) {
    return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const sessionId = searchParams.get('sessionId')

  let query = auth.supabase
    .from('study_artifact')
    .select('id, session_id, kind, payload, concept_keys, created_at')
    .eq('user_id', auth.user.id)
    .order('created_at', { ascending: false })

  if (sessionId) {
    query = query.eq('session_id', sessionId)
  }

  const { data, error } = await query

  if (error) {
    console.error('api/study/list: read failed', error)
    return NextResponse.json({ error: 'Could not load your study kits right now.' }, { status: 502 })
  }

  const artifacts: ArtifactEntry[] = ((data ?? []) as ArtifactRow[]).map((row) => ({
    id: row.id,
    sessionId: row.session_id,
    kind: row.kind,
    payload: row.payload,
    conceptKeys: row.concept_keys,
    createdAt: row.created_at,
  }))

  return NextResponse.json({ artifacts })
}
