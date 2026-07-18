import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { spawn, type ChildProcess } from 'node:child_process'
import { createRequire } from 'node:module'
import http, { type Server } from 'node:http'
import { beforeAll, afterAll, describe, it, expect } from 'vitest'
import { createClient } from '@supabase/supabase-js'

// The Sprint 13 Task 9 EQUIVALENCE pin (ADR-026; renamed to status pins by
// ADR-034): `computeStatusPins` (events.ts) predicts what THIS turn's
// off-critical-path `applyInteraction` (apply.ts) will write, by running
// the SAME extracted `computeNodeUpdate` core read-only. This file asserts
// the two never drift for identical fixtures -- driven end-to-end via a
// real running server (apply.ts/events.ts sit behind `import
// 'server-only'`, which throws if imported directly into this vitest
// process outside Next's bundler, the same constraint
// ai-turn.test.ts/session.test.ts already document). A turn's PIN is read
// from the response; the ACTUAL write is read back from the DB after
// waiting for the off-critical-path apply to land (session.test.ts's
// waitFor convention) -- if the shared-core extraction ever let the two
// callers diverge, this is where it would show up as a real assertion
// failure, not a hypothetical.

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

// Distinct from every other suite's spawned `next dev` (session.test.ts
// 3100, ai-turn.test.ts 3101, voice.test.ts 3103, ai-stream.test.ts 3106,
// axe-web-surfaces.test.ts 3108, profile-overview.test.ts 3109).
const PORT = 3110
const FAKE_ANTHROPIC_PORT = 3111
const API_BASE = `http://localhost:${PORT}`

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
const PASSWORD = 'learning-events-test-' + Math.random().toString(36).slice(2)

const admin = createClient(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } })

let server: ChildProcess
let fakeAnthropic: Server
let user: { id: string }
let token: string

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

