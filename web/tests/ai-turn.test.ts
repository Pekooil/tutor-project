import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { spawn, type ChildProcess } from 'node:child_process'
import { createRequire } from 'node:module'
import http, { type Server } from 'node:http'
import { beforeAll, afterAll, beforeEach, describe, it, expect } from 'vitest'
import { createClient } from '@supabase/supabase-js'

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

// Distinct from session.test.ts's port (3100) and a developer's `next dev`
// (3000), so the two suites can run in parallel vitest workers.
const PORT = 3101
const FAKE_ANTHROPIC_PORT = 3102
const API_BASE = `http://localhost:${PORT}`

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
const PASSWORD = 'ai-turn-test-' + Math.random().toString(36).slice(2)

function testEmail() {
  return `darcy20080911+calyxaaiturn${Date.now()}@gmail.com`
}

// Service-role client: fixture setup/teardown ONLY (session.test.ts discipline).
const admin = createClient(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } })

let server: ChildProcess
let fakeAnthropic: Server
let user: { id: string }
let token: string

// Sprint 08: a second fixture user, seeded with one knowledge_nodes row, so
// the "live profile in the prompt" test has a non-calibrating profile to
// assert against without polluting `user`/`token` (which every other test in
// this file relies on staying at zero nodes -- the cold-start case).
let userWithProfile: { id: string }
let tokenWithProfile: string
const SEEDED_CONCEPT_KEY = 'algebra.quadratics.factoring'

// Sprint 09 Task 7: a third fixture user, seeded with an old, low-stability
// knowledge_nodes row, isolating the "decay-on-read" assertion from
// `userWithProfile` above (which intentionally stays undecayed -- raw
// mastery === rendered mastery -- as its own back-compat check).
let userDecayed: { id: string }
let tokenDecayed: string
const DECAY_CONCEPT_KEY = 'algebra.quadratics.formula'
const DECAY_RAW_MASTERY = 0.65
const DECAY_DAYS_AGO = 30
// retrievability(stability=1, days=30) = (1 + 30/9)^-1 = 3/13; 0.65 * 3/13 =
// 0.15 exactly, so the decayed value below isn't a rounding coincidence.
const DECAY_EXPECTED_MASTERY = '0.15'

// --- Fake Anthropic backend ---
// We spawn a REAL `next dev` below (not a direct route-function call) for the
// same reason session.test.ts does: it exercises proxy.ts for real, which
// matters here specifically because Task 3 found a live bug where proxy.ts
// redirected /api/ai/turn before the route ever ran. Mocking @anthropic-ai/sdk
// via vi.mock would only patch this test process, not that separate child
// process, so instead we point the SDK at a local stand-in for
// api.anthropic.com. @anthropic-ai/sdk reads `ANTHROPIC_BASE_URL` from the
// environment by default (see node_modules/@anthropic-ai/sdk/client.js), so
// no change to claude.ts is needed. This keeps the request fully local,
// deterministic, and free — no live model call, no real ANTHROPIC_API_KEY.
type FakeResponse = { status: number; body: unknown; headers?: Record<string, string> }

function fakeTextMessage(text: string) {
  return {
    id: 'msg_fake',
    type: 'message',
    role: 'assistant',
    model: 'claude-haiku-4-5-20251001',
    content: [{ type: 'text', text }],
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: { input_tokens: 1, output_tokens: 1 },
  }
}

let nextResponse: FakeResponse = { status: 200, body: fakeTextMessage('default fake reply') }
const receivedRequests: Array<{ system?: unknown; messages?: unknown; model?: unknown }> = []

function startFakeAnthropic(): Promise<Server> {
  return new Promise((resolveServer) => {
    const srv = http.createServer((req, res) => {
      let raw = ''
      req.on('data', (chunk) => (raw += chunk))
      req.on('end', () => {
        receivedRequests.push(JSON.parse(raw || '{}'))
        const { status, body, headers } = nextResponse
        res.writeHead(status, { 'Content-Type': 'application/json', ...headers })
        res.end(JSON.stringify(body))
      })
    })
    srv.listen(FAKE_ANTHROPIC_PORT, () => resolveServer(srv))
  })
}

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

