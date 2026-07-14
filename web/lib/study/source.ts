import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { buildSessionRecap, type RecapConcept, type RecapMisconception } from '@/lib/learning/recap'

// Sprint 21 / Task 3 (ADR-049): the shared read the study-kit generator
// prompts from. This is deliberately NOT a second implementation of the
// recap's concept/misconception aggregation -- it CALLS buildSessionRecap
// and passes its `concepts` / `misconceptionsAdded` / `misconceptionsResolved`
// straight through, so a kit can never disagree with what the recap already
// told the student about this session (the same anti-divergence reasoning
// recap.ts itself gives for reusing loadProfile's retrievability()).
// `nextReviews` / `trends` are deliberately NOT carried over -- those are the
// FSRS scheduler's forward look, and ADR-049 explicitly forecloses wiring
// generated flashcards into spaced-repetition scheduling this sprint; a
// generator prompt has no legitimate use for them, so they are left out of
// this type rather than carried "just in case."
//
// The one thing recap.ts's own read does NOT fetch is the actual per-turn
// TRANSCRIPT (`student_transcript` / `tutor_response`) -- its
// `session_interactions` query selects only `concept_key, outcome` because
// the recap's job is stats (turns/correct/incorrect per concept), not
// narrative. A study kit needs the narrative: the actual worked problem
// text is what lets the generator write real notes and grounded new
// practice problems, not just "you got 2/3 correct on factoring." So this
// file adds its own second read of `session_interactions` for the transcript
// -- a genuinely new read of data recap never touches, not a divergent
// second read of data recap already computes.
//
// That transcript read also deliberately does NOT apply recap's
// `.not('concept_key', 'is', null).neq('outcome', 'none')` filters: recap
// excludes ungraded turns (e.g. the opening scan, ADR-030) because they
// don't count toward stats, but the opening scan is often exactly where the
// problem statement first appears on the wire -- dropping it would give the
// generator a narrative with a hole at the start. Every turn in the session
// is included, in order.

export type SessionSourceTurn = {
  turnIndex: number
  conceptKey: string | null
  studentTranscript: string | null
  tutorResponse: string | null
  outcome: string
}

export type SessionSource = {
  turns: SessionSourceTurn[]
  concepts: RecapConcept[]
  misconceptionsAdded: RecapMisconception[]
  misconceptionsResolved: RecapMisconception[]
}

type TranscriptRow = {
  turn_index: number
  concept_key: string | null
  student_transcript: string | null
  tutor_response: string | null
  outcome: string
}

// Loads the per-session material a study-kit generation prompt needs:
// the ordered transcript, the concepts practiced (with recap's decay-adjusted
// mastery/state), and the misconceptions touched. RLS-scoped through the
// caller's own `supabase` client -- the same posture as every other read in
// this codebase (RLS is the isolation guarantee, not a `where` clause).
//
// Returns `undefined` for a session with nothing worth generating from --
// mirroring `buildSessionRecap`'s own "no gradable interactions" convention,
// since a session the recap has nothing to report on has no worked material
// for a study kit either. Throws on a failed essential read (both legs),
// the same fail-loud-not-partially-honest posture `buildSessionRecap`
// documents for itself -- the CALLER (the generation route, Task 4) is
// expected to catch and refuse, not receive a silently incomplete source.
export async function loadSessionSource(
  supabase: SupabaseClient,
  userId: string,
  sessionId: string
): Promise<SessionSource | undefined> {
  const [recap, transcriptResult] = await Promise.all([
    buildSessionRecap(supabase, userId, sessionId),
    supabase
      .from('session_interactions')
      .select('turn_index, concept_key, student_transcript, tutor_response, outcome')
      .eq('session_id', sessionId)
      .eq('user_id', userId)
      .is('deleted_at', null)
      .order('turn_index', { ascending: true }),
  ])

  if (transcriptResult.error) {
    throw new Error(`loadSessionSource transcript read failed: ${transcriptResult.error.message}`)
  }

  if (!recap) return undefined

  const turns: SessionSourceTurn[] = ((transcriptResult.data ?? []) as TranscriptRow[]).map((row) => ({
    turnIndex: row.turn_index,
    conceptKey: row.concept_key,
    studentTranscript: row.student_transcript,
    tutorResponse: row.tutor_response,
    outcome: row.outcome,
  }))

  return {
    turns,
    concepts: recap.concepts,
    misconceptionsAdded: recap.misconceptionsAdded,
    misconceptionsResolved: recap.misconceptionsResolved,
  }
}
