import 'server-only'
import { getConcept } from '@calyxa/curriculum'
import type { SessionSource } from '@/lib/study/source'
import type { RecapConcept, RecapMisconception } from '@/lib/learning/recap'

// ADR-054: the per-concept slice of a session the notebook generator prompts
// from. This is deliberately NOT a new read — it FILTERS the already-loaded
// `SessionSource` (web/lib/study/source.ts, which itself reuses
// buildSessionRecap) down to one concept. The session-end hook loads the source
// ONCE and slices it per concept, so a session touching N concepts still does a
// single transcript read, and the notebook can never disagree with what the
// recap and the study kit — built from the same source — already told the
// student.
//
// A concept slice carries only that concept's turns (turns already tag their
// `conceptKey`), the concept's recap stats, and the misconceptions on it. Turns
// tagged with a different concept — or the ungraded opening-scan turn (null
// concept, ADR-030) — are left out: a per-concept notebook wants this concept's
// worked material, not the whole session's narrative (that is the study kit's
// job).

export type ConceptSlice = {
  conceptKey: string
  title: string
  // This concept's turns from the session, in order (student + tutor text +
  // outcome) — the narrative the summary/explanations are grounded in.
  turns: SessionSource['turns']
  // The concept's recap stats (turns/correct/incorrect), or undefined if the
  // recap did not surface it (e.g. only ungraded turns touched it).
  concept: RecapConcept | undefined
  // Misconceptions on THIS concept spotted / resolved this session — the source
  // of the notebook's "things you keep forgetting" reminders.
  misconceptionsAdded: RecapMisconception[]
  misconceptionsResolved: RecapMisconception[]
  // Every misconception CURRENTLY OPEN on this concept, regardless of which
  // session first spotted it.
  //
  // Why this is separate from `misconceptionsAdded`: that list is only what THIS
  // session added, so a concept carrying long-standing misconceptions showed the
  // generator none of them and the notebook came back with no step mistakes
  // attached at all — the flags are the most valuable thing in the document, and
  // they were silently absent for exactly the students who needed them most.
  // Filled by the caller (which has the RLS-scoped client); empty when unknown.
  misconceptionsTracked: RecapMisconception[]
}

// The concept keys worth building a notebook for from this session: the recap's
// practiced concepts (a concept with a gradable turn), newest signal first is
// not needed here — the hook orders/caps. Returned as the recap's `concepts`
// keys so "practiced this session" is exactly the recap's own definition, kept
// in one place.
export function practicedConceptKeys(source: SessionSource): string[] {
  return source.concepts.map((c) => c.conceptKey)
}

// Filters a whole-session `SessionSource` to one concept. Pure — no I/O, no
// throw. `title` resolves through the curriculum with the raw-key fallback the
// recap/kit paths use, so a stale key never breaks prompt assembly.
export function conceptSlice(
  source: SessionSource,
  conceptKey: string,
  /** The concept's currently-open misconceptions, from the caller's read. */
  tracked: RecapMisconception[] = []
): ConceptSlice {
  const added = source.misconceptionsAdded.filter((m) => m.conceptKey === conceptKey)
  // Anything this session just added is already listed as "new"; keep the tracked
  // list to the older ones so the prompt doesn't show the same category twice.
  const addedCategories = new Set(added.map((m) => m.category))

  return {
    conceptKey,
    title: getConcept(conceptKey)?.title ?? conceptKey,
    turns: source.turns.filter((t) => t.conceptKey === conceptKey),
    concept: source.concepts.find((c) => c.conceptKey === conceptKey),
    misconceptionsAdded: added,
    misconceptionsResolved: source.misconceptionsResolved.filter((m) => m.conceptKey === conceptKey),
    misconceptionsTracked: tracked.filter(
      (m) => m.conceptKey === conceptKey && !addedCategories.has(m.category)
    ),
  }
}
