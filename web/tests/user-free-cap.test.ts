import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

import { userOverFreeCap, FREE_SESSION_LIMIT, COMP_SUBSCRIPTION_STATUS } from '../lib/tier/session-gate'

// The USER-level free-cap gate (2026-08-04). sessionOverFreeCap re-derives the
// verdict recorded on a session row and needs a sessionId; this one answers
// "is this user out of free sessions right now?" for the paid paths that have
// no session of their own — the voice legs and study-kit generation — and for
// sessionless turns, which previously failed open and so ran uncapped.
//
// These cases pin the arithmetic to `start_session`'s (migration 0022's RPC):
// tier gate, the 30-day rolling period, the limit, and referral bonuses.

const USER_ID = '00000000-0000-4000-8000-000000000001'

type Row = {
  subscription_tier: string | null
  free_session_count: number | null
  free_period_started_at: string | null
  referral_bonus_sessions: number | null
}

/** A client whose users-row read resolves to `row` (or an error). */
function fakeClient(result: { data: Row | null; error: unknown }) {
  const maybeSingle = vi.fn(async () => result)
  const eq = vi.fn(() => ({ maybeSingle }))
  const select = vi.fn(() => ({ eq }))
  const from = vi.fn(() => ({ select }))
  return { client: { from } as unknown as SupabaseClient, from, select, eq }
}

/** A row `days` ago, ISO — the period-start clock the RPC compares against. */
function daysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString()
}

function freeRow(overrides: Partial<Row> = {}): Row {
  return {
    subscription_tier: 'free',
    free_session_count: FREE_SESSION_LIMIT,
    free_period_started_at: daysAgo(1),
    referral_bonus_sessions: 0,
    ...overrides,
  }
}

describe('userOverFreeCap', () => {
  it('caps a free user who has spent the allowance with no bonus left', async () => {
    const { client } = fakeClient({ data: freeRow(), error: null })
    expect(await userOverFreeCap(client, USER_ID)).toBe(true)
  })

  it('does not cap a free user still under the allowance', async () => {
    const { client } = fakeClient({
      data: freeRow({ free_session_count: FREE_SESSION_LIMIT - 1 }),
      error: null,
    })
    expect(await userOverFreeCap(client, USER_ID)).toBe(false)
  })

  it('never caps a Pro user, however high the stored count', async () => {
    const { client } = fakeClient({
      data: freeRow({ subscription_tier: 'pro', free_session_count: FREE_SESSION_LIMIT * 10 }),
      error: null,
    })
    expect(await userOverFreeCap(client, USER_ID)).toBe(false)
  })

  it('never caps a complimentary account (tier pro, non-Stripe status)', async () => {
    // Comp accounts are Pro by grant; the status only tells the reconcile cron
    // to leave the row alone. The tier predicate is what exempts them here.
    const { client } = fakeClient({
      data: {
        subscription_tier: 'pro',
        free_session_count: FREE_SESSION_LIMIT,
        free_period_started_at: daysAgo(1),
        referral_bonus_sessions: 0,
      },
      error: null,
    })
    expect(COMP_SUBSCRIPTION_STATUS).toBe('comp')
    expect(await userOverFreeCap(client, USER_ID)).toBe(false)
  })

  it('does not cap while referral bonus sessions remain (they are spent first)', async () => {
    const { client } = fakeClient({ data: freeRow({ referral_bonus_sessions: 2 }), error: null })
    expect(await userOverFreeCap(client, USER_ID)).toBe(false)
  })

  it('does not cap once the 30-day period has rolled over — the RPC zeroes the count next start', async () => {
    const { client } = fakeClient({ data: freeRow({ free_period_started_at: daysAgo(31) }), error: null })
    expect(await userOverFreeCap(client, USER_ID)).toBe(false)
  })

  it('still caps inside the period window (29 days is not a rollover)', async () => {
    const { client } = fakeClient({ data: freeRow({ free_period_started_at: daysAgo(29) }), error: null })
    expect(await userOverFreeCap(client, USER_ID)).toBe(true)
  })

  it('fails OPEN on a lookup error — a guard fault never refuses a paying user', async () => {
    const { client } = fakeClient({ data: null, error: { message: 'db down' } })
    expect(await userOverFreeCap(client, USER_ID)).toBe(false)
  })

  it('fails OPEN when the row is missing', async () => {
    const { client } = fakeClient({ data: null, error: null })
    expect(await userOverFreeCap(client, USER_ID)).toBe(false)
  })

  it('filters on the passed userId rather than relying on RLS to return one row', async () => {
    // Reachable with a service-role client (admin/seed-notebooks), where RLS is
    // bypassed and an unfiltered read would match every user and error.
    const { client, from, eq } = fakeClient({ data: freeRow(), error: null })
    await userOverFreeCap(client, USER_ID)
    expect(from).toHaveBeenCalledWith('users')
    expect(eq).toHaveBeenCalledWith('id', USER_ID)
  })
})
