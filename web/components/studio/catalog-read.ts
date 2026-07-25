import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { loadDashboard, type DashboardData } from '@/lib/learning/dashboard-read'
import { strandStyle } from '@/components/dashboard/premium/theme'
import { misconceptionState } from './misconception'

// The "Everything tutored" browser's read — the subject → concept catalog the
// studio dashboard indexes into. It reuses `loadDashboard` (RLS-scoped,
// decay-adjusted, per-request-fresh, ADR-047) for mastery/misconceptions/due
// dates and adds only what that loader doesn't carry: per-concept counts of
// generated practice problems and flashcards, whether a notebook exists, and how
// many distinct sessions touched the concept.
//
// Never throws — every supplementary read degrades to "no counts" rather than
// failing the dashboard, exactly as `loadStudyKits` does.

/** A concept's one-glance status, driving the row's dot colour. */
export type ConceptStatus = 'gap' | 'due' | 'solid'

export type StudioConcept = {
  conceptKey: string
  title: string
  /** Decay-adjusted mastery in [0,1], or null when unpracticed. */
  mastery: number | null
  /** Distinct sessions that touched this concept. */
  sessions: number
  lastPracticedAt: string | null
  /** Generated practice problems available for the quiz runner. */
  quizCount: number
  /** Generated flashcards available for the flashcards viewer. */
  cardCount: number
  /** CONFIRMED misconceptions still going wrong — what "to fix" counts. */
  misconceptionCount: number
  /** Slips seen once, being watched. Deliberately NOT folded into
   *  `misconceptionCount`: a one-off is not yet a gap, and inflating the gap
   *  number with maybes would make the dashboard's headline count untrustworthy. */
  watchingCount: number
  /** True when a Personal Notebook has been written for this concept. */
  hasNotes: boolean
  status: ConceptStatus
  dueAt: string | null
}

export type StudioSubject = {
  key: string
  label: string
  /** The 2-character initials tile, e.g. "A1". */
  short: string
  color: string
  concepts: StudioConcept[]
  /** Mean decay-adjusted mastery across this subject's practiced concepts. */
  averageMastery: number
  /** Summed confirmed misconceptions — the "N to fix" badge. */
  misconceptionCount: number
  /** Summed slips being watched — shown only when there is nothing to fix. */
  watchingCount: number
  lastPracticedAt: string | null
}

type ArtifactRow = { kind: string; payload: unknown; concept_keys: string[] | null }

function arrayLength(payload: unknown): number {
  return Array.isArray(payload) ? payload.length : 0
}

/** Per-concept counts of generated problems/flashcards. A concept can be covered
 *  by several kits over time; the counts sum across all of them, which is what
 *  the quiz and flashcard runners actually have available. */
async function loadArtifactCounts(
  supabase: SupabaseClient
): Promise<Map<string, { quiz: number; cards: number }>> {
  const counts = new Map<string, { quiz: number; cards: number }>()
  const { data, error } = await supabase.from('study_artifact').select('kind, payload, concept_keys')
  if (error || !data) return counts

  for (const row of data as ArtifactRow[]) {
    if (row.kind !== 'problems' && row.kind !== 'flashcards') continue
    const n = arrayLength(row.payload)
    if (n === 0) continue
    for (const key of row.concept_keys ?? []) {
      const entry = counts.get(key) ?? { quiz: 0, cards: 0 }
      if (row.kind === 'problems') entry.quiz += n
      else entry.cards += n
      counts.set(key, entry)
    }
  }
  return counts
}

/** The concepts that have a Personal Notebook written for them. */
async function loadNotebookKeys(supabase: SupabaseClient): Promise<Set<string>> {
  const { data, error } = await supabase.from('concept_notebook').select('concept_key')
  if (error || !data) return new Set()
  return new Set((data as { concept_key: string }[]).map((r) => r.concept_key))
}

// How many interaction rows to scan for the per-concept session counts. A
// bounded read — the dashboard shows "N sessions" as a recency signal, not an
// audited lifetime total, and an unbounded scan on a long-lived account would
// cost more than the number is worth.
const INTERACTION_SCAN_LIMIT = 4000

/** Distinct sessions per concept, from the interaction log. */
async function loadSessionCounts(supabase: SupabaseClient): Promise<Map<string, number>> {
  const counts = new Map<string, number>()
  const { data, error } = await supabase
    .from('session_interactions')
    .select('concept_key, session_id')
    .is('deleted_at', null)
    .not('concept_key', 'is', null)
    .order('created_at', { ascending: false })
    .limit(INTERACTION_SCAN_LIMIT)

  if (error || !data) return counts

  const seen = new Map<string, Set<string>>()
  for (const row of data as { concept_key: string | null; session_id: string | null }[]) {
    if (!row.concept_key || !row.session_id) continue
    const set = seen.get(row.concept_key) ?? new Set<string>()
    set.add(row.session_id)
    seen.set(row.concept_key, set)
  }
  for (const [key, set] of seen) counts.set(key, set.size)
  return counts
}

