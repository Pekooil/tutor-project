import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { spawn, type ChildProcess } from 'node:child_process'
import { createRequire } from 'node:module'
import http, { type Server } from 'node:http'
import { beforeAll, afterAll, describe, it, expect } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { FREE_SESSION_LIMIT } from '../lib/tier/session-gate'

// vitest doesn't auto-load .env.local the way `next dev`/`next build` do
// (rls.test.ts convention).
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

// A dedicated port, distinct from 3000, so this suite doesn't collide with a
// developer's already-running `next dev`.
const PORT = 3100
// Distinct from ai-turn.test.ts's fake Anthropic backend (3102) and
// voice.test.ts's fake providers (3104).
const FAKE_ANTHROPIC_PORT = 3105
const API_BASE = `http://localhost:${PORT}`

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
const PASSWORD = 'session-test-' + Math.random().toString(36).slice(2)

function testEmail(label: string) {
  return `darcy20080911+calyxasession${label}${Date.now()}@gmail.com`
}

// Service-role client: fixture setup/teardown ONLY. It bypasses RLS, so it
// must never appear in an assertion below (PLAN's "request-scoped clients
// for assertions, service role only for fixtures" discipline).
const admin = createClient(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } })

let server: ChildProcess
let userA: { id: string; email: string }
let userB: { id: string; email: string }
let clientA: SupabaseClient
let clientB: SupabaseClient
let tokenA: string
let tokenB: string
const sessionIds: string[] = []

// --- Fake Anthropic backend (Sprint 08 Task 7) ---
// /api/session/end's summariser call (summariseSession, ADR-015) is the only
// new path in this file that reaches the Anthropic SDK. Same technique as
// ai-turn.test.ts: @anthropic-ai/sdk reads ANTHROPIC_BASE_URL from the
// environment, so pointing it at this local stand-in keeps the whole suite
// local, deterministic, and free -- no live model call, no real
// ANTHROPIC_API_KEY. The existing Sprint 04 tests above never send a
// transcript, so the route never reaches this server for them -- this is
// purely additive.
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

let fakeAnthropic: Server
let nextFakeResponse: FakeResponse = { status: 200, body: fakeTextMessage(JSON.stringify({ observations: [] })) }
const receivedRequests: Array<{ system?: unknown; messages?: unknown }> = []

function startFakeAnthropic(): Promise<Server> {
  return new Promise((resolveServer) => {
    const srv = http.createServer((req, res) => {
      let raw = ''
      req.on('data', (chunk) => (raw += chunk))
      req.on('end', () => {
        receivedRequests.push(JSON.parse(raw || '{}'))
        const { status, body, headers } = nextFakeResponse
        res.writeHead(status, { 'Content-Type': 'application/json', ...headers })
        res.end(JSON.stringify(body))
      })
    })
    srv.listen(FAKE_ANTHROPIC_PORT, () => resolveServer(srv))
  })
}

// Sets what the NEXT call into the fake backend returns. The summariser call
// inside /api/session/end and a follow-up /api/ai/turn probe in the same
// test always run sequentially (awaited, never concurrently), so mutating
// this one shared variable right before each fetch is enough -- no per-call
// routing needed.
function setFakeSummary(observations: unknown[]) {
  nextFakeResponse = { status: 200, body: fakeTextMessage(JSON.stringify({ observations })) }
}

// `x-should-retry: false` stops the SDK's default retry-on-5xx, matching
// ai-turn.test.ts's "sanitises a provider failure" test.
function setFakeSummaryFailure() {
  nextFakeResponse = {
    status: 500,
    body: { type: 'error', error: { type: 'api_error', message: 'forced summariser failure' } },
    headers: { 'x-should-retry': 'false' },
  }
}

function setFakeTurnReply(text: string) {
  nextFakeResponse = { status: 200, body: fakeTextMessage(text) }
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

async function start(token: string | null, body: Record<string, unknown> = {}) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (token) headers.Authorization = `Bearer ${token}`
  const res = await fetch(`${API_BASE}/api/session/start`, { method: 'POST', headers, body: JSON.stringify(body) })
  return { status: res.status, json: await res.json() }
}

