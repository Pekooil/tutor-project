import { beforeEach, describe, expect, it, vi } from 'vitest'

// Sprint 23 / Task 8 (ADR-050): the reconcile cron — the dropped-webhook safety
// net. CRON_SECRET-gated; pulls live Stripe state for every billing-engaged user
// and heals drift (a dropped checkout self-heals to Pro, a dropped delete
// self-heals to free); owns the past_due grace-window downgrade. The Stripe
// client (subscriptions.list) and the service-role admin client (the user page
// query + the update) are mocked — pure logic, no Stripe I/O, no hosted Supabase.
vi.mock('server-only', () => ({}))

const { state } = vi.hoisted(() => ({
  state: {
    users: [] as Array<Record<string, unknown>>,
    listData: [] as Array<Record<string, unknown>>,
    updates: [] as Array<{ id: unknown; fields: Record<string, unknown> }>,
    listCalls: 0,
  },
}))

vi.mock('@/lib/billing/stripe', () => ({
  stripeClient: () => ({
    subscriptions: {
      list: async () => {
        state.listCalls++
        return { data: state.listData }
      },
    },
  }),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: () => {
      let served = false
      return {
        select: () => {
          // `neq` is applied for real, not stubbed to a pass-through: the route
          // uses it to EXCLUDE complimentary accounts (subscription_status =
          // 'comp'), whose tier is a grant rather than a Stripe fact. A no-op
          // mock would let that filter rot silently and still show green.
          const excluded: Array<{ col: string; value: unknown }> = []
          const builder: Record<string, unknown> = {
            not: () => builder,
            is: () => builder,
            neq: (col: string, value: unknown) => {
              excluded.push({ col, value })
              return builder
            },
            order: () => builder,
            range: async () => {
              const rows = state.users.filter(
                (u) => !excluded.some(({ col, value }) => (u as Record<string, unknown>)[col] === value)
              )
              const data = served ? [] : rows
              served = true
              return { data, error: null }
            },
          }
          return builder
        },
        update: (fields: Record<string, unknown>) => ({
          eq: async (_col: string, id: unknown) => {
            state.updates.push({ id, fields })
            return { error: null }
          },
        }),
      }
    },
  }),
}))

const SECRET = 'reconcile-test-secret'
process.env.CRON_SECRET = SECRET
import * as route from '../app/api/cron/stripe-reconcile/route'

const NOW_SEC = Math.floor(Date.now() / 1000)

function subscription(
  status: string,
  { id = 'sub_1', customer = 'cus_1', daysFromNow = 30 } = {}
) {
  return {
    id,
    status,
    customer,
    items: { data: [{ current_period_end: NOW_SEC + daysFromNow * 86400 }] },
  }
}

function iso(daysFromNow: number): string {
  return new Date((NOW_SEC + daysFromNow * 86400) * 1000).toISOString()
}

function get(authHeader?: string) {
  const headers: Record<string, string> = {}
  if (authHeader) headers.Authorization = authHeader
  return route.GET(new Request('http://localhost/api/cron/stripe-reconcile', { headers }))
}

beforeEach(() => {
  state.users = []
  state.listData = []
  state.updates = []
  state.listCalls = 0
})

describe('GET /api/cron/stripe-reconcile — auth gate', () => {
  it('401s a missing secret, touching neither Stripe nor the DB', async () => {
    const res = await get()
    expect(res.status).toBe(401)
    expect(state.listCalls).toBe(0)
    expect(state.updates).toHaveLength(0)
  })

  it('401s a wrong secret', async () => {
    const res = await get('Bearer not-the-secret')
    expect(res.status).toBe(401)
    expect(state.listCalls).toBe(0)
  })
})

describe('GET /api/cron/stripe-reconcile — self-heal', () => {
  it('heals a dropped checkout: free row + active Stripe sub → Pro', async () => {
    state.users = [
      {
        id: 'u1',
        stripe_customer_id: 'cus_1',
        stripe_subscription_id: null,
        subscription_tier: 'free',
        subscription_status: null,
        subscription_renews_at: null,
      },
    ]
    state.listData = [subscription('active', { id: 'sub_1', customer: 'cus_1', daysFromNow: 30 })]

    const res = await get(`Bearer ${SECRET}`)
    expect(res.status).toBe(200)
    expect(state.updates).toHaveLength(1)
    expect(state.updates[0].id).toBe('u1')
    expect(state.updates[0].fields.subscription_tier).toBe('pro')
    expect(state.updates[0].fields.stripe_subscription_id).toBe('sub_1')
  })

  it('heals a dropped delete: pro row + canceled Stripe sub → free, renewal cleared', async () => {
    state.users = [
      {
        id: 'u5',
        stripe_customer_id: 'cus_5',
        stripe_subscription_id: 'sub_5',
        subscription_tier: 'pro',
        subscription_status: 'active',
        subscription_renews_at: iso(30),
      },
    ]
    state.listData = [subscription('canceled', { id: 'sub_5', customer: 'cus_5', daysFromNow: -1 })]

    await get(`Bearer ${SECRET}`)
    expect(state.updates[0].fields.subscription_tier).toBe('free')
    expect(state.updates[0].fields.subscription_renews_at).toBeNull()
  })

  it('is idempotent: an already-in-sync row is not written', async () => {
    const sub = subscription('active', { id: 'sub_4', customer: 'cus_4', daysFromNow: 30 })
    state.users = [
      {
        id: 'u4',
        stripe_customer_id: 'cus_4',
        stripe_subscription_id: 'sub_4',
        subscription_tier: 'pro',
        subscription_status: 'active',
        subscription_renews_at: new Date(sub.items.data[0].current_period_end * 1000).toISOString(),
      },
    ]
    state.listData = [sub]

    await get(`Bearer ${SECRET}`)
    expect(state.updates).toHaveLength(0)
  })
})

