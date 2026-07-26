import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { retrievability } from '@calyxa/learning-model'
import { getConcept } from '@calyxa/curriculum'
import { STRAND_ORDER, STRAND_LABELS, strandOf } from '@/lib/onboarding/item-bank'
import type { ConfidenceBand, MasteryState } from '@/lib/ai/profile'

// Sprint 22 Task 4 (ADR-047): the dashboard-sized read. Where `loadProfile`
// (`profile-read.ts`) returns the overlay/tutor-sized top-K weakest slice,
// `loadDashboard` returns the FULL per-user learning graph, grouped by the six
// curriculum strands, for the post-login web dashboard. It REUSES
// `profile-read`'s exact read-time decay (`mastery * retrievability(stability,
// daysSince(last_practiced_at))`, §2.3/ADR-016) so a shared node reads back the
// same decay-adjusted mastery the tutor sees — the parity the sprint's test
// asserts. It is server-only, RLS-scoped (every row is `auth.uid()`-scoped by
// policy; the explicit `eq('user_id', ...)` is defense-in-depth), rendered
// fresh per request (no cache — ADR-047), and NEVER throws: any leg that errors
// degrades to an empty section, the same discipline `loadProfile` applies.
//
// There is no mastery-history table (knowledge_nodes is current-state only), so
// this read charts current state + real activity/accuracy history from
// `session_interactions`; the forward-only mastery trend reads `mastery_snapshot`
// (Task 5) and is not part of this read.

const MS_PER_DAY = 1000 * 60 * 60 * 24

function daysSince(timestamp: string | null): number {
  if (!timestamp) return 0
  return Math.max(0, (Date.now() - new Date(timestamp).getTime()) / MS_PER_DAY)
}

// Bounded scan for the activity/accuracy trend. Aggregation is in-memory (the
// Supabase JS client has no GROUP BY), so this caps the rows read on a hot
// per-request path. At launch/beta scale a user has single-digit sessions of
// single-digit gradable turns, so this ceiling is never reached in practice; if
// it ever is, the OLDEST history is dropped (rows are read newest-first) — a
// gap at the far-left of the trend, never a wrong recent number. Moving the
// aggregation into a single SQL query is the escalation path (ADR-047), not a
// cache.
const LIMIT_ACTIVITY_SCAN = 2000

// ---------------------------------------------------------------------------
// Row shapes (the columns each leg selects).
// ---------------------------------------------------------------------------

type KnowledgeNodeRow = {
  concept_key: string
  mastery: number
  stability: number
  state: string
  confidence_band: string
  observation_count: number
  last_practiced_at: string | null
}

type MisconceptionRow = {
  id: string
  concept_key: string
  category: string
  description: string | null
  status: string
  occurrence_count: number
  consecutive_correct: number
  first_seen_at: string
  last_seen_at: string
  resolved_at: string | null
}

type ScheduleRow = {
  concept_key: string
  due_at: string
  interval_days: number
  priority: number
  lapses: number
  last_review_at: string | null
}

type InteractionRow = {
  session_id: string
  outcome: string
  created_at: string
}

// ---------------------------------------------------------------------------
// Public return shape. The views (Tasks 6/7) compose over this; nothing here
// resolves a chart color (that stays in the token-driven components).
// ---------------------------------------------------------------------------

export type DashboardMasteryNode = {
  conceptKey: string
  title: string
  strand: string
  strandLabel: string
  /** Decay-adjusted mastery in [0,1] — identical math to `loadProfile`. */
  mastery: number
  state: MasteryState
  confidenceBand: ConfidenceBand
  observationCount: number
  lastPracticedAt: string | null
}

export type StateCounts = Record<MasteryState, number>

export type DashboardStrandGroup = {
  strand: string
  strandLabel: string
  /** Weakest-first (decay-adjusted mastery ascending), matching `loadProfile`. */
  nodes: DashboardMasteryNode[]
  /** Mean decay-adjusted mastery over this strand's nodes; 0 when empty. */
  averageMastery: number
  stateCounts: StateCounts
}