async function end(
  token: string | null,
  sessionId: string,
  transcript?: Array<{ role: 'user' | 'assistant'; content: string }>
) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (token) headers.Authorization = `Bearer ${token}`
  const res = await fetch(`${API_BASE}/api/session/end`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ sessionId, ...(transcript ? { transcript } : {}) }),
  })
  return { status: res.status, json: await res.json() }
}

// Sprint 08 Task 7: a real follow-up /api/ai/turn call against this same
// spawned server is how "a subsequent loadProfile reflects it" gets
// verified -- loadProfile lives behind `import 'server-only'`, which throws
// when loaded directly into the vitest process (no Next.js bundler
// `react-server` condition here), so the live profile can only be observed
// through the running server, same as every other assertion in this file.
async function turn(token: string | null, body: Record<string, unknown>) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (token) headers.Authorization = `Bearer ${token}`
  const res = await fetch(`${API_BASE}/api/ai/turn`, { method: 'POST', headers, body: JSON.stringify(body) })
  return { status: res.status, json: await res.json() }
}

beforeAll(async () => {
  fakeAnthropic = await startFakeAnthropic()

  // Self-contained: spawn this workspace's own `next dev` rather than
  // relying on one already running, so `npm test` needs no manual step and
  // exercises proxy.ts for real (a direct route-function call would not).
  const require = createRequire(import.meta.url)
  const nextBin = require.resolve('next/dist/bin/next')
  server = spawn(process.execPath, [nextBin, 'dev', '-p', String(PORT)], {
    cwd: process.cwd(),
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      // Fake key + local baseURL (ai-turn.test.ts convention): even though
      // only the new Sprint 08 tests below ever send a transcript, this
      // guarantees no real ANTHROPIC_API_KEY is reachable from this process.
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

  const { data: signInA, error: signInAErr } = await clientA.auth.signInWithPassword({
    email: emailA,
    password: PASSWORD,
  })
  if (signInAErr || !signInA.session) throw new Error(`sign-in failed for A: ${signInAErr?.message}`)
  tokenA = signInA.session.access_token

  const { data: signInB, error: signInBErr } = await clientB.auth.signInWithPassword({
    email: emailB,
    password: PASSWORD,
  })
  if (signInBErr || !signInB.session) throw new Error(`sign-in failed for B: ${signInBErr?.message}`)
  tokenB = signInB.session.access_token
}, 45000)

afterAll(async () => {
  // Teardown via the service role only, mirroring rls.test.ts.
  for (const id of sessionIds) {
    await admin.from('sessions').delete().eq('id', id)
  }
  if (userA) {
    // The Sprint 08 tables are cleared before deleting userA --
    // knowledge_nodes.user_id / misconceptions.user_id reference
    // public.users with no ON DELETE CASCADE (0004_knowledge_graph.sql), so
    // leftover rows here would otherwise block the users delete with a
    // foreign-key violation.
    await admin.from('misconceptions').delete().eq('user_id', userA.id)
    await admin.from('knowledge_nodes').delete().eq('user_id', userA.id)
    await admin.from('users').delete().eq('id', userA.id)
    await admin.auth.admin.deleteUser(userA.id)
  }
  if (userB) {
    await admin.from('users').delete().eq('id', userB.id)
    await admin.auth.admin.deleteUser(userB.id)
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

describe('session start/end + tier enforcement', () => {
  it('A starts a session under the limit: counts_against_free, not degraded, remaining decremented', async () => {
    const { status, json } = await start(tokenA, { pageDomain: 'example.com', mode: 'voice' })

    expect(status).toBe(200)
    expect(json.countsAgainstFree).toBe(true)
    expect(json.degraded).toBe(false)
    expect(json.remaining).toBe(FREE_SESSION_LIMIT - 1)

    sessionIds.push(json.sessionId)
  })

  it('driving A to the limit degrades the next start; free_session_count never exceeds the limit', async () => {
    for (let i = 1; i < FREE_SESSION_LIMIT; i++) {
      const { status, json } = await start(tokenA, { pageDomain: 'example.com', mode: 'voice' })
      expect(status).toBe(200)
      expect(json.degraded).toBe(false)
      expect(json.countsAgainstFree).toBe(true)
      expect(json.remaining).toBe(FREE_SESSION_LIMIT - (i + 1))
      sessionIds.push(json.sessionId)
    }

    const overLimit = await start(tokenA, { pageDomain: 'example.com', mode: 'voice' })
    expect(overLimit.status).toBe(200)
    expect(overLimit.json.degraded).toBe(true)
    expect(overLimit.json.countsAgainstFree).toBe(false)
    sessionIds.push(overLimit.json.sessionId)

    // Read as A (RLS-scoped) — never the service role in an assertion.
    const { data: row, error } = await clientA
      .from('users')
      .select('free_session_count')
      .eq('id', userA.id)
      .single()
    expect(error).toBeNull()
    expect(row!.free_session_count).toBe(FREE_SESSION_LIMIT)
  })

  it("B cannot end A's open session; it stays open", async () => {
    const targetId = sessionIds[0]

    const asB = await end(tokenB, targetId)
    expect(asB.status).toBe(404)
    expect(asB.json.error).toBe('no such open session')

    const { data, error } = await clientA.from('sessions').select('ended_at').eq('id', targetId).single()
    expect(error).toBeNull()
    expect(data!.ended_at).toBeNull()
  })

  it('A can end her own session', async () => {
    const targetId = sessionIds[0]

    const asA = await end(tokenA, targetId)
    expect(asA.status).toBe(200)
    expect(asA.json.sessionId).toBe(targetId)
    expect(asA.json.endedAt).not.toBeNull()
    expect(typeof asA.json.interactionCount).toBe('number')
  })

  it('no-bearer calls are rejected by the route with 401', async () => {
    const startRes = await start(null)
    expect(startRes.status).toBe(401)

    const endRes = await end(null, sessionIds[0])
    expect(endRes.status).toBe(401)
  })
})

// --- Sprint 08 Task 7: session-end summary write (ADR-014/ADR-015) ---
// All assertions read through clientA (RLS-scoped), never `admin` -- the
// service-role client stays fixture-setup/teardown only, per this file's
// existing discipline.
describe('session end -> live learning profile write', () => {
  let writtenSessionId: string

  it('ending with a transcript writes knowledge_nodes, and a subsequent turn reflects the live profile', async () => {
    setFakeSummary([{ conceptKey: 'algebra.quadratics.factoring', outcome: 'correct' }])

    const started = await start(tokenA, { pageDomain: 'example.com', mode: 'text' })
    expect(started.status).toBe(200)
    writtenSessionId = started.json.sessionId
    sessionIds.push(writtenSessionId)

    const transcript: Array<{ role: 'user' | 'assistant'; content: string }> = [
      { role: 'user', content: 'How do I factor x^2+5x+6?' },
      { role: 'assistant', content: 'What two numbers multiply to 6 and add to 5?' },
      { role: 'user', content: '2 and 3, so (x+2)(x+3)' },
    ]
    const ended = await end(tokenA, writtenSessionId, transcript)
    expect(ended.status).toBe(200)

    // "a subsequent loadProfile reflects it" -- observed via a real turn
    // against the live server (see the `turn` helper's comment above for why
    // loadProfile can't be imported directly into this test process).
    setFakeTurnReply('looks good, want to try another one?')
    const probe = await turn(tokenA, { messages: [{ role: 'user', content: 'what should I work on next?' }] })
    expect(probe.status).toBe(200)

    const system = receivedRequests[receivedRequests.length - 1].system as string
    // K=0.2 nudge from mastery 0, grade 1 (correct): 0 + 0.2*(1-0) = 0.20;
    // observationCount 1 -> confidence 'low'; mastery<0.5 -> state 'weak'
    // (update.ts). Not asserting an exact future-proof number -- just that
    // the seeded write is the one rendered into the prompt.
    expect(system).toContain('algebra.quadratics.factoring: mastery 0.20, state weak, confidence low')
    expect(system).not.toContain('(no mastery data yet)')
  })

  it('idempotent: ending the same session again 404s and writes nothing more', async () => {
    const reEnded = await end(tokenA, writtenSessionId, [{ role: 'user', content: 'one more try' }])
    expect(reEnded.status).toBe(404)

    setFakeTurnReply('still the same profile')
    const probe = await turn(tokenA, { messages: [{ role: 'user', content: 'check my progress' }] })
    expect(probe.status).toBe(200)

    const system = receivedRequests[receivedRequests.length - 1].system as string
    // Unchanged from the previous test -- end_session's open->ended
    // transition 404s before the summariser ever runs a second time, so
    // there is no second mastery nudge to observe here.
    expect(system).toContain('algebra.quadratics.factoring: mastery 0.20, state weak, confidence low')
  })

  it('ending with no transcript still ends the session and writes no learning state (back-compat)', async () => {
    const started = await start(tokenA, { pageDomain: 'example.com', mode: 'text' })
    expect(started.status).toBe(200)
    sessionIds.push(started.json.sessionId)

    const before = await clientA
      .from('knowledge_nodes')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userA.id)

    const ended = await end(tokenA, started.json.sessionId)
    expect(ended.status).toBe(200)

    const after = await clientA
      .from('knowledge_nodes')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userA.id)

    expect(after.count).toBe(before.count)
  })

  it('a forced summariser failure still ends the session (no 500) and writes no learning state for that session', async () => {
    setFakeSummaryFailure()

    const started = await start(tokenA, { pageDomain: 'example.com', mode: 'text' })
    expect(started.status).toBe(200)
    sessionIds.push(started.json.sessionId)

    const before = await clientA
      .from('knowledge_nodes')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userA.id)

    const ended = await end(tokenA, started.json.sessionId, [{ role: 'user', content: 'How do I solve 2x + 3 = 11?' }])
    expect(ended.status).toBe(200) // best-effort -- the session still ends (ADR-015)

    const after = await clientA
      .from('knowledge_nodes')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userA.id)

    expect(after.count).toBe(before.count) // summariser failed -> empty summary -> nothing written
  })

  it('two sessions flagging the same exact-category misconception promote it pending -> active, and it appears in the live profile', async () => {
    const misconception = {
      category: 'sign_error.distribution',
      description: 'drops the negative sign when distributing',
    }

    setFakeSummary([{ conceptKey: 'algebra.polynomials.expanding', outcome: 'incorrect', misconception }])
    const first = await start(tokenA, { pageDomain: 'example.com', mode: 'text' })
    sessionIds.push(first.json.sessionId)
    const firstEnd = await end(tokenA, first.json.sessionId, [{ role: 'user', content: '-(x+2) = -x+2' }])
    expect(firstEnd.status).toBe(200)

    setFakeTurnReply('ok, next one')
    const probeAfterFirst = await turn(tokenA, { messages: [{ role: 'user', content: 'next problem please' }] })
    expect(probeAfterFirst.status).toBe(200)
    const systemAfterFirst = receivedRequests[receivedRequests.length - 1].system as string
    expect(systemAfterFirst).not.toContain('sign_error.distribution') // 1 instance -- still pending, not active

    setFakeSummary([{ conceptKey: 'algebra.polynomials.expanding', outcome: 'incorrect', misconception }])
    const second = await start(tokenA, { pageDomain: 'example.com', mode: 'text' })
    sessionIds.push(second.json.sessionId)
    const secondEnd = await end(tokenA, second.json.sessionId, [{ role: 'user', content: '-(x+3) = -x+3' }])
    expect(secondEnd.status).toBe(200)

    setFakeTurnReply('ok, next one again')
    const probeAfterSecond = await turn(tokenA, { messages: [{ role: 'user', content: 'next problem please' }] })
    expect(probeAfterSecond.status).toBe(200)
    const systemAfterSecond = receivedRequests[receivedRequests.length - 1].system as string
    expect(systemAfterSecond).toContain(
      'algebra.polynomials.expanding — sign_error.distribution: drops the negative sign when distributing'
    )
  })
})
