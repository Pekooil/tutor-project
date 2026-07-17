import { beforeEach, describe, expect, it, vi } from 'vitest'

// Sprint 23 / Task 8 (ADR-050): the Stripe webhook — signature verification,
// idempotency via stripe_events, and the four event → tier/status transitions.
// The route's two collaborators are mocked: the Stripe client (constructEvent +
// subscriptions.retrieve) and the service-role admin client (the stripe_events
// upsert + the users update). This keeps the suite pure-logic — no Stripe I/O,
// no hosted Supabase — and sidesteps admin.ts / stripe.ts `server-only`.
vi.mock('server-only', () => ({}))

const { constructEvent, retrieveSub, upsertSelect, userUpdate } = vi.hoisted(() => ({
  constructEvent: vi.fn(),
  retrieveSub: vi.fn(),
  // stripe_events upsert(...).select('event_id') — resolves { data, error };
  // an empty data array is the "already processed" (duplicate) signal.
  upsertSelect: vi.fn<() => Promise<{ data: unknown[] | null; error: unknown }>>(),
  // users update(fields).eq(...) — captures the fields, resolves { error }.
  userUpdate: vi.fn<(fields: unknown) => Promise<{ error: unknown }>>(),
}))

vi.mock('@/lib/billing/stripe', () => ({
  stripeClient: () => ({
    webhooks: { constructEvent },
    subscriptions: { retrieve: retrieveSub },
  }),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      if (table === 'stripe_events') {
        return { upsert: () => ({ select: () => upsertSelect() }) }
      }
      if (table === 'users') {
        return { update: (fields: unknown) => ({ eq: () => userUpdate(fields) }) }
      }
      throw new Error(`unexpected table: ${table}`)
    },
  }),
}))

process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test'
import * as route from '../app/api/billing/webhook/route'

const NOW_SEC = Math.floor(Date.now() / 1000)

function subscription(
  status: string,
  { id = 'sub_1', customer = 'cus_1', periodEnd = NOW_SEC + 30 * 86400 } = {}
) {
  return { id, status, customer, items: { data: [{ current_period_end: periodEnd }] } }
}

function post(rawBody: string, sig: string | null = 'sig') {
  const headers: Record<string, string> = {}
  if (sig !== null) headers['stripe-signature'] = sig
  return route.POST(
    new Request('http://localhost/api/billing/webhook', { method: 'POST', headers, body: rawBody })
  )
}

beforeEach(() => {
  constructEvent.mockReset()
  retrieveSub.mockReset()
  upsertSelect.mockReset()
  userUpdate.mockReset()
  // Default: a fresh (not-yet-seen) event id + a successful user update.
  upsertSelect.mockResolvedValue({ data: [{ event_id: 'evt_1' }], error: null })
  userUpdate.mockResolvedValue({ error: null })
})

describe('POST /api/billing/webhook — signature', () => {
  it('400s a missing signature header, with no processing', async () => {
    const res = await post('raw', null)
    expect(res.status).toBe(400)
    expect(constructEvent).not.toHaveBeenCalled()
    expect(upsertSelect).not.toHaveBeenCalled()
    expect(userUpdate).not.toHaveBeenCalled()
  })

  it('400s an unverifiable signature, with NO processing (fail closed)', async () => {
    constructEvent.mockImplementation(() => {
      throw new Error('signature mismatch')
    })
    const res = await post('raw', 'badsig')
    expect(res.status).toBe(400)
    // The guard: nothing is recorded or applied on a bad signature.
    expect(upsertSelect).not.toHaveBeenCalled()
    expect(userUpdate).not.toHaveBeenCalled()
  })
})

describe('POST /api/billing/webhook — idempotency', () => {
  it('processes a fresh event once and no-ops an exact redelivery', async () => {
    constructEvent.mockReturnValue({
      id: 'evt_1',
      type: 'customer.subscription.updated',
      data: { object: subscription('active') },
    })

    // First delivery: stripe_events insert returns a row → process it.
    upsertSelect.mockResolvedValueOnce({ data: [{ event_id: 'evt_1' }], error: null })
    const first = await post('raw')
    expect(first.status).toBe(200)
    expect(userUpdate).toHaveBeenCalledTimes(1)

    // Redelivery: the insert conflicts → zero rows → already processed.
    upsertSelect.mockResolvedValueOnce({ data: [], error: null })
    const second = await post('raw')
    expect(second.status).toBe(200)
    expect(await second.json()).toMatchObject({ duplicate: true })
    // THE guard: the user row is NOT updated a second time. Remove the
    // zero-rows short-circuit and this becomes 2.
    expect(userUpdate).toHaveBeenCalledTimes(1)
  })
})

describe('POST /api/billing/webhook — event → tier/status', () => {
  it('checkout.session.completed → retrieves the sub and sets Pro', async () => {
    const pe = NOW_SEC + 20 * 86400
    constructEvent.mockReturnValue({
      id: 'evt_c',
      type: 'checkout.session.completed',
      data: { object: { subscription: 'sub_9' } },
    })
    retrieveSub.mockResolvedValue(subscription('active', { id: 'sub_9', customer: 'cus_1', periodEnd: pe }))

    const res = await post('raw')
    expect(res.status).toBe(200)
    expect(retrieveSub).toHaveBeenCalledWith('sub_9')

    const fields = userUpdate.mock.calls[0][0] as Record<string, unknown>
    expect(fields.subscription_tier).toBe('pro')
    expect(fields.subscription_status).toBe('active')
    expect(fields.stripe_subscription_id).toBe('sub_9')
    expect(fields.subscription_renews_at).toBe(new Date(pe * 1000).toISOString())
  })

  it('customer.subscription.updated (active) → Pro', async () => {
    constructEvent.mockReturnValue({
      id: 'evt_u',
      type: 'customer.subscription.updated',
      data: { object: subscription('active', { id: 'sub_2' }) },
    })
    await post('raw')
    const fields = userUpdate.mock.calls[0][0] as Record<string, unknown>
    expect(fields.subscription_tier).toBe('pro')
    expect(fields.stripe_subscription_id).toBe('sub_2')
  })

  it('invoice.payment_failed → past_due, Pro RETAINED (tier untouched)', async () => {
    constructEvent.mockReturnValue({
      id: 'evt_f',
      type: 'invoice.payment_failed',
      data: { object: { customer: 'cus_1' } },
    })
    await post('raw')
    const fields = userUpdate.mock.calls[0][0] as Record<string, unknown>
    // Only the status is written — the grace window: tier is deliberately NOT
    // downgraded here (only deleted / the reconcile cron's grace expiry does).
    expect(fields).toEqual({ subscription_status: 'past_due' })
  })

  it('customer.subscription.deleted → free, renewal cleared', async () => {
    constructEvent.mockReturnValue({
      id: 'evt_d',
      type: 'customer.subscription.deleted',
      data: { object: subscription('canceled', { id: 'sub_3' }) },
    })
    await post('raw')
    const fields = userUpdate.mock.calls[0][0] as Record<string, unknown>
    expect(fields.subscription_tier).toBe('free')
    expect(fields.subscription_status).toBe('canceled')
    expect(fields.subscription_renews_at).toBeNull()
  })

  it('an unhandled event type is recorded (idempotency) but applies nothing', async () => {
    constructEvent.mockReturnValue({ id: 'evt_x', type: 'customer.created', data: { object: {} } })
    const res = await post('raw')
    expect(res.status).toBe(200)
    expect(upsertSelect).toHaveBeenCalledTimes(1) // recorded
    expect(userUpdate).not.toHaveBeenCalled() // no billing write
  })
})
