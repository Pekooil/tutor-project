import { NextResponse } from 'next/server'
import type { Outcome } from '@calyxa/learning-model'
import { clientFromBearerOrCookie } from '@/lib/auth/bearer'
import { applyReviewObservation } from '@/lib/learning/apply'
import { scheduleReinforcement } from '@/lib/learning/scheduler'

// POST { conceptKey, correct, total } — record the completion of a guided
// concept review (the product vision's "after completion → update mastery +
// recalculate next review date").
//
// When the review had self-graded questions (total > 0), the aggregate outcome
// is applied to the learning model through the SAME FSRS write a tutoring turn
// uses (applyReviewObservation → applyMasteryUpdate + scheduleReinforcement): a
// clean pass raises mastery and pushes the next review out, a full miss lowers
// it and pulls it in, a mix is a 'partial'. A notes-only refresh (total === 0)
// is not a graded attempt, so it only reschedules the concept off its current
// node — no mastery change.
//
// See applyReviewObservation for the modelling notes (self-grade → derived
// reasoningQuality; no misconception-streak or session_interactions write). RLS
// is the ownership guarantee — every read/write is the caller's own rows.
//
// Responses: 200 { masteryUpdated, rescheduled } · 400 invalid body · 401 not
// signed in.
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

  const { conceptKey, correct, total } = (body ?? {}) as Record<string, unknown>
  if (typeof conceptKey !== 'string' || conceptKey.trim().length === 0) {
    return NextResponse.json({ error: 'conceptKey must be a non-empty string.' }, { status: 400 })
  }
  if (typeof total !== 'number' || !Number.isInteger(total) || total < 0) {
    return NextResponse.json({ error: 'total must be a non-negative integer.' }, { status: 400 })
  }
  const correctCount = typeof correct === 'number' && Number.isInteger(correct) ? Math.max(0, Math.min(correct, total)) : 0

  // Graded review → apply the aggregate outcome through the FSRS path.
  if (total > 0) {
    const outcome: Outcome = correctCount === total ? 'correct' : correctCount === 0 ? 'incorrect' : 'partial'
    await applyReviewObservation(auth.supabase, auth.user.id, conceptKey, outcome)
    return NextResponse.json({ masteryUpdated: true, rescheduled: true })
  }

  // Notes-only refresh → reschedule off the current node without moving mastery.
  const { data: node, error: nodeError } = await auth.supabase
    .from('knowledge_nodes')
    .select('stability, state')
    .eq('user_id', auth.user.id)
    .eq('concept_key', conceptKey)
    .is('deleted_at', null)
    .maybeSingle()

  if (nodeError || !node) {
    return NextResponse.json({ masteryUpdated: false, rescheduled: false })
  }

  const { count } = await auth.supabase
    .from('misconceptions')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', auth.user.id)
    .eq('concept_key', conceptKey)
    .eq('status', 'active')
    .is('deleted_at', null)

  await scheduleReinforcement(
    auth.supabase,
    auth.user.id,
    conceptKey,
    { stability: (node as { stability: number }).stability, state: (node as { state: string }).state },
    { hasActiveMisconception: (count ?? 0) > 0, lastOutcomeFailed: false }
  )

  return NextResponse.json({ masteryUpdated: false, rescheduled: true })
}
