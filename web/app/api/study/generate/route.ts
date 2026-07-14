import { NextResponse } from 'next/server'
import { clientFromBearerOrCookie } from '@/lib/auth/bearer'
import { costGuard } from '@/lib/tier/cost-guard'
import { estimateCost } from '@/lib/tier/cost-model'
import { loadSessionSource } from '@/lib/study/source'
import { generateStudyKit } from '@/lib/study/generate'
import { isEmptyStudyKit, type StudyKit } from '@/lib/study/tool'

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

  // The cost guard, BEFORE the read or the Claude call (ADR-041). Only the
  // hard cap applies -- generating a kit is a paid AI call like any other, so
  // ADR-041's "hard cap refuses new AI turns" covers it; there are no voice
  // legs to soft-degrade here. hardExceeded => refuse gracefully, no Claude
  // call. costGuard fails OPEN (an RPC outage never blocks generation), so a
  // real over-cap is the only thing that reaches this branch.
  const { hardExceeded } = await costGuard(auth.supabase, estimateCost('study_kit'))

  if (hardExceeded) {
    const refusal: GenerateResponse = { refused: 'cost' }
    return NextResponse.json(refusal)
  }

  try {
    // The SAME per-session material the recap shows (Task 3), RLS-scoped.
    // undefined => the session has nothing worth generating from (mirrors
    // buildSessionRecap's "no gradable interactions" convention).
    const source = await loadSessionSource(auth.supabase, auth.user.id, sessionId)

    if (!source) {
      const refusal: GenerateResponse = { refused: 'empty' }
      return NextResponse.json(refusal)
    }

    const kit = await generateStudyKit(source)

    // The deterministic fallback surfaced (ADR-049 decision 2): a model that
    // returned no usable artifacts persists NOTHING -- the extension shows its
    // placeholder + a gentle message, never a broken kit stored to the table.
    if (isEmptyStudyKit(kit)) {
      const refusal: GenerateResponse = { refused: 'empty' }
      return NextResponse.json(refusal)
    }

    // The concepts this kit covers, for every persisted row's `concept_keys`:
    // grounded FIRST in the session's actually-practiced concepts (real, from
    // the recap read), augmented by any concept the model tagged a new problem
    // with (already validated to CONCEPT_KEYS in parseStudyKit). Deduped;
    // null when there is genuinely nothing to record.
    const conceptKeySet = new Set<string>(source.concepts.map((c) => c.conceptKey))
    for (const problem of kit.problems) {
      if (problem.conceptKey) conceptKeySet.add(problem.conceptKey)
    }
    const conceptKeys = conceptKeySet.size > 0 ? [...conceptKeySet] : null

    // One row per artifact KIND (ADR-049 decision 3 / migration 0021), for
    // independent rendering -- only the kinds that actually have content. The
    // problems payload is { statement, solution } to match the migration's
    // documented payload shape; the per-problem conceptKey is grounding for the
    // row-level concept_keys above, not stored per problem.
    const rows: {
      user_id: string
      session_id: string
      kind: 'notes' | 'problems' | 'flashcards'
      payload: unknown
      concept_keys: string[] | null
    }[] = []

    if (kit.notes.length > 0) {
      rows.push({ user_id: auth.user.id, session_id: sessionId, kind: 'notes', payload: kit.notes, concept_keys: conceptKeys })
    }
    if (kit.problems.length > 0) {
      rows.push({
        user_id: auth.user.id,
        session_id: sessionId,
        kind: 'problems',
        payload: kit.problems.map((p) => ({ statement: p.statement, solution: p.solution })),
        concept_keys: conceptKeys,
      })
    }
    if (kit.flashcards.length > 0) {
      rows.push({ user_id: auth.user.id, session_id: sessionId, kind: 'flashcards', payload: kit.flashcards, concept_keys: conceptKeys })
    }

    const { error } = await auth.supabase.from('study_artifact').insert(rows)

    if (error) {
      // Server-side terminal only -- never relay the DB error text to the client.
      console.error('api/study/generate: insert failed', error)
      return NextResponse.json({ error: 'Could not save your study kit right now.' }, { status: 502 })
    }

    const success: GenerateResponse = { kit }
    return NextResponse.json(success)
  } catch (err) {
    // A failed essential read (loadSessionSource throws) or a real model/SDK
    // error (generateStudyKit) -- never relay the provider/DB error text.
    console.error('api/study/generate: generation failed', err)
    return NextResponse.json({ error: 'Could not generate a study kit right now.' }, { status: 502 })
  }
}