function statusOf(misconceptions: number, dueAt: string | null, now: Date): ConceptStatus {
  if (misconceptions > 0) return 'gap'
  if (dueAt && new Date(dueAt).getTime() <= now.getTime()) return 'due'
  return 'solid'
}

/** Builds the catalog from an already-loaded dashboard read, so a caller that
 *  needs both (the dashboard page does) pays for `loadDashboard` once. */
export async function buildStudioCatalog(
  supabase: SupabaseClient,
  data: DashboardData,
  now: Date
): Promise<StudioSubject[]> {
  const [artifactCounts, notebookKeys, sessionCounts] = await Promise.all([
    loadArtifactCounts(supabase),
    loadNotebookKeys(supabase),
    loadSessionCounts(supabase),
  ])

  // Per concept: confirmed-and-still-wrong ("to fix") kept separate from
  // seen-once ("watching"). An 'improving' one is confirmed but trending right,
  // so it is not counted as a gap either.
  const openByConcept = new Map<string, number>()
  const watchingByConcept = new Map<string, number>()
  for (const m of data.misconceptions) {
    const state = misconceptionState(m)
    if (state === 'active') {
      openByConcept.set(m.conceptKey, (openByConcept.get(m.conceptKey) ?? 0) + 1)
    } else if (state === 'watching') {
      watchingByConcept.set(m.conceptKey, (watchingByConcept.get(m.conceptKey) ?? 0) + 1)
    }
  }

  const dueByConcept = new Map<string, string>()
  for (const d of data.dueQueue) dueByConcept.set(d.conceptKey, d.dueAt)

  return data.strands
    .filter((strand) => strand.nodes.length > 0)
    .map((strand) => {
      const style = strandStyle(strand.strand)
      const concepts: StudioConcept[] = strand.nodes.map((node) => {
        const misconceptionCount = openByConcept.get(node.conceptKey) ?? 0
        const watchingCount = watchingByConcept.get(node.conceptKey) ?? 0
        const dueAt = dueByConcept.get(node.conceptKey) ?? null
        const counts = artifactCounts.get(node.conceptKey)
        return {
          conceptKey: node.conceptKey,
          title: node.title,
          mastery: node.mastery,
          sessions: sessionCounts.get(node.conceptKey) ?? 0,
          lastPracticedAt: node.lastPracticedAt,
          quizCount: counts?.quiz ?? 0,
          cardCount: counts?.cards ?? 0,
          misconceptionCount,
          watchingCount,
          hasNotes: notebookKeys.has(node.conceptKey),
          status: statusOf(misconceptionCount, dueAt, now),
          dueAt,
        }
      })

      const practiced = concepts.filter((c) => c.lastPracticedAt !== null)
      const lastPracticedAt = practiced.reduce<string | null>((latest, c) => {
        if (!c.lastPracticedAt) return latest
        return !latest || c.lastPracticedAt > latest ? c.lastPracticedAt : latest
      }, null)

      return {
        key: strand.strand,
        label: strand.strandLabel,
        short: style.short,
        color: style.color,
        concepts,
        averageMastery: strand.averageMastery,
        misconceptionCount: concepts.reduce((n, c) => n + c.misconceptionCount, 0),
        watchingCount: concepts.reduce((n, c) => n + c.watchingCount, 0),
        lastPracticedAt,
      }
    })
}

export async function loadStudioCatalog(supabase: SupabaseClient, now: Date): Promise<StudioSubject[]> {
  return buildStudioCatalog(supabase, await loadDashboard(supabase), now)
}

/** The concept a bare `/notes`, `/quiz` or `/flashcards` should open: the most
 *  recently practiced one, else the weakest, else null (nothing tutored yet). */
export function defaultConceptKey(subjects: StudioSubject[]): string | null {
  const all = subjects.flatMap((s) => s.concepts)
  if (all.length === 0) return null
  const practiced = all.filter((c) => c.lastPracticedAt !== null)
  if (practiced.length > 0) {
    return practiced.reduce((a, b) => ((a.lastPracticedAt ?? '') >= (b.lastPracticedAt ?? '') ? a : b)).conceptKey
  }
  return all.reduce((a, b) => ((a.mastery ?? 1) <= (b.mastery ?? 1) ? a : b)).conceptKey
}