describe('GET /api/cron/stripe-reconcile — past_due grace window', () => {
  it('KEEPS Pro for a past_due sub still within the 14-day grace window', async () => {
    state.users = [
      {
        id: 'u3',
        stripe_customer_id: 'cus_3',
        stripe_subscription_id: 'sub_3',
        // Stale free row (e.g. a mistaken earlier state) — the reconcile should
        // restore Pro because the sub is past_due but only 5 days past due.
        subscription_tier: 'free',
        subscription_status: 'canceled',
        subscription_renews_at: null,
      },
    ]
    state.listData = [subscription('past_due', { id: 'sub_3', customer: 'cus_3', daysFromNow: -5 })]

    await get(`Bearer ${SECRET}`)
    expect(state.updates[0].fields.subscription_tier).toBe('pro')
  })

  it('DOWNGRADES a past_due sub past the grace window to free', async () => {
    state.users = [
      {
        id: 'u2',
        stripe_customer_id: 'cus_2',
        stripe_subscription_id: 'sub_2',
        subscription_tier: 'pro',
        subscription_status: 'past_due',
        subscription_renews_at: iso(-20),
      },
    ]
    // past_due, 20 days past due (> 14-day grace) → downgrade.
    state.listData = [subscription('past_due', { id: 'sub_2', customer: 'cus_2', daysFromNow: -20 })]

    await get(`Bearer ${SECRET}`)
    // THE guard: remove the grace-expiry check and this stays 'pro'.
    expect(state.updates[0].fields.subscription_tier).toBe('free')
  })
})

describe('GET /api/cron/stripe-reconcile — complimentary accounts', () => {
  it('never touches a comp account, even with no live Stripe subscription', async () => {
    // Comp accounts (owner/test grants) are Pro because someone GRANTED it, not
    // because Stripe says so. They can still carry a stripe_customer_id from an
    // earlier checkout, and reconcileFields maps "no live subscription" to free
    // — so without the `neq('subscription_status', 'comp')` filter this nightly
    // cron would silently revoke the grant within a day.
    state.users = [
      {
        id: 'u_comp',
        stripe_customer_id: 'cus_comp',
        stripe_subscription_id: 'sub_comp',
        subscription_tier: 'pro',
        subscription_status: 'comp',
        subscription_renews_at: null,
      },
    ]
    // Stripe's view: the only subscription is canceled — exactly what would
    // otherwise force a downgrade.
    state.listData = [subscription('canceled', { id: 'sub_comp', customer: 'cus_comp', daysFromNow: -30 })]

    await get(`Bearer ${SECRET}`)

    // THE guard: drop the comp filter and this row gets written back to 'free'.
    expect(state.updates).toHaveLength(0)
  })

  it('still reconciles ordinary accounts alongside a comp one', async () => {
    state.users = [
      {
        id: 'u_comp',
        stripe_customer_id: 'cus_comp',
        stripe_subscription_id: 'sub_comp',
        subscription_tier: 'pro',
        subscription_status: 'comp',
        subscription_renews_at: null,
      },
      {
        id: 'u_real',
        stripe_customer_id: 'cus_real',
        stripe_subscription_id: 'sub_real',
        subscription_tier: 'pro',
        subscription_status: 'active',
        subscription_renews_at: iso(30),
      },
    ]
    state.listData = [subscription('canceled', { id: 'sub_real', customer: 'cus_real', daysFromNow: -5 })]

    await get(`Bearer ${SECRET}`)

    // The comp row is skipped; the real cancellation is still enforced.
    expect(state.updates).toHaveLength(1)
    expect(state.updates[0].id).toBe('u_real')
    expect(state.updates[0].fields.subscription_tier).toBe('free')
  })
})
