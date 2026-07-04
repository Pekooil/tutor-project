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

// --- Fake Anthropic backend (Sprint 08 Task 7; ADR-019 changes what calls it) ---
// Sprint 09/10: /api/session/end's summariser call (summariseSession,
// ADR-015) was the only path in this file reaching the Anthropic SDK.
// Sprint 11 (ADR-019) retires that call entirely -- learning state now
// writes per turn, via /api/ai/turn's envelope + off-critical-path apply,
// so /api/ai/turn is the only path this file's fake backend serves now.
// Same technique as ai-turn.test.ts: @anthropic-ai/sdk reads
// ANTHROPIC_BASE_URL from the environment, so pointing it at this local
// stand-in keeps the whole suite local, deterministic, and free -- no live
// model call, no real ANTHROPIC_API_KEY.
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
let nextFakeResponse: FakeResponse = { status: 200, body: fakeTextMessage('default fake reply') }
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

type FakeAssessment = {
  conceptKey: string
  outcome: 'correct' | 'partial' | 'incorrect' | 'none'
  reasoningQuality?: 'sound' | 'shallow' | 'none'
  selfConfidence?: 'low' | 'med' | 'high' | 'unknown'
  misconceptionCategory?: string | null
  misconceptionDescription?: string | null
}

// Sets the NEXT /api/ai/turn call's reply to a §2.5 envelope (ADR-019) --
// the mechanism that now drives every learning-state write in this file,
// replacing setFakeSummary. Calls in one test always run sequentially
// (awaited), so mutating this one shared variable right before each fetch
// is enough -- no per-call routing needed. Omitted assessment fields
// default exactly as envelope.ts's parseAssessment defaults them
// ('none'/'unknown'), matching what the old summariser's parser defaulted
// to for an unspecified reasoningQuality/selfConfidence.
function setFakeEnvelope(say: string, assessment?: FakeAssessment) {
  nextFakeResponse = {
    status: 200,
    body: fakeTextMessage(
      JSON.stringify({
        say,
        ...(assessment
          ? {
              assessment: {
                concept_key: assessment.conceptKey,
                outcome: assessment.outcome,
                reasoning_quality: assessment.reasoningQuality ?? 'none',
                self_confidence: assessment.selfConfidence ?? 'unknown',
                misconception_category: assessment.misconceptionCategory ?? null,
                misconception_description: assessment.misconceptionDescription ?? null,
                confidence: 'high',
              },
            }
          : {}),
      })
    ),
  }
}

