import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { SOFT_CAP_CENTS, HARD_CAP_CENTS } from './cost-model'

// Sprint 16 / Task 3 (ADR-041): the thin wrapper around the `cost_guard` RPC
// (migration 0013) — mirrors session-gate.ts's startSession/endSession shape
// (a small function taking the request-scoped `supabase` client + call
// params, returning a plain result). Callers pass only `estimatedCents`
// (from cost-model.ts's estimateCost()); the cap thresholds are read here,
// not threaded through every call site, so cost-model.ts stays the one
// place that changes when a cap is retuned.

export type CostGuardResult = {
  softExceeded: boolean
  hardExceeded: boolean
}

// Fails OPEN, not closed: an RPC error here is a cost-tracking-layer
// problem, not evidence the budget is actually blown, and this guard must
// never be the reason a paid route 500s or wrongly refuses a turn. Every
// source of "should this call proceed" in this codebase degrades to the
// permissive/silent case on its own failure (ADR-030's opening scan,
// ADR-034's status pins) — this is the same discipline applied to spend
// tracking. Logged server-side so a persistently-failing guard is still
// visible in the logs, never silently invisible.
export async function costGuard(
  supabase: SupabaseClient,
  estimatedCents: number
): Promise<CostGuardResult> {
  const { data, error } = await supabase
    .rpc('cost_guard', {
      p_estimated_cents: estimatedCents,
      p_soft_cap_cents: SOFT_CAP_CENTS,
      p_hard_cap_cents: HARD_CAP_CENTS,
    })
    .single()

  if (error || !data) {
    console.error('cost-guard: cost_guard RPC failed, proceeding as under-cap', error)
    return { softExceeded: false, hardExceeded: false }
  }

  const row = data as { soft_exceeded: boolean; hard_exceeded: boolean }
  return { softExceeded: row.soft_exceeded, hardExceeded: row.hard_exceeded }
}
