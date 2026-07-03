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
})

afterAll(async () => {
  // Teardown via the service role only, mirroring the setup above.
  // Child-first -- NO FK in this schema cascades (0007's comment):
  // session_interactions before its session, and every user_id-keyed table
  // (knowledge_nodes/misconceptions/reinforcement_schedule) before the
  // users delete, or the deletes below them fail with FK violations.
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
