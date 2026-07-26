import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getConcept } from '@calyxa/curriculum'
import { courseLabel, homeCourseOf } from '@/lib/curriculum/courses'

// Single-kit read for the viewer route (`/kits/[key]`). RLS-scoped, never
// throws. A "kit" is the ≤3 `study_artifact` rows (one per kind) sharing a
// session; `key` is the session id, or the artifact id for a session-less kit
// (session deleted → session_id set null). Payload shapes are the persisted
// forms from `study/tool.ts` / the generate route:
//   notes      → string[]
//   problems   → { statement, solution }[]  (no per-item conceptKey when stored)
//   flashcards → { front, back }[]

export type KitProblem = { statement: string; solution: string }
export type KitFlashcard = { front: string; back: string }

export type StudyKitDetail = {
  title: string
  meta: string
  notes: string[]
  problems: KitProblem[]
  flashcards: KitFlashcard[]
  empty: boolean
}

type Row = { kind: string; payload: unknown; concept_keys: string[] | null; session_id: string | null; created_at: string }

function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' })
}

function asNotes(payload: unknown): string[] {
  return Array.isArray(payload) ? payload.filter((n): n is string => typeof n === 'string') : []
}
function asProblems(payload: unknown): KitProblem[] {
  if (!Array.isArray(payload)) return []
  return payload
    .filter((p): p is KitProblem => !!p && typeof p === 'object' && 'statement' in p && 'solution' in p)
    .map((p) => ({ statement: String(p.statement), solution: String(p.solution) }))
}
function asFlashcards(payload: unknown): KitFlashcard[] {
  if (!Array.isArray(payload)) return []
  return payload
    .filter((c): c is KitFlashcard => !!c && typeof c === 'object' && 'front' in c && 'back' in c)
    .map((c) => ({ front: String(c.front), back: String(c.back) }))
}

export async function loadStudyKit(supabase: SupabaseClient, key: string): Promise<StudyKitDetail | null> {
  try {
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return null

    // Try session-scoped first, then fall back to a session-less artifact id.
    let rows: Row[] = []
    const bySession = await supabase
      .from('study_artifact')
      .select('kind, payload, concept_keys, session_id, created_at')
      .eq('user_id', user.id)
      .eq('session_id', key)
    if (!bySession.error && bySession.data && bySession.data.length > 0) {
      rows = bySession.data as Row[]
    } else {
      const byId = await supabase
        .from('study_artifact')
        .select('kind, payload, concept_keys, session_id, created_at')
        .eq('user_id', user.id)
        .eq('id', key)
      if (!byId.error && byId.data) rows = byId.data as Row[]
    }

    if (rows.length === 0) return null

    const notes = asNotes(rows.find((r) => r.kind === 'notes')?.payload)
    const problems = asProblems(rows.find((r) => r.kind === 'problems')?.payload)
    const flashcards = asFlashcards(rows.find((r) => r.kind === 'flashcards')?.payload)

    const conceptKey = rows.map((r) => r.concept_keys?.[0]).find(Boolean)
    const concept = conceptKey ? getConcept(conceptKey) : null
    const courseKey = conceptKey ? homeCourseOf(conceptKey) : null
    const strandLabel = courseKey ? courseLabel(courseKey) : (concept?.strandLabel ?? 'Study session')
    const newest = rows.reduce((a, b) => (a.created_at > b.created_at ? a : b))

    return {
      title: concept?.title ?? 'Study kit',
      meta: `From your ${shortDate(newest.created_at)} session · ${strandLabel}`,
      notes,
      problems,
      flashcards,
      empty: notes.length === 0 && problems.length === 0 && flashcards.length === 0,
    }
  } catch {
    return null
  }
}
