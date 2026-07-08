import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { retrievability } from '@calyxa/learning-model'
import type {
  ActiveMisconception,
  ConfidenceBand,
  DueForReviewItem,
  LearningProfile,
  MasteryNode,
  MasteryState,
  PriorWorkItem,
} from '@/lib/ai/profile'

const MS_PER_DAY = 1000 * 60 * 60 * 24

function daysSince(timestamp: string | null): number {
  if (!timestamp) return 0
  return Math.max(0, (Date.now() - new Date(timestamp).getTime()) / MS_PER_DAY)
}

// PLAN.md §2.3 query 1, now WITH the page-relevant bias ADR-014 deferred
// (ADR-021): the caller's weakest knowledge_nodes plus any page-relevant
// (`topicKeys`) nodes, topic-relevant first — the bias only REORDERS and
// ADDS, it never drops the weakest-overall set or active misconceptions.
// Query 2 (the due-item fetch, ADR-020) rides the same read: due
// reinforcement_schedule rows become the profile's `dueForReview` set. RLS
// already scopes every row to auth.uid(); the explicit eq('user_id', ...)
// below is defense-in-depth, not the only guard. LIMIT_NODES mirrors the
// §2.5 budget (MAX_MASTERY_NODES, already enforced by renderProfileSummary
// in system-prompt.ts) — top-K weakest/relevant, K≈12.
const LIMIT_NODES = 12
// PLAN §2.3 query 2's LIMIT — the due queue surfaced per turn, highest
// priority / longest overdue first.
const LIMIT_DUE = 10

// The prior-work digest (Sprint 13, ADR-026): at most this many entries
// reach the prompt's PRIOR SESSIONS block — the callback material is meant
// to be occasional and specific, never a history dump.
const LIMIT_PRIOR_WORK = 3
// Bounded scan of recent gradable interactions from ENDED sessions. ~60
// rows comfortably covers several sessions of real tutoring (sessions run
// single-digit gradable turns) while keeping the query cheap; anything the
// scan window misses is simply "too long ago to call back to."
const LIMIT_PRIOR_WORK_SCAN = 60

// The cold-start profile (PLAN §2.10): a user with no knowledge_nodes yet
// reads exactly as the "calibrating" fallback system-prompt.ts already
// renders ("no mastery data yet" / "none active").
const CALIBRATING_PROFILE: LearningProfile = {
  masteryNodes: [],
  activeMisconceptions: [],
  confidenceNote: 'Calibrating — early estimate.',
}

type KnowledgeNodeRow = {
  concept_key: string
  mastery: number
  stability: number
  state: string
  confidence_band: string
  last_practiced_at: string | null
}

type MisconceptionRow = {
  concept_key: string
  category: string
  description: string | null
}

type DueScheduleRow = {
  concept_key: string
  due_at: string
  priority: number
}

// One recent gradable interaction from an ENDED session (the sessions
// !inner join guarantees ended_at is non-null, which is also what excludes
// the CURRENT session -- it is still open, so none of its rows can appear
// here and "prior" needs no sessionId parameter).
type PriorInteractionRow = {
  concept_key: string | null
  outcome: string
  created_at: string
  session_id: string
}

// The bounded outcomeLine phrasings (ADR-026): derived mechanically from
// one (session, concept)'s recorded outcomes, never free text -- the
// digest can say what the rows say and nothing more. `rows` arrive in
// created_at order (oldest first) so "finished strong" reads the actual
// last outcome of that session's work on the concept.
function outcomeLineFor(rows: PriorInteractionRow[]): string {
  const correct = rows.filter((r) => r.outcome === 'correct').length
  const incorrect = rows.filter((r) => r.outcome === 'incorrect').length
  const partial = rows.filter((r) => r.outcome === 'partial').length
  const last = rows[rows.length - 1]?.outcome

  if (incorrect === 0 && partial === 0 && correct > 0) return 'went cleanly'
  if (correct === 0) return 'was tough going'
  if (last === 'correct' && incorrect > 0) return 'struggled early, finished strong'
  return 'was a mixed session'
}

