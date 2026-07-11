import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { beforeAll, afterAll, describe, it, expect, vi } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

// vitest doesn't auto-load .env.local the way `next dev`/`next build` do
// (rls.test.ts / session.test.ts convention).
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

// web/app/api/account/delete only imports clientFromBearerOrCookie (no
// `server-only` module in its chain), so it can be imported + called directly,
// bearer-authed, with no dev server. web/app/api/account/export USED to be the
// same, but Sprint 17 (ADR-043) added a service-role read for telemetry_event
// (the one insert-only table with no client SELECT policy), so it now imports
// `@/lib/supabase/admin` -- which carries `import 'server-only'`. That is
// neutralized by the SAME two mocks the sweep route already needs below
// (`vi.mock('server-only', ...)` and `vi.mock('@/lib/supabase/admin', ...)`),
// so the export route stays importable + directly callable here; its
// telemetry read resolves to the mocked admin client, whose `from(table)`
// returns the real service-role builder for any table other than 'users'.
const exportRoute = await import('../app/api/account/export/route')
const deleteRoute = await import('../app/api/account/delete/route')

// hard-delete-sweep DOES sit behind `import 'server-only'`
// (web/lib/supabase/admin.ts, web/lib/cron/auth.ts) -- same neutralization
// as cron-auth.test.ts, for the same reason (real files, not reimplemented
// logic). Unlike cron-auth.test.ts, this suite needs the sweep's REAL
// cascade behavior, not a no-op -- so `@/lib/supabase/admin` is mocked to a
// client that is real in every respect EXCEPT the "which users qualify"
// query, which is hard-scoped to this file's own two sweep fixtures
// (`sweepScopedIds`, populated in beforeAll once their ids exist). This is
// what makes it safe to run the real sweep logic (real delete, real
// verify-by-reselect) against the live "calyxa" project without any risk of
// it ever touching a real pre-existing user: the candidate query can only
// ever return rows from this file's own fixtures, whatever their real
// erasure_requested_at state.
vi.mock('server-only', () => ({}))

const TEST_CRON_SECRET = 'account-test-cron-secret-do-not-use-in-prod'
process.env.CRON_SECRET = TEST_CRON_SECRET

const sweepScopedIds = vi.hoisted(() => ({ current: [] as string[] }))

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

// The one real service-role client this file uses both for fixture setup/
// teardown/assertions (every other suite's `admin` convention) AND, scoped,
// as the sweep route's admin client below.
const admin = createClient(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } })

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    auth: admin.auth,
    from(table: string) {
      const real = admin.from(table)
      if (table !== 'users') return real

      return {
        select(columns: string) {
          const sel = real.select(columns)
          return {
            // The sweep's "find queued" shape: .not(...).lte(...).limit(...).
            // The real `.not()` filter is replaced with a hard `.in('id', ...)`
            // scope to this file's own fixtures -- everything chained after
            // (.lte()/.limit()) is the real, unmocked PostgrestFilterBuilder,
            // so the erasure_requested_at/grace-window logic is exercised for
            // real, just never able to reach a row outside this scope.
            not: () => sel.in('id', sweepScopedIds.current),
            // The sweep's "verify absence" shape: .eq('id', id) -- passed
            // through untouched.
            eq: (column: string, value: unknown) => sel.eq(column, value),
          }
        },
        update: (values: Record<string, unknown>) => real.update(values),
      }
    },
  }),
}))

const hardDeleteSweep = await import('../app/api/cron/hard-delete-sweep/route')

const PASSWORD = 'account-test-' + Math.random().toString(36).slice(2)

function testEmail(label: string) {
  return `darcy20080911+calyxaaccount${label}${Date.now()}@gmail.com`
}

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