export type DashboardMisconception = {
  id: string
  conceptKey: string
  title: string
  strand: string
  strandLabel: string
  category: string
  description: string
  /** The real lifecycle state (`apply.ts`): `pending` = the slip has been seen
   *  ONCE and is not yet a confirmed pattern ("watching"), `active` = confirmed
   *  at 2+ occurrences, `resolved` = 3 consecutive correct since.
   *
   *  The dashboard surfaces all three — a student is owed the difference between
   *  "you keep doing this" and "I noticed this once". Note this is WIDER than
   *  what `loadProfile` feeds the tutor, which stays `active`-only on purpose: a
   *  one-off slip should not be taught against as an established misconception. */
  status: 'pending' | 'active' | 'resolved'
  occurrenceCount: number
  consecutiveCorrect: number
  firstSeenAt: string
  lastSeenAt: string
  resolvedAt: string | null
}

export type DashboardDueItem = {
  conceptKey: string
  title: string
  strand: string
  strandLabel: string
  dueAt: string
  intervalDays: number
  priority: number
  lapses: number
  /** When this concept was last actually reviewed (`scheduler.ts` stamps it on
   *  every schedule update). The only record of a COMPLETED review — the
   *  schedule holds what is coming, not a history — so it is what the dashboard's
   *  "recently done" column reads. Null until the first review. */
  lastReviewAt: string | null
  /** True when `due_at <= now` — the review view labels overdue vs upcoming. */
  overdue: boolean
}

export type DashboardActivityDay = {
  /** UTC calendar day, `YYYY-MM-DD`. */
  day: string
  /** Distinct sessions that had any interaction that day. */
  sessions: number
  correct: number
  partial: number
  incorrect: number
}

export type DashboardData = {
  /** The six strands in curriculum order; a strand with no practiced nodes is present but empty. */
  strands: DashboardStrandGroup[]
  /** Overall state distribution across every practiced node. */
  stateCounts: StateCounts
  /** Count of practiced concepts (knowledge_nodes rows). */
  totalConcepts: number
  misconceptions: DashboardMisconception[]
  /** Priority DESC, due_at ASC (PLAN §2.3 query 2); includes overdue AND upcoming. */
  dueQueue: DashboardDueItem[]
  /** Ascending by day; real historical accuracy from session_interactions. */
  activity: DashboardActivityDay[]
  /** True when the user has no practiced nodes yet (cold start). */
  isEmpty: boolean
}

function emptyStateCounts(): StateCounts {
  return { unseen: 0, learning: 0, weak: 0, mastered: 0, forgotten: 0 }
}

// The full-empty dashboard: a signed-out user, an auth failure, or a cold-start
// account with no data reads back as six empty strands and empty sections —
// the same "calibrating"/cold-start contract `loadProfile` returns, so the
// views render one consistent empty state, never a crash.
function emptyDashboard(): DashboardData {
  return {
    strands: STRAND_ORDER.map((strand) => ({
      strand,
      strandLabel: STRAND_LABELS[strand] ?? strand,
      nodes: [],
      averageMastery: 0,
      stateCounts: emptyStateCounts(),
    })),
    stateCounts: emptyStateCounts(),
    totalConcepts: 0,
    misconceptions: [],
    dueQueue: [],
    activity: [],
    isEmpty: true,
  }
}

// Resolve a concept_key to its curriculum title + strand label. A key not in
// the static graph (a legacy/renamed concept) falls back to the raw key as
// title and its dotted prefix as the strand — visible, never dropped.
function resolveConcept(conceptKey: string): { title: string; strand: string; strandLabel: string } {
  const concept = getConcept(conceptKey)
  const strand = strandOf(conceptKey)
  return {
    title: concept?.title ?? conceptKey,
    strand,
    strandLabel: STRAND_LABELS[strand] ?? concept?.strandLabel ?? strand,
  }
}

function utcDay(timestamp: string): string {
  return new Date(timestamp).toISOString().slice(0, 10)
}