// `x-should-retry: false` stops the SDK's default retry-on-5xx, matching
// ai-turn.test.ts's "sanitises a provider failure" test.
function setFakeTurnFailure() {
  nextFakeResponse = {
    status: 500,
    body: { type: 'error', error: { type: 'api_error', message: 'forced turn failure' } },
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

// ADR-019: the turn route's learning-state write runs off the critical
// path (after()), and ending a session only reconciles rows that were
// never claimed or whose claim looks abandoned (apply.ts's claimed_at
// staleness check) -- it does NOT wait for an in-flight after() that's
// already working. So there is no request in this file's vocabulary that
// synchronously guarantees "the write has landed." This polls a check
// function until it stops throwing (or times out), the standard pattern
// for asserting against an eventually-consistent, asynchronously-applied
// write instead of assuming any particular request is a hard sync point.
async function waitFor(check: () => Promise<void>, timeoutMs = 5000, intervalMs = 200): Promise<void> {
  const deadline = Date.now() + timeoutMs
  let lastError: unknown
  while (Date.now() < deadline) {
    try {
      await check()
      return
    } catch (err) {
      lastError = err
      await new Promise((r) => setTimeout(r, intervalMs))
    }
  }
  throw lastError
}

async function start(token: string | null, body: Record<string, unknown> = {}) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (token) headers.Authorization = `Bearer ${token}`
  const res = await fetch(`${API_BASE}/api/session/start`, { method: 'POST', headers, body: JSON.stringify(body) })
  return { status: res.status, json: await res.json() }
}

// ADR-019: no transcript parameter -- the route no longer accepts or needs
// one (learning state is already persisted per turn). Ending a session now
// also RECONCILEs any session_interactions row a turn's own after() hook
// hadn't applied yet, so calling this after one or more turn() calls is a
// deterministic sync point for asserting on knowledge_nodes/misconceptions,
// regardless of after()'s exact timing relative to turn()'s fetch resolving.
async function end(token: string | null, sessionId: string) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (token) headers.Authorization = `Bearer ${token}`
  const res = await fetch(`${API_BASE}/api/session/end`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ sessionId }),
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
  // Teardown via the service role only, mirroring rls.test.ts. Child-first
  // in the PLAN §2.7 erasure order -- NO FK in this schema cascades (0007's
  // comment), so session_interactions rows (written per turn as of ADR-019)
  // must go before their sessions, and reinforcement_schedule rows (ADR-020)
  // before the users row, or every delete below them fails silently with an
  // FK violation and the fixture users leak.
  if (userA) {
    await admin.from('session_interactions').delete().eq('user_id', userA.id)
  }
  for (const id of sessionIds) {
    await admin.from('sessions').delete().eq('id', id)
  }
  if (userA) {
    await admin.from('reinforcement_schedule').delete().eq('user_id', userA.id)
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

// --- Sprint 11: per-turn learning-state write (ADR-019/ADR-020) ---
// Sprint 08-10 drove every write in this block via a transcript passed to
// /api/session/end (summariseSession, ADR-015). ADR-019 retires that call
// entirely: the write now happens per turn, off /api/ai/turn's
// off-critical-path after() hook. Each test below drives the write with a
// real /api/ai/turn call carrying `sessionId` + an envelope-shaped fake
// reply (setFakeEnvelope). Ending the session (end()) reconciles rows the
// after() hook never got to, but it does NOT wait for one already in
// flight (apply.ts's claimed_at staleness check deliberately skips a
// recently-claimed row, on the assumption its own claimant is about to
// finish) -- so no request here is a hard synchronization point. Every
// assertion that depends on the write having landed goes through waitFor
// (above), which retries a short-lived poll instead of assuming any one
// call is a deterministic sync barrier. All assertions read through
// clientA (RLS-scoped), never `admin` -- the service-role client stays
// fixture-setup/teardown only, per this file's existing discipline.
describe('per-turn learning-state write -> live profile', () => {
  let writtenSessionId: string

  it('a turn with sessionId writes knowledge_nodes, and a subsequent turn reflects the live profile', async () => {
    const started = await start(tokenA, { pageDomain: 'example.com', mode: 'text' })
    expect(started.status).toBe(200)
    writtenSessionId = started.json.sessionId
    sessionIds.push(writtenSessionId)

    setFakeEnvelope('What two numbers multiply to 6 and add to 5?', {
      conceptKey: 'algebra.quadratics.factoring',
      outcome: 'correct',
    })
    const turnRes = await turn(tokenA, {
      sessionId: writtenSessionId,
      messages: [{ role: 'user', content: '2 and 3, so (x+2)(x+3)' }],
    })
    expect(turnRes.status).toBe(200)

    const ended = await end(tokenA, writtenSessionId)
    expect(ended.status).toBe(200)

    // "a subsequent loadProfile reflects it" -- observed via a real turn
    // against the live server (see the `turn` helper's comment above for why
    // loadProfile can't be imported directly into this test process). The
    // write may still be in flight via after() at this point (end() does
    // not wait for it -- see the describe-block comment above), so this
    // polls a fresh probe turn until the profile reflects it.
    await waitFor(async () => {
      setFakeTurnReply('looks good, want to try another one?')
      const probe = await turn(tokenA, { messages: [{ role: 'user', content: 'what should I work on next?' }] })
      expect(probe.status).toBe(200)

      const system = receivedRequests[receivedRequests.length - 1].system as string
      // apply.ts's applyInteraction calls the full FSRS updateKnowledgeNode
      // (ADR-016/ADR-019). This envelope omits reasoning_quality/
      // self_confidence, which envelope.ts's parseAssessment defaults to
      // 'none'/'unknown', which trips the lucky-guess discount on this
      // "correct" outcome: grade 0.6, K = BASE_K(0.3) * LUCKY_GUESS_K_SCALE(0.5)
      // * confidenceWeight(observationCount=0, =1) = 0.15; mastery
      // 0 + 0.15*(0.6-0) = 0.09. observationCount 1 -> confidence 'low';
      // mastery<0.5 -> state 'weak'. Not asserting an exact future-proof
      // number beyond that -- just that the seeded write is the one rendered
      // into the prompt.
      expect(system).toContain('algebra.quadratics.factoring: mastery 0.09, state weak, confidence low')
      expect(system).not.toContain('(no mastery data yet)')
    })
  })

  it('idempotent: ending the same session again 404s and writes nothing more', async () => {
    const reEnded = await end(tokenA, writtenSessionId)
    expect(reEnded.status).toBe(404)

    setFakeTurnReply('still the same profile')
    const probe = await turn(tokenA, { messages: [{ role: 'user', content: 'check my progress' }] })
    expect(probe.status).toBe(200)

    const system = receivedRequests[receivedRequests.length - 1].system as string
    // Unchanged from the previous test -- end_session's open->ended
    // transition 404s before the reconcile sweep ever runs a second time for
    // this session, so there is no second mastery nudge to observe here.
    expect(system).toContain('algebra.quadratics.factoring: mastery 0.09, state weak, confidence low')
  })

  it('ending a session with no turns still ends it and writes no learning state (back-compat)', async () => {
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

  it('a forced turn failure writes no interaction and no learning state, and the session still ends cleanly', async () => {
    const started = await start(tokenA, { pageDomain: 'example.com', mode: 'text' })
    expect(started.status).toBe(200)
    const failedSessionId = started.json.sessionId
    sessionIds.push(failedSessionId)

    const before = await clientA
      .from('knowledge_nodes')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userA.id)

    setFakeTurnFailure()
    const turnRes = await turn(tokenA, {
      sessionId: failedSessionId,
      messages: [{ role: 'user', content: 'How do I solve 2x + 3 = 11?' }],
    })
    expect(turnRes.status).toBe(502) // sanitised failure -- matches ai-turn.test.ts's own assertion

    const interactions = await clientA
      .from('session_interactions')
      .select('*', { count: 'exact', head: true })
      .eq('session_id', failedSessionId)
    expect(interactions.count).toBe(0) // runTutorTurn threw before persistInteraction ever ran

    const ended = await end(tokenA, failedSessionId)
    expect(ended.status).toBe(200) // best-effort -- the session still ends

    const after = await clientA
      .from('knowledge_nodes')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userA.id)

    expect(after.count).toBe(before.count) // no interaction was ever written -> nothing to reconcile
  })

  it('two sessions flagging the same exact-category misconception promote it pending -> active, and it appears in the live profile', async () => {
    const misconception = {
      category: 'sign_error.distribution',
      description: 'drops the negative sign when distributing',
    }

    const first = await start(tokenA, { pageDomain: 'example.com', mode: 'text' })
    sessionIds.push(first.json.sessionId)
    setFakeEnvelope('Watch the sign there.', {
      conceptKey: 'algebra.polynomials.expanding',
      outcome: 'incorrect',
      misconceptionCategory: misconception.category,
      misconceptionDescription: misconception.description,
    })
    const firstTurn = await turn(tokenA, {
      sessionId: first.json.sessionId,
      messages: [{ role: 'user', content: '-(x+2) = -x+2' }],
    })
    expect(firstTurn.status).toBe(200)
    const firstEnd = await end(tokenA, first.json.sessionId)
    expect(firstEnd.status).toBe(200)

    // Confirm the FIRST occurrence actually landed (pending, count 1)
    // before checking it's correctly absent from the profile -- otherwise
    // "not yet written at all" would pass this check just as trivially as
    // "written but still pending" would.
    await waitFor(async () => {
      const { data, error } = await clientA
        .from('misconceptions')
        .select('status, occurrence_count')
        .eq('user_id', userA.id)
        .eq('concept_key', 'algebra.polynomials.expanding')
        .eq('category', misconception.category)
        .single()
      expect(error).toBeNull()
      expect(data!.status).toBe('pending')
      expect(data!.occurrence_count).toBe(1)
    })

    setFakeTurnReply('ok, next one')
    const probeAfterFirst = await turn(tokenA, { messages: [{ role: 'user', content: 'next problem please' }] })
    expect(probeAfterFirst.status).toBe(200)
    const systemAfterFirst = receivedRequests[receivedRequests.length - 1].system as string
    expect(systemAfterFirst).not.toContain('sign_error.distribution') // 1 instance -- still pending, not active

    const second = await start(tokenA, { pageDomain: 'example.com', mode: 'text' })
    sessionIds.push(second.json.sessionId)
    setFakeEnvelope('Watch the sign there.', {
      conceptKey: 'algebra.polynomials.expanding',
      outcome: 'incorrect',
      misconceptionCategory: misconception.category,
      misconceptionDescription: misconception.description,
    })
    const secondTurn = await turn(tokenA, {
      sessionId: second.json.sessionId,
      messages: [{ role: 'user', content: '-(x+3) = -x+3' }],
    })
    expect(secondTurn.status).toBe(200)
    const secondEnd = await end(tokenA, second.json.sessionId)
    expect(secondEnd.status).toBe(200)

    await waitFor(async () => {
      setFakeTurnReply('ok, next one again')
      const probeAfterSecond = await turn(tokenA, { messages: [{ role: 'user', content: 'next problem please' }] })
      expect(probeAfterSecond.status).toBe(200)
      const systemAfterSecond = receivedRequests[receivedRequests.length - 1].system as string
      expect(systemAfterSecond).toContain(
        'algebra.polynomials.expanding — sign_error.distribution: drops the negative sign when distributing'
      )
    })
  })

  // --- Sprint 09 Task 7 / Sprint 11: full FSRS + scheduler write path
  // (ADR-016/ADR-017/ADR-019/ADR-020) ---

  it('FSRS persists stability and difficulty, not just mastery (Sprint 08 dropped them), and schedules reinforcement', async () => {
    const conceptKey = 'algebra.exponents.power-rule'

    setFakeEnvelope('Nice, that exponent rule is right.', {
      conceptKey,
      outcome: 'correct',
      reasoningQuality: 'sound',
      selfConfidence: 'high',
    })
    const started = await start(tokenA, { pageDomain: 'example.com', mode: 'text' })
    sessionIds.push(started.json.sessionId)
    const turnRes = await turn(tokenA, {
      sessionId: started.json.sessionId,
      messages: [{ role: 'user', content: '(x^2)^3 = x^6' }],
    })
    expect(turnRes.status).toBe(200)
    const ended = await end(tokenA, started.json.sessionId)
    expect(ended.status).toBe(200)

    await waitFor(async () => {
      const { data, error } = await clientA
        .from('knowledge_nodes')
        .select('stability, difficulty')
        .eq('user_id', userA.id)
        .eq('concept_key', conceptKey)
        .single()

      expect(error).toBeNull()
      // MIN_STABILITY floor (constants.ts) and the DIFF_MIN/DIFF_MAX drift
      // bounds -- the exact values are an implementation detail of the
      // (explicitly uncalibrated) package; what this test gates is that
      // these two columns are written at all, where update.ts never wrote
      // them.
      expect(data!.stability).toBeGreaterThanOrEqual(1.0)
      expect(data!.difficulty).toBeGreaterThan(0.05)
      expect(data!.difficulty).toBeLessThan(0.95)
    })

    // ADR-020: the same interaction that updated knowledge_nodes also
    // upserts one reinforcement_schedule row for this concept.
    await waitFor(async () => {
      const { data: scheduled, error: scheduleErr } = await clientA
        .from('reinforcement_schedule')
        .select('due_at, interval_days, priority, lapses')
        .eq('user_id', userA.id)
        .eq('concept_key', conceptKey)
        .single()

      expect(scheduleErr).toBeNull()
      expect(new Date(scheduled!.due_at).getTime()).toBeGreaterThan(Date.now()) // due in the future
      expect(scheduled!.interval_days).toBeGreaterThan(0)
      expect(scheduled!.priority).toBeGreaterThanOrEqual(0.5) // BASE_PRIORITY, no misconception/urgency boost here
      expect(scheduled!.lapses).toBe(0) // a correct outcome never increments lapses
    })
  })

  it('two sessions flagging the same error under DIFFERENT categories but similar wording collapse via pg_trgm, not exact-category', async () => {
    const conceptKey = 'algebra.inequalities.linear'

    setFakeEnvelope('Careful with that sign.', {
      conceptKey,
      outcome: 'incorrect',
      misconceptionCategory: 'sign_error.flip_on_negative_multiply',
      misconceptionDescription: 'forgets to flip the inequality sign when multiplying both sides by a negative number',
    })
    const first = await start(tokenA, { pageDomain: 'example.com', mode: 'text' })
    sessionIds.push(first.json.sessionId)
    const firstTurn = await turn(tokenA, {
      sessionId: first.json.sessionId,
      messages: [{ role: 'user', content: '-2x < 6 so x < -3' }],
    })
    expect(firstTurn.status).toBe(200)
    const firstEnd = await end(tokenA, first.json.sessionId)
    expect(firstEnd.status).toBe(200)

    // The SECOND turn's fuzzy match needs the FIRST misconception row to
    // already exist, or findMisconceptionMatch finds nothing and creates a
    // second row regardless of pg_trgm working correctly -- this would be a
    // false test failure indistinguishable from a real matching bug, not
    // just an assertion-timing flake, so this checkpoint is a correctness
    // precondition for the rest of the test, not just tidiness.
    await waitFor(async () => {
      const { data, error } = await clientA
        .from('misconceptions')
        .select('id')
        .eq('user_id', userA.id)
        .eq('concept_key', conceptKey)
        .eq('category', 'sign_error.flip_on_negative_multiply')
        .single()
      expect(error).toBeNull()
      expect(data).not.toBeNull()
    })

    // A different category label (simulating assessment drift across turns)
    // but a near-identical description -- exact-category match must fail
    // here, so only the pg_trgm fallback can collapse this onto the same row.
    setFakeEnvelope('Careful with that sign.', {
      conceptKey,
      outcome: 'incorrect',
      misconceptionCategory: 'inequality_sign_flip_error',
      misconceptionDescription: 'forgets to flip the inequality sign when multiplying both sides by a negative value',
    })
    const second = await start(tokenA, { pageDomain: 'example.com', mode: 'text' })
    sessionIds.push(second.json.sessionId)
    const secondTurn = await turn(tokenA, {
      sessionId: second.json.sessionId,
      messages: [{ role: 'user', content: '-5x < 10 so x < -2' }],
    })
    expect(secondTurn.status).toBe(200)
    const secondEnd = await end(tokenA, second.json.sessionId)
    expect(secondEnd.status).toBe(200)

    await waitFor(async () => {
      const { data, error } = await clientA
        .from('misconceptions')
        .select('id, category, status, occurrence_count')
        .eq('user_id', userA.id)
        .eq('concept_key', conceptKey)

      expect(error).toBeNull()
      expect(data).toHaveLength(1) // one row, not two -- the fuzzy match found the first row
      expect(data![0].category).toBe('sign_error.flip_on_negative_multiply') // the original, first-seen category
      expect(data![0].occurrence_count).toBe(2)
      expect(data![0].status).toBe('active') // promoted at 2 instances, same as exact-category
    })

    await waitFor(async () => {
      setFakeTurnReply('ok, next one')
      const probe = await turn(tokenA, { messages: [{ role: 'user', content: 'next problem please' }] })
      expect(probe.status).toBe(200)
      const system = receivedRequests[receivedRequests.length - 1].system as string
      expect(system).toContain(`${conceptKey} — sign_error.flip_on_negative_multiply`)
    })
  })

  it('three sound-correct sessions resolve an active misconception, and it leaves the live profile', async () => {
    const conceptKey = 'algebra.linear-equations.two-variable'
    const misconception = {
      category: 'forgot_substitution_step',
      description: 'skips substituting back into the other equation after solving for one variable',
    }

    // Two incorrect, misconception-flagging turns -- promotes pending ->
    // active. Each iteration's write must have actually landed before the
    // NEXT iteration's turn is processed (occurrence_count/
    // consecutive_correct are cumulative) -- this is a correctness
    // precondition for the loop, not just an end-of-test assertion, so each
    // iteration confirms its own expected count via waitFor before moving on.
    const misconceptionLines = ['substituted nothing back in', 'forgot to substitute again']
    for (let i = 0; i < misconceptionLines.length; i++) {
      setFakeEnvelope('Did you substitute back in?', {
        conceptKey,
        outcome: 'incorrect',
        misconceptionCategory: misconception.category,
        misconceptionDescription: misconception.description,
      })
      const started = await start(tokenA, { pageDomain: 'example.com', mode: 'text' })
      sessionIds.push(started.json.sessionId)
      const turnRes = await turn(tokenA, {
        sessionId: started.json.sessionId,
        messages: [{ role: 'user', content: misconceptionLines[i] }],
      })
      expect(turnRes.status).toBe(200)
      const ended = await end(tokenA, started.json.sessionId)
      expect(ended.status).toBe(200)

      const expectedCount = i + 1
      await waitFor(async () => {
        const { data, error } = await clientA
          .from('misconceptions')
          .select('occurrence_count')
          .eq('user_id', userA.id)
          .eq('concept_key', conceptKey)
          .eq('category', misconception.category)
          .single()
        expect(error).toBeNull()
        expect(data!.occurrence_count).toBe(expectedCount)
      })
    }

    const { data: afterPromotion, error: promotionErr } = await clientA
      .from('misconceptions')
      .select('id, status, consecutive_correct')
      .eq('user_id', userA.id)
      .eq('concept_key', conceptKey)
      .eq('category', misconception.category)
      .single()
    expect(promotionErr).toBeNull()
    expect(afterPromotion!.status).toBe('active')

    // Three sound-correct turns on the SAME concept, with no misconception
    // flagged -- each one advances consecutive_correct (apply.ts
    // applyMisconceptionResolution); the third flips active -> resolved.
    // Same per-iteration landing requirement as the loop above.
    for (let i = 0; i < 3; i++) {
      setFakeEnvelope('Nice, clean solve.', {
        conceptKey,
        outcome: 'correct',
        reasoningQuality: 'sound',
        selfConfidence: 'high',
      })
      const started = await start(tokenA, { pageDomain: 'example.com', mode: 'text' })
      sessionIds.push(started.json.sessionId)
      const turnRes = await turn(tokenA, {
        sessionId: started.json.sessionId,
        messages: [{ role: 'user', content: `clean attempt ${i}` }],
      })
      expect(turnRes.status).toBe(200)
      const ended = await end(tokenA, started.json.sessionId)
      expect(ended.status).toBe(200)

      const expectedStreak = i + 1
      await waitFor(async () => {
        const { data, error } = await clientA
          .from('misconceptions')
          .select('consecutive_correct, status')
          .eq('id', afterPromotion!.id)
          .single()
        expect(error).toBeNull()
        expect(data!.consecutive_correct).toBe(expectedStreak)
      })
    }

    const { data: afterResolution, error: resolutionErr } = await clientA
      .from('misconceptions')
      .select('status, consecutive_correct')
      .eq('id', afterPromotion!.id)
      .single()
    expect(resolutionErr).toBeNull()
    expect(afterResolution!.consecutive_correct).toBe(3)
    expect(afterResolution!.status).toBe('resolved')

    setFakeTurnReply('great work')
    const probe = await turn(tokenA, { messages: [{ role: 'user', content: 'how am I doing?' }] })
    expect(probe.status).toBe(200)
    const system = receivedRequests[receivedRequests.length - 1].system as string
    expect(system).not.toContain(misconception.category) // resolved -- loadProfile only selects status='active'
  })

  // --- Sprint 11 Task 8: the restored third lucky-guess sub-guard
  // (real response_latency_ms, ADR-016/ADR-019) + reconcile guarantees ---

  it('a fast unreasoned-looking correct moves mastery LESS than a reasoned one; session end reconciles nothing twice and makes NO Anthropic call', async () => {
    // Two fresh concepts, identical envelopes (correct/sound/high) -- the
    // ONLY difference is the client-measured latency, so any mastery gap is
    // the latency sub-guard and nothing else. For a fresh node (difficulty
    // 0.3) the threshold is fastGuessThresholdMs = 1500 * (1 + 0.3) =
    // 1950ms: 800ms trips it (grade 0.6, K scaled 0.5 -> mastery 0.09),
    // 20000ms doesn't (grade 1.0 -> mastery 0.30).
    const fastConcept = 'algebra.linear-equations.one-variable'
    const reasonedConcept = 'algebra.exponents.product-rule'

    const started = await start(tokenA, { pageDomain: 'example.com', mode: 'text' })
    expect(started.status).toBe(200)
    const sessionId = started.json.sessionId
    sessionIds.push(sessionId)

    setFakeEnvelope('Correct!', {
      conceptKey: fastConcept,
      outcome: 'correct',
      reasoningQuality: 'sound',
      selfConfidence: 'high',
    })
    const fastTurn = await turn(tokenA, {
      sessionId,
      messages: [{ role: 'user', content: 'x = 4' }],
      responseLatencyMs: 800,
    })
    expect(fastTurn.status).toBe(200)

    setFakeEnvelope('Correct!', {
      conceptKey: reasonedConcept,
      outcome: 'correct',
      reasoningQuality: 'sound',
      selfConfidence: 'high',
    })
    const reasonedTurn = await turn(tokenA, {
      sessionId,
      messages: [
        { role: 'user', content: 'x = 4' },
        { role: 'assistant', content: 'Correct!' },
        { role: 'user', content: 'x^3 * x^4 = x^7 because the exponents add' },
      ],
      responseLatencyMs: 20000,
    })
    expect(reasonedTurn.status).toBe(200)

    // Wait for both after() applies to land, then pin the guard's effect.
    let fastMastery = 0
    let reasonedMastery = 0
    await waitFor(async () => {
      const { data, error } = await clientA
        .from('knowledge_nodes')
        .select('concept_key, mastery')
        .eq('user_id', userA.id)
        .in('concept_key', [fastConcept, reasonedConcept])

      expect(error).toBeNull()
      expect(data).toHaveLength(2)
      fastMastery = data!.find((row) => row.concept_key === fastConcept)!.mastery
      reasonedMastery = data!.find((row) => row.concept_key === reasonedConcept)!.mastery
    })

    expect(fastMastery).toBeCloseTo(0.09, 3)
    expect(reasonedMastery).toBeCloseTo(0.3, 3)
    expect(fastMastery).toBeLessThan(reasonedMastery)

    // Both interactions fully applied (applied_to_profile is set only after
    // the FSRS/misconception/scheduler work actually ran -- apply.ts).
    await waitFor(async () => {
      const { data, error } = await clientA
        .from('session_interactions')
        .select('applied_to_profile, response_latency_ms')
        .eq('session_id', sessionId)

      expect(error).toBeNull()
      expect(data).toHaveLength(2)
      expect(data!.every((row) => row.applied_to_profile)).toBe(true)
    })

    // Ending the session now (1) makes no Anthropic call -- the summariser
    // is retired, reconcile is DB-only -- and (2) re-applies nothing:
    // every row is already applied_to_profile=true, so the sweep is a no-op.
    const requestsBefore = receivedRequests.length
    const ended = await end(tokenA, sessionId)
    expect(ended.status).toBe(200)
    expect(receivedRequests.length).toBe(requestsBefore)

    const { data: after, error: afterErr } = await clientA
      .from('knowledge_nodes')
      .select('concept_key, mastery, observation_count')
      .eq('user_id', userA.id)
      .in('concept_key', [fastConcept, reasonedConcept])

    expect(afterErr).toBeNull()
    for (const row of after!) {
      // One observation each -- a double apply would read 2 here and the
      // mastery values would have moved again.
      expect(row.observation_count).toBe(1)
      expect(row.mastery).toBeCloseTo(row.concept_key === fastConcept ? 0.09 : 0.3, 3)
    }
  })

  it('a weak concept with an active misconception is scheduled sooner and ranked higher than a healthy one (ADR-020)', async () => {
    // The weak side already exists: the pg_trgm test above left
    // algebra.inequalities.linear weak (two incorrects) with an ACTIVE
    // misconception, so its last scheduleReinforcement call took every
    // boost: priority 0.5 + 0.3 (misconception) + 0.2 (weak) = 1.0, the
    // x0.5 urgency interval scale, and lapses incremented per incorrect.
    //
    // The healthy side has to be MADE healthy first: every turn-driven node
    // in this file is young (low mastery -> weak -> urgency-boosted), so a
    // genuinely stable node is seeded via the service role (fixture data,
    // not an assertion) and then updated through a real reasoned turn so
    // ITS schedule row is written by the same production path.
    const weakConcept = 'algebra.inequalities.linear'
    const healthyConcept = 'algebra.quadratics.formula'

    const { error: seedErr } = await admin.from('knowledge_nodes').insert({
      user_id: userA.id,
      concept_key: healthyConcept,
      mastery: 0.7,
      stability: 20,
      state: 'learning',
      confidence_band: 'medium',
      observation_count: 5,
      last_practiced_at: new Date().toISOString(),
    })
    expect(seedErr).toBeNull()

    setFakeEnvelope('Clean use of the formula.', {
      conceptKey: healthyConcept,
      outcome: 'correct',
      reasoningQuality: 'sound',
      selfConfidence: 'high',
    })
    const started = await start(tokenA, { pageDomain: 'example.com', mode: 'text' })
    sessionIds.push(started.json.sessionId)
    const turnRes = await turn(tokenA, {
      sessionId: started.json.sessionId,
      messages: [{ role: 'user', content: 'x = (-b ± sqrt(b^2-4ac)) / 2a, so x = 2 or x = 3' }],
      responseLatencyMs: 25000,
    })
    expect(turnRes.status).toBe(200)
    const ended = await end(tokenA, started.json.sessionId)
    expect(ended.status).toBe(200)

    await waitFor(async () => {
      const { data: weak, error: weakErr } = await clientA
        .from('reinforcement_schedule')
        .select('due_at, interval_days, priority, lapses')
        .eq('user_id', userA.id)
        .eq('concept_key', weakConcept)
        .single()

      const { data: healthy, error: healthyErr } = await clientA
        .from('reinforcement_schedule')
        .select('due_at, interval_days, priority, lapses')
        .eq('user_id', userA.id)
        .eq('concept_key', healthyConcept)
        .single()

      expect(weakErr).toBeNull()
      expect(healthyErr).toBeNull()

      // Ranked higher: full boost stack vs bare BASE_PRIORITY.
      expect(weak!.priority).toBeCloseTo(1.0, 5)
      expect(healthy!.priority).toBeCloseTo(0.5, 5)

      // Pulled forward: the weak concept's interval collapsed to the
      // urgency-scaled floor region (9*S*(1/0.9-1) = 1 day at the stability
      // floor, x0.5 urgent = 0.5), while the stable node's interval grew
      // with its stability (= ~S days = ~20). due_at orders the same way.
      expect(weak!.interval_days).toBeLessThan(1)
      expect(healthy!.interval_days).toBeGreaterThan(5)
      expect(new Date(weak!.due_at).getTime()).toBeLessThan(new Date(healthy!.due_at).getTime())

      // Lapses counted per incorrect outcome (two incorrects), never for
      // the healthy concept's correct.
      expect(weak!.lapses).toBe(2)
      expect(healthy!.lapses).toBe(0)
    })
  })

  it("an abandoned session's stranded rows are swept at the next session START (cross-session reconcile)", async () => {
    // /api/session/end reconciles a session that ENDS -- but a session the
    // client abandoned (crash, closed tab) never reaches that route, and
    // before the session-start sweep its unapplied rows stayed stranded
    // forever (Sprint 11 audit finding). Simulate the strand directly: a
    // row whose turn-time after() hook "died" before applying (fixture via
    // the service role, per this file's discipline), in a session that is
    // never ended.
    const conceptKey = 'algebra.exponents.power-rule'

    const abandoned = await start(tokenA, { pageDomain: 'example.com', mode: 'text' })
    expect(abandoned.status).toBe(200)
    sessionIds.push(abandoned.json.sessionId)

    const { data: nodeBefore } = await clientA
      .from('knowledge_nodes')
      .select('observation_count')
      .eq('user_id', userA.id)
      .eq('concept_key', conceptKey)
      .single()
    const observationsBefore = nodeBefore!.observation_count

    const { data: strandedRow, error: strandErr } = await admin
      .from('session_interactions')
      .insert({
        session_id: abandoned.json.sessionId,
        user_id: userA.id,
        turn_index: 1,
        concept_key: conceptKey,
        student_transcript: 'so (x^2)^3 is x to the sixth',
        tutor_response: 'Exactly -- multiply the exponents.',
        outcome: 'correct',
        reasoning_quality: 'sound',
        self_confidence: 'high',
        applied_to_profile: false,
      })
      .select('id')
      .single()
    expect(strandErr).toBeNull()

    // The abandoned session is never ended. Starting the NEXT session is
    // what must recover the row.
    const next = await start(tokenA, { pageDomain: 'example.com', mode: 'text' })
    expect(next.status).toBe(200)
    sessionIds.push(next.json.sessionId)

    await waitFor(async () => {
      // The stranded row itself is marked applied...
      const { data: swept } = await clientA
        .from('session_interactions')
        .select('applied_to_profile')
        .eq('id', strandedRow!.id)
        .single()
      expect(swept!.applied_to_profile).toBe(true)

      // ...and its FSRS update genuinely landed, not just the flag flip.
      const { data: nodeAfter } = await clientA
        .from('knowledge_nodes')
        .select('observation_count')
        .eq('user_id', userA.id)
        .eq('concept_key', conceptKey)
        .single()
      expect(nodeAfter!.observation_count).toBe(observationsBefore + 1)
    })
  })
})
