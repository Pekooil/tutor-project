import { describe, expect, it, vi } from 'vitest'

// Sprint 16 / Task 8 (ADR-036): the shared CRON_SECRET gate
// (web/lib/cron/auth.ts), exercised for real against all three cron routes.
//
// This suite deliberately does NOT spin up a real `next dev` and hit the
// routes with the true CRON_SECRET the way url-hash.test.ts hits
// /api/session/start: reset-free-tier and hard-delete-sweep are real,
// mutating routes against the LIVE "calyxa" Supabase project (hard-delete-
// sweep calls auth.admin.deleteUser) -- proving "accepts the correct
// secret" that way would mean actually running the sweep/reset against
// whatever real rows happen to qualify, not a controlled fixture. Instead,
// the routes are imported directly and `@/lib/supabase/admin` is mocked to
// a safe, inert no-op (createAdminClient's OWN behavior isn't the point of
// this file; the auth gate is) -- so a "correct secret" call proves the
// gate passed and the route completed, with no real Supabase mutation.
// (Task 8's account.test.ts is where hard-delete-sweep's real cascade
// against a controlled fixture is proven, scoped to fixture rows only.)
//
// Both web/lib/cron/auth.ts and web/lib/supabase/admin.ts are
// `import 'server-only'`; Next's bundler aliases that away (its
// `react-server` export condition), plain vitest has no such condition, so
// the real files throw on import unless mocked/neutralized. admin.ts is
// mocked outright (waitlist.test.ts's precedent for this exact guard); for
// cron/auth.ts -- the actual subject under test here, so mocking IT away
// would test nothing -- the `server-only` package itself is neutralized
// instead, which is exactly what Next's bundler already does in production.
vi.mock('server-only', () => ({}))

function chainable(result: unknown): unknown {
  return new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === 'then') {
          return (resolve: (value: unknown) => void) => resolve(result)
        }
        return () => chainable(result)
      },
    }
  )
}

const { deleteUser } = vi.hoisted(() => ({
  deleteUser: vi.fn(async () => ({ error: null })),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: () => chainable({ data: [], error: null }),
    auth: { admin: { deleteUser } },
  }),
}))

// Sprint 23 / Task 5: stripe-reconcile went stub → real, so it now constructs a
// Stripe client. Mock it to an inert stub (whose subscription list resolves
// empty) so this suite still proves only the CRON_SECRET gate + a clean run past
// it — not real Stripe I/O. The deep reconciliation logic is proven separately
// in stripe-reconcile.test.ts (Task 8). Same inert-mock philosophy as the admin
// mock above.
vi.mock('@/lib/billing/stripe', () => ({
  stripeClient: () => ({
    subscriptions: { list: async () => ({ data: [] }) },
  }),
}))

const TEST_CRON_SECRET = 'cron-auth-test-secret-do-not-use-in-prod'
process.env.CRON_SECRET = TEST_CRON_SECRET

const resetFreeTier = await import('../app/api/cron/reset-free-tier/route')
const hardDeleteSweep = await import('../app/api/cron/hard-delete-sweep/route')
const stripeReconcile = await import('../app/api/cron/stripe-reconcile/route')

const ROUTES = [
  { path: '/api/cron/reset-free-tier', handler: resetFreeTier },
  { path: '/api/cron/hard-delete-sweep', handler: hardDeleteSweep },
  { path: '/api/cron/stripe-reconcile', handler: stripeReconcile },
] as const

function requestFor(path: string, authHeader?: string) {
  const headers: Record<string, string> = {}
  if (authHeader !== undefined) headers.Authorization = authHeader
  return new Request(`http://localhost${path}`, { headers })
}

describe.each(ROUTES)('$path auth gate', ({ path, handler }) => {
  it('rejects a missing Authorization header with 401', async () => {
    const response = await handler.GET(requestFor(path))
    expect(response.status).toBe(401)
  })

  it('rejects a non-Bearer Authorization header with 401', async () => {
    const response = await handler.GET(requestFor(path, TEST_CRON_SECRET))
    expect(response.status).toBe(401)
  })

  it('rejects the wrong secret with 401', async () => {
    const response = await handler.GET(requestFor(path, 'Bearer not-the-real-secret'))
    expect(response.status).toBe(401)
  })

  it('rejects a secret that only differs in length with 401', async () => {
    const response = await handler.GET(requestFor(path, `Bearer ${TEST_CRON_SECRET}-extra`))
    expect(response.status).toBe(401)
  })

  it('accepts the correct secret (not a 401)', async () => {
    const response = await handler.GET(requestFor(path, `Bearer ${TEST_CRON_SECRET}`))
    expect(response.status).not.toBe(401)
    expect(response.status).toBeLessThan(500)
  })
})

describe('GET /api/cron/stripe-reconcile', () => {
  it('runs past the gate and reports scan/reconcile counts', async () => {
    const response = await stripeReconcile.GET(
      requestFor('/api/cron/stripe-reconcile', `Bearer ${TEST_CRON_SECRET}`)
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.ok).toBe(true)
    // The mocked admin client resolves an empty customer set, so the run
    // completes cleanly having scanned nothing — proving the gate passed and
    // the real body executes. The deep reconciliation logic (self-heal,
    // past_due grace downgrade) is proven in stripe-reconcile.test.ts (Task 8).
    expect(body.usersScanned).toBe(0)
    expect(body.reconciled).toBe(0)
    expect(Array.isArray(body.failedUsers)).toBe(true)
  })
})

describe('GET /api/cron/reset-free-tier', () => {
  it('runs past the gate and reports a reset count', async () => {
    const response = await resetFreeTier.GET(
      requestFor('/api/cron/reset-free-tier', `Bearer ${TEST_CRON_SECRET}`)
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(typeof body.resetCount).toBe('number')
  })
})

describe('GET /api/cron/hard-delete-sweep', () => {
  it('runs past the gate and reports a deleted count', async () => {
    const response = await hardDeleteSweep.GET(
      requestFor('/api/cron/hard-delete-sweep', `Bearer ${TEST_CRON_SECRET}`)
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(typeof body.deletedCount).toBe('number')
    expect(Array.isArray(body.failedIds)).toBe(true)
    // The mocked admin client's `.from()` always resolves an empty queue, so
    // this also proves the route never calls deleteUser when nothing
    // qualifies -- not just that the gate passed.
    expect(deleteUser).not.toHaveBeenCalled()
  })
})
