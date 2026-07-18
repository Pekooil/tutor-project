import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { VOICE_CREDIT_CAP_CENTS } from './cost-model'

// Public launch (2026-07-18): thin wrapper around the `voice_credit_guard`
// RPC (migration 0023) — cost-guard.ts's exact shape. Callers pass only the
// estimate (from cost-model.ts's estimateCost()); the cap is read here, not
// threaded through call sites, so cost-model.ts stays the one retune point.
// The RPC itself no-ops for non-'free' tiers, so routes call this
// unconditionally without a tier read of their own.

export type VoiceCreditResult = {
  exceeded: boolean
}

// Fails OPEN, not closed — the same contract as costGuard and every other
// "should this call proceed" source in this codebase: an RPC error is a
// guard-layer problem, not evidence the budget is blown, and it must never be
// the reason a voice leg 500s. Logged so a persistently-failing guard stays
// visible.
export async function voiceCreditGuard(
  supabase: SupabaseClient,
  estimatedCents: number
): Promise<VoiceCreditResult> {
  const { data, error } = await supabase
    .rpc('voice_credit_guard', {
      p_estimated_cents: estimatedCents,
      p_cap_cents: VOICE_CREDIT_CAP_CENTS,
    })
    .single()

  if (error || !data) {
    console.error('voice-credit: voice_credit_guard RPC failed, proceeding as under-cap', error)
    return { exceeded: false }
  }

  return { exceeded: (data as { exceeded: boolean }).exceeded }
}
