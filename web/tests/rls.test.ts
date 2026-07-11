import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { beforeAll, afterAll, describe, it, expect } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

// vitest doesn't auto-load .env.local the way `next dev`/`next build` do, so
// pull the same file Task 4/5 already use for local credentials.
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

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
const PASSWORD = 'rls-test-' + Math.random().toString(36).slice(2)

function testEmail(label: string) {
  return `darcy20080911+calyxarls${label}${Date.now()}@gmail.com`
}

// Sprint 18 Task 5 (ADR-044): deny-all fixtures. Admin-seeded rows the
// RLS-scoped clients must never see — unique/inert values so the sweep never
// touches a real waitlist signup or the live daily cost ledger cost_guard uses.
const SENTINEL_WAITLIST_EMAIL = `rls-sweep-sentinel-${Date.now()}@example.invalid`
const SENTINEL_LEDGER_DAY = '1971-01-01'
const SENTINEL_RATELIMIT_BUCKET = `rls-sweep-sentinel-${Date.now()}`

// Service-role client: fixture setup/teardown ONLY (sprint-03-plan.md Task 7).
// It bypasses RLS, so it must never appear in an assertion below.
const admin = createClient(url, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
})

let userA: { id: string; email: string }
let userB: { id: string; email: string }
// Request-scoped (anon/JWT) clients — one per signed-in user. All assertions
// run through these, never through `admin`.
let clientA: SupabaseClient
let clientB: SupabaseClient
let sessionAId: string
let knowledgeNodeAId: string
let misconceptionAId: string
// Sprint 11 (ADR-019/ADR-020): the two new tables, same owner-only shape.
let interactionAId: string
let scheduleAId: string
// Sprint 18 Task 5 (ADR-044): extend the sweep to the Sprint 16/17 tables.
let feedbackAId: string
// An anonymous (never-signed-in) client — the deny-all tables (Shape 3) must
// reject anon AND authenticated alike, so both are exercised below.
let anonClient: SupabaseClient

beforeAll(async () => {
  const emailA = testEmail('a')
  const emailB = testEmail('b')

  const { data: createdA, error: errA } = await admin.auth.admin.createUser({
    email: emailA,
    password: PASSWORD,
    email_confirm: true,
  })
  if (errA || !createdA.user) throw new Error(`fixture setup failed for A: ${errA?.message}`)
  userA = { id: createdA.user.id, email: emailA }

  const { data: createdB, error: errB } = await admin.auth.admin.createUser({
    email: emailB,
    password: PASSWORD,
    email_confirm: true,
  })
  if (errB || !createdB.user) throw new Error(`fixture setup failed for B: ${errB?.message}`)
  userB = { id: createdB.user.id, email: emailB }

  clientA = createClient(url, anonKey)
  clientB = createClient(url, anonKey)

  const { error: signInAErr } = await clientA.auth.signInWithPassword({
    email: emailA,
    password: PASSWORD,
  })
  if (signInAErr) throw new Error(`sign-in failed for A: ${signInAErr.message}`)

  const { error: signInBErr } = await clientB.auth.signInWithPassword({
    email: emailB,
    password: PASSWORD,
  })
  if (signInBErr) throw new Error(`sign-in failed for B: ${signInBErr.message}`)

  // Never signed in — exercises the anon role against the deny-all tables.
  anonClient = createClient(url, anonKey)

  // Seed one hidden row into each deny-all table via the service role (which
  // bypasses RLS), so the deny-all SELECT assertions prove a REAL row is
  // invisible to clients, not merely that the table is empty on a fresh test
  // project. delete-before-insert makes a leftover from a crashed run a no-op.
  await admin.from('cost_ledger').delete().eq('day', SENTINEL_LEDGER_DAY)
  const { error: ledgerSeedErr } = await admin
    .from('cost_ledger')
    .insert({ day: SENTINEL_LEDGER_DAY, spent_cents: 1 })
  if (ledgerSeedErr) throw new Error(`cost_ledger seed failed: ${ledgerSeedErr.message}`)

  await admin.from('waitlist').delete().eq('email', SENTINEL_WAITLIST_EMAIL)
  const { error: waitlistSeedErr } = await admin
    .from('waitlist')
    .insert({ email: SENTINEL_WAITLIST_EMAIL, source: 'rls-sweep' })
  if (waitlistSeedErr) throw new Error(`waitlist seed failed: ${waitlistSeedErr.message}`)

  await admin.from('rate_limit').delete().eq('bucket', SENTINEL_RATELIMIT_BUCKET)
  const { error: rateLimitSeedErr } = await admin
    .from('rate_limit')
    .insert({ bucket: SENTINEL_RATELIMIT_BUCKET, window_start: '2000-01-01T00:00:00Z', count: 1 })
  if (rateLimitSeedErr) throw new Error(`rate_limit seed failed: ${rateLimitSeedErr.message}`)
})

