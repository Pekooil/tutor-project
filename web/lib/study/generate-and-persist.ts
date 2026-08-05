import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { costGuard } from '@/lib/tier/cost-guard'
import { estimateCost } from '@/lib/tier/cost-model'
import { userOverFreeCap } from '@/lib/tier/session-gate'
import { loadSessionSource } from '@/lib/study/source'
import { generateStudyKit } from '@/lib/study/generate'
import { isEmptyStudyKit, type StudyKit } from '@/lib/study/tool'

// The shared core of study-kit generation (ADR-049), extracted from
// /api/study/generate so BOTH the on-demand route AND the automatic
// session-end hook (misconception → kit workflow) run the exact same guarded
// path: cost guard BEFORE any Claude call → the RLS-scoped session read →
// generate → persist one row per non-empty kind. RLS on `supabase` is the
// ownership guarantee (the read only sees the caller's session; the insert can
// only write their user_id). Never throws — a failed read/model/persist returns
// `{ error }` so callers (a route → 502, the best-effort hook → log-and-ignore)
// decide how loud to be.

export type GenerateResult =
  | { kit: StudyKit }
  | { refused: 'cost' | 'empty' }
  | { error: string }

export type GenerateOptions = {
  // Whether the caller's monthly free-session allowance gates this generation.
  // Defaults to true — every STUDENT-initiated path (the recap card's button
  // and the automatic session-end hook) must respect it. The admin backfill
  // (/api/admin/seed-notebooks) passes false: it is a deliberate,
  // CRON_SECRET-gated operator action against a chosen account, and applying a
  // student quota there would silently skip exactly the over-cap accounts an
  // operator is most likely to be backfilling. That route still runs the
  // global cost guard, which is the fleet-wide spend bound.
  enforceFreeCap?: boolean
}

export async function generateAndPersistStudyKit(
  supabase: SupabaseClient,
  userId: string,
  sessionId: string,
  options: GenerateOptions = {}
): Promise<GenerateResult> {
  const { enforceFreeCap = true } = options
  // Cost guard + the per-user free-session cap, BOTH before the read or the
  // Claude call (ADR-041). Each fails OPEN, so only a real over-cap reaches
  // these branches — no Claude call is made either way.
  //
  // The free-cap check closes a leak: study-kit generation is a paid model
  // call with no per-user gate of its own, reachable BOTH on demand (the recap
  // card's button → /api/study/generate) and automatically from the
  // session-end hook. A free user past their monthly allowance could therefore
  // still bill a generation on every session they ended. Gating the shared
  // core rather than the route covers both call sites at once. Pro and comp
  // accounts are exempt via userOverFreeCap's tier predicate.
  //
  // Reported as `refused: 'cost'` deliberately — callers already branch on it
  // (the route returns it verbatim, the hook logs and ignores), and the
  // student-visible outcome is identical: no kit, nothing persisted.
  const [{ hardExceeded }, overFreeCap] = await Promise.all([
    costGuard(supabase, estimateCost('study_kit')),
    enforceFreeCap ? userOverFreeCap(supabase, userId) : Promise.resolve(false),
  ])
  if (hardExceeded || overFreeCap) return { refused: 'cost' }

  try {
    // The SAME per-session material the recap shows (Task 3), RLS-scoped.
    const source = await loadSessionSource(supabase, userId, sessionId)
    if (!source) return { refused: 'empty' }

    const kit = await generateStudyKit(source)

    // Deterministic empty-kit fallback (ADR-049 decision 2): persist NOTHING.
    if (isEmptyStudyKit(kit)) return { refused: 'empty' }

    // Concepts this kit covers: grounded first in the session's practiced
    // concepts, augmented by any concept the model tagged a new problem with.
    const conceptKeySet = new Set<string>(source.concepts.map((c) => c.conceptKey))
    for (const problem of kit.problems) {
      if (problem.conceptKey) conceptKeySet.add(problem.conceptKey)
    }
    const conceptKeys = conceptKeySet.size > 0 ? [...conceptKeySet] : null

    // One row per artifact KIND (ADR-049 decision 3 / migration 0021).
    const rows: {
      user_id: string
      session_id: string
      kind: 'notes' | 'problems' | 'flashcards'
      payload: unknown
      concept_keys: string[] | null
    }[] = []

    if (kit.notes.length > 0) {
      rows.push({ user_id: userId, session_id: sessionId, kind: 'notes', payload: kit.notes, concept_keys: conceptKeys })
    }
    if (kit.problems.length > 0) {
      rows.push({
        user_id: userId,
        session_id: sessionId,
        kind: 'problems',
        payload: kit.problems.map((p) => ({ statement: p.statement, solution: p.solution })),
        concept_keys: conceptKeys,
      })
    }
    if (kit.flashcards.length > 0) {
      rows.push({ user_id: userId, session_id: sessionId, kind: 'flashcards', payload: kit.flashcards, concept_keys: conceptKeys })
    }

    const { error } = await supabase.from('study_artifact').insert(rows)
    if (error) {
      console.error('generateAndPersistStudyKit: insert failed', error)
      return { error: 'Could not save your study kit right now.' }
    }

    return { kit }
  } catch (err) {
    console.error('generateAndPersistStudyKit: generation failed', err)
    return { error: 'Could not generate a study kit right now.' }
  }
}
