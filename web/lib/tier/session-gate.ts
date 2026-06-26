import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js'

// Monthly free-session allowance (PLAN.md §2.8 example). Single source of
// truth, server-side only — the route never computes or transmits this; it
// is only ever read by the `start_session` RPC call below.
export const FREE_SESSION_LIMIT = 10

export type SessionMode = 'voice' | 'text'

export type StartSessionRow = {
  id: string
  started_at: string
  mode: SessionMode
  counts_against_free: boolean
  degraded: boolean
  remaining: number | null
}

export type EndSessionRow = {
  id: string
  ended_at: string | null
  interaction_count: number
}

export async function startSession(
  supabase: SupabaseClient,
  { pageDomain, mode }: { pageDomain: string | null; mode: SessionMode }
): Promise<{ data: StartSessionRow | null; error: PostgrestError | null }> {
  const { data, error } = await supabase
    .rpc('start_session', {
      p_page_domain: pageDomain,
      p_mode: mode,
      p_free_limit: FREE_SESSION_LIMIT,
    })
    .single()

  return { data: data as StartSessionRow | null, error }
}

export async function endSession(
  supabase: SupabaseClient,
  sessionId: string
): Promise<{ data: EndSessionRow[] | null; error: PostgrestError | null }> {
  const { data, error } = await supabase.rpc('end_session', { p_session_id: sessionId })

  return { data: data as EndSessionRow[] | null, error }
}
