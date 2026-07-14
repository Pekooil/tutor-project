import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { retrievability } from '@calyxa/learning-model'

// vitest doesn't auto-load .env.local the way `next dev`/`next build` do
// (rls.test.ts / account.test.ts convention).
function loadEnvLocal() {
  const path = resolve(process.cwd(), '.env.local')
  if (!existsSync(path)) return
  for (const line of readFileSync(path, 'utf-8').split('\n')) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/)
    if (match && !(match[1] in process.env)) {
      process.env[match[1]] = match[2]
    }
  }
}

loadEnvLocal()

// Sprint 22 Task 8 (ADR-047/ADR-048). Both the cron route and the export route
// sit behind `import 'server-only'` (web/lib/cron/auth.ts, web/lib/supabase/
// admin.ts); Next's bundler aliases that away, plain vitest does not, so it is
// neutralized here — the same as account.test.ts / cron-auth.test.ts.
vi.mock('server-only', () => ({}))

const TEST_CRON_SECRET = 'mastery-snapshot-test-cron-secret-do-not-use-in-prod'
process.env.CRON_SECRET = TEST_CRON_SECRET

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

// The one real service-role client, used for fixture setup/teardown/assertions
// AND (scoped) as the cron's admin client below.
const admin = createClient(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } })

// The cron pages EVERY non-deleted user (`from('users')`) and snapshots them —
// running it unscoped against the live "calyxa" project would write a real
// mastery_snapshot row for every real user. So `@/lib/supabase/admin` is mocked
// exactly as account.test.ts mocks it for hard-delete-sweep: a client that is
// real in every respect EXCEPT the "which users" query, which is hard-scoped by
// an injected `.in('id', ...)` to this file's own two fixtures (set in beforeAll
// once their ids exist). Every other table (`knowledge_nodes`, the
// `mastery_snapshot` upsert, the export's `telemetry_event`) passes through to
// the real service-role builder, so the actual upsert/idempotency/decay logic
// runs for real — it just can never reach a user outside this file's scope.
const usersScopedIds = vi.hoisted(() => ({ current: [] as string[] }))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    auth: admin.auth,
    from(table: string) {
      const real = admin.from(table)
      if (table !== 'users') return real
      return {
        // The cron's users query: .select('id').is(...).order(...).range(...).
        // The injected `.in('id', scoped)` narrows it to the fixtures;
        // everything chained after is the real, unmocked filter builder.
        select: (columns: string) => real.select(columns).in('id', usersScopedIds.current),
      }
    },
  }),
}))

const cronRoute = await import('../app/api/cron/mastery-snapshot/route')
const exportRoute = await import('../app/api/account/export/route')

const PASSWORD = 'mastery-snapshot-test-' + Math.random().toString(36).slice(2)

function testEmail(label: string) {
  return `darcy20080911+calyxamastsnap${label}${Date.now()}@gmail.com`
}

function daysAgoIso(days: number) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()
}

const TODAY = new Date().toISOString().slice(0, 10)

const ALGEBRA_KEY = 'algebra.linear-equations.one-variable'
const CALCULUS_KEY = 'calculus.limits.formal'
const GEOMETRY_KEY = 'geometry.angles.parallel-lines' // userA's UNOBSERVED node

// userA's observed nodes (observation_count > 0) — the two that must be
// snapshotted; kept here so the decay assertion can recompute the expected
// read-time mastery from the same inputs the cron reads.
const OBSERVED_A = [
  { concept_key: ALGEBRA_KEY, mastery: 0.7, stability: 5, state: 'weak', observation_count: 8, last_practiced_at: daysAgoIso(4) },
  { concept_key: CALCULUS_KEY, mastery: 0.3, stability: 2, state: 'learning', observation_count: 3, last_practiced_at: daysAgoIso(1) },
] as const

type Fixture = { id: string; client: SupabaseClient; token: string }

