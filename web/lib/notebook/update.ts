import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getConcept } from '@calyxa/curriculum'
import type { RecapMisconception } from '@/lib/learning/recap'
import { costGuard } from '@/lib/tier/cost-guard'
import { estimateCost } from '@/lib/tier/cost-model'
import { loadSessionSource, type SessionSource } from '@/lib/study/source'
import { conceptSlice } from './source'
import { generateConceptNotebook } from './generate'
import { isEmptyNotebook, parseNotebook, type Notebook } from './tool'

// ADR-054: the Personal Notebook persist path — the study-kit
// generate-and-persist analog, but per-CONCEPT and UPSERT (not per-session,
// append-once). Two entry points:
//   - updateConceptNotebook: revise ONE concept's notebook (guard → read
//     existing → generate → upsert). The unit of work + the per-call cost guard.
//   - updateSessionNotebooks: the session-end orchestrator — load the source
//     ONCE, pick the practiced concepts, cap to the most-practiced few, and run
//     updateConceptNotebook for each.
// RLS on `supabase` is the ownership guarantee (reads/writes only the caller's
// rows). Neither throws — a failed guard/read/model/persist is a typed result
// so the best-effort session-end hook can log-and-ignore.

// ADR-054 decision 5b: the notebook update makes one model call PER CONCEPT, so
// the session-end hook caps how many concepts a single session revises — the
// most-practiced few. The rest are logged (never silently dropped — the
// "no silent truncation" rule) and revised the next time they are practiced.
export const MAX_NOTEBOOK_CONCEPTS_PER_SESSION = 3

export type NotebookUpdateResult =
  | { notebook: Notebook }
  | { refused: 'cost' | 'empty' }
  | { error: string }

// The concept's OPEN misconceptions, whenever they were first spotted.
//
// The recap only reports what the CURRENT session added, so without this a
// concept with a long history of tracked misconceptions handed the generator an
// empty list and got back a notebook with no step mistakes flagged — the flags
// being the single most useful thing the document carries. Confirmed against a
// real account: a concept with 7 tracked misconceptions produced 0 flags.
//
// `pending` is included: a slip seen once is still worth writing down as a thing
// to watch, and the notebook's own flag copy distinguishes it. Resolved ones are
// excluded — the student has fixed those, and re-flagging them would misrepresent
// where they stand. Never throws; an empty list simply means no flags.
async function loadTrackedMisconceptions(
  supabase: SupabaseClient,
  userId: string,
  conceptKey: string
): Promise<RecapMisconception[]> {
  const { data, error } = await supabase
    .from('misconceptions')
    .select('concept_key, category, description')
    .eq('user_id', userId)
    .eq('concept_key', conceptKey)
    .in('status', ['pending', 'active'])
    .is('deleted_at', null)
    .order('occurrence_count', { ascending: false })
    .limit(MAX_TRACKED_MISCONCEPTIONS)

  if (error || !data) {
    if (error) console.error('loadTrackedMisconceptions: read failed', error)
    return []
  }

  return (data as { concept_key: string; category: string; description: string | null }[]).map((row) => ({
    conceptKey: row.concept_key,
    title: getConcept(row.concept_key)?.title ?? row.concept_key,
    category: row.category,
    description: row.description ?? '',
  }))
}

// Most-frequent first, capped: a notebook has at most MAX_STEPS steps to hang
// flags on, so listing more categories than that only dilutes the prompt.
const MAX_TRACKED_MISCONCEPTIONS = 8

