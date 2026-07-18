import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { beforeAll, afterAll, describe, it, expect } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

// Public launch (2026-07-18): the per-free-user monthly voice credit
// (migration 0023) — the `voice_credit_guard` RPC + `voice_spend` table,
// exercised against the real Supabase project (rls.test.ts's style: direct
// RPC/table calls with real anon/authenticated/service-role clients, no
// spawned dev server — the route wiring above this RPC is the same
// parallel-guard shape cost-guard.test.ts already exercises end-to-end for
// the global caps).
//
// The cap is a PARAMETER of the RPC (cost_guard's pattern), so these tests
// pass small explicit caps instead of pushing a ledger toward the real
// 50-cent threshold — every run is idempotent for its own fresh fixture user.

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

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
const PASSWORD = 'voice-credit-test-' + Math.random().toString(36).slice(2)

function testEmail(tag: string) {
  return `darcy20080911+calyxavoicecredit${tag}${Date.now()}@gmail.com`
}

const admin = createClient(url, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
})

type GuardRow = { exceeded: boolean; spent_cents: number }

async function callGuard(client: SupabaseClient, estimated: number, cap: number) {
  const { data, error } = await client
    .rpc('voice_credit_guard', { p_estimated_cents: estimated, p_cap_cents: cap })
    .single()
  return { row: data as GuardRow | null, error }
}

let freeUser: { id: string; email: string }
let proUser: { id: string; email: string }
let freeClient: SupabaseClient
let proClient: SupabaseClient
let anonClient: SupabaseClient

beforeAll(async () => {
  const emailFree = testEmail('free')
  const emailPro = testEmail('pro')

  const { data: createdFree, error: errFree } = await admin.auth.admin.createUser({
    email: emailFree,
    password: PASSWORD,
    email_confirm: true,
  })
  if (errFree || !createdFree.user) throw new Error(`fixture setup failed (free): ${errFree?.message}`)
  freeUser = { id: createdFree.user.id, email: emailFree }

  const { data: createdPro, error: errPro } = await admin.auth.admin.createUser({
    email: emailPro,
    password: PASSWORD,
    email_confirm: true,
  })
  if (errPro || !createdPro.user) throw new Error(`fixture setup failed (pro): ${errPro?.message}`)
  proUser = { id: createdPro.user.id, email: emailPro }

  const { error: tierErr } = await admin
    .from('users')
    .update({ subscription_tier: 'pro' })
    .eq('id', proUser.id)
  if (tierErr) throw new Error(`pro tier flip failed: ${tierErr.message}`)

  freeClient = createClient(url, anonKey)
  proClient = createClient(url, anonKey)
  anonClient = createClient(url, anonKey)

  const { error: signInFreeErr } = await freeClient.auth.signInWithPassword({
    email: emailFree,
    password: PASSWORD,
  })
  if (signInFreeErr) throw new Error(`sign-in failed (free): ${signInFreeErr.message}`)

  const { error: signInProErr } = await proClient.auth.signInWithPassword({
    email: emailPro,
    password: PASSWORD,
  })
  if (signInProErr) throw new Error(`sign-in failed (pro): ${signInProErr.message}`)
})

afterAll(async () => {
  // voice_spend FK-cascades on the users delete (the erasure guarantee this
  // suite also asserts below), so removing the auth users is sufficient.
  if (freeUser) await admin.auth.admin.deleteUser(freeUser.id)
  if (proUser) await admin.auth.admin.deleteUser(proUser.id)
})

describe('voice_credit_guard: free-tier metering', () => {
  it('accumulates spend and flips exceeded at the cap', async () => {
    // Cap of 5 cents: 2 + 2 stays under, the 3rd call crosses.
    const first = await callGuard(freeClient, 2, 5)
    expect(first.error).toBeNull()
    expect(first.row).toMatchObject({ exceeded: false, spent_cents: 2 })

    const second = await callGuard(freeClient, 2, 5)
    expect(second.error).toBeNull()
    expect(second.row).toMatchObject({ exceeded: false, spent_cents: 4 })

    const third = await callGuard(freeClient, 2, 5)
    expect(third.error).toBeNull()
    expect(third.row).toMatchObject({ exceeded: true, spent_cents: 6 })

    // Once exceeded, it stays exceeded (add-then-check never un-crosses
    // within the month).
    const fourth = await callGuard(freeClient, 1, 5)
    expect(fourth.row?.exceeded).toBe(true)
  })

  it('writes one row per (user, month) that the owner can read back', async () => {
    const { data, error } = await freeClient.from('voice_spend').select('*')
    expect(error).toBeNull()
    expect(data).toHaveLength(1)
    expect(data![0].user_id).toBe(freeUser.id)
    expect(data![0].cents).toBeGreaterThan(0)
  })
})

describe('voice_credit_guard: pro exemption', () => {
  it('never meters a non-free tier and writes no ledger row', async () => {
    const result = await callGuard(proClient, 100, 5)
    expect(result.error).toBeNull()
    expect(result.row).toMatchObject({ exceeded: false, spent_cents: 0 })

    const { data } = await admin.from('voice_spend').select('*').eq('user_id', proUser.id)
    expect(data).toHaveLength(0)
  })
})

describe('voice_spend: RLS boundary', () => {
  it('anon cannot execute the guard RPC', async () => {
    const { error } = await anonClient
      .rpc('voice_credit_guard', { p_estimated_cents: 1, p_cap_cents: 5 })
      .single()
    expect(error).not.toBeNull()
  })

  it('another authenticated user cannot read someone else’s spend', async () => {
    const { data, error } = await proClient.from('voice_spend').select('*').eq('user_id', freeUser.id)
    expect(error).toBeNull()
    expect(data).toHaveLength(0)
  })

  it('clients cannot write the ledger directly (RPC is the only writer)', async () => {
    const { error: insertErr } = await freeClient
      .from('voice_spend')
      .insert({ user_id: freeUser.id, month: '2000-01-01', cents: -100 })
    expect(insertErr).not.toBeNull()

    const { error: updateErr, data: updated } = await freeClient
      .from('voice_spend')
      .update({ cents: 0 })
      .eq('user_id', freeUser.id)
      .select()
    // No UPDATE policy: PostgREST reports zero affected rows rather than an
    // error — either shape proves the write did not land.
    if (!updateErr) expect(updated).toHaveLength(0)

    const { data: after } = await admin.from('voice_spend').select('cents').eq('user_id', freeUser.id)
    expect(after![0].cents).toBeGreaterThan(0)
  })
})
