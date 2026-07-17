import { describe, expect, it, vi } from 'vitest'

// Sprint 23 / Task 8 (ADR-051): the entitlements resolver truth table + the
// require-pro re-check. resolve.ts and require-pro.ts both carry
// `import 'server-only'` (a defensive marker) — neutralized for the node test
// env the same way the other server-only suites do (predict/waitlist).
vi.mock('server-only', () => ({}))

import {
  resolveEntitlements,
  isEntitlementGranted,
  FREE_ENTITLEMENTS,
  type Entitlements,
} from '../lib/entitlements/resolve'
import { assertEntitlement } from '../lib/tier/require-pro'

const PRO_ALL_TRUE: Omit<Entitlements, 'image_capture'> = {
  voice_premium: true,
  misconception_graph: true,
  spaced_reinforcement: true,
  full_dashboard: true,
  unlimited_history: true,
}

describe('resolveEntitlements — truth table', () => {
  it('free tier → every Pro flag off, image_capture off', () => {
    expect(resolveEntitlements('free', null)).toEqual(FREE_ENTITLEMENTS)
    expect(resolveEntitlements('free', 'active')).toEqual(FREE_ENTITLEMENTS)
  })

  it('pro + active → every Pro flag on', () => {
    // The gating assertion: if the tier gate were removed/inverted this fails.
    expect(resolveEntitlements('pro', 'active')).toMatchObject(PRO_ALL_TRUE)
  })

  it('pro + trialing → Pro (trial confers Pro)', () => {
    expect(resolveEntitlements('pro', 'trialing')).toMatchObject(PRO_ALL_TRUE)
  })

  it('pro + past_due (in grace) → Pro retained', () => {
    // tier is the grace authority: the webhook/reconcile keep tier='pro' during
    // the grace window, so a past_due-but-still-pro row keeps every Pro flag.
    expect(resolveEntitlements('pro', 'past_due')).toMatchObject(PRO_ALL_TRUE)
  })

  it('free + canceled (grace expired / downgraded) → no Pro flags', () => {
    // Grace expiry / cancellation is encoded as tier='free' by the reconcile
    // cron + webhook, so this resolves to the free set.
    expect(resolveEntitlements('free', 'canceled')).toEqual(FREE_ENTITLEMENTS)
  })

  it('is null/undefined-safe (defaults to free)', () => {
    expect(resolveEntitlements(null, null)).toEqual(FREE_ENTITLEMENTS)
    expect(resolveEntitlements(undefined, undefined)).toEqual(FREE_ENTITLEMENTS)
  })
})

describe('resolveEntitlements — image_capture staged rollout', () => {
  it("defaults to 'off' for both free and pro (conservative default)", () => {
    expect(resolveEntitlements('free', 'active').image_capture).toBe('off')
    expect(resolveEntitlements('pro', 'active').image_capture).toBe('off')
  })

  it('honors a per-user override for a Pro user', () => {
    expect(resolveEntitlements('pro', 'active', { image_capture: 'beta' }).image_capture).toBe('beta')
    expect(resolveEntitlements('pro', 'active', { image_capture: 'on' }).image_capture).toBe('on')
  })

  it('honors a per-user override even for a free user (rollout tester)', () => {
    expect(resolveEntitlements('free', null, { image_capture: 'beta' }).image_capture).toBe('beta')
  })
})

describe('isEntitlementGranted', () => {
  it('boolean flags grant iff true', () => {
    expect(isEntitlementGranted(true)).toBe(true)
    expect(isEntitlementGranted(false)).toBe(false)
  })

  it("staged image_capture grants iff not 'off'", () => {
    expect(isEntitlementGranted('off')).toBe(false)
    expect(isEntitlementGranted('beta')).toBe(true)
    expect(isEntitlementGranted('on')).toBe(true)
  })
})

// A minimal RLS-scoped-client stand-in: auth.getUser() + the single own-row
// select().eq().maybeSingle() that assertEntitlement performs.
function fakeClient(opts: {
  user: { id: string } | null
  row?: { subscription_tier: string | null; subscription_status: string | null } | null
  rowError?: unknown
}) {
  return {
    auth: { getUser: async () => ({ data: { user: opts.user }, error: null }) },
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: opts.row ?? null, error: opts.rowError ?? null }),
        }),
      }),
    }),
  } as unknown as Parameters<typeof assertEntitlement>[0]
}

describe('assertEntitlement (require-pro) — re-derives from the row', () => {
  it('401s an unauthenticated caller', async () => {
    const res = await assertEntitlement(fakeClient({ user: null }), 'unlimited_history')
    expect(res?.status).toBe(401)
  })

  it('403s a FREE user even though the client might claim Pro', async () => {
    // The helper takes no client-supplied entitlement — it reads the caller's
    // own row. A free row is rejected regardless of any cached/forged client
    // hint. THIS is the guard: remove the tier re-derivation (always grant) and
    // this assertion fails.
    const res = await assertEntitlement(
      fakeClient({ user: { id: 'u1' }, row: { subscription_tier: 'free', subscription_status: 'active' } }),
      'unlimited_history'
    )
    expect(res?.status).toBe(403)
  })

  it('lets a real Pro row through (returns null)', async () => {
    const res = await assertEntitlement(
      fakeClient({ user: { id: 'u1' }, row: { subscription_tier: 'pro', subscription_status: 'active' } }),
      'full_dashboard'
    )
    expect(res).toBeNull()
  })

  it('keeps a past_due-in-grace Pro user (tier=pro) through', async () => {
    const res = await assertEntitlement(
      fakeClient({ user: { id: 'u1' }, row: { subscription_tier: 'pro', subscription_status: 'past_due' } }),
      'voice_premium'
    )
    expect(res).toBeNull()
  })

  it('fails closed (403) when the row cannot be read', async () => {
    const res = await assertEntitlement(
      fakeClient({ user: { id: 'u1' }, row: null, rowError: { message: 'db down' } }),
      'unlimited_history'
    )
    expect(res?.status).toBe(403)
  })

  it("gates image_capture on 'off' vs staged", async () => {
    // A Pro user with the default 'off' image_capture is NOT granted image_capture.
    const res = await assertEntitlement(
      fakeClient({ user: { id: 'u1' }, row: { subscription_tier: 'pro', subscription_status: 'active' } }),
      'image_capture'
    )
    expect(res?.status).toBe(403)
  })
})
