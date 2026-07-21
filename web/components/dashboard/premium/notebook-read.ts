import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { CONCEPTS } from '@calyxa/curriculum'
import { STRAND_ORDER, STRAND_LABELS, strandOf } from '@/lib/onboarding/item-bank'
import {
  loadDashboard,
  type DashboardData,
  type StateCounts,
} from '@/lib/learning/dashboard-read'
import { loadRecentSessions } from '@/lib/learning/activity-read'
import { parseNotebook, isEmptyNotebook, type Notebook } from '@/lib/notebook/tool'
import { loadUserSnapshotsByConcept, type WorkedSnapshot } from './snapshots-read'
import type { KitProblem, KitFlashcard } from './kit-read'
import { overviewStats } from './derive'
import { strandStyle } from './theme'
import type { MasteryState, ConfidenceBand } from '@/lib/ai/profile'

// The Personal Notebook aggregate read (redesign). Where `detail-read.ts`
// assembles ONE concept, this assembles a whole SUBJECT's notebook — its
// chapters and every concept in them — plus the six-subject switcher summary and
// the student-level Tutor Insights, in a small fixed number of bulk queries
// regardless of how many concepts the subject has. It composes the existing
// RLS-scoped reads (`loadDashboard`, the notebook/kit/snapshot tables) and never
// throws: any leg that fails degrades to an empty section, the discipline every
// dashboard read follows.
//
// Hierarchy (all derived from the code-shipped curriculum, no schema level):
//   Subject  = strandOf(conceptKey)         → the 6 courses (one notebook each)
//   Chapter  = Concept.strand / strandLabel → the collapsible folder
//   Concept  = Concept.title                → the notebook page
//
// All exported types are plain display shapes (no server-only), so the client
// notebook shell imports them with `import type` — the same boundary
// `detail-read` → `ConceptDetailScreen` already uses.

// ── Display types ───────────────────────────────────────────────────────────

export type NbNode = {
  mastery: number
  state: MasteryState
  observationCount: number
  lastPracticedAt: string | null
  confidenceBand: ConfidenceBand
}

export type NbMisconception = {
  id: string
  title: string
  category: string
  description: string
  status: 'active' | 'resolved'
  occurrenceCount: number
  consecutiveCorrect: number
  firstSeenAt: string
  lastSeenAt: string
  resolvedAt: string | null
}

export type NbKit = { notes: string[]; problems: KitProblem[]; flashcards: KitFlashcard[] }

export type NbReview = { dueAt: string; intervalDays: number; overdue: boolean; lapses: number }

// The "live notebook" content (ADR-054 v2): a running summary, numbered
// must-know key points, and the ordered solving method (steps carry an optional
// highlighted expression + a mistake annotation the render layer joins to a
// misconception's live count/date). Same shape parseNotebook produces.
export type NbNotebook = Notebook

/** One dated event on a concept's Review Timeline — always a real signal (a
 *  spotted/resolved misconception, a worked turn, a mastery-snapshot crossing,
 *  the next scheduled review). Never fabricated. */
export type NbTimelineEvent = {
  date: string
  kind: 'learned' | 'spotted' | 'resolved' | 'mastered' | 'practiced' | 'review'
  label: string
  future: boolean
}

export type NbConcept = {
  conceptKey: string
  title: string
  chapterKey: string
  chapterLabel: string
  node: NbNode | null
  notebook: NbNotebook | null
  misconceptions: NbMisconception[]
  kit: NbKit | null
  snapshots: WorkedSnapshot[]
  review: NbReview | null
  timeline: NbTimelineEvent[]
  /** True when this concept has anything worth a full page (else a placeholder). */
  hasContent: boolean
  /** `/review/[key]` when a kit exists to review with, else null. */
  reviewHref: string | null
  /** `/kits/[key]` for the study-kit viewer (practice + flashcards bundle), or
   *  null when the concept has no kit. */
  studyKitHref: string | null
}

export type NbChapter = {
  key: string
  label: string
  concepts: NbConcept[]
  averageMastery: number
}

export type NbSubjectSummary = {
  key: string
  label: string
  color: string
  practiced: number
  total: number
  averageMastery: number
  mastered: number
  active: boolean
}