afterAll(async () => {
  // Teardown via the service role only, mirroring the setup above.
  // Child-first -- NO FK in this schema cascades (0007's comment):
  // session_interactions before its session, and every user_id-keyed table
  // (knowledge_nodes/misconceptions/reinforcement_schedule) before the
  // users delete, or the deletes below them fail with FK violations.
  // Sprint 18 Task 5 tables. feedback/telemetry_event also cascade on the
  // users delete below, but clean them explicitly first (the file's child-
  // first discipline); the deny-all sentinels have no user FK, so they must
  // be removed here.
  if (feedbackAId) {
    await admin.from('feedback').delete().eq('id', feedbackAId)
  }
  if (userA) {
    await admin.from('telemetry_event').delete().eq('user_id', userA.id)
  }
  await admin.from('waitlist').delete().eq('email', SENTINEL_WAITLIST_EMAIL)
  await admin.from('cost_ledger').delete().eq('day', SENTINEL_LEDGER_DAY)
  await admin.from('rate_limit').delete().eq('bucket', SENTINEL_RATELIMIT_BUCKET)

  if (interactionAId) {
    await admin.from('session_interactions').delete().eq('id', interactionAId)
  }
  if (scheduleAId) {
    await admin.from('reinforcement_schedule').delete().eq('id', scheduleAId)
  }
  if (misconceptionAId) {
    await admin.from('misconceptions').delete().eq('id', misconceptionAId)
  }
  if (knowledgeNodeAId) {
    await admin.from('knowledge_nodes').delete().eq('id', knowledgeNodeAId)
  }
  if (sessionAId) {
    await admin.from('sessions').delete().eq('id', sessionAId)
  }
  if (userA) {
    await admin.from('users').delete().eq('id', userA.id)
    await admin.auth.admin.deleteUser(userA.id)
  }
  if (userB) {
    await admin.from('users').delete().eq('id', userB.id)
    await admin.auth.admin.deleteUser(userB.id)
  }
})

describe('RLS isolation: sessions and users', () => {
  it("A can insert and read A's own sessions row", async () => {
    const { data: inserted, error: insertErr } = await clientA
      .from('sessions')
      .insert({ user_id: userA.id, mode: 'voice' })
      .select()
      .single()

    expect(insertErr).toBeNull()
    expect(inserted).toBeTruthy()
    sessionAId = inserted!.id

    const { data: ownRead, error: ownReadErr } = await clientA
      .from('sessions')
      .select()
      .eq('id', sessionAId)

    expect(ownReadErr).toBeNull()
    expect(ownRead).toHaveLength(1)
  })

  it("B cannot SELECT A's sessions row", async () => {
    const { data, error } = await clientB.from('sessions').select().eq('id', sessionAId)

    // RLS denial via USING is silent: zero rows, not a thrown error.
    expect(error).toBeNull()
    expect(data).toHaveLength(0)
  })

  it("B cannot UPDATE A's sessions row", async () => {
    const { data, error } = await clientB
      .from('sessions')
      .update({ page_domain: 'evil.example' })
      .eq('id', sessionAId)
      .select()

    expect(error).toBeNull()
    expect(data).toHaveLength(0)
  })

  it("A can SELECT A's own users row", async () => {
    const { data, error } = await clientA.from('users').select().eq('id', userA.id)

    expect(error).toBeNull()
    expect(data).toHaveLength(1)
    expect(data?.[0].id).toBe(userA.id)
  })

  it("B cannot SELECT A's users row", async () => {
    const { data, error } = await clientB.from('users').select().eq('id', userA.id)

    expect(error).toBeNull()
    expect(data).toHaveLength(0)
  })

  it("A can read only A's own users row", async () => {
    const { data, error } = await clientA.from('users').select()

    expect(error).toBeNull()
    expect(data).toHaveLength(1)
    expect(data?.[0].id).toBe(userA.id)
  })
})

