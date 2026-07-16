import { NextResponse } from 'next/server'
import { clientFromBearerOrCookie } from '@/lib/auth/bearer'
import { generateAndPersistStudyKit } from '@/lib/study/generate-and-persist'
import type { StudyKit } from '@/lib/study/tool'

// Sprint 21 / Task 4 (ADR-049): POST { sessionId } -- turn one completed
// session into a persisted study kit. The order is the plan's acceptance gate:
// auth -> cost guard BEFORE any Claude call -> the shared session read ->
// generate -> persist -> return the kit.
//
// Response shapes (all 200 unless noted), a discriminated union the extension
// (Task 5) branches on:
//   { kit }              -- generated and persisted
//   { refused: 'cost' }  -- hard cap hit; NO Claude call was made (ADR-041)
//   { refused: 'empty' } -- nothing to generate from, or the model returned an
//                           empty kit; nothing persisted (never a half-kit)
//   401 { error }        -- not signed in
//   400 { error }        -- missing/invalid sessionId
//   502 { error }        -- the read / model / persist failed
//
// Auth is bearer-OR-cookie (clientFromBearerOrCookie): the extension recap card
// (Task 5) calls with a bearer token, and a future dashboard "Study kits"
// button (Sprint 22) calls with a cookie session -- one route serves both, the
// way the account export/delete routes already do. RLS on `auth.supabase` is
// the ownership guarantee end to end (the read only sees the caller's session,
// the insert can only write the caller's user_id) -- no app-level "is this my
// session" check, the same posture /api/feedback and the turn route take for a
// client-supplied sessionId.
//
// There is deliberately NO entitlement/Pro gate here (ADR-049 decision 5):
// study kits are available to all beta users; Sprint 23's future gate is a
// one-line `isPro`/flag check added right after the cost guard, not a refactor.

type GenerateResponse = { kit: StudyKit } | { refused: 'cost' | 'empty' }

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

  const { sessionId } = (body ?? {}) as Record<string, unknown>

  if (typeof sessionId !== 'string' || sessionId.trim().length === 0) {
    return NextResponse.json({ error: 'sessionId must be a non-empty string.' }, { status: 400 })
  }

  // The guarded generate+persist core (shared with the automatic session-end
  // hook). It runs the cost guard BEFORE any Claude call (ADR-041), the
  // RLS-scoped read, generation, and the per-kind persist; it never throws.
  const result = await generateAndPersistStudyKit(auth.supabase, auth.user.id, sessionId)

  if ('error' in result) {
    // A failed read / model / persist — never relay the provider/DB error text.
    return NextResponse.json({ error: result.error }, { status: 502 })
  }

  // { kit } | { refused: 'cost' | 'empty' } — both 200, the discriminated union
  // the extension (Task 5) branches on.
  return NextResponse.json(result as GenerateResponse)
}
