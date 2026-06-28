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
  // knowledge_nodes/misconceptions are cleared before the sessions/users
  // deletes below -- both reference public.users with no ON DELETE CASCADE
  // (0004_knowledge_graph.sql), so a leftover row here would otherwise block
  // the users delete with a foreign-key violation.
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
})
