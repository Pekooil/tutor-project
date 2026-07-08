import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { spawn, type ChildProcess } from 'node:child_process'
import { createRequire } from 'node:module'
import { beforeAll, afterAll, describe, it, expect } from 'vitest'
import { createClient } from '@supabase/supabase-js'

// vitest doesn't auto-load .env.local the way `next dev`/`next build` do
// (rls.test.ts / ai-turn.test.ts convention).
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

// A dedicated port, distinct from every other suite's spawned `next dev`
// (session.test.ts 3100, ai-turn.test.ts 3101, voice.test.ts 3103,
// ai-stream.test.ts 3106, axe-web-surfaces.test.ts 3108,
// learning-events.test.ts 3110). GET /api/profile/overview never calls the
// model (Task 3: "no model call, no free-tier interaction"), so this file
// needs no fake-Anthropic backend at all.
const PORT = 3109
const API_BASE = `http://localhost:${PORT}`

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
const PASSWORD = 'profile-overview-test-' + Math.random().toString(36).slice(2)

function testEmail(label: string) {
  return `darcy20080911+calyxaoverview${label}${Date.now()}@gmail.com`
}

// Service-role client: fixture setup/teardown ONLY (ai-turn.test.ts discipline).
const admin = createClient(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } })

let server: ChildProcess

// A fresh user with zero knowledge_nodes -- the calibrating case.
let freshUser: { id: string }
let freshToken: string

// A seeded user: one mastery node (weakSpots/dueForReview both empty), so
// the "display-ready shape with titles" test has titles to check without
// tangling weakSpot/due assertions into the same fixture.
let seededUser: { id: string }
let seededToken: string
const SEEDED_CONCEPT_KEY = 'algebra.quadratics.factoring'
const SEEDED_TITLE = 'Factoring quadratics'

async function waitForServer(timeoutMs: number) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      await fetch(`${API_BASE}/login`)
      return
    } catch {
      await new Promise((r) => setTimeout(r, 300))
    }
  }
  throw new Error(`dev server did not become ready on ${API_BASE} within ${timeoutMs}ms`)
}

async function overview(bearer: string | null) {
  const headers: Record<string, string> = {}
  if (bearer) headers.Authorization = `Bearer ${bearer}`
  const res = await fetch(`${API_BASE}/api/profile/overview`, { headers })
  return { status: res.status, json: await res.json() }
}

beforeAll(async () => {
  const require = createRequire(import.meta.url)
  const nextBin = require.resolve('next/dist/bin/next')
  server = spawn(process.execPath, [nextBin, 'dev', '-p', String(PORT)], {
    cwd: process.cwd(),
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      // No fake-Anthropic base URL is wired here on purpose: a route that
      // somehow reached the SDK would have no key and no reachable base URL
      // to call, which is the point -- this endpoint must never touch it.
      ANTHROPIC_API_KEY: 'sk-ant-test-fake-key-not-real',
    },
  })
  const startupLog: string[] = []
  server.stdout?.on('data', (chunk) => startupLog.push(String(chunk)))
  server.stderr?.on('data', (chunk) => startupLog.push(String(chunk)))

  try {
    await waitForServer(30000)
  } catch (err) {
    throw new Error(`${(err as Error).message}\n--- next dev output ---\n${startupLog.join('')}`)
  }

  const freshEmail = testEmail('fresh')
  const { data: createdFresh, error: freshErr } = await admin.auth.admin.createUser({
    email: freshEmail,
    password: PASSWORD,
    email_confirm: true,
  })
  if (freshErr || !createdFresh.user) throw new Error(`fixture setup failed (fresh user): ${freshErr?.message}`)
  freshUser = { id: createdFresh.user.id }

  const freshClient = createClient(url, anonKey)
  const { data: signInFresh, error: signInFreshErr } = await freshClient.auth.signInWithPassword({
    email: freshEmail,
    password: PASSWORD,
  })
  if (signInFreshErr || !signInFresh.session) throw new Error(`sign-in failed (fresh user): ${signInFreshErr?.message}`)
  freshToken = signInFresh.session.access_token

  const seededEmail = testEmail('seeded')
  const { data: createdSeeded, error: seededErr } = await admin.auth.admin.createUser({
    email: seededEmail,
    password: PASSWORD,
    email_confirm: true,
  })
  if (seededErr || !createdSeeded.user) throw new Error(`fixture setup failed (seeded user): ${seededErr?.message}`)
  seededUser = { id: createdSeeded.user.id }

  const { error: seedErr } = await admin.from('knowledge_nodes').insert({
    user_id: seededUser.id,
    concept_key: SEEDED_CONCEPT_KEY,
    mastery: 0.42,
    stability: 1.0,
    state: 'learning',
    confidence_band: 'medium',
    observation_count: 4,
    last_practiced_at: new Date().toISOString(),
  })
  if (seedErr) throw new Error(`fixture setup failed (knowledge_nodes seed): ${seedErr.message}`)

  const seededClient = createClient(url, anonKey)
  const { data: signInSeeded, error: signInSeededErr } = await seededClient.auth.signInWithPassword({
    email: seededEmail,
    password: PASSWORD,
  })
  if (signInSeededErr || !signInSeeded.session) {
    throw new Error(`sign-in failed (seeded user): ${signInSeededErr?.message}`)
  }
  seededToken = signInSeeded.session.access_token
}, 45000)

