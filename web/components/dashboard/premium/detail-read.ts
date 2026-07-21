import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { CONCEPTS, getConcept, prerequisitesOf } from '@calyxa/curriculum'
import {
  loadDashboard,
  type DashboardMasteryNode,
  type DashboardMisconception,
  type DashboardDueItem,
} from '@/lib/learning/dashboard-read'
import { loadStudyKits, kitHrefForConcept } from './kits-read'
import { loadStudyKit, type StudyKitDetail } from './kit-read'
import { parseNotebook, isEmptyNotebook, type Notebook } from '@/lib/notebook/tool'
import { loadConceptSnapshots, type WorkedSnapshot } from './snapshots-read'
import { strandStyle } from './theme'

// Server reads for the drill-down detail pages. Both reuse `loadDashboard`
// (RLS-scoped, decay-adjusted, per-request-fresh) + `loadStudyKits` for the
// concept→kit glue, plus the static curriculum graph for prerequisites /
// dependents. Never throw — a missing concept/misconception returns null so the
// page can `notFound()`.

export type RelatedConcept = { conceptKey: string; title: string; mastery: number | null; state: string | null }

/** The concept's Personal Notebook (ADR-054) for the workspace, or null when no
 *  notebook exists yet. A plain display shape (not the server-only `Notebook`
 *  type) so the client-boundary screen imports only data. */
export type ConceptNotebookView = {
  summary: string
  mustKnow: Notebook['mustKnow']
  method: Notebook['method']
  /** How many sessions have fed this notebook — the "updated after N sessions"
   *  line in the workspace. */
  sessionCount: number
  updatedAt: string | null
}

// Reads the caller's Personal Notebook for one concept, RLS-scoped (the
// `concept_notebook_select_own` policy is the ownership guarantee, and
// unique(user_id, concept_key) makes this at most one row). Never throws — a
// read hiccup or a genuinely-empty notebook returns null so the workspace just
// omits the card. parseNotebook defensively coerces the stored jsonb.
export async function loadConceptNotebook(
  supabase: SupabaseClient,
  conceptKey: string
): Promise<ConceptNotebookView | null> {
  const { data, error } = await supabase
    .from('concept_notebook')
    .select('content, session_count, updated_at')
    .eq('concept_key', conceptKey)
    .maybeSingle()

  if (error || !data) return null

  const parsed = parseNotebook((data as { content?: unknown }).content ?? null)
  if (isEmptyNotebook(parsed)) return null

  return {
    summary: parsed.summary,
    mustKnow: parsed.mustKnow,
    method: parsed.method,
    sessionCount: (data as { session_count?: number }).session_count ?? 1,
    updatedAt: (data as { updated_at?: string | null }).updated_at ?? null,
  }
}

export type ConceptDetail = {
  conceptKey: string
  title: string
  strandLabel: string
  strandColor: string
  node: DashboardMasteryNode | null
  prerequisites: RelatedConcept[]
  dependents: RelatedConcept[]
  misconceptions: DashboardMisconception[]
  kitHref: string | null
  /** This concept's reinforcement-schedule entry (next review), or null. */
  review: DashboardDueItem | null
  /** The concept's study-kit content (notes/problems/flashcards) for inline
   *  practice in the workspace, or null when no kit covers it. */
  kit: StudyKitDetail | null
  /** The concept's Personal Notebook (ADR-054), or null when none exists yet. */
  notebook: ConceptNotebookView | null
  /** Worked-problem snapshots for this concept (ADR-055) — annotated turns,
   *  newest first. Empty when no annotated turns exist yet. */
  snapshots: WorkedSnapshot[]
}

function nodeIndex(strands: Awaited<ReturnType<typeof loadDashboard>>['strands']): Map<string, DashboardMasteryNode> {
  const map = new Map<string, DashboardMasteryNode>()
  for (const strand of strands) for (const node of strand.nodes) map.set(node.conceptKey, node)
  return map
}

function related(key: string, byKey: Map<string, DashboardMasteryNode>): RelatedConcept {
  const concept = getConcept(key)
  const node = byKey.get(key)
  return {
    conceptKey: key,
    title: concept?.title ?? key,
    mastery: node ? node.mastery : null,
    state: node ? node.state : null,
  }
}

export async function loadConceptDetail(supabase: SupabaseClient, conceptKey: string): Promise<ConceptDetail | null> {
  const concept = getConcept(conceptKey)
  const [data, kits, notebook, snapshots] = await Promise.all([
    loadDashboard(supabase),
    loadStudyKits(supabase),
    loadConceptNotebook(supabase, conceptKey),
    loadConceptSnapshots(supabase, conceptKey),
  ])
  const byKey = nodeIndex(data.strands)
  const node = byKey.get(conceptKey) ?? null

  // Unknown key with no practiced node and no curriculum entry → not found.
  if (!concept && !node) return null

  const strand = concept?.strand ?? node?.strand ?? ''
  const st = strandStyle(strand)

  const prerequisites = prerequisitesOf(conceptKey).map((k) => related(k, byKey))
  const dependents = CONCEPTS.filter((c) => c.prerequisites.includes(conceptKey)).map((c) => related(c.key, byKey))
  const misconceptions = data.misconceptions.filter((m) => m.conceptKey === conceptKey)
  const review = data.dueQueue.find((d) => d.conceptKey === conceptKey) ?? null
  const kitHref = kitHrefForConcept(kits, conceptKey)
  // Pull the concept's kit content for inline practice (best-effort; a read
  // hiccup just omits the practice sections, never fails the page).
  const kit = kitHref ? await loadStudyKit(supabase, kitHref) : null

  return {
    conceptKey,
    title: concept?.title ?? node?.title ?? conceptKey,
    strandLabel: st.label !== strand ? st.label : (concept?.strandLabel ?? strand),
    strandColor: st.color,
    node,
    prerequisites,
    dependents,
    misconceptions,
    kitHref,
    review,
    kit,
    notebook,
    snapshots,
  }
}

export type MisconceptionDetail = {
  misconception: DashboardMisconception
  strandColor: string
  conceptNode: DashboardMasteryNode | null
  kitHref: string | null
  resolutionStreak: number
}

// Mirrors RESOLUTION_STREAK in lib/learning/apply.ts (3 consecutive correct
// resolves a misconception). Kept here as a plain number so this module stays
// importable without pulling apply.ts's server graph into a page's bundle.
export const RESOLUTION_STREAK = 3

export async function loadMisconceptionDetail(supabase: SupabaseClient, id: string): Promise<MisconceptionDetail | null> {
  const [data, kits] = await Promise.all([loadDashboard(supabase), loadStudyKits(supabase)])
  const misconception = data.misconceptions.find((m) => m.id === id)
  if (!misconception) return null

  const byKey = nodeIndex(data.strands)
  return {
    misconception,
    strandColor: strandStyle(misconception.strand).color,
    conceptNode: byKey.get(misconception.conceptKey) ?? null,
    kitHref: kitHrefForConcept(kits, misconception.conceptKey),
    resolutionStreak: RESOLUTION_STREAK,
  }
}