function startFakeAnthropic(): Promise<Server> {
  return new Promise((resolveServer) => {
    const srv = http.createServer((req, res) => {
      let raw = ''
      req.on('data', (chunk) => (raw += chunk))
      req.on('end', () => {
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

async function start(bearer: string, body: Record<string, unknown> = {}) {
  const res = await fetch(`${API_BASE}/api/session/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${bearer}` },
    body: JSON.stringify(body),
  })
  return { status: res.status, json: await res.json() }
}

async function turn(bearer: string, body: Record<string, unknown>) {
  const res = await fetch(`${API_BASE}/api/ai/turn`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${bearer}` },
    body: JSON.stringify(body),
  })
  return { status: res.status, json: await res.json() }
}

async function seedNode(row: {
  conceptKey: string
  mastery: number
  stability: number
  state: string
  confidenceBand: string
  observationCount: number
}) {
  const { error } = await admin.from('knowledge_nodes').insert({
    user_id: user.id,
    concept_key: row.conceptKey,
    mastery: row.mastery,
    stability: row.stability,
    difficulty: 0.3,
    state: row.state,
    confidence_band: row.confidenceBand,
    observation_count: row.observationCount,
    last_practiced_at: new Date().toISOString(),
  })
  if (error) throw new Error(`fixture seed failed for ${row.conceptKey}: ${error.message}`)
}

async function seedMisconception(conceptKey: string, consecutiveCorrect: number) {
  const { error } = await admin.from('misconceptions').insert({
    user_id: user.id,
    concept_key: conceptKey,
    category: 'sign-errors',
    description: 'drops the negative sign when distributing',
    status: 'active',
    occurrence_count: 2,
    consecutive_correct: consecutiveCorrect,
  })
  if (error) throw new Error(`fixture misconception seed failed for ${conceptKey}: ${error.message}`)
}

function soundCorrectEnvelope(conceptKey: string) {
  return {
    status: 200 as const,
    body: fakeTextMessage(
      JSON.stringify({
        say: 'Nice work.',
        assessment: {
          concept_key: conceptKey,
          outcome: 'correct',
          reasoning_quality: 'sound',
          self_confidence: 'high',
          misconception_category: null,
          confidence: 'high',
        },
      })
    ),
  }
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
      ANTHROPIC_API_KEY: 'sk-ant-test-fake-key-not-real',
      ANTHROPIC_BASE_URL: `http://localhost:${FAKE_ANTHROPIC_PORT}`,
      // ADR-052 flipped the DEFAULT tutor provider to OpenAI; this suite's
      // fake server speaks the ANTHROPIC wire shape, so pin the seam to the
      // retained Anthropic path (the same pin ai-turn.test.ts /
      // ai-stream.test.ts got at the flip; this file and session.test.ts
      // were missed — found 2026-07-18). Fake OpenAI key so no stray path
      // can spend real money from this process.
      TUTOR_PROVIDER: 'anthropic',
      STUDY_KIT_PROVIDER: 'anthropic',
      OPENAI_API_KEY: 'sk-test-fake-key-not-real',
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

  const email = `darcy20080911+calyxalearningevents${Date.now()}@gmail.com`
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
}, 45000)

afterAll(async () => {
  if (user) {
    await admin.from('session_interactions').delete().eq('user_id', user.id)
    await admin.from('sessions').delete().eq('user_id', user.id)
    await admin.from('reinforcement_schedule').delete().eq('user_id', user.id)
    await admin.from('misconceptions').delete().eq('user_id', user.id)
    await admin.from('knowledge_nodes').delete().eq('user_id', user.id)
    await admin.from('users').delete().eq('id', user.id)
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

describe('computeStatusPins prospective outcome == applyInteraction actual write', () => {
  it('a concept-understood pin (weak -> learning) predicts exactly the state applyInteraction then writes', async () => {
    const conceptKey = 'algebra.polynomials.expanding'
    await seedNode({ conceptKey, mastery: 0.45, stability: 5, state: 'weak', confidenceBand: 'low', observationCount: 2 })

    const started = await start(token, { mode: 'text' })
    expect(started.status).toBe(200)

    nextResponse = soundCorrectEnvelope(conceptKey)
    const { status, json } = await turn(token, {
      sessionId: started.json.sessionId,
      messages: [{ role: 'user', content: 'expanding attempt' }],
    })
    expect(status).toBe(200)
    expect(json.pins).toEqual([
      {
        category: 'progress',
        kind: 'concept-understood',
        conceptKey,
        label: 'Key concept understood: Expanding polynomials',
      },
    ])

    // The pin PREDICTED 'learning' (a "Key concept understood" label, not
    // "Mastered"). The real write, landing off the critical path, must
    // independently agree -- the whole point of the shared computeNodeUpdate
    // core.
    await waitFor(async () => {
      const { data, error } = await admin
        .from('knowledge_nodes')
        .select('state, mastery')
        .eq('user_id', user.id)
        .eq('concept_key', conceptKey)
        .single()
      if (error || !data) throw new Error('write has not landed yet')
      expect(data.state).toBe('learning')
      expect(data.mastery).toBeCloseTo(0.505, 3)
    })
  })

  it('a concept-understood pin crossing into "mastered" predicts exactly that, and the real write agrees', async () => {
    const conceptKey = 'algebra.quadratics.formula'
    // mastery already at 0.84 with a healthy (non-low) band and stability --
    // one more sound-correct clears MASTERED_THRESHOLD (0.85).
    await seedNode({ conceptKey, mastery: 0.84, stability: 20, state: 'learning', confidenceBand: 'medium', observationCount: 3 })

    const started = await start(token, { mode: 'text' })
    expect(started.status).toBe(200)

    nextResponse = soundCorrectEnvelope(conceptKey)
    const { status, json } = await turn(token, {
      sessionId: started.json.sessionId,
      messages: [{ role: 'user', content: 'quadratic formula attempt' }],
    })
    expect(status).toBe(200)
    expect(json.pins).toEqual([
      { category: 'progress', kind: 'concept-understood', conceptKey, label: 'Mastered: The quadratic formula' },
    ])

    await waitFor(async () => {
      const { data, error } = await admin
        .from('knowledge_nodes')
        .select('state')
        .eq('user_id', user.id)
        .eq('concept_key', conceptKey)
        .single()
      if (error || !data) throw new Error('write has not landed yet')
      expect(data.state).toBe('mastered')
    })
  })

  it('a pattern-broken pin predicts exactly the streak/status applyInteraction then writes', async () => {
    const conceptKey = 'algebra.exponents.product-rule'
    await seedNode({ conceptKey, mastery: 0.8, stability: 20, state: 'learning', confidenceBand: 'medium', observationCount: 6 })
    await seedMisconception(conceptKey, 2)

    const started = await start(token, { mode: 'text' })
    expect(started.status).toBe(200)

    nextResponse = soundCorrectEnvelope(conceptKey)
    const { status, json } = await turn(token, {
      sessionId: started.json.sessionId,
      messages: [{ role: 'user', content: 'exponent attempt' }],
    })
    expect(status).toBe(200)
    expect(json.pins).toEqual([
      { category: 'progress', kind: 'pattern-broken', conceptKey, label: 'Pattern broken: sign errors' },
    ])

    // The pin PREDICTED this turn's answer completes the streak (2 -> 3,
    // resolved). The real write must independently agree.
    await waitFor(async () => {
      const { data, error } = await admin
        .from('misconceptions')
        .select('status, consecutive_correct')
        .eq('user_id', user.id)
        .eq('concept_key', conceptKey)
        .eq('category', 'sign-errors')
        .single()
      if (error || !data) throw new Error('write has not landed yet')
      expect(data.consecutive_correct).toBe(3)
      expect(data.status).toBe('resolved')
    })
  })

  it('a turn predicting NO pin (an in-state tick) actually writes no state transition either', async () => {
    const conceptKey = 'algebra.inequalities.linear'
    await seedNode({ conceptKey, mastery: 0.6, stability: 10, state: 'learning', confidenceBand: 'medium', observationCount: 5 })

    const started = await start(token, { mode: 'text' })
    expect(started.status).toBe(200)

    nextResponse = soundCorrectEnvelope(conceptKey)
    const { status, json } = await turn(token, {
      sessionId: started.json.sessionId,
      messages: [{ role: 'user', content: 'inequality attempt' }],
    })
    expect(status).toBe(200)
    expect(json.pins).toBeUndefined()

    await waitFor(async () => {
      const { data, error } = await admin
        .from('knowledge_nodes')
        .select('state, observation_count')
        .eq('user_id', user.id)
        .eq('concept_key', conceptKey)
        .single()
      if (error || !data) throw new Error('write has not landed yet')
      // The write DID happen (observation_count incremented) -- only the
      // STATE stayed 'learning', matching the ping computation's silence.
      expect(data.observation_count).toBe(6)
      expect(data.state).toBe('learning')
    })
  })
})

describe('the apply.ts shared-core extraction: write-path behaviour unchanged', () => {
  it('a fresh (unseen) concept still writes the same mastery/state applyInteraction has always written (no seed row, no pin)', async () => {
    const conceptKey = 'algebra.linear-equations.two-variable'

    const started = await start(token, { mode: 'text' })
    expect(started.status).toBe(200)

    nextResponse = soundCorrectEnvelope(conceptKey)
    const { status, json } = await turn(token, {
      sessionId: started.json.sessionId,
      messages: [{ role: 'user', content: 'first attempt' }],
    })
    expect(status).toBe(200)
    expect(json.pins).toBeUndefined()

    await waitFor(async () => {
      const { data, error } = await admin
        .from('knowledge_nodes')
        .select('mastery, state, observation_count')
        .eq('user_id', user.id)
        .eq('concept_key', conceptKey)
        .single()
      if (error || !data) throw new Error('write has not landed yet')
      // BASE_K(0.3) * confidenceWeight(0)(=1) * grade(1) from mastery 0 --
      // the same fresh-node math every other suite in this repo pins.
      expect(data.mastery).toBeCloseTo(0.3, 3)
      expect(data.state).toBe('weak')
      expect(data.observation_count).toBe(1)
    })
  })
})