afterAll(async () => {
  for (const fixture of [freshUser, seededUser]) {
    if (!fixture) continue
    await admin.from('session_interactions').delete().eq('user_id', fixture.id)
    await admin.from('sessions').delete().eq('user_id', fixture.id)
    await admin.from('reinforcement_schedule').delete().eq('user_id', fixture.id)
    await admin.from('misconceptions').delete().eq('user_id', fixture.id)
    await admin.from('knowledge_nodes').delete().eq('user_id', fixture.id)
    await admin.from('users').delete().eq('id', fixture.id)
    await admin.auth.admin.deleteUser(fixture.id)
  }

  if (server?.pid) {
    try {
      process.kill(-server.pid, 'SIGTERM')
    } catch {
      // already gone
    }
    await new Promise((r) => setTimeout(r, 500))
    try {
      process.kill(-server.pid, 'SIGKILL')
    } catch {
      // already gone
    }
  }
}, 20000)

describe('GET /api/profile/overview', () => {
  it('rejects a no-bearer request with 401', async () => {
    const { status } = await overview(null)
    expect(status).toBe(401)
  })

  it('rejects a garbage bearer with 401', async () => {
    const { status } = await overview('garbage')
    expect(status).toBe(401)
  })

  it('a fresh user (no knowledge_nodes) gets calibrating: true with empty lists', async () => {
    const { status, json } = await overview(freshToken)

    expect(status).toBe(200)
    expect(json).toEqual({
      calibrating: true,
      mastery: [],
      weakSpots: [],
      dueForReview: [],
    })
  })

  it('a seeded user gets a display-ready shape with the curriculum title, matching loadProfile\'s decay-adjusted values', async () => {
    const { status, json } = await overview(seededToken)

    expect(status).toBe(200)
    expect(json.calibrating).toBe(false)
    expect(json.mastery).toHaveLength(1)
    expect(json.mastery[0]).toEqual({
      conceptKey: SEEDED_CONCEPT_KEY,
      title: SEEDED_TITLE,
      // last_practiced_at was set to "now" at seed time, so decay is
      // negligible -- the rendered mastery is (within floating-point noise)
      // the raw seeded value, mirroring ai-turn.test.ts's undecayed fixture.
      mastery: expect.closeTo(0.42, 3),
      state: 'learning',
      confidenceBand: 'medium',
      // Sprint 15 fix pass round 2: recency for the overview card's
      // "top 3 recently updated" sort -- the seed sets it to "now".
      lastPracticedAt: expect.any(String),
    })
    expect(json.weakSpots).toEqual([])
    expect(json.dueForReview).toEqual([])
  })

  it('writes nothing -- a read-only endpoint (ADR-024/025)', async () => {
    const before = await admin
      .from('knowledge_nodes')
      .select('mastery, observation_count')
      .eq('user_id', seededUser.id)
      .eq('concept_key', SEEDED_CONCEPT_KEY)
      .single()

    const { status } = await overview(seededToken)
    expect(status).toBe(200)

    const after = await admin
      .from('knowledge_nodes')
      .select('mastery, observation_count')
      .eq('user_id', seededUser.id)
      .eq('concept_key', SEEDED_CONCEPT_KEY)
      .single()

    expect(after.data).toEqual(before.data)

    // Structural guard mirroring ai-turn.test.ts's own: the route never
    // imports the service-role/write-capable client.
    const source = readFileSync(resolve(process.cwd(), 'app/api/profile/overview/route.ts'), 'utf-8')
    expect(source).not.toMatch(/from\s+['"]@\/lib\/supabase\/admin['"]/)
  })
})