export type NbSubject = {
  key: string
  label: string
  color: string
  practiced: number
  total: number
  averageMastery: number
  stateCounts: StateCounts
  activeMisconceptions: number
  chapters: NbChapter[]
}

export type TutorInsights = {
  subjectsMastered: { label: string; color: string; mastered: number; practiced: number; total: number }[]
  mistakePatterns: { category: string; count: number }[]
  activeMisconceptions: number
  resolvedMisconceptions: number
  accuracy: number | null
  streak: number
  sessionCount: number
  avgStudyMinutes: number | null
  practicesToMastery: number | null
  masteredConcepts: number
  practicedConcepts: number
}

export type NbLastSession = { id: string; startedAt: string; mode: string; kitHref: string | null } | null

export type NotebookData = {
  subjects: NbSubjectSummary[]
  active: NbSubject
  insights: TutorInsights
  lastSession: NbLastSession
}

export const NOTEBOOK_SUBJECTS = STRAND_ORDER

/** Is `subject` one of the six real notebooks? Route guard helper. */
export function isNotebookSubject(subject: string): boolean {
  return (STRAND_ORDER as readonly string[]).includes(subject)
}

/** The subject a student should land on: the most-practiced one, else the first. */
export function defaultNotebookSubject(data: DashboardData): string {
  let best = STRAND_ORDER[0] as string
  let bestPracticed = -1
  for (const s of data.strands) {
    if (s.nodes.length > bestPracticed) {
      bestPracticed = s.nodes.length
      best = s.strand
    }
  }
  return best
}

// ── Bulk study-kit read (content + review href per concept, one query) ───────

type ArtifactRow = {
  id: string
  session_id: string | null
  kind: 'notes' | 'problems' | 'flashcards'
  payload: unknown
  concept_keys: string[] | null
  created_at: string
}

function asNotes(p: unknown): string[] {
  return Array.isArray(p) ? p.filter((n): n is string => typeof n === 'string') : []
}
function asProblems(p: unknown): KitProblem[] {
  if (!Array.isArray(p)) return []
  return p
    .filter((x): x is KitProblem => !!x && typeof x === 'object' && 'statement' in x && 'solution' in x)
    .map((x) => ({ statement: String(x.statement), solution: String(x.solution) }))
}
function asFlashcards(p: unknown): KitFlashcard[] {
  if (!Array.isArray(p)) return []
  return p
    .filter((x): x is KitFlashcard => !!x && typeof x === 'object' && 'front' in x && 'back' in x)
    .map((x) => ({ front: String(x.front), back: String(x.back) }))
}

type KitBundle = {
  contentByConcept: Map<string, NbKit>
  hrefByConcept: Map<string, string>
  kitSessionIds: Set<string>
}

