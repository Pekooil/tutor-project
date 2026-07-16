import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { CONCEPTS, getConcept, prerequisitesOf } from '@calyxa/curriculum'
import { loadDashboard, type DashboardMasteryNode, type DashboardMisconception } from '@/lib/learning/dashboard-read'
import { loadStudyKits, kitHrefForConcept } from './kits-read'
import { strandStyle } from './theme'

// Server reads for the drill-down detail pages. Both reuse `loadDashboard`
// (RLS-scoped, decay-adjusted, per-request-fresh) + `loadStudyKits` for the
// concept→kit glue, plus the static curriculum graph for prerequisites /
// dependents. Never throw — a missing concept/misconception returns null so the
// page can `notFound()`.

export type RelatedConcept = { conceptKey: string; title: string; mastery: number | null; state: string | null }

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
  const [data, kits] = await Promise.all([loadDashboard(supabase), loadStudyKits(supabase)])
  const byKey = nodeIndex(data.strands)
  const node = byKey.get(conceptKey) ?? null

  // Unknown key with no practiced node and no curriculum entry → not found.
  if (!concept && !node) return null

  const strand = concept?.strand ?? node?.strand ?? ''
  const st = strandStyle(strand)

  const prerequisites = prerequisitesOf(conceptKey).map((k) => related(k, byKey))
  const dependents = CONCEPTS.filter((c) => c.prerequisites.includes(conceptKey)).map((c) => related(c.key, byKey))
  const misconceptions = data.misconceptions.filter((m) => m.conceptKey === conceptKey)

  return {
    conceptKey,
    title: concept?.title ?? node?.title ?? conceptKey,
    strandLabel: st.label !== strand ? st.label : (concept?.strandLabel ?? strand),
    strandColor: st.color,
    node,
    prerequisites,
    dependents,
    misconceptions,
    kitHref: kitHrefForConcept(kits, conceptKey),
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