// Build the six strand groups (plus any unrecognized-prefix strand as a
// trailing group so nothing is silently hidden). Nodes are decay-adjusted here,
// reusing the exact `loadProfile` formula.
function groupByStrand(rows: KnowledgeNodeRow[]): {
  strands: DashboardStrandGroup[]
  stateCounts: StateCounts
} {
  const overall = emptyStateCounts()
  const byStrand = new Map<string, DashboardMasteryNode[]>()

  for (const row of rows) {
    const { title, strand, strandLabel } = resolveConcept(row.concept_key)
    const node: DashboardMasteryNode = {
      conceptKey: row.concept_key,
      title,
      strand,
      strandLabel,
      // §2.3/ADR-016 read-time decay — identical to profile-read.ts.
      mastery: row.mastery * retrievability(row.stability, daysSince(row.last_practiced_at)),
      state: row.state as MasteryState,
      confidenceBand: row.confidence_band as ConfidenceBand,
      observationCount: row.observation_count,
      lastPracticedAt: row.last_practiced_at,
    }
    if (node.state in overall) overall[node.state] += 1
    const list = byStrand.get(strand)
    if (list) list.push(node)
    else byStrand.set(strand, [node])
  }

  // The six known strands first, in curriculum order; then any extra prefix a
  // legacy node carried, appended so it stays visible.
  const orderedStrandKeys = [
    ...STRAND_ORDER,
    ...[...byStrand.keys()].filter((s) => !STRAND_ORDER.includes(s as (typeof STRAND_ORDER)[number])),
  ]

  const strands: DashboardStrandGroup[] = orderedStrandKeys.map((strand) => {
    const nodes = (byStrand.get(strand) ?? []).sort((a, b) => a.mastery - b.mastery)
    const stateCounts = emptyStateCounts()
    let masterySum = 0
    for (const node of nodes) {
      if (node.state in stateCounts) stateCounts[node.state] += 1
      masterySum += node.mastery
    }
    return {
      strand,
      strandLabel: STRAND_LABELS[strand] ?? nodes[0]?.strandLabel ?? strand,
      nodes,
      averageMastery: nodes.length > 0 ? masterySum / nodes.length : 0,
      stateCounts,
    }
  })

  return { strands, stateCounts: overall }
}

// Aggregate the bounded interaction scan into per-day accuracy + session
// counts, ascending by day. Rows arrive newest-first (the LIMIT keeps recent
// history when capped); the day map is re-sorted ascending for the trend.
function aggregateActivity(rows: InteractionRow[]): DashboardActivityDay[] {
  const byDay = new Map<string, { sessions: Set<string>; correct: number; partial: number; incorrect: number }>()

  for (const row of rows) {
    const day = utcDay(row.created_at)
    let bucket = byDay.get(day)
    if (!bucket) {
      bucket = { sessions: new Set(), correct: 0, partial: 0, incorrect: 0 }
      byDay.set(day, bucket)
    }
    bucket.sessions.add(row.session_id)
    if (row.outcome === 'correct') bucket.correct += 1
    else if (row.outcome === 'partial') bucket.partial += 1
    else if (row.outcome === 'incorrect') bucket.incorrect += 1
    // 'none' turns count toward the session but not the accuracy segments.
  }

  return [...byDay.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([day, b]) => ({
      day,
      sessions: b.sessions.size,
      correct: b.correct,
      partial: b.partial,
      incorrect: b.incorrect,
    }))
}

