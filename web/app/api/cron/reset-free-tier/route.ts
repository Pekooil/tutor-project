import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertCronSecret } from '@/lib/cron/auth'

// Sprint 16 / Task 6 (ADR-036): the safety net over `start_session`'s lazy
// 30-day reset (migration 0003) — that RPC only resets a user's free period
// when THEY start a session, so a dormant account's count never clears on
// its own. This cron normalizes any account whose period is >= 30 days old
// regardless of activity. Service-role admin client (bulk cross-user
// write; RLS is per-user and would block this). Idempotent (set-to-0),
// safe to re-run same day.
const FREE_PERIOD_DAYS = 30

export async function GET(request: Request) {
  const authError = assertCronSecret(request)
  if (authError) return authError

  const cutoff = new Date(Date.now() - FREE_PERIOD_DAYS * 24 * 60 * 60 * 1000).toISOString()
  const supabase = createAdminClient()

  const { data, error } = await supabase
    .from('users')
    .update({ free_session_count: 0, free_period_started_at: new Date().toISOString() })
    .lt('free_period_started_at', cutoff)
    .select('id')

  if (error) {
    console.error('cron/reset-free-tier: update failed', error)
    return NextResponse.json({ error: 'Reset failed' }, { status: 500 })
  }

  return NextResponse.json({ ok: true, resetCount: data?.length ?? 0 })
}