// Reads every study_artifact row once (mirrors kits-read/kit-read's parsing) and
// maps each concept to the NEWEST kit that covers it, plus that kit's viewer
// href. Rows are read newest-first, so the first kit seen covering a concept is
// its newest.
async function loadKitBundle(supabase: SupabaseClient, userId: string): Promise<KitBundle> {
  const contentByConcept = new Map<string, NbKit>()
  const hrefByConcept = new Map<string, string>()
  const kitSessionIds = new Set<string>()

  const { data, error } = await supabase
    .from('study_artifact')
    .select('id, session_id, kind, payload, concept_keys, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })

  if (error || !data) return { contentByConcept, hrefByConcept, kitSessionIds }

  // Group rows into kits (one per session, or a standalone artifact). Map
  // insertion order follows the newest-first row order.
  const groups = new Map<string, ArtifactRow[]>()
  for (const row of data as ArtifactRow[]) {
    if (row.session_id) kitSessionIds.add(row.session_id)
    const groupKey = row.session_id ?? `artifact:${row.id}`
    const list = groups.get(groupKey)
    if (list) list.push(row)
    else groups.set(groupKey, [row])
  }

  for (const rows of groups.values()) {
    const href = rows[0].session_id ?? rows[0].id
    const kit: NbKit = {
      notes: asNotes(rows.find((r) => r.kind === 'notes')?.payload),
      problems: asProblems(rows.find((r) => r.kind === 'problems')?.payload),
      flashcards: asFlashcards(rows.find((r) => r.kind === 'flashcards')?.payload),
    }
    const empty = kit.notes.length === 0 && kit.problems.length === 0 && kit.flashcards.length === 0
    const conceptKeys = [...new Set(rows.flatMap((r) => r.concept_keys ?? []))]
    for (const key of conceptKeys) {
      // First (newest) kit covering the concept wins.
      if (!hrefByConcept.has(key)) hrefByConcept.set(key, href)
      if (!empty && !contentByConcept.has(key)) contentByConcept.set(key, kit)
    }
  }

  return { contentByConcept, hrefByConcept, kitSessionIds }
}

// ── Notebook rows (all concepts, one query) ──────────────────────────────────

async function loadNotebookRows(supabase: SupabaseClient, userId: string): Promise<Map<string, NbNotebook>> {
  const byConcept = new Map<string, NbNotebook>()
  const { data, error } = await supabase
    .from('concept_notebook')
    .select('concept_key, content')
    .eq('user_id', userId)

  if (error || !data) return byConcept
  for (const row of data as { concept_key: string; content: unknown }[]) {
    const parsed = parseNotebook(row.content)
    if (!isEmptyNotebook(parsed)) byConcept.set(row.concept_key, parsed)
  }
  return byConcept
}

// Earliest day each concept was recorded 'mastered' in the forward-only trend
// (mastery_snapshot). Sparse by design — the timeline just omits the event when
// there's no crossing yet, never invents a date.
async function loadMasteredDays(supabase: SupabaseClient, userId: string): Promise<Map<string, string>> {
  const byConcept = new Map<string, string>()
  const { data, error } = await supabase
    .from('mastery_snapshot')
    .select('concept_key, day, state')
    .eq('user_id', userId)
    .eq('state', 'mastered')
    .order('day', { ascending: true })

  if (error || !data) return byConcept
  for (const row of data as { concept_key: string; day: string }[]) {
    if (!byConcept.has(row.concept_key)) byConcept.set(row.concept_key, row.day)
  }
  return byConcept
}

// ── Timeline assembly (per concept, only real dated signals) ─────────────────

function buildTimeline(
  node: NbNode | null,
  misconceptions: NbMisconception[],
  snapshots: WorkedSnapshot[],
  review: NbReview | null,
  masteredDay: string | undefined
): NbTimelineEvent[] {
  const events: NbTimelineEvent[] = []

  // "First worked on this" — the earliest real dated signal we have: the first
  // annotated snapshot, or the first time a misconception was spotted here.
  const firstCandidates = [
    ...snapshots.map((s) => s.createdAt),
    ...misconceptions.map((m) => m.firstSeenAt),
  ].filter(Boolean)
  const earliest = firstCandidates.sort()[0] ?? null
  if (earliest) {
    events.push({ date: earliest, kind: 'learned', label: 'First worked on this', future: false })
  }

  // Misconceptions spotted, and the ones the student later resolved.
  for (const m of misconceptions) {
    if (m.firstSeenAt && m.firstSeenAt !== earliest) {
      events.push({ date: m.firstSeenAt, kind: 'spotted', label: `Spotted: ${m.title}`, future: false })
    }
    if (m.status === 'resolved' && m.resolvedAt) {
      events.push({ date: m.resolvedAt, kind: 'resolved', label: `Resolved: ${m.title}`, future: false })
    }
  }

  if (masteredDay) {
    events.push({ date: `${masteredDay}T00:00:00Z`, kind: 'mastered', label: 'Reached mastered', future: false })
  }

  // "Last practiced" only when it's a distinct, later beat than the first.
  if (node?.lastPracticedAt && (!earliest || node.lastPracticedAt > earliest)) {
    events.push({ date: node.lastPracticedAt, kind: 'practiced', label: 'Last practiced', future: false })
  }

  const past = events.sort((a, b) => a.date.localeCompare(b.date))

  // Collapse same-day repeats of the same kind.
  const deduped: NbTimelineEvent[] = []
  for (const e of past) {
    const prev = deduped[deduped.length - 1]
    if (prev && prev.kind === e.kind && prev.date.slice(0, 10) === e.date.slice(0, 10)) continue
    deduped.push(e)
  }

  if (review?.dueAt) {
    deduped.push({ date: review.dueAt, kind: 'review', label: 'Next scheduled review', future: true })
  }

  return deduped.slice(0, 7)
}

// ── The main loader ──────────────────────────────────────────────────────────

const MS_PER_MIN = 60_000

function avg(nums: number[]): number | null {
  if (nums.length === 0) return null
  return nums.reduce((a, b) => a + b, 0) / nums.length
}

// Humanise a misconception category slug for the insights list.
function humanizeCategory(category: string): string {
  const s = category.replace(/[-_.]/g, ' ').trim()
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : 'Pattern'
}

export async function loadNotebook(supabase: SupabaseClient, subjectKey: string): Promise<NotebookData | null> {
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return null
  if (!isNotebookSubject(subjectKey)) return null

  const [data, notebookRows, kitBundle, snapshotsByConcept, masteredDays] = await Promise.all([
    loadDashboard(supabase),
    loadNotebookRows(supabase, user.id),
    loadKitBundle(supabase, user.id),
    loadUserSnapshotsByConcept(supabase),
    loadMasteredDays(supabase, user.id),
  ])
  const recentSessions = await loadRecentSessions(supabase, kitBundle.kitSessionIds)

  // Index dashboard signals by concept key.
  const nodeByKey = new Map(data.strands.flatMap((s) => s.nodes).map((n) => [n.conceptKey, n]))
  const reviewByKey = new Map(data.dueQueue.map((d) => [d.conceptKey, d]))
  const miscByKey = new Map<string, NbMisconception[]>()
  for (const m of data.misconceptions) {
    const item: NbMisconception = {
      id: m.id,
      title: m.title,
      category: m.category,
      description: m.description,
      status: m.status,
      occurrenceCount: m.occurrenceCount,
      consecutiveCorrect: m.consecutiveCorrect,
      firstSeenAt: m.firstSeenAt,
      lastSeenAt: m.lastSeenAt,
      resolvedAt: m.resolvedAt,
    }
    const list = miscByKey.get(m.conceptKey)
    if (list) list.push(item)
    else miscByKey.set(m.conceptKey, [item])
  }

  // Build one concept's page data.
  const buildConcept = (concept: (typeof CONCEPTS)[number]): NbConcept => {
    const key = concept.key
    const dashNode = nodeByKey.get(key)
    const node: NbNode | null = dashNode
      ? {
          mastery: dashNode.mastery,
          state: dashNode.state,
          observationCount: dashNode.observationCount,
          lastPracticedAt: dashNode.lastPracticedAt,
          confidenceBand: dashNode.confidenceBand,
        }
      : null
    const notebook = notebookRows.get(key) ?? null
    const misconceptions = miscByKey.get(key) ?? []
    const kit = kitBundle.contentByConcept.get(key) ?? null
    const snapshots = snapshotsByConcept.get(key) ?? []
    const dash = reviewByKey.get(key)
    const review: NbReview | null = dash
      ? { dueAt: dash.dueAt, intervalDays: dash.intervalDays, overdue: dash.overdue, lapses: dash.lapses }
      : null
    const timeline = buildTimeline(node, misconceptions, snapshots, review, masteredDays.get(key))
    const hasContent =
      !!notebook || !!kit || snapshots.length > 0 || misconceptions.length > 0 || !!node
    return {
      conceptKey: key,
      title: concept.title,
      chapterKey: concept.strand,
      chapterLabel: concept.strandLabel,
      node,
      notebook,
      misconceptions,
      kit,
      snapshots,
      review,
      timeline,
      hasContent,
      reviewHref: kit ? `/review/${key}` : null,
      studyKitHref: kitBundle.hrefByConcept.has(key) ? `/kits/${kitBundle.hrefByConcept.get(key)}` : null,
    }
  }

  // Subject → chapters → concepts, from the curriculum in file order.
  const subjectConcepts = CONCEPTS.filter((c) => strandOf(c.key) === subjectKey)
  const chapterMap = new Map<string, NbConcept[]>()
  const chapterLabels = new Map<string, string>()
  for (const c of subjectConcepts) {
    const built = buildConcept(c)
    const list = chapterMap.get(c.strand)
    if (list) list.push(built)
    else {
      chapterMap.set(c.strand, [built])
      chapterLabels.set(c.strand, c.strandLabel)
    }
  }
  const chapters: NbChapter[] = [...chapterMap.entries()].map(([chKey, concepts]) => {
    const practiced = concepts.filter((c) => c.node)
    return {
      key: chKey,
      label: chapterLabels.get(chKey) ?? chKey,
      concepts,
      averageMastery: avg(practiced.map((c) => c.node!.mastery)) ?? 0,
    }
  })

  const st = strandStyle(subjectKey)
  const strandGroup = data.strands.find((s) => s.strand === subjectKey)
  const active: NbSubject = {
    key: subjectKey,
    label: STRAND_LABELS[subjectKey] ?? st.label,
    color: st.color,
    practiced: strandGroup?.nodes.length ?? 0,
    total: subjectConcepts.length,
    averageMastery: strandGroup?.averageMastery ?? 0,
    stateCounts: strandGroup?.stateCounts ?? { unseen: 0, learning: 0, weak: 0, mastered: 0, forgotten: 0 },
    activeMisconceptions: data.misconceptions.filter(
      (m) => m.status === 'active' && strandOf(m.conceptKey) === subjectKey
    ).length,
    chapters,
  }

  // Six-subject switcher summary.
  const subjects: NbSubjectSummary[] = STRAND_ORDER.map((strand) => {
    const group = data.strands.find((s) => s.strand === strand)
    const style = strandStyle(strand)
    const total = CONCEPTS.filter((c) => strandOf(c.key) === strand).length
    return {
      key: strand,
      label: STRAND_LABELS[strand] ?? style.label,
      color: style.color,
      practiced: group?.nodes.length ?? 0,
      total,
      averageMastery: group?.averageMastery ?? 0,
      mastered: group?.stateCounts.mastered ?? 0,
      active: strand === subjectKey,
    }
  })

  // ── Tutor Insights (student-level, real data only) ─────────────────────────
  const stats = overviewStats(data)
  const allNodes = data.strands.flatMap((s) => s.nodes)
  const masteredNodes = allNodes.filter((n) => n.state === 'mastered')
  const practicesToMastery = avg(masteredNodes.map((n) => n.observationCount))

  const endedDurations = recentSessions
    .filter((s) => s.endedAt)
    .map((s) => (new Date(s.endedAt!).getTime() - new Date(s.startedAt).getTime()) / MS_PER_MIN)
    .filter((m) => m > 0 && m < 240)
  const avgStudyMinutes = avg(endedDurations)

  const mistakeCounts = new Map<string, number>()
  for (const m of data.misconceptions) {
    const label = humanizeCategory(m.category)
    mistakeCounts.set(label, (mistakeCounts.get(label) ?? 0) + m.occurrenceCount)
  }
  const mistakePatterns = [...mistakeCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([category, count]) => ({ category, count }))

  const insights: TutorInsights = {
    subjectsMastered: subjects
      .filter((s) => s.practiced > 0)
      .map((s) => ({ label: s.label, color: s.color, mastered: s.mastered, practiced: s.practiced, total: s.total })),
    mistakePatterns,
    activeMisconceptions: data.misconceptions.filter((m) => m.status === 'active').length,
    resolvedMisconceptions: data.misconceptions.filter((m) => m.status === 'resolved').length,
    accuracy: stats.accuracy,
    streak: stats.streak,
    sessionCount: recentSessions.length,
    avgStudyMinutes: avgStudyMinutes != null ? Math.round(avgStudyMinutes) : null,
    practicesToMastery: practicesToMastery != null ? Math.round(practicesToMastery * 10) / 10 : null,
    masteredConcepts: data.stateCounts.mastered,
    practicedConcepts: data.totalConcepts,
  }

  const last = recentSessions[0]
  const lastSession: NbLastSession = last
    ? { id: last.id, startedAt: last.startedAt, mode: last.mode, kitHref: last.kitHref }
    : null

  return { subjects, active, insights, lastSession }
}
