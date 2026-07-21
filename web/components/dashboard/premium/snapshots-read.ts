import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getConcept } from '@calyxa/curriculum'

// ADR-055: server reads for worked-problem snapshots — the persisted tutor
// annotations (migration 0027) replayed as text cards. RLS-scoped through the
// caller's own client. Plain display shapes (not the server-only `Annotation`
// type) so the client-boundary screens import only data. Never throw — a read
// hiccup returns an empty list so the surface just omits the section.

/** One annotated mark on a snapshot: the problem span the tutor pointed at, its
 *  colour, the short label, and the optional why-note. */
export type SnapshotAnnotation = {
  id: string
  type: string
  targetText: string | null
  color: string | null
  label: string | null
  note: string | null
}

/** One worked-problem snapshot — a single tutored turn, replayed. */
export type WorkedSnapshot = {
  id: string
  turnIndex: number
  conceptKey: string | null
  conceptTitle: string | null
  studentTranscript: string | null
  tutorResponse: string | null
  /** The misconception this turn surfaced (description preferred, else the
   *  humanised category), or null. */
  misconception: string | null
  annotations: SnapshotAnnotation[]
  createdAt: string
}

export type SessionDetail = {
  id: string
  startedAt: string
  endedAt: string | null
  mode: string
  pageDomain: string | null
  snapshots: WorkedSnapshot[]
}

type InteractionRow = {
  id: string
  turn_index: number
  concept_key: string | null
  student_transcript: string | null
  tutor_response: string | null
  misconception_category: string | null
  misconception_description: string | null
  annotations: unknown
  created_at: string
}

const INTERACTION_COLUMNS =
  'id, turn_index, concept_key, student_transcript, tutor_response, misconception_category, misconception_description, annotations, created_at'

function humanize(category: string): string {
  return category.replace(/[-_.]/g, ' ').replace(/\s+/g, ' ').trim()
}

function cleanString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

// Defensively coerce the stored `annotations` jsonb (an `Annotation[]` written
// by turn-complete.ts) into display shapes. A malformed element is dropped, not
// thrown on — the same posture parseNotebook/parseStudyKit take on stored jsonb.
function coerceAnnotations(raw: unknown): SnapshotAnnotation[] {
  if (!Array.isArray(raw)) return []
  const out: SnapshotAnnotation[] = []
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) continue
    const a = item as Record<string, unknown>
    const id = cleanString(a.id)
    const type = cleanString(a.type)
    if (!id || !type) continue
    const target = (typeof a.target === 'object' && a.target !== null ? a.target : {}) as Record<string, unknown>
    const style = (typeof a.style === 'object' && a.style !== null ? a.style : {}) as Record<string, unknown>
    out.push({
      id,
      type,
      targetText: cleanString(target.text),
      color: cleanString(style.color),
      label: cleanString(a.label),
      note: cleanString(a.note),
    })
  }
  return out
}

function toSnapshot(row: InteractionRow): WorkedSnapshot {
  return {
    id: row.id,
    turnIndex: row.turn_index,
    conceptKey: row.concept_key,
    conceptTitle: row.concept_key ? (getConcept(row.concept_key)?.title ?? row.concept_key) : null,
    studentTranscript: cleanString(row.student_transcript),
    tutorResponse: cleanString(row.tutor_response),
    misconception: cleanString(row.misconception_description) ?? (row.misconception_category ? humanize(row.misconception_category) : null),
    annotations: coerceAnnotations(row.annotations),
    createdAt: row.created_at,
  }
}

// The annotated turns for ONE concept, newest first, capped — the concept
// workspace's "Worked-problem snapshots" section (brief §2). Only turns that
// actually carry annotations, so the section is present exactly when there is
// something to show.
export async function loadConceptSnapshots(
  supabase: SupabaseClient,
  conceptKey: string,
  limit = 6
): Promise<WorkedSnapshot[]> {
  const { data, error } = await supabase
    .from('session_interactions')
    .select(INTERACTION_COLUMNS)
    .eq('concept_key', conceptKey)
    .not('annotations', 'is', null)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error || !data) return []
  return (data as InteractionRow[]).map(toSnapshot)
}

// Every annotated turn for the caller, grouped by concept (newest first, capped
// per concept) — the notebook's bulk snapshot feed (redesign). One query for the
// whole notebook instead of loadConceptSnapshots per concept, so a subject with
// N practiced concepts still does a single read. RLS-scoped; never throws.
export async function loadUserSnapshotsByConcept(
  supabase: SupabaseClient,
  perConcept = 4,
  scanLimit = 600
): Promise<Map<string, WorkedSnapshot[]>> {
  const byConcept = new Map<string, WorkedSnapshot[]>()
  const { data, error } = await supabase
    .from('session_interactions')
    .select(INTERACTION_COLUMNS)
    .not('annotations', 'is', null)
    .not('concept_key', 'is', null)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(scanLimit)

  if (error || !data) return byConcept

  for (const row of data as InteractionRow[]) {
    const key = row.concept_key
    if (!key) continue
    const list = byConcept.get(key)
    if (list) {
      if (list.length < perConcept) list.push(toSnapshot(row))
    } else {
      byConcept.set(key, [toSnapshot(row)])
    }
  }
  return byConcept
}

// One session's full ordered timeline + meta — the Sessions detail view (brief
// §3). Includes every turn in order (annotations render when present); returns
// null when the session isn't the caller's or doesn't exist, so the page can
// notFound().
export async function loadSessionDetail(supabase: SupabaseClient, sessionId: string): Promise<SessionDetail | null> {
  const { data: session, error: sessionError } = await supabase
    .from('sessions')
    .select('id, started_at, ended_at, mode, page_domain')
    .eq('id', sessionId)
    .is('deleted_at', null)
    .maybeSingle()

  if (sessionError || !session) return null

  const { data: rows } = await supabase
    .from('session_interactions')
    .select(INTERACTION_COLUMNS)
    .eq('session_id', sessionId)
    .is('deleted_at', null)
    .order('turn_index', { ascending: true })

  const s = session as { id: string; started_at: string; ended_at: string | null; mode: string; page_domain: string | null }
  return {
    id: s.id,
    startedAt: s.started_at,
    endedAt: s.ended_at,
    mode: s.mode,
    pageDomain: s.page_domain,
    snapshots: ((rows ?? []) as InteractionRow[]).map(toSnapshot),
  }
}