// Seeds one row in every user-scoped table the export route reads (and the
// sweep must cascade-delete), mirroring EXPORTED_TABLES in
// web/app/api/account/export/route.ts.
async function seedAllTables(userId: string) {
  const { data: session, error: sessionErr } = await admin
    .from('sessions')
    .insert({ user_id: userId, mode: 'text' })
    .select('id')
    .single()
  if (sessionErr || !session) throw new Error(`seed sessions failed: ${sessionErr?.message}`)

  const { error: nodeErr } = await admin
    .from('knowledge_nodes')
    .insert({ user_id: userId, concept_key: 'algebra.test.fixture' })
  if (nodeErr) throw new Error(`seed knowledge_nodes failed: ${nodeErr.message}`)

  const { error: misconceptionErr } = await admin
    .from('misconceptions')
    .insert({ user_id: userId, concept_key: 'algebra.test.fixture', category: 'test-category' })
  if (misconceptionErr) throw new Error(`seed misconceptions failed: ${misconceptionErr.message}`)

  const { error: interactionErr } = await admin
    .from('session_interactions')
    .insert({ session_id: session.id, user_id: userId, turn_index: 0 })
  if (interactionErr) throw new Error(`seed session_interactions failed: ${interactionErr.message}`)

  const { error: scheduleErr } = await admin
    .from('reinforcement_schedule')
    .insert({ user_id: userId, concept_key: 'algebra.test.fixture', due_at: new Date().toISOString() })
  if (scheduleErr) throw new Error(`seed reinforcement_schedule failed: ${scheduleErr.message}`)

  // Sprint 17 (ADR-039/ADR-043): the two beta-observability tables must be
  // export- AND erasure-covered. `feedback` carries the one user-authored
  // free-text field (message); `telemetry_event` is insert-only (exported via
  // the route's scoped service-role read, not RLS).
  const { error: feedbackErr } = await admin
    .from('feedback')
    .insert({ user_id: userId, session_id: session.id, kind: 'idea', message: 'fixture feedback' })
  if (feedbackErr) throw new Error(`seed feedback failed: ${feedbackErr.message}`)

  const { error: telemetryErr } = await admin
    .from('telemetry_event')
    .insert({ user_id: userId, kind: 'session_started', payload: { mode: 'text' } })
  if (telemetryErr) throw new Error(`seed telemetry_event failed: ${telemetryErr.message}`)

  return { sessionId: session.id as string }
}

async function existsInAnyTable(userId: string): Promise<Record<string, number>> {
  const tables = ['users', 'sessions', 'knowledge_nodes', 'misconceptions', 'session_interactions', 'reinforcement_schedule', 'feedback', 'telemetry_event']
  const counts: Record<string, number> = {}

  for (const table of tables) {
    const column = table === 'users' ? 'id' : 'user_id'
    const { data } = await admin.from(table).select('id').eq(column, userId)
    counts[table] = data?.length ?? 0
  }

  return counts
}

