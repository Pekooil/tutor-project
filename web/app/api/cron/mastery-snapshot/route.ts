import { NextResponse } from 'next/server'
import { retrievability } from '@calyxa/learning-model'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertCronSecret } from '@/lib/cron/auth'

// Sprint 22 / Task 5 (ADR-047, ADR-048): the daily forward-only mastery-trend
// writer. There is no mastery-history table besides `mastery_snapshot` (0020) —
// `knowledge_nodes` is current-state only — so this cron is the ONLY thing that
// makes a genuine "mastery over time" line possible, accruing one compact row
// per (user, active concept, today) from launch forward. It never backfills
// (ADR-047): it writes today's decay-adjusted mastery, today.
//
// CRON_SECRET-gated via the shared `assertCronSecret` (fails CLOSED — it holds
// the service-role admin client). Service-role because it writes across every
// user (RLS is per-user and would block a bulk cross-user write, and snapshots
// have no client write policy by design — 0020). Idempotent: the upsert keys on
// the unique (user_id, concept_key, day), so re-running the same day overwrites
// rather than duplicating — safe to re-run.
//
// Bounded: users are paged in batches; each user's active nodes upsert in one
// call. At beta scale this is trivial; the paging keeps it correct at any size.

const MS_PER_DAY = 1000 * 60 * 60 * 24

// How many users to page per query. Each page then does one bulk upsert per
// user; a page of 100 users is a handful of small round-trips.
const USER_BATCH = 100
// Safety ceiling on pages so a query bug can never spin forever (100k users).
const MAX_PAGES = 1000

function daysSince(timestamp: string | null): number {
  if (!timestamp) return 0
  return Math.max(0, (Date.now() - new Date(timestamp).getTime()) / MS_PER_DAY)
}

type NodeRow = {
  concept_key: string
  mastery: number
  stability: number
  state: string
  last_practiced_at: string | null
}

export async function GET(request: Request) {
  const authError = assertCronSecret(request)
  if (authError) return authError

  const supabase = createAdminClient()

  // The UTC calendar day every row this run is written FOR. Computed once so a
  // run that straddles midnight still writes a single consistent day.
  const day = new Date().toISOString().slice(0, 10)

  let usersProcessed = 0
  let snapshotRows = 0
  const failedUsers: string[] = []

  for (let page = 0; page < MAX_PAGES; page++) {
    const from = page * USER_BATCH
    const { data: users, error: usersError } = await supabase
      .from('users')
      .select('id')
      .is('deleted_at', null)
      .order('id', { ascending: true })
      .range(from, from + USER_BATCH - 1)

    if (usersError) {
      console.error('cron/mastery-snapshot: user page query failed', page, usersError)
      return NextResponse.json({ error: 'Snapshot query failed' }, { status: 500 })
    }

    const batch = users ?? []

    for (const user of batch) {
      // Active concepts = knowledge_nodes the user has actually observed
      // (observation_count > 0). Unseen/never-practiced nodes carry no mastery
      // signal (mastery stays at the default), so snapshotting them would only
      // bloat the trend with flat zero lines — the trend tracks what is being
      // learned.
      const { data: nodes, error: nodesError } = await supabase
        .from('knowledge_nodes')
        .select('concept_key, mastery, stability, state, last_practiced_at')
        .eq('user_id', user.id)
        .is('deleted_at', null)
        .gt('observation_count', 0)

      if (nodesError) {
        console.error('cron/mastery-snapshot: node read failed', user.id, nodesError)
        failedUsers.push(user.id)
        continue
      }

      usersProcessed++

      const nodeRows = (nodes ?? []) as NodeRow[]
      if (nodeRows.length === 0) continue

      const rows = nodeRows.map((node) => ({
        user_id: user.id,
        concept_key: node.concept_key,
        day,
        // Read-time decay — the exact math loadProfile/loadDashboard use — so
        // the snapshot equals the mastery shown that day, frozen for the trend.
        mastery: node.mastery * retrievability(node.stability, daysSince(node.last_practiced_at)),
        state: node.state,
      }))

      const { error: upsertError } = await supabase
        .from('mastery_snapshot')
        .upsert(rows, { onConflict: 'user_id,concept_key,day' })

      if (upsertError) {
        console.error('cron/mastery-snapshot: upsert failed', user.id, upsertError)
        failedUsers.push(user.id)
        continue
      }

      snapshotRows += rows.length
    }

    // A short (or empty) page means we've reached the end of the user table.
    if (batch.length < USER_BATCH) break
  }

  return NextResponse.json({
    ok: failedUsers.length === 0,
    day,
    usersProcessed,
    snapshotRows,
    failedUsers,
  })
}
