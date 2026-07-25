import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { loadConceptDetail, type ConceptNotebookView } from '@/components/dashboard/premium/detail-read'
import type { KitFlashcard, KitProblem } from '@/components/dashboard/premium/kit-read'
import type { WorkedSnapshot } from '@/components/dashboard/premium/snapshots-read'
import type { DashboardMisconception } from '@/lib/learning/dashboard-read'
import { byUrgency } from './misconception'

// The Notes view's read. It is `loadConceptDetail` (already RLS-scoped and
// per-request-fresh — notebook + misconceptions + study kit + schedule in one
// place) plus the one thing that loader doesn't carry: which session last
// touched this concept, for the notebook's "Jul 22 tutoring session (24 min)"
// reference and the "Your attempt · Jul 22 session" flag labels.
//
// Never throws: an unknown concept returns null so the route can `notFound()`,
// and the session lookup degrades to null rather than failing the page.

export type StudioSessionRef = {
  id: string
  startedAt: string
  /** Wall-clock minutes, or null when the session has no end timestamp yet. */
  minutes: number | null
}

export type StudioNotes = {
  conceptKey: string
  title: string
  subjectLabel: string
  subjectColor: string
  notebook: ConceptNotebookView | null
  misconceptions: DashboardMisconception[]
  /** Open misconceptions keyed by category — the notebook's step and heading
   *  flags join through this to the live count and last-seen date. */
  misconceptionByCategory: Record<string, DashboardMisconception>
  /** Tutor-annotated turns on this concept (ADR-055), newest first. These are the
   *  REAL marks the extension drew on the student's work — the notes view renders
   *  them as its annotation section, so the annotations exist even when the
   *  notebook itself recorded no step-level mistake. */
  snapshots: WorkedSnapshot[]
  notes: string[]
  problems: KitProblem[]
  flashcards: KitFlashcard[]
  /** `/kits/[key]` for the generated study kit, or null when none covers this. */
  kitHref: string | null
  lastSession: StudioSessionRef | null
}

const MS_PER_MINUTE = 60_000

async function loadLastSessionForConcept(
  supabase: SupabaseClient,
  conceptKey: string
): Promise<StudioSessionRef | null> {
  const { data: interaction, error } = await supabase
    .from('session_interactions')
    .select('session_id')
    .eq('concept_key', conceptKey)
    .is('deleted_at', null)
    .not('session_id', 'is', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  const sessionId = (interaction as { session_id?: string | null } | null)?.session_id
  if (error || !sessionId) return null

  const { data: session } = await supabase
    .from('sessions')
    .select('id, started_at, ended_at')
    .eq('id', sessionId)
    .maybeSingle()

  if (!session) return null
  const row = session as { id: string; started_at: string; ended_at: string | null }
  const started = new Date(row.started_at).getTime()
  const ended = row.ended_at ? new Date(row.ended_at).getTime() : null
  const minutes =
    ended !== null && !Number.isNaN(started) && !Number.isNaN(ended)
      ? Math.max(1, Math.round((ended - started) / MS_PER_MINUTE))
      : null

  return { id: row.id, startedAt: row.started_at, minutes }
}

export async function loadStudioNotes(
  supabase: SupabaseClient,
  conceptKey: string
): Promise<StudioNotes | null> {
  const [detail, lastSession] = await Promise.all([
    loadConceptDetail(supabase, conceptKey),
    loadLastSessionForConcept(supabase, conceptKey),
  ])
  if (!detail) return null

  // Every state drives a flag — the pill differs per state (confirmed gap /
  // watching / improving / resolved), so all three are indexed. When a category
  // somehow has more than one row, the most urgent wins, so a concept with both a
  // confirmed and a resolved row flags as the confirmed one.
  const misconceptionByCategory: Record<string, DashboardMisconception> = {}
  for (const m of detail.misconceptions) {
    const existing = misconceptionByCategory[m.category]
    if (!existing || byUrgency(m, existing) < 0) {
      misconceptionByCategory[m.category] = m
    }
  }

  return {
    conceptKey: detail.conceptKey,
    title: detail.title,
    subjectLabel: detail.strandLabel,
    subjectColor: detail.strandColor,
    notebook: detail.notebook,
    misconceptions: detail.misconceptions,
    misconceptionByCategory,
    // Only turns that actually carry marks — a turn with an empty annotation
    // array has nothing to show and would render an empty card.
    snapshots: detail.snapshots.filter((s) => s.annotations.length > 0),
    notes: detail.kit?.notes ?? [],
    problems: detail.kit?.problems ?? [],
    flashcards: detail.kit?.flashcards ?? [],
    kitHref: detail.kitHref,
    lastSession,
  }
}