async function makeFixture(label: string): Promise<Fixture> {
  const email = testEmail(label)
  const { data, error } = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true })
  if (error || !data.user) throw new Error(`fixture setup failed for ${label}: ${error?.message}`)

  const client = createClient(url, anonKey)
  const { data: signIn, error: signInErr } = await client.auth.signInWithPassword({ email, password: PASSWORD })
  if (signInErr || !signIn.session) throw new Error(`sign-in failed for ${label}: ${signInErr?.message}`)

  return { id: data.user.id, client, token: signIn.session.access_token }
}

function cronRequest(authHeader?: string) {
  const headers: Record<string, string> = {}
  if (authHeader !== undefined) headers.Authorization = authHeader
  return new Request('http://localhost/api/cron/mastery-snapshot', { headers })
}

function exportRequest(token: string) {
  return new Request('http://localhost/api/account/export', { headers: { Authorization: `Bearer ${token}` } })
}

let userA: Fixture
let userB: Fixture // FK-cascade fixture
let firstRun: { ok: boolean; day: string; usersProcessed: number; snapshotRows: number; failedUsers: string[] }

async function snapshotRowsFor(userId: string) {
  const { data, error } = await admin
    .from('mastery_snapshot')
    .select('concept_key, day, mastery, state')
    .eq('user_id', userId)
  if (error) throw new Error(`snapshot read failed: ${error.message}`)
  return data ?? []
}

beforeAll(async () => {
  const [a, b] = await Promise.all([makeFixture('a'), makeFixture('b')])
  userA = a
  userB = b
  usersScopedIds.current = [userA.id, userB.id]

  // userA: two observed nodes (snapshotted) + one unobserved node (skipped).
  // Uniform column set across the batch — a bulk insert with heterogeneous keys
  // NULLs a row's missing columns instead of applying their (NOT NULL) defaults.
  const { error: aErr } = await admin.from('knowledge_nodes').insert([
    ...OBSERVED_A.map((n) => ({ user_id: userA.id, confidence_band: 'medium', ...n })),
    {
      user_id: userA.id,
      concept_key: GEOMETRY_KEY,
      mastery: 0.0,
      stability: 1,
      state: 'unseen',
      confidence_band: 'low',
      observation_count: 0,
      last_practiced_at: null,
    },
  ])
  if (aErr) throw new Error(`seed knowledge_nodes A failed: ${aErr.message}`)

  // userB: one observed node — enough to prove the FK cascade removes it.
  const { error: bErr } = await admin
    .from('knowledge_nodes')
    .insert({ user_id: userB.id, concept_key: ALGEBRA_KEY, mastery: 0.5, stability: 3, observation_count: 5, state: 'weak', last_practiced_at: daysAgoIso(2) })
  if (bErr) throw new Error(`seed knowledge_nodes B failed: ${bErr.message}`)

  // The canonical snapshot run (correct secret). Idempotency + gate tests re-run
  // it below; assertions read the resulting rows.
  const response = await cronRoute.GET(cronRequest(`Bearer ${TEST_CRON_SECRET}`))
  firstRun = await response.json()
}, 30000)

afterAll(async () => {
  for (const user of [userA, userB]) {
    if (!user) continue
    await admin.from('mastery_snapshot').delete().eq('user_id', user.id)
    await admin.from('knowledge_nodes').delete().eq('user_id', user.id)
    await admin.from('users').delete().eq('id', user.id)
    await admin.auth.admin.deleteUser(user.id).catch(() => {})
  }
}, 30000)

