import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { costGuard } from '@/lib/tier/cost-guard'
import { estimateCost } from '@/lib/tier/cost-model'
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

export async function generateAndPersistStudyKit(
  supabase: SupabaseClient,
  userId: string,
  sessionId: string
): Promise<GenerateResult> {
  // Cost guard, BEFORE the read or the Claude call (ADR-041). costGuard fails
  // OPEN, so only a real over-cap reaches this branch — no Claude call is made.
  const { hardExceeded } = await costGuard(supabase, estimateCost('study_kit'))
  if (hardExceeded) return { refused: 'cost' }

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