// Derives the ≤3-entry prior-work digest from the bounded interaction scan.
// `orderedConceptKeys` is the profile's own concept order (topic-relevant
// first, then weakest-first), so the digest prioritizes exactly what the
// rest of the profile prioritizes. sessionsAgo is the 1-based recency rank
// of the prior session among the scanned ended sessions (1 = the most
// recent prior session). Pure and in-memory; a concept with no prior-
// session rows simply contributes nothing.
function derivePriorWork(
  rows: PriorInteractionRow[],
  orderedConceptKeys: readonly string[]
): PriorWorkItem[] {
  if (rows.length === 0) return []

  // Rank scanned sessions by the recency of their newest interaction.
  const sessionLatest = new Map<string, number>()
  for (const row of rows) {
    const at = new Date(row.created_at).getTime()
    sessionLatest.set(row.session_id, Math.max(sessionLatest.get(row.session_id) ?? 0, at))
  }
  const sessionRank = new Map(
    [...sessionLatest.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([sessionId], index) => [sessionId, index + 1] as const)
  )

  const items: PriorWorkItem[] = []

  for (const conceptKey of orderedConceptKeys) {
    if (items.length >= LIMIT_PRIOR_WORK) break

    const conceptRows = rows.filter((r) => r.concept_key === conceptKey)
    if (conceptRows.length === 0) continue

    // The most recent prior session that touched this concept.
    const bestSessionId = conceptRows.reduce((best, row) =>
      (sessionRank.get(row.session_id) ?? Infinity) < (sessionRank.get(best.session_id) ?? Infinity)
        ? row
        : best
    ).session_id

    const sessionRows = conceptRows
      .filter((r) => r.session_id === bestSessionId)
      .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())

    items.push({
      conceptKey,
      sessionsAgo: sessionRank.get(bestSessionId) ?? 1,
      daysAgo: Math.floor(daysSince(sessionRows[sessionRows.length - 1].created_at)),
      outcomeLine: outcomeLineFor(sessionRows),
    })
  }

  return items
}

// The "why now" line the prompt renders for a due item: the node's state
// when we have it (the §2.3 query-2 join to knowledge_nodes — a logical
// join, the same convention the scheduler's tables already use) plus how
// overdue the schedule says it is.
function dueReason(row: DueScheduleRow, node: KnowledgeNodeRow | undefined): string {
  const overdueDays = Math.floor(daysSince(row.due_at))
  const when = overdueDays < 1 ? 'due for review now' : `overdue by ${overdueDays}d`

  if (node && (node.state === 'weak' || node.state === 'forgotten')) {
    return `${node.state}, ${when}`
  }

  return when
}