// Sprint 08 Task 7 / ADR-014: the live knowledge graph must be owner-only
// before it ever receives real data, matching the canonical `sessions`
// policy shape asserted above (0004_knowledge_graph.sql).
describe('RLS isolation: knowledge_nodes and misconceptions', () => {
  it("A can insert and read A's own knowledge_nodes row", async () => {
    const { data: inserted, error: insertErr } = await clientA
      .from('knowledge_nodes')
      .insert({ user_id: userA.id, concept_key: 'algebra.linear-equations.one-variable', mastery: 0.5 })
      .select()
      .single()

    expect(insertErr).toBeNull()
    expect(inserted).toBeTruthy()
    knowledgeNodeAId = inserted!.id

    const { data: ownRead, error: ownReadErr } = await clientA
      .from('knowledge_nodes')
      .select()
      .eq('id', knowledgeNodeAId)

    expect(ownReadErr).toBeNull()
    expect(ownRead).toHaveLength(1)
  })

  it("B cannot SELECT A's knowledge_nodes row", async () => {
    const { data, error } = await clientB.from('knowledge_nodes').select().eq('id', knowledgeNodeAId)

    // RLS denial via USING is silent: zero rows, not a thrown error.
    expect(error).toBeNull()
    expect(data).toHaveLength(0)
  })

  it("B cannot UPDATE A's knowledge_nodes row", async () => {
    const { data, error } = await clientB
      .from('knowledge_nodes')
      .update({ mastery: 0.99 })
      .eq('id', knowledgeNodeAId)
      .select()

    expect(error).toBeNull()
    expect(data).toHaveLength(0)
  })

  it("A can insert and read A's own misconceptions row", async () => {
    const { data: inserted, error: insertErr } = await clientA
      .from('misconceptions')
      .insert({
        user_id: userA.id,
        concept_key: 'algebra.linear-equations.one-variable',
        category: 'sign_error.distribution',
      })
      .select()
      .single()

    expect(insertErr).toBeNull()
    expect(inserted).toBeTruthy()
    misconceptionAId = inserted!.id

    const { data: ownRead, error: ownReadErr } = await clientA
      .from('misconceptions')
      .select()
      .eq('id', misconceptionAId)

    expect(ownReadErr).toBeNull()
    expect(ownRead).toHaveLength(1)
  })

  it("B cannot SELECT A's misconceptions row", async () => {
    const { data, error } = await clientB.from('misconceptions').select().eq('id', misconceptionAId)

    expect(error).toBeNull()
    expect(data).toHaveLength(0)
  })

  it("B cannot UPDATE A's misconceptions row", async () => {
    const { data, error } = await clientB
      .from('misconceptions')
      .update({ status: 'resolved' })
      .eq('id', misconceptionAId)
      .select()

    expect(error).toBeNull()
    expect(data).toHaveLength(0)
  })

  // Sprint 09 Task 7 / ADR-017: the additive `embedding` column (migration
  // 0005) carries no policy of its own -- it inherits misconceptions' table-
  // level RLS. This locks that in, the same way the column-agnostic checks
  // above already do for the rest of the row.
  it("the additive embedding column on misconceptions stays owner-only", async () => {
    const probeEmbedding = Array(1024).fill(0.01)

    const { data: inserted, error: insertErr } = await clientA
      .from('misconceptions')
      .insert({
        user_id: userA.id,
        concept_key: 'algebra.linear-equations.one-variable',
        category: 'embedding_rls_probe',
        embedding: probeEmbedding,
      })
      .select('id, embedding')
      .single()

    expect(insertErr).toBeNull()
    expect(inserted!.embedding).not.toBeNull()

    const { data: ownRead, error: ownReadErr } = await clientA
      .from('misconceptions')
      .select('id, embedding')
      .eq('id', inserted!.id)
    expect(ownReadErr).toBeNull()
    expect(ownRead).toHaveLength(1)

    const { data: bSees, error: bErr } = await clientB
      .from('misconceptions')
      .select('id, embedding')
      .eq('id', inserted!.id)

    // RLS denial via USING is silent: zero rows, not a thrown error --
    // same as every other row check in this describe block.
    expect(bErr).toBeNull()
    expect(bSees).toHaveLength(0)

    await admin.from('misconceptions').delete().eq('id', inserted!.id)
  })
})