async function turn(bearer: string | null, body: Record<string, unknown>) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (bearer) headers.Authorization = `Bearer ${bearer}`
  const res = await fetch(`${API_BASE}/api/ai/turn`, { method: 'POST', headers, body: JSON.stringify(body) })
  return { status: res.status, json: await res.json() }
}

beforeAll(async () => {
  fakeAnthropic = await startFakeAnthropic()

  const require = createRequire(import.meta.url)
  const nextBin = require.resolve('next/dist/bin/next')
  server = spawn(process.execPath, [nextBin, 'dev', '-p', String(PORT)], {
    cwd: process.cwd(),
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      // Fake key + local baseURL: even if a future change makes the route
      // call the SDK unexpectedly, there is no real key for it to use and no
      // route to api.anthropic.com from this process.
      ANTHROPIC_API_KEY: 'sk-ant-test-fake-key-not-real',
      ANTHROPIC_BASE_URL: `http://localhost:${FAKE_ANTHROPIC_PORT}`,
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

  const email = testEmail()
  const { data: created, error } = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
  })
  if (error || !created.user) throw new Error(`fixture setup failed: ${error?.message}`)
  user = { id: created.user.id }

  const client = createClient(url, anonKey)
  const { data: signIn, error: signInErr } = await client.auth.signInWithPassword({ email, password: PASSWORD })
  if (signInErr || !signIn.session) throw new Error(`sign-in failed: ${signInErr?.message}`)
  token = signIn.session.access_token

  // Sprint 08 fixture: a second user with one knowledge_nodes row inserted
  // directly via the service role (fixture setup, not an assertion). Mirrors
  // /supabase/seed/seed.sql's dev-only seed, just scoped to this test's own
  // disposable user instead of the shared dev account.
  const profileEmail = `darcy20080911+calyxaaiturnprofile${Date.now()}@gmail.com`
  const { data: createdProfile, error: profileErr } = await admin.auth.admin.createUser({
    email: profileEmail,
    password: PASSWORD,
    email_confirm: true,
  })
  if (profileErr || !createdProfile.user) {
    throw new Error(`fixture setup failed (profile user): ${profileErr?.message}`)
  }
  userWithProfile = { id: createdProfile.user.id }

  const { error: seedErr } = await admin.from('knowledge_nodes').insert({
    user_id: userWithProfile.id,
    concept_key: SEEDED_CONCEPT_KEY,
    mastery: 0.42,
    state: 'learning',
    confidence_band: 'medium',
    observation_count: 4,
  })
  if (seedErr) throw new Error(`fixture setup failed (knowledge_nodes seed): ${seedErr.message}`)

  const profileClient = createClient(url, anonKey)
  const { data: signInProfile, error: signInProfileErr } = await profileClient.auth.signInWithPassword({
    email: profileEmail,
    password: PASSWORD,
  })
  if (signInProfileErr || !signInProfile.session) {
    throw new Error(`sign-in failed (profile user): ${signInProfileErr?.message}`)
  }
  tokenWithProfile = signInProfile.session.access_token

  // Sprint 09 Task 7 fixture: a node practiced DECAY_DAYS_AGO days ago at
  // MIN_STABILITY (1.0) -- low stability so the power-decay curve has
  // visibly bitten by day 30. Inserted directly via the service role since
  // last_practiced_at has no "now" default to override (0004_knowledge_graph.sql).
  const decayedEmail = `darcy20080911+calyxaaiturndecayed${Date.now()}@gmail.com`
  const { data: createdDecayed, error: decayedErr } = await admin.auth.admin.createUser({
    email: decayedEmail,
    password: PASSWORD,
    email_confirm: true,
  })
  if (decayedErr || !createdDecayed.user) {
    throw new Error(`fixture setup failed (decayed user): ${decayedErr?.message}`)
  }
  userDecayed = { id: createdDecayed.user.id }

  const { error: decaySeedErr } = await admin.from('knowledge_nodes').insert({
    user_id: userDecayed.id,
    concept_key: DECAY_CONCEPT_KEY,
    mastery: DECAY_RAW_MASTERY,
    stability: 1.0,
    state: 'learning',
    confidence_band: 'medium',
    observation_count: 4,
    last_practiced_at: new Date(Date.now() - DECAY_DAYS_AGO * 24 * 60 * 60 * 1000).toISOString(),
  })
  if (decaySeedErr) throw new Error(`fixture setup failed (decayed knowledge_nodes seed): ${decaySeedErr.message}`)

  const decayedClient = createClient(url, anonKey)
  const { data: signInDecayed, error: signInDecayedErr } = await decayedClient.auth.signInWithPassword({
    email: decayedEmail,
    password: PASSWORD,
  })
  if (signInDecayedErr || !signInDecayed.session) {
    throw new Error(`sign-in failed (decayed user): ${signInDecayedErr?.message}`)
  }
  tokenDecayed = signInDecayed.session.access_token
}, 45000)

