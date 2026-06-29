import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { retrievability } from '@calyxa/learning-model'
import type {
  ActiveMisconception,
  ConfidenceBand,
  LearningProfile,
  MasteryNode,
  MasteryState,
} from '@/lib/ai/profile'

const MS_PER_DAY = 1000 * 60 * 60 * 24

function daysSince(timestamp: string | null): number {
  if (!timestamp) return 0
  return Math.max(0, (Date.now() - new Date(timestamp).getTime()) / MS_PER_DAY)
}

// PLAN.md §2.3 query 1, simplified for this sprint (ADR-014): the caller's
// weakest knowledge_nodes plus their active misconceptions, with no
// page-relevant join / topic bias (that join is deferred — ADR-014). RLS
// already scopes every row to auth.uid(); the explicit eq('user_id', ...)
// below is defense-in-depth, not the only guard. LIMIT_NODES mirrors the
// §2.5 budget (MAX_MASTERY_NODES, already enforced by renderProfileSummary
// in system-prompt.ts) — top-K weakest/relevant, K≈12.
const LIMIT_NODES = 12

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

// Replaces HARDCODED_PROFILE (ADR-009/ADR-014) as the source of the
// LearningProfile the AI turn route injects into the prompt. Never throws —
// any query failure degrades to the calibrating empty profile rather than
// failing the turn, the same discipline /api/ai/turn already applies to a
// malformed pageContext (ADR-013).
export async function loadProfile(supabase: SupabaseClient): Promise<LearningProfile> {
  const { data: userData, error: userError } = await supabase.auth.getUser()
  const userId = userData?.user?.id

  if (userError || !userId) {
    return CALIBRATING_PROFILE
  }

  const [nodesResult, misconceptionsResult] = await Promise.all([
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
  ])

  const nodeRows = (nodesResult.data ?? []) as KnowledgeNodeRow[]

  if (nodesResult.error || nodeRows.length === 0) {
    return CALIBRATING_PROFILE
  }

  const misconceptionRows = (misconceptionsResult.data ?? []) as MisconceptionRow[]

  // Read-time decay (§2.3 "decay-adjusted on read", ADR-016): mastery is
  // discounted by retrievability at the time of reading, not just at the
  // time of the last update -- a node nobody has touched in a while reads
  // back weaker even though its stored `mastery` hasn't changed.
  const masteryNodes: MasteryNode[] = nodeRows.map((row) => ({
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

  return {
    masteryNodes,
    activeMisconceptions,
    confidenceNote: 'Based on recorded session history.',
  }
}
