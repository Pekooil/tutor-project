import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { FREE_SESSION_LIMIT } from '@/lib/tier/session-gate'

// Dashboard reads for the free-session quota + the recent-sessions list
// (Activity + Overview). RLS-scoped, server-only, and — like loadDashboard —
// never throwing: each helper degrades to an empty/safe shape so a read
// hiccup never blanks a whole page.

// The rolling free-tier window matches start_session's lazy reset and the
// reset-free-tier cron (migration 0003 / web/app/api/cron/reset-free-tier).
const FREE_PERIOD_DAYS = 30
const MS_PER_DAY = 86_400_000
const RECENT_SESSIONS_LIMIT = 50

export type SessionQuota = {
  tier: string
  isPro: boolean
  /** Monthly free allowance (FREE_SESSION_LIMIT); meaningful only when !isPro. */
  limit: number
  /** Sessions logged against the allowance this period (users.free_session_count). */
  used: number
  /** max(limit - used, 0). */
  remaining: number
  /** free_period_started_at + 30 days — when the counter next rolls over. */
  resetsAt: string | null
}

export type RecentSession = {
  id: string
  startedAt: string
  endedAt: string | null
  mode: string
  /** True when a study kit was generated from this session. */
  hasKit: boolean
  /** `/kits/${id}` when hasKit (loadStudyKit resolves by session_id first), else null. */
  kitHref: string | null
}

type SessionRow = {
  id: string
  started_at: string
  ended_at: string | null
  mode: string
}

// The caller's free-tier usage: the users.free_session_count counter against
// FREE_SESSION_LIMIT (the same number start_session enforces), not a count of
// `sessions` rows. Pro users are unlimited — `used`/`remaining` are left as the
// counter value but the UI keys on `isPro` to show "Unlimited" instead.
export async function loadSessionQuota(supabase: SupabaseClient): Promise<SessionQuota> {
  const fallback: SessionQuota = {
    tier: 'free',
    isPro: false,
    limit: FREE_SESSION_LIMIT,
    used: 0,
    remaining: FREE_SESSION_LIMIT,
    resetsAt: null,
  }
  try {
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return fallback

    const { data, error } = await supabase
      .from('users')
      .select('subscription_tier, free_session_count, free_period_started_at')
      .eq('id', user.id)
      .single()

    if (error || !data) return fallback

    const tier = (data.subscription_tier as string) ?? 'free'
    const used = (data.free_session_count as number) ?? 0
    const startedAt = (data.free_period_started_at as string | null) ?? null
    const resetsAt = startedAt
      ? new Date(new Date(startedAt).getTime() + FREE_PERIOD_DAYS * MS_PER_DAY).toISOString()
      : null

    return {
      tier,
      isPro: tier === 'pro',
      limit: FREE_SESSION_LIMIT,
      used,
      remaining: Math.max(FREE_SESSION_LIMIT - used, 0),
      resetsAt,
    }
  } catch {
    return fallback
  }
}

// The caller's most recent sessions, newest first (served by
// idx_sessions_user_started), each tagged with whether a study kit exists for
// it. `kitSessionIds` is the set of session ids that produced a kit — pass
// `new Set(kits.map((k) => k.href))` from loadStudyKits (a kit's href is its
// session id, or an artifact id for a session-less kit, which simply never
// matches a session id here).
export async function loadRecentSessions(
  supabase: SupabaseClient,
  kitSessionIds: Set<string>,
  limit = RECENT_SESSIONS_LIMIT
): Promise<RecentSession[]> {
  try {
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return []

    const { data, error } = await supabase
      .from('sessions')
      .select('id, started_at, ended_at, mode')
      .eq('user_id', user.id)
      .is('deleted_at', null)
      .order('started_at', { ascending: false })
      .limit(limit)

    if (error || !data) return []

    return (data as SessionRow[]).map((row) => {
      const hasKit = kitSessionIds.has(row.id)
      return {
        id: row.id,
        startedAt: row.started_at,
        endedAt: row.ended_at,
        mode: row.mode,
        hasKit,
        kitHref: hasKit ? `/kits/${row.id}` : null,
      }
    })
  } catch {
    return []
  }
}
