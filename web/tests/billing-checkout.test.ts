import { beforeEach, describe, expect, it, vi } from 'vitest'

// Sprint 23 / Task 8 (ADR-050): Stripe Checkout — the Customer is created/reused
// keyed on users.stripe_customer_id, the checkout session URL is returned, and
// the whole flow is RLS-scoped to the caller (a user can never checkout for
// another). The `stripe` npm package is mocked (a fake Stripe class) so the REAL
// lib/billing/stripe.ts logic (ensureStripeCustomer's reuse/create keying) is
// exercised without network; `@/lib/auth/bearer` is mocked to control the caller.
vi.mock('server-only', () => ({}))

const { customerCreate, checkoutCreate, auth } = vi.hoisted(() => ({
  customerCreate: vi.fn<(args: unknown) => Promise<{ id: string }>>(),
  checkoutCreate: vi.fn<(args: unknown) => Promise<{ url: string | null }>>(),
  auth: { current: null as unknown },
}))

vi.mock('stripe', () => ({
  default: class MockStripe {
    customers = { create: customerCreate }
    checkout = { sessions: { create: checkoutCreate } }
  },
}))

vi.mock('@/lib/auth/bearer', () => ({
  clientFromBearerOrCookie: async () => auth.current,
}))

process.env.STRIPE_SECRET_KEY = 'sk_test_dummy'
process.env.STRIPE_PRICE_ID = 'price_test'
process.env.NEXT_PUBLIC_SITE_URL = 'http://localhost:3000'

import * as checkoutRoute from '../app/api/billing/checkout/route'
import { ensureStripeCustomer } from '../lib/billing/stripe'

// An RLS-scoped users client: records every .eq(col, val) so a test can prove
// the read/write is scoped to the caller's own id, and captures the update.
function fakeSupabase(opts: {
  existingCustomerId?: string | null
  email?: string | null
  updateError?: unknown
}) {
  const eqCalls: Array<{ op: string; col: string; val: unknown; fields?: unknown }> = []
  const updates: Array<{ fields: unknown; id: unknown }> = []
  const client = {
    eqCalls,
    updates,
    from: () => ({
      select: () => ({
        eq: (col: string, val: unknown) => {
          eqCalls.push({ op: 'select', col, val })
          return {
            maybeSingle: async () => ({
              data: { stripe_customer_id: opts.existingCustomerId ?? null, email: opts.email ?? null },
              error: null,
            }),
          }
        },
      }),
      update: (fields: unknown) => ({
        eq: async (col: string, val: unknown) => {
          eqCalls.push({ op: 'update', col, val, fields })
          updates.push({ fields, id: val })
          return { error: opts.updateError ?? null }
        },
      }),
    }),
  }
  return client
}

function post(body: unknown = {}) {
  return checkoutRoute.POST(
    new Request('http://localhost/api/billing/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  )
}

beforeEach(() => {
  customerCreate.mockReset()
  checkoutCreate.mockReset()
  customerCreate.mockResolvedValue({ id: 'cus_new' })
  checkoutCreate.mockResolvedValue({ url: 'https://checkout.stripe.test/session' })
  auth.current = null
})

describe('ensureStripeCustomer — keyed on stripe_customer_id', () => {
  it('reuses an existing Customer (no Stripe create)', async () => {
    const sb = fakeSupabase({ existingCustomerId: 'cus_existing' })
    const result = await ensureStripeCustomer(sb as never, { id: 'u1', email: 'a@b.com' })

    expect(result).toEqual({ customerId: 'cus_existing' })
    expect(customerCreate).not.toHaveBeenCalled()
    // RLS-scoped: the lookup is against the caller's own id.
    expect(sb.eqCalls.every((c) => c.col === 'id' && c.val === 'u1')).toBe(true)
  })

  it('creates a Customer (metadata.supabase_user_id) and stores the id back', async () => {
    const sb = fakeSupabase({ existingCustomerId: null, email: 'a@b.com' })
    const result = await ensureStripeCustomer(sb as never, { id: 'u1', email: 'a@b.com' })

    expect(result).toEqual({ customerId: 'cus_new' })
    expect(customerCreate).toHaveBeenCalledWith({
      email: 'a@b.com',
      metadata: { supabase_user_id: 'u1' },
    })
    // The new id is persisted back onto the caller's own row.
    expect(sb.updates).toHaveLength(1)
    expect(sb.updates[0]).toMatchObject({ fields: { stripe_customer_id: 'cus_new' }, id: 'u1' })
  })
})

describe('POST /api/billing/checkout', () => {
  it('401s when not signed in', async () => {
    auth.current = { error: 401 }
    const res = await post()
    expect(res.status).toBe(401)
    expect(checkoutCreate).not.toHaveBeenCalled()
  })

  it('returns the Stripe-hosted session URL for the authed caller', async () => {
    const sb = fakeSupabase({ existingCustomerId: 'cus_x' })
    auth.current = { supabase: sb, user: { id: 'u1', email: 'a@b.com' } }

    const res = await post()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ url: 'https://checkout.stripe.test/session' })
    expect(checkoutCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'subscription',
        customer: 'cus_x',
        line_items: [{ price: 'price_test', quantity: 1 }],
      })
    )
  })

  it('is RLS-scoped: a spoofed body userId cannot checkout for another user', async () => {
    // The route derives the Customer purely from the authed caller's own row —
    // it never reads a user id from the request body. A spoofed body is ignored:
    // the session is created for the caller's Customer (cus_x), not the body's.
    const sb = fakeSupabase({ existingCustomerId: 'cus_x' })
    auth.current = { supabase: sb, user: { id: 'u1', email: 'a@b.com' } }

    await post({ userId: 'victim-user', customerId: 'cus_victim' })

    expect(checkoutCreate).toHaveBeenCalledWith(expect.objectContaining({ customer: 'cus_x' }))
    expect(sb.eqCalls.every((c) => c.val === 'u1')).toBe(true)
  })
})