afterAll(async () => {
  if (userDecayed) {
    await admin.from('knowledge_nodes').delete().eq('user_id', userDecayed.id)
    await admin.auth.admin.deleteUser(userDecayed.id)
  }

  if (userWithProfile) {
    // knowledge_nodes.user_id -> public.users.id has no ON DELETE CASCADE
    // (0004_knowledge_graph.sql) -- clear the seeded row first so deleting
    // the auth user below doesn't hit a foreign-key violation.
    await admin.from('knowledge_nodes').delete().eq('user_id', userWithProfile.id)
    await admin.auth.admin.deleteUser(userWithProfile.id)
  }

  if (user) {
    await admin.auth.admin.deleteUser(user.id)
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

  await new Promise<void>((resolveClose) => fakeAnthropic.close(() => resolveClose()))
}, 20000)

beforeEach(() => {
  receivedRequests.length = 0
  nextResponse = { status: 200, body: fakeTextMessage('default fake reply') }
})

describe('/api/ai/turn', () => {
  it('rejects a no-bearer request with 401 and never calls the model', async () => {
    const { status } = await turn(null, { messages: [{ role: 'user', content: 'hi' }] })

    expect(status).toBe(401)
    expect(receivedRequests).toHaveLength(0)
  })

  it('rejects a garbage bearer with 401 and never calls the model', async () => {
    const { status } = await turn('garbage', { messages: [{ role: 'user', content: 'hi' }] })

    expect(status).toBe(401)
    expect(receivedRequests).toHaveLength(0)
  })

  it('the system prompt carries the math-only rule, the Socratic pedagogy block, and the live (cold-start) profile; the page-context slot is empty', async () => {
    const { status } = await turn(token, {
      messages: [{ role: 'user', content: 'How do I factor x^2+5x+6?' }],
    })

    expect(status).toBe(200)
    expect(receivedRequests).toHaveLength(1)

    const system = receivedRequests[0].system as string
    expect(typeof system).toBe('string')
    expect(system).toContain('NEVER answer anything outside mathematics')
    expect(system).toContain('DEFAULT MODE IS SOCRATIC')
    // `user` has zero knowledge_nodes -- loadProfile's cold-start fallback
    // (ADR-014), replacing the retired HARDCODED_PROFILE (ADR-009).
    expect(system).toContain('(no mastery data yet)')
    expect(system).toContain('(none active)')
    expect(system).toContain('Calibrating — early estimate.')
    expect(system).toContain('(no page context this turn)')

    expect(receivedRequests[0].messages).toEqual([
      { role: 'user', content: 'How do I factor x^2+5x+6?' },
    ])
  })

  // --- Sprint 08 Task 7: live profile read replaces HARDCODED_PROFILE ---

  it('live profile in the prompt: a seeded knowledge_node replaces the calibrating fallback', async () => {
    const { status } = await turn(tokenWithProfile, {
      messages: [{ role: 'user', content: 'How do I factor x^2+5x+6?' }],
    })

    expect(status).toBe(200)
    expect(receivedRequests).toHaveLength(1)

    const system = receivedRequests[0].system as string
    expect(system).toContain(`${SEEDED_CONCEPT_KEY}: mastery 0.42, state learning, confidence medium`)
    expect(system).not.toContain('(no mastery data yet)')
    expect(system).toContain('Confidence: Based on recorded session history.')
  })

  // --- Sprint 09 Task 7: read-time decay (ADR-016, profile-read.ts) ---

  it('decay-on-read: an old, low-stability node reads back with reduced mastery, not the raw stored value', async () => {
    const { status } = await turn(tokenDecayed, {
      messages: [{ role: 'user', content: 'How do I use the quadratic formula here?' }],
    })

    expect(status).toBe(200)
    expect(receivedRequests).toHaveLength(1)

    const system = receivedRequests[0].system as string
    expect(system).toContain(`${DECAY_CONCEPT_KEY}: mastery ${DECAY_EXPECTED_MASTERY}`)
    expect(system).not.toContain(`mastery ${DECAY_RAW_MASTERY.toFixed(2)}`)
  })

  it('writes nothing to knowledge_nodes on a turn (ADR-013 holds for the live profile read)', async () => {
    const before = await admin
      .from('knowledge_nodes')
      .select('mastery, observation_count')
      .eq('user_id', userWithProfile.id)
      .eq('concept_key', SEEDED_CONCEPT_KEY)
      .single()

    const { status } = await turn(tokenWithProfile, {
      messages: [{ role: 'user', content: 'Can you check my work on this one?' }],
    })
    expect(status).toBe(200)

    const after = await admin
      .from('knowledge_nodes')
      .select('mastery, observation_count')
      .eq('user_id', userWithProfile.id)
      .eq('concept_key', SEEDED_CONCEPT_KEY)
      .single()

    // The turn route only reads loadProfile -- the seeded row is untouched.
    expect(after.data).toEqual(before.data)
  })

  it('relays the model reply verbatim', async () => {
    nextResponse = { status: 200, body: fakeTextMessage('a known Socratic reply') }

    const { status, json } = await turn(token, { messages: [{ role: 'user', content: 'hi' }] })

    expect(status).toBe(200)
    expect(json.reply).toBe('a known Socratic reply')
  })

  it('rejects malformed messages with 400 and never calls the model', async () => {
    const empty = await turn(token, { messages: [] })
    expect(empty.status).toBe(400)

    const wrongRole = await turn(token, { messages: [{ role: 'system', content: 'hi' }] })
    expect(wrongRole.status).toBe(400)

    const lastNotUser = await turn(token, {
      messages: [
        { role: 'user', content: 'hi' },
        { role: 'assistant', content: 'ok' },
      ],
    })
    expect(lastNotUser.status).toBe(400)

    expect(receivedRequests).toHaveLength(0)
  })

  it('sanitises a provider failure into a 502 with no key/error leakage', async () => {
    // `x-should-retry: false` stops the SDK's default retry-on-5xx so this
    // resolves on the first attempt instead of after ~2 backoff retries.
    nextResponse = {
      status: 500,
      body: {
        type: 'error',
        error: { type: 'api_error', message: 'FAKE_PROVIDER_SECRET sk-ant-totally-real-should-not-leak' },
      },
      headers: { 'x-should-retry': 'false' },
    }

    const { status, json } = await turn(token, { messages: [{ role: 'user', content: 'hi' }] })

    expect(status).toBe(502)
    const raw = JSON.stringify(json)
    expect(raw).not.toContain('FAKE_PROVIDER_SECRET')
    expect(raw).not.toContain('sk-ant-totally-real-should-not-leak')
    expect(json.error).toBe('Tutor is unavailable right now.')
  })

  // --- Sprint 07 Task 4: page-context injection (ADR-012/ADR-013) ---
  // The "page-context slot is empty" case above already covers the
  // no-pageContext back-compat path (Sprint 05/06 behaviour); these add the
  // present-pageContext side.

  it('injects pageContext into the prompt so the tutor can reference on-screen content', async () => {
    const { status } = await turn(token, {
      messages: [{ role: 'user', content: 'what equation is this?' }],
      pageContext: { equations: [{ latex: 'x^2 + 5x + 6 = 0' }] },
    })

    expect(status).toBe(200)
    expect(receivedRequests).toHaveLength(1)

    const system = receivedRequests[0].system as string
    expect(system).toContain('x^2 + 5x + 6 = 0')
    expect(system).toContain('Anchor the session to THIS content')
    expect(system).not.toContain('(no page context this turn)')
  })

  it('degrades a malformed or oversized pageContext to "no page context" instead of crashing', async () => {
    const cases: unknown[] = [
      { equations: [] }, // valid but otherwise the cases below cover the failure shapes
      'just a string', // not an object at all
      { equations: 'not-an-array' },
      { equations: [{ latex: 12345 }] }, // wrong field type
      { equations: Array.from({ length: 50 }, (_, i) => ({ latex: `eq${i}` })) }, // over MAX_EQUATIONS
      { equations: [{ latex: 'x'.repeat(500) }] }, // over MAX_EQUATION_CHARS
      { equations: [], text: 'x'.repeat(3000) }, // over MAX_TEXT_CHARS
    ]

    for (const pageContext of cases) {
      const { status } = await turn(token, {
        messages: [{ role: 'user', content: 'hi' }],
        pageContext,
      })
      expect(status).toBe(200)
    }

    // The first case ({ equations: [] }) is well-formed-but-empty and also
    // falls back to the empty-slot wording (Task 2); every case here
    // degrades to the same short, bounded fallback rather than 500ing or
    // injecting unbounded text.
    for (const captured of receivedRequests) {
      expect(captured.system as string).toContain('(no page context this turn)')
    }
  })

  it('a missing bearer still 401s even when a pageContext is attached', async () => {
    const { status } = await turn(null, {
      messages: [{ role: 'user', content: 'hi' }],
      pageContext: { equations: [{ latex: 'x=1' }] },
    })

    expect(status).toBe(401)
    expect(receivedRequests).toHaveLength(0)
  })

  it('writes nothing to the database on a page-context turn (ADR-013 guard)', async () => {
    const before = await admin
      .from('sessions')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', user.id)

    const { status } = await turn(token, {
      messages: [{ role: 'user', content: 'what equation is this?' }],
      pageContext: { equations: [{ latex: 'x^2 + 5x + 6 = 0' }] },
    })
    expect(status).toBe(200)

    const after = await admin
      .from('sessions')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', user.id)

    // No row appeared in the one user-data table that exists today
    // (sessions) — the AI turn route is entirely separate from
    // /api/session/start and never touches it.
    expect(after.count).toBe(before.count)

    // Structural guard, mirroring the ADR-011 no-storage-import assertion
    // in voice.test.ts: the route's own source never imports the
    // service-role/write-capable client or calls an insert/upsert.
    const source = readFileSync(resolve(process.cwd(), 'app/api/ai/turn/route.ts'), 'utf-8')
    expect(source).not.toMatch(/from\s+['"]@\/lib\/supabase\/admin['"]/)
    expect(source).not.toMatch(/\.insert\(/)
    expect(source).not.toMatch(/\.upsert\(/)
  })
})
