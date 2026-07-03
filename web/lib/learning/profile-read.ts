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

  const [nodesResult, misconceptionsResult, topicNodesResult, dueResult] = await Promise.all([
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
  ])

  const nodeRows = (nodesResult.data ?? []) as KnowledgeNodeRow[]

  if (nodesResult.error || nodeRows.length === 0) {
    return CALIBRATING_PROFILE
  }

  const misconceptionRows = (misconceptionsResult.data ?? []) as MisconceptionRow[]
  const topicNodeRows = (topicNodesResult.data ?? []) as KnowledgeNodeRow[]
  const dueRows = (dueResult.data ?? []) as DueScheduleRow[]

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

  return {
    masteryNodes,
    activeMisconceptions,
    confidenceNote: 'Based on recorded session history.',
    // Present only when something is actually due — a profile with an empty
    // queue keeps the exact pre-Sprint-11 shape (back-compat).
    ...(dueForReview.length > 0 ? { dueForReview } : {}),
  }
}