function requestFor(path: string, token: string, init: RequestInit = {}) {
  return new Request(`http://localhost${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, ...(init.headers ?? {}) },
  })
}

let userA: Fixture // export: the caller whose data must come back complete
let userB: Fixture // export: the decoy whose data must never leak into A's export
let userC: Fixture // delete: queues erasure, must not cascade in-request
let userD: Fixture // sweep: queued + past the grace window -- must be fully gone
let userE: Fixture // sweep: never queued -- must be entirely untouched
let seedA: { sessionId: string }
let seedB: { sessionId: string }
let seedC: { sessionId: string }

beforeAll(async () => {
  [userA, userB, userC, userD, userE] = await Promise.all([
    makeFixture('a'),
    makeFixture('b'),
    makeFixture('c'),
    makeFixture('d'),
    makeFixture('e'),
  ])

  // D/E's seeded rows are asserted via existsInAnyTable's counts below, not
  // via their session ids -- only A/B/C's returned sessionId is read
  // directly, so only those three are bound.
  const seeded = await Promise.all([
    seedAllTables(userA.id),
    seedAllTables(userB.id),
    seedAllTables(userC.id),
    seedAllTables(userD.id),
    seedAllTables(userE.id),
  ])
  ;[seedA, seedB, seedC] = seeded

  // D is queued PAST the 7-day grace window (ERASURE_GRACE_DAYS,
  // hard-delete-sweep/route.ts) -- backdated directly via the admin client,
  // the same way the plan's reset-free-tier fixture ages
  // free_period_started_at, since the real /api/account/delete route always
  // stamps `now()` and could never produce an eligible-today fixture on its
  // own. E is left with erasure_requested_at = null (never requested).
  const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString()
  const { error: queueErr } = await admin
    .from('users')
    .update({ erasure_requested_at: eightDaysAgo, deleted_at: eightDaysAgo })
    .eq('id', userD.id)
  if (queueErr) throw new Error(`queuing userD for erasure failed: ${queueErr.message}`)

  // Scopes the mocked admin client's sweep query to exactly these two users
  // -- set here, after both ids exist, not in the vi.mock factory (which
  // runs before any fixture is created).
  sweepScopedIds.current = [userD.id, userE.id]
}, 30000)

afterAll(async () => {
  // Child-first delete order (rls.test.ts / session.test.ts discipline) for
  // whichever fixtures the sweep test didn't already remove.
  for (const user of [userA, userB, userC, userE]) {
    if (!user) continue
    await admin.from('session_interactions').delete().eq('user_id', user.id)
    await admin.from('reinforcement_schedule').delete().eq('user_id', user.id)
    await admin.from('misconceptions').delete().eq('user_id', user.id)
    await admin.from('knowledge_nodes').delete().eq('user_id', user.id)
    await admin.from('sessions').delete().eq('user_id', user.id)
    await admin.from('users').delete().eq('id', user.id)
    await admin.auth.admin.deleteUser(user.id)
  }
  // userD is expected to already be fully gone via the sweep test itself;
  // this is a safety net only, in case that test failed before deleting it.
  if (userD) {
    await admin.auth.admin.deleteUser(userD.id).catch(() => {})
  }
}, 30000)

describe('GET /api/account/export', () => {
  it("returns a complete export of the caller's own rows across all six tables", async () => {
    const response = await exportRoute.GET(requestFor('/api/account/export', userA.token))
    expect(response.status).toBe(200)
    const body = await response.json()

    expect(body.schemaVersion).toBeDefined()
    expect(body.userId).toBe(userA.id)
    expect(body.users).toHaveLength(1)
    expect(body.users[0].id).toBe(userA.id)
    expect(body.sessions.map((s: { id: string }) => s.id)).toEqual([seedA.sessionId])
    expect(body.knowledge_nodes).toHaveLength(1)
    expect(body.knowledge_nodes[0].concept_key).toBe('algebra.test.fixture')
    expect(body.misconceptions).toHaveLength(1)
    expect(body.session_interactions).toHaveLength(1)
    expect(body.session_interactions[0].session_id).toBe(seedA.sessionId)
    expect(body.reinforcement_schedule).toHaveLength(1)
    // Sprint 17: feedback (RLS-scoped read) + telemetry_event (scoped
    // service-role read) both land in the export.
    expect(body.feedback).toHaveLength(1)
    expect(body.feedback[0].message).toBe('fixture feedback')
    expect(body.telemetry_event).toHaveLength(1)
    expect(body.telemetry_event[0].kind).toBe('session_started')
  })

  it("never includes a second user's rows (RLS proven, not a query we could get wrong)", async () => {
    const response = await exportRoute.GET(requestFor('/api/account/export', userA.token))
    const body = await response.json()

    const allIds = [
      ...body.users.map((r: { id: string }) => r.id),
      ...body.sessions.map((r: { id: string }) => r.id),
      ...body.knowledge_nodes.map((r: { id: string }) => r.id),
      ...body.misconceptions.map((r: { id: string }) => r.id),
      ...body.session_interactions.map((r: { id: string }) => r.id),
      ...body.reinforcement_schedule.map((r: { id: string }) => r.id),
    ]

    expect(allIds).not.toContain(userB.id)
    expect(allIds).not.toContain(seedB.sessionId)

    // Sprint 17: telemetry_event is exported via a service-role read scoped
    // ONLY by an explicit `.eq('user_id', ...)` (it bypasses RLS), so the
    // scoping is the route's own code, not the database's -- assert it
    // directly. feedback (RLS-scoped) is checked the same way for symmetry.
    for (const row of body.feedback) expect(row.user_id).toBe(userA.id)
    for (const row of body.telemetry_event) expect(row.user_id).toBe(userA.id)
  })

  it('rejects an invalid bearer token', async () => {
    // Not "no auth" -- with no Authorization header at all,
    // clientFromBearerOrCookie falls through to the cookie branch, which
    // calls Next's cookies() and throws outside a real request scope (the
    // same `after()`-style limitation url-hash.test.ts's comment explains).
    // An invalid bearer token exercises clientFromBearer's real rejection
    // path without ever reaching that branch.
    const response = await exportRoute.GET(requestFor('/api/account/export', 'not-a-real-token'))
    expect(response.status).toBe(401)
  })
})

describe('POST /api/account/delete', () => {
  it('queues erasure (erasure_requested_at + deleted_at) without cascading in-request', async () => {
    const response = await deleteRoute.POST(requestFor('/api/account/delete', userC.token, { method: 'POST' }))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true })

    const { data: row, error } = await admin
      .from('users')
      .select('erasure_requested_at, deleted_at')
      .eq('id', userC.id)
      .single()

    expect(error).toBeNull()
    expect(row!.erasure_requested_at).not.toBeNull()
    expect(row!.deleted_at).not.toBeNull()

    // Not deleted in-request: the seeded session is still there.
    const { data: stillThere } = await admin.from('sessions').select('id').eq('id', seedC.sessionId)
    expect(stillThere).toHaveLength(1)
  })

  it('is idempotent: a second call is a no-op, still 200', async () => {
    const response = await deleteRoute.POST(requestFor('/api/account/delete', userC.token, { method: 'POST' }))
    expect(response.status).toBe(200)
  })

  it('rejects an invalid bearer token', async () => {
    const response = await deleteRoute.POST(
      requestFor('/api/account/delete', 'not-a-real-token', { method: 'POST' })
    )
    expect(response.status).toBe(401)
  })
})

describe('GET /api/cron/hard-delete-sweep', () => {
  it('cascade-deletes a user past the grace window across every table, and leaves a non-queued user untouched', async () => {
    const response = await hardDeleteSweep.GET(
      new Request('http://localhost/api/cron/hard-delete-sweep', {
        headers: { Authorization: `Bearer ${TEST_CRON_SECRET}` },
      })
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.deletedCount).toBeGreaterThanOrEqual(1)
    expect(body.failedIds).not.toContain(userD.id)

    // D: gone everywhere, including auth.users.
    const dCounts = await existsInAnyTable(userD.id)
    expect(Object.values(dCounts).every((count) => count === 0)).toBe(true)
    const { data: dAuthUser } = await admin.auth.admin.getUserById(userD.id)
    expect(dAuthUser?.user).toBeFalsy()

    // E: entirely untouched -- never queued, so the scoped candidate query
    // (real erasure_requested_at IS NULL check) must exclude it.
    const eCounts = await existsInAnyTable(userE.id)
    expect(eCounts.users).toBe(1)
    expect(eCounts.sessions).toBe(1)
    expect(eCounts.knowledge_nodes).toBe(1)
    expect(eCounts.misconceptions).toBe(1)
    expect(eCounts.session_interactions).toBe(1)
    expect(eCounts.reinforcement_schedule).toBe(1)
    // Sprint 17: the two new tables cascade-delete for D (its all-zero check
    // above already covers them via existsInAnyTable) and stay for E.
    expect(eCounts.feedback).toBe(1)
    expect(eCounts.telemetry_event).toBe(1)
  })
})