// Replaces HARDCODED_PROFILE (ADR-009/ADR-014) as the source of the
// LearningProfile the AI turn route injects into the prompt. Never throws —
// any query failure degrades to the calibrating empty profile (or, for the
// query-2/topic legs, to a profile without that signal) rather than failing
// the turn, the same discipline /api/ai/turn already applies to a malformed
// pageContext (ADR-013). `topicKeys` (detectTopicKeys, ADR-021) is optional
// and additive: absent or empty, the read is exactly the pre-Sprint-11 one.
export async function loadProfile(
  supabase: SupabaseClient,
  opts?: { topicKeys?: readonly string[] }
): Promise<LearningProfile> {
  const { data: userData, error: userError } = await supabase.auth.getUser()
  const userId = userData?.user?.id

  if (userError || !userId) {
    return CALIBRATING_PROFILE
  }

  const topicKeys = opts?.topicKeys ?? []

  const [nodesResult, misconceptionsResult, topicNodesResult, dueResult, priorWorkResult] = await Promise.all([
    supabase
      .from('knowledge_nodes')
      .select('concept_key, mastery, stability, state, confidence_band, last_practiced_at')
      .eq('user_id', userId)
      .is('deleted_at', null)
      .order('mastery', { ascending: true })
      .limit(LIMIT_NODES),
    supabase
      .from('misconceptions')
      .select('concept_key, category, description')
      .eq('user_id', userId)
      .eq('status', 'active')
      .is('deleted_at', null),
    // Page-relevant nodes (§2.3 query 1's `$2` bias, ADR-021) — may overlap
    // the weakest set (deduped below) or add nodes the weakest-K cut off.
    topicKeys.length > 0
      ? supabase
          .from('knowledge_nodes')
          .select('concept_key, mastery, stability, state, confidence_band, last_practiced_at')
          .eq('user_id', userId)
          .in('concept_key', [...topicKeys])
          .is('deleted_at', null)
          .order('mastery', { ascending: true })
      : Promise.resolve({ data: null, error: null }),
    // §2.3 query 2 (ADR-020): the due reinforcement queue.
    supabase
      .from('reinforcement_schedule')
      .select('concept_key, due_at, priority')
      .eq('user_id', userId)
      .lte('due_at', new Date().toISOString())
      .is('deleted_at', null)
      .order('priority', { ascending: false })
      .order('due_at', { ascending: true })
      .limit(LIMIT_DUE),
    // Prior-work scan (Sprint 13, ADR-026): recent gradable interactions
    // from ENDED sessions only -- the sessions!inner join both enforces
    // "prior" (the current session is still open, ended_at null) and rides
    // the existing FK; served by idx_si_user_applied's user_id prefix +
    // the created_at order over a small LIMIT. RLS scopes both tables to
    // the caller.
    supabase
      .from('session_interactions')
      .select('concept_key, outcome, created_at, session_id, sessions!inner(ended_at)')
      .eq('user_id', userId)
      .not('concept_key', 'is', null)
      .neq('outcome', 'none')
      .is('deleted_at', null)
      .not('sessions.ended_at', 'is', null)
      .order('created_at', { ascending: false })
      .limit(LIMIT_PRIOR_WORK_SCAN),
  ])

  const nodeRows = (nodesResult.data ?? []) as KnowledgeNodeRow[]

  if (nodesResult.error || nodeRows.length === 0) {
    return CALIBRATING_PROFILE
  }

  const misconceptionRows = (misconceptionsResult.data ?? []) as MisconceptionRow[]
  const topicNodeRows = (topicNodesResult.data ?? []) as KnowledgeNodeRow[]
  const dueRows = (dueResult.data ?? []) as DueScheduleRow[]
  // The embedded `sessions` object only exists to make the inner-join
  // filter apply; the digest never reads it, so the cast drops it.
  const priorInteractionRows = (priorWorkResult.data ?? []) as PriorInteractionRow[]

  // Topic bias (ADR-021): page-relevant nodes first (each set stays
  // weakest-first internally), then the weakest-overall set minus overlap.
  // With no topicKeys this is exactly the pre-Sprint-11 ordering.
  const topicKeySet = new Set(topicNodeRows.map((row) => row.concept_key))
  const orderedRows = [...topicNodeRows, ...nodeRows.filter((row) => !topicKeySet.has(row.concept_key))]

  const nodesByKey = new Map(orderedRows.map((row) => [row.concept_key, row]))

  // Read-time decay (§2.3 "decay-adjusted on read", ADR-016): mastery is
  // discounted by retrievability at the time of reading, not just at the
  // time of the last update -- a node nobody has touched in a while reads
  // back weaker even though its stored `mastery` hasn't changed.
  const masteryNodes: MasteryNode[] = orderedRows.map((row) => ({
    conceptKey: row.concept_key,
    mastery: row.mastery * retrievability(row.stability, daysSince(row.last_practiced_at)),
    state: row.state as MasteryState,
    confidenceBand: row.confidence_band as ConfidenceBand,
    lastPracticedAt: row.last_practiced_at,
  }))

  const activeMisconceptions: ActiveMisconception[] = misconceptionRows.map((row) => ({
    conceptKey: row.concept_key,
    category: row.category,
    description: row.description ?? '',
  }))

  const dueForReview: DueForReviewItem[] = dueRows.map((row) => ({
    conceptKey: row.concept_key,
    reason: dueReason(row, nodesByKey.get(row.concept_key)),
  }))

  // The prior-work digest keys off the profile's own concept order, so the
  // callback material tracks what the rest of the read prioritizes
  // (topic-relevant first). A query error above degrades to [] here, which
  // degrades to "no priorWork on the profile" below -- the loadProfile
  // never-throws contract, leg by leg.
  const priorWork = derivePriorWork(
    priorInteractionRows,
    orderedRows.map((row) => row.concept_key)
  )

  return {
    masteryNodes,
    activeMisconceptions,
    confidenceNote: 'Based on recorded session history.',
    // Present only when something is actually due — a profile with an empty
    // queue keeps the exact pre-Sprint-11 shape (back-compat).
    ...(dueForReview.length > 0 ? { dueForReview } : {}),
    // Present only when prior ended sessions touched a currently-relevant
    // concept (Sprint 13, ADR-026) — first sessions and cold starts keep
    // the prior shape.
    ...(priorWork.length > 0 ? { priorWork } : {}),
  }
}