// Revises one concept's notebook from its existing content + this session's
// slice, and upserts it. The `source` is already loaded (the orchestrator loads
// it once for the whole session); this only slices + costs + generates + writes.
export async function updateConceptNotebook(
  supabase: SupabaseClient,
  userId: string,
  sessionId: string,
  source: SessionSource,
  conceptKey: string
): Promise<NotebookUpdateResult> {
  // Cost guard, BEFORE the read or the model call (ADR-041). costGuard fails
  // OPEN, so only a real over-cap reaches this branch — no model call is made.
  const { hardExceeded } = await costGuard(supabase, estimateCost('notebook'))
  if (hardExceeded) return { refused: 'cost' }

  try {
    // Read the CURRENT notebook first. A read ERROR must NOT proceed: generating
    // from an assumed-empty notebook and upserting would CLOBBER the real one
    // (reset its content + session_count). So a broken read returns { error }
    // and leaves the existing row untouched — the opposite of the study kit,
    // which has no prior row to protect.
    const { data: row, error: readError } = await supabase
      .from('concept_notebook')
      .select('content, session_count')
      .eq('user_id', userId)
      .eq('concept_key', conceptKey)
      .maybeSingle()

    if (readError) {
      console.error('updateConceptNotebook: read failed', readError)
      return { error: 'Could not read the current notebook right now.' }
    }

    // parseNotebook coerces the stored jsonb defensively (a malformed row → an
    // empty notebook the model then rebuilds), never throwing on bad data.
    const existing = parseNotebook((row as { content?: unknown } | null)?.content ?? null)
    const priorCount = (row as { session_count?: number } | null)?.session_count ?? 0

    const slice = conceptSlice(source, conceptKey, await loadTrackedMisconceptions(supabase, userId, conceptKey))
    const notebook = await generateConceptNotebook(existing, slice)

    // Deterministic empty fallback (ADR-054): persist NOTHING. On a FIRST
    // session this leaves no row; on a LATER session it leaves the existing
    // notebook untouched rather than overwriting it with an empty one.
    if (isEmptyNotebook(notebook)) return { refused: 'empty' }

    // Upsert on the (user_id, concept_key) unique key — the revise-in-place
    // mechanic. created_at is omitted so it survives updates (default on insert
    // only); updated_at is the DB trigger's job; session_count increments off
    // the value we just read.
    const { error: writeError } = await supabase.from('concept_notebook').upsert(
      {
        user_id: userId,
        concept_key: conceptKey,
        content: notebook,
        source_session_id: sessionId,
        session_count: priorCount + 1,
      },
      { onConflict: 'user_id,concept_key' }
    )

    if (writeError) {
      console.error('updateConceptNotebook: upsert failed', writeError)
      return { error: 'Could not save the notebook right now.' }
    }

    return { notebook }
  } catch (err) {
    console.error('updateConceptNotebook: generation failed', err)
    return { error: 'Could not update the notebook right now.' }
  }
}

export type SessionNotebooksResult = {
  updated: string[]
  skipped: string[]
  // Concepts practiced this session but NOT revised because of the per-session
  // cap — deferred to the next time they are practiced (logged, not dropped).
  deferred: string[]
}

// The session-end orchestrator (the seat the route calls, mirroring
// generateAndPersistStudyKit). Loads the session source ONCE, orders the
// practiced concepts by how much they were worked this session, revises the top
// MAX_NOTEBOOK_CONCEPTS_PER_SESSION, and reports the rest as deferred. Never
// throws — the route wraps it best-effort, but a bad source/concept collapses
// to an empty result here rather than an exception. The kill switch
// (CALYXA_DISABLE_NOTEBOOK) is the ROUTE's guard, not this function's, matching
// the study-kit split.
export async function updateSessionNotebooks(
  supabase: SupabaseClient,
  userId: string,
  sessionId: string
): Promise<SessionNotebooksResult> {
  const empty: SessionNotebooksResult = { updated: [], skipped: [], deferred: [] }

  let source: SessionSource | undefined
  try {
    source = await loadSessionSource(supabase, userId, sessionId)
  } catch (err) {
    console.error('updateSessionNotebooks: source load failed', err)
    return empty
  }
  if (!source) return empty

  // Practiced concepts, most-worked first (turns desc), so the cap keeps the
  // concepts this session actually centered on. Only concepts the recap
  // surfaced (a gradable turn) are candidates — `source.concepts` already is
  // exactly that set.
  const ranked = [...source.concepts].sort((a, b) => b.turns - a.turns).map((c) => c.conceptKey)
  const chosen = ranked.slice(0, MAX_NOTEBOOK_CONCEPTS_PER_SESSION)
  const deferred = ranked.slice(MAX_NOTEBOOK_CONCEPTS_PER_SESSION)

  if (deferred.length > 0) {
    console.info(
      `updateSessionNotebooks: session ${sessionId} practiced ${ranked.length} concepts; ` +
        `revising ${chosen.length} (cap ${MAX_NOTEBOOK_CONCEPTS_PER_SESSION}), deferring ${deferred.length}: ${deferred.join(', ')}`
    )
  }

  const result: SessionNotebooksResult = { updated: [], skipped: [], deferred }

  // Sequential, not parallel: the per-call cost guard reads the shared daily
  // ledger, and one over-cap concept should short-circuit the rest of this
  // session rather than racing N calls past the cap at once.
  for (const conceptKey of chosen) {
    const outcome = await updateConceptNotebook(supabase, userId, sessionId, source, conceptKey)
    if ('notebook' in outcome) {
      result.updated.push(conceptKey)
    } else if ('refused' in outcome && outcome.refused === 'cost') {
      // Hard cap hit — no point trying the remaining concepts this session.
      result.deferred.push(...chosen.slice(chosen.indexOf(conceptKey)).filter((k) => k !== conceptKey))
      break
    } else {
      result.skipped.push(conceptKey)
    }
  }

  return result
}