// The FULL per-user learning graph for the web dashboard. RLS-scoped,
// server-rendered fresh per request, never throws. Reuses `loadProfile`'s decay
// math (via `retrievability`) so shared nodes read identically to the tutor's
// view.
export async function loadDashboard(supabase: SupabaseClient): Promise<DashboardData> {
  const { data: userData, error: userError } = await supabase.auth.getUser()
  const userId = userData?.user?.id

  if (userError || !userId) {
    return emptyDashboard()
  }

  const nowIso = new Date().toISOString()

  const [nodesResult, misconceptionsResult, scheduleResult, activityResult] = await Promise.all([
    // All knowledge_nodes for the user (not the top-K slice loadProfile takes).
    supabase
      .from('knowledge_nodes')
      .select('concept_key, mastery, stability, state, confidence_band, observation_count, last_practiced_at')
      .eq('user_id', userId)
      .is('deleted_at', null),
    // All three lifecycle states. `pending` used to be excluded here to mirror
    // loadProfile's confirmed-only stance, but that conflated two different
    // audiences: the TUTOR must not teach against an unconfirmed slip, while the
    // STUDENT'S dashboard should still show it — as "watching", visibly weaker
    // than a confirmed misconception. loadProfile keeps its `active`-only read.
    supabase
      .from('misconceptions')
      .select(
        'id, concept_key, category, description, status, occurrence_count, consecutive_correct, first_seen_at, last_seen_at, resolved_at'
      )
      .eq('user_id', userId)
      .in('status', ['pending', 'active', 'resolved'])
      .is('deleted_at', null)
      .order('status', { ascending: true })
      .order('occurrence_count', { ascending: false })
      .order('last_seen_at', { ascending: false }),
    // The full reinforcement queue — overdue AND upcoming (the review view
    // shows "what's coming back and when"), ordered PLAN §2.3 query 2.
    supabase
      .from('reinforcement_schedule')
      .select('concept_key, due_at, interval_days, priority, lapses, last_review_at')
      .eq('user_id', userId)
      .is('deleted_at', null)
      .order('priority', { ascending: false })
      .order('due_at', { ascending: true }),
    // Real activity/accuracy history (backfilled from existing rows). Read
    // newest-first under a bounded cap; aggregated in-memory by day.
    supabase
      .from('session_interactions')
      .select('session_id, outcome, created_at')
      .eq('user_id', userId)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(LIMIT_ACTIVITY_SCAN),
  ])

  const nodeRows = (nodesResult.error ? [] : (nodesResult.data ?? [])) as KnowledgeNodeRow[]
  const misconceptionRows = (misconceptionsResult.error ? [] : (misconceptionsResult.data ?? [])) as MisconceptionRow[]
  const scheduleRows = (scheduleResult.error ? [] : (scheduleResult.data ?? [])) as ScheduleRow[]
  const activityRows = (activityResult.error ? [] : (activityResult.data ?? [])) as InteractionRow[]

  // No nodes at all → the cold-start dashboard (six empty strands), but still
  // surface any misconception/queue/activity that somehow exists independently.
  const { strands, stateCounts } =
    nodeRows.length > 0
      ? groupByStrand(nodeRows)
      : { strands: emptyDashboard().strands, stateCounts: emptyStateCounts() }

  const misconceptions: DashboardMisconception[] = misconceptionRows.map((row) => {
    const { title, strand, strandLabel } = resolveConcept(row.concept_key)
    return {
      id: row.id,
      conceptKey: row.concept_key,
      title,
      strand,
      strandLabel,
      category: row.category,
      description: row.description ?? '',
      // Preserve the real state. This used to coerce everything non-resolved to
      // 'active', which was harmless only because the query excluded 'pending' —
      // now that pending is read, coercing it would relabel a one-off slip as a
      // confirmed misconception, which is exactly the distinction being added.
      // Anything unrecognised still falls back to 'active' (fail toward "show it").
      status: row.status === 'resolved' ? 'resolved' : row.status === 'pending' ? 'pending' : 'active',
      occurrenceCount: row.occurrence_count,
      consecutiveCorrect: row.consecutive_correct,
      firstSeenAt: row.first_seen_at,
      lastSeenAt: row.last_seen_at,
      resolvedAt: row.resolved_at,
    }
  })

  const dueQueue: DashboardDueItem[] = scheduleRows.map((row) => {
    const { title, strand, strandLabel } = resolveConcept(row.concept_key)
    return {
      conceptKey: row.concept_key,
      title,
      strand,
      strandLabel,
      dueAt: row.due_at,
      intervalDays: row.interval_days,
      priority: row.priority,
      lapses: row.lapses,
      lastReviewAt: row.last_review_at,
      overdue: row.due_at <= nowIso,
    }
  })

  const activity = aggregateActivity(activityRows)

  return {
    strands,
    stateCounts,
    totalConcepts: nodeRows.length,
    misconceptions,
    dueQueue,
    activity,
    isEmpty: nodeRows.length === 0,
  }
}