describe('CRON_SECRET gate', () => {
  it('rejects a missing Authorization header with 401', async () => {
    expect((await cronRoute.GET(cronRequest())).status).toBe(401)
  })

  it('rejects a non-Bearer Authorization header with 401', async () => {
    expect((await cronRoute.GET(cronRequest(TEST_CRON_SECRET))).status).toBe(401)
  })

  it('rejects the wrong secret with 401', async () => {
    expect((await cronRoute.GET(cronRequest('Bearer not-the-real-secret'))).status).toBe(401)
  })

  it('rejects a secret that only differs in length with 401', async () => {
    expect((await cronRoute.GET(cronRequest(`Bearer ${TEST_CRON_SECRET}-extra`))).status).toBe(401)
  })

  it('accepts the correct secret and reports a run summary', async () => {
    // firstRun was the canonical run in beforeAll; assert its shape here.
    expect(firstRun.ok).toBe(true)
    expect(firstRun.day).toBe(TODAY)
    expect(firstRun.usersProcessed).toBeGreaterThanOrEqual(2)
    expect(firstRun.snapshotRows).toBeGreaterThanOrEqual(3) // 2 for A + 1 for B
    expect(firstRun.failedUsers).toEqual([])
  })
})

describe('mastery_snapshot writes', () => {
  it("writes one row per (user, active concept, today), skipping unobserved nodes", async () => {
    const rows = await snapshotRowsFor(userA.id)
    // Exactly the two OBSERVED concepts — the observation_count=0 geometry node
    // is skipped (no mastery signal to trend).
    expect(rows.map((r) => r.concept_key).sort()).toEqual([ALGEBRA_KEY, CALCULUS_KEY].sort())
    expect(rows.some((r) => r.concept_key === GEOMETRY_KEY)).toBe(false)
    for (const row of rows) {
      expect(row.day).toBe(TODAY)
      expect(row.state).toBeDefined()
    }
  })

  it('stores the decay-adjusted mastery (mastery * retrievability), not the raw value', async () => {
    const rows = await snapshotRowsFor(userA.id)
    const algebra = rows.find((r) => r.concept_key === ALGEBRA_KEY)!
    const stored = OBSERVED_A[0]
    const days = (Date.now() - new Date(stored.last_practiced_at).getTime()) / (24 * 60 * 60 * 1000)
    const expected = stored.mastery * retrievability(stored.stability, days)
    expect(algebra.mastery).toBeCloseTo(expected, 4)
    expect(algebra.mastery).toBeLessThan(stored.mastery)
  })

  it('is idempotent: re-running the same day overwrites, never duplicates', async () => {
    const response = await cronRoute.GET(cronRequest(`Bearer ${TEST_CRON_SECRET}`))
    expect(response.status).toBe(200)

    // Still exactly two rows for userA — the unique (user_id, concept_key, day)
    // key made the second run an upsert, not an insert.
    const rows = await snapshotRowsFor(userA.id)
    expect(rows).toHaveLength(2)
  })
})

describe('GDPR export coverage', () => {
  it("includes the caller's own snapshots, scoped to them", async () => {
    const response = await exportRoute.GET(exportRequest(userA.token))
    expect(response.status).toBe(200)
    const body = await response.json()

    expect(Array.isArray(body.mastery_snapshot)).toBe(true)
    expect(body.mastery_snapshot).toHaveLength(2)
    for (const row of body.mastery_snapshot) {
      expect(row.user_id).toBe(userA.id)
    }
    expect(body.mastery_snapshot.map((r: { concept_key: string }) => r.concept_key).sort()).toEqual(
      [ALGEBRA_KEY, CALCULUS_KEY].sort()
    )
  })
})

describe('erasure (FK cascade)', () => {
  it('removes a user’s snapshots when the user row is deleted (on delete cascade)', async () => {
    // Precondition: userB has a snapshot from the canonical run.
    expect((await snapshotRowsFor(userB.id)).length).toBeGreaterThanOrEqual(1)

    // Deleting the parent users row cascades to mastery_snapshot (migration 0020,
    // FK on delete cascade) — the same path Sprint 16's hard-delete-sweep drives.
    await admin.from('knowledge_nodes').delete().eq('user_id', userB.id)
    const { error } = await admin.from('users').delete().eq('id', userB.id)
    expect(error).toBeNull()

    expect(await snapshotRowsFor(userB.id)).toHaveLength(0)
  })
})