// Sprint 11 Task 8 / ADR-019/ADR-020: the two new tables must be owner-only
// BEFORE they carry real data (the RLS-before-data rule) -- both were
// created with the canonical user_id-keyed policy in their own migrations
// (0007/0008); this locks that in with the same probe shape as every block
// above. session_interactions rows hang off A's session from the first
// describe block (declaration order guarantees sessionAId exists here).
describe('RLS isolation: session_interactions and reinforcement_schedule', () => {
  it("A can insert and read A's own session_interactions row", async () => {
    const { data: inserted, error: insertErr } = await clientA
      .from('session_interactions')
      .insert({
        session_id: sessionAId,
        user_id: userA.id,
        turn_index: 1,
        concept_key: 'algebra.linear-equations.one-variable',
        student_transcript: 'x = 4',
        tutor_response: 'Right — walk me through how you got there.',
        outcome: 'correct',
        self_confidence: 'high',
        response_latency_ms: 4200,
      })
      .select()
      .single()

    expect(insertErr).toBeNull()
    expect(inserted).toBeTruthy()
    interactionAId = inserted!.id

    const { data: ownRead, error: ownReadErr } = await clientA
      .from('session_interactions')
      .select()
      .eq('id', interactionAId)

    expect(ownReadErr).toBeNull()
    expect(ownRead).toHaveLength(1)
    expect(ownRead![0].student_transcript).toBe('x = 4')
  })

  it("B cannot SELECT A's session_interactions row", async () => {
    const { data, error } = await clientB.from('session_interactions').select().eq('id', interactionAId)

    // RLS denial via USING is silent: zero rows, not a thrown error.
    expect(error).toBeNull()
    expect(data).toHaveLength(0)
  })

  it("B cannot UPDATE A's session_interactions row", async () => {
    const { data, error } = await clientB
      .from('session_interactions')
      .update({ outcome: 'incorrect' })
      .eq('id', interactionAId)
      .select()

    expect(error).toBeNull()
    expect(data).toHaveLength(0)
  })

  it("B cannot forge an interaction INTO A's session (WITH CHECK denies a cross-user insert)", async () => {
    // user_id must match auth.uid() (the WITH CHECK half of the policy) --
    // so B can neither write a row AS A nor attach one to A's session under
    // B's own id (the route's ownership check is the second, independent
    // guard for that).
    const { data, error } = await clientB
      .from('session_interactions')
      .insert({
        session_id: sessionAId,
        user_id: userA.id,
        turn_index: 99,
        outcome: 'incorrect',
      })
      .select()

    // WITH CHECK denial is a real error (42501), not a silent zero-row.
    expect(error).not.toBeNull()
    expect(data).toBeNull()
  })

  it("A can insert and read A's own reinforcement_schedule row", async () => {
    const { data: inserted, error: insertErr } = await clientA
      .from('reinforcement_schedule')
      .insert({
        user_id: userA.id,
        concept_key: 'algebra.linear-equations.one-variable',
        due_at: new Date().toISOString(),
        interval_days: 1.0,
        priority: 0.7,
      })
      .select()
      .single()

    expect(insertErr).toBeNull()
    expect(inserted).toBeTruthy()
    scheduleAId = inserted!.id

    const { data: ownRead, error: ownReadErr } = await clientA
      .from('reinforcement_schedule')
      .select()
      .eq('id', scheduleAId)

    expect(ownReadErr).toBeNull()
    expect(ownRead).toHaveLength(1)
  })

  it("B cannot SELECT A's reinforcement_schedule row", async () => {
    const { data, error } = await clientB.from('reinforcement_schedule').select().eq('id', scheduleAId)

    expect(error).toBeNull()
    expect(data).toHaveLength(0)
  })

  it("B cannot UPDATE A's reinforcement_schedule row", async () => {
    const { data, error } = await clientB
      .from('reinforcement_schedule')
      .update({ priority: 0.01, due_at: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString() })
      .eq('id', scheduleAId)
      .select()

    expect(error).toBeNull()
    expect(data).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// Sprint 17 tables (migration 0017). Sprint 18 Task 5 (ADR-044) extends the
// sweep to every table added after Sprint 11.
// ---------------------------------------------------------------------------

// feedback — Shape 2 (user_id-keyed) but with NO deleted_at column (ADR-039),
// so its policies omit the `deleted_at is null` clause. Owner reads/writes
// only their own rows; a cross-user forge is denied by WITH CHECK.
describe('RLS isolation: feedback (Shape 2, no deleted_at — ADR-039)', () => {
  it("A can insert and read A's own feedback row", async () => {
    const { data: inserted, error: insertErr } = await clientA
      .from('feedback')
      .insert({ user_id: userA.id, kind: 'idea', message: 'more worked examples please' })
      .select()
      .single()
    expect(insertErr).toBeNull()
    expect(inserted).toBeTruthy()
    feedbackAId = inserted!.id

    const { data: ownRead, error: ownReadErr } = await clientA.from('feedback').select().eq('id', feedbackAId)
    expect(ownReadErr).toBeNull()
    expect(ownRead).toHaveLength(1)
  })

  it("B cannot SELECT A's feedback row", async () => {
    const { data, error } = await clientB.from('feedback').select().eq('id', feedbackAId)
    expect(error).toBeNull()
    expect(data).toHaveLength(0)
  })

  it("B cannot UPDATE A's feedback row", async () => {
    const { data, error } = await clientB
      .from('feedback')
      .update({ message: 'tampered' })
      .eq('id', feedbackAId)
      .select()
    expect(error).toBeNull()
    expect(data).toHaveLength(0)
  })

  it("B cannot forge a feedback row attributed to A (WITH CHECK denies it)", async () => {
    const { data, error } = await clientB
      .from('feedback')
      .insert({ user_id: userA.id, kind: 'bug', message: 'forged' })
      .select()
    expect(error).not.toBeNull()
    expect(data).toBeNull()
  })
})

// telemetry_event — Shape 2 keyed on user_id but INSERT-ONLY from the owner
// (ADR-043): a single `for insert with check (auth.uid() = user_id)` policy
// and NO select/update/delete policy. Clients write their own events and can
// never read ANY row back (analysis is service-role only). Inserts therefore
// use no `.select()` — a RETURNING clause would be filtered by the absent
// select policy and mask the successful write.
describe('RLS isolation: telemetry_event (insert-only, owner-scoped — ADR-043)', () => {
  it("A can INSERT its own telemetry event", async () => {
    const { error } = await clientA
      .from('telemetry_event')
      .insert({ user_id: userA.id, kind: 'session_started', payload: {} })
    expect(error).toBeNull()
  })

  it("A CANNOT read its own telemetry back — no select policy (insert-only)", async () => {
    const { data, error } = await clientA.from('telemetry_event').select().eq('user_id', userA.id)
    expect(error).toBeNull()
    expect(data).toHaveLength(0)
  })

  it("B cannot forge a telemetry event attributed to A (WITH CHECK)", async () => {
    const { data, error } = await clientB
      .from('telemetry_event')
      .insert({ user_id: userA.id, kind: 'session_started', payload: {} })
      .select()
    expect(error).not.toBeNull()
    expect(data).toBeNull()
  })

  it("A cannot write an event attributed to another user or to no user", async () => {
    const asB = await clientA
      .from('telemetry_event')
      .insert({ user_id: userB.id, kind: 'session_started', payload: {} })
    expect(asB.error, "attributing to B must fail the WITH CHECK").not.toBeNull()

    const asNull = await clientA
      .from('telemetry_event')
      .insert({ user_id: null, kind: 'session_started', payload: {} })
    expect(asNull.error, "a null-user event must fail the WITH CHECK").not.toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Sprint 16 deny-all tables (Shape 3): waitlist (0012), cost_ledger (0013).
// RLS is enabled with ZERO policies, so NO client key — anon OR authenticated
// — may read or write; only the service role (which bypasses RLS) can. Each
// has an admin-seeded hidden row (beforeAll), so "SELECT returns nothing"
// proves a real row is invisible rather than that the table is empty.
// ---------------------------------------------------------------------------
describe('RLS: deny-all tables reject every client key (Shape 3)', () => {
  const clients = () => [['anon', anonClient] as const, ['authed', clientA] as const]

  it('waitlist — neither anon nor authenticated can SELECT (a seeded row stays hidden)', async () => {
    for (const [who, client] of clients()) {
      const { data, error } = await client.from('waitlist').select().eq('email', SENTINEL_WAITLIST_EMAIL)
      expect(error, `${who} select`).toBeNull()
      expect(data, `${who} select`).toHaveLength(0)
    }
  })

  it('waitlist — neither anon nor authenticated can INSERT', async () => {
    for (const [who, client] of clients()) {
      const { data, error } = await client
        .from('waitlist')
        .insert({ email: `intruder-${who}-${Date.now()}@example.invalid` })
        .select()
      expect(error, `${who} insert must be denied`).not.toBeNull()
      expect(data, `${who} insert`).toBeNull()
    }
  })

  it('cost_ledger — neither anon nor authenticated can SELECT (a seeded row stays hidden)', async () => {
    for (const [who, client] of clients()) {
      const { data, error } = await client.from('cost_ledger').select().eq('day', SENTINEL_LEDGER_DAY)
      expect(error, `${who} select`).toBeNull()
      expect(data, `${who} select`).toHaveLength(0)
    }
  })

  it('cost_ledger — neither anon nor authenticated can INSERT', async () => {
    for (const [who, client] of clients()) {
      const { data, error } = await client
        .from('cost_ledger')
        .insert({ day: '1972-02-02', spent_cents: 999 })
        .select()
      expect(error, `${who} insert must be denied`).not.toBeNull()
      expect(data, `${who} insert`).toBeNull()
    }
  })

  // rate_limit (migration 0018, the security-review §7.1 follow-up) — same
  // Shape 3 deny-all as above: the rate-limit counter is written only by the
  // service role via the check_rate_limit RPC, never by a client key.
  it('rate_limit — neither anon nor authenticated can SELECT (a seeded row stays hidden)', async () => {
    for (const [who, client] of clients()) {
      const { data, error } = await client.from('rate_limit').select().eq('bucket', SENTINEL_RATELIMIT_BUCKET)
      expect(error, `${who} select`).toBeNull()
      expect(data, `${who} select`).toHaveLength(0)
    }
  })

  it('rate_limit — neither anon nor authenticated can INSERT', async () => {
    for (const [who, client] of clients()) {
      const { data, error } = await client
        .from('rate_limit')
        .insert({ bucket: `intruder-${who}-${Date.now()}`, window_start: '2000-01-01T00:00:00Z', count: 1 })
        .select()
      expect(error, `${who} insert must be denied`).not.toBeNull()
      expect(data, `${who} insert`).toBeNull()
    }
  })
})
