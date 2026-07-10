import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { spawn, type ChildProcess } from 'node:child_process'
import { createRequire } from 'node:module'
import http, { type Server } from 'node:http'
import { beforeAll, afterAll, describe, it, expect } from 'vitest'
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

// Sprint 16 / Task 8 (ADR-041): the cost guard, exercised against the three
// real paid routes (ai/turn, voice/stt, voice/tts). Every route's guard sits
// behind `import 'server-only'` (cost-guard.ts, cost-model.ts), and Task 3's
// own bug history (see ai-turn.test.ts / voice.test.ts's comments: "Task 3
// found a live bug where proxy.ts redirected /api/ai/turn before the route
// ever ran") is exactly why this suite spawns a REAL `next dev`, same as
// those two, rather than importing the route modules directly.
//
// A real spawned server also means the SOFT_CAP_CENTS/HARD_CAP_CENTS this
// process reads are the true, deployed cost-model.ts values (2000/5000
// cents) UNLESS overridden -- which they are, via the COST_*_OVERRIDE env
// vars added to cost-model.ts alongside this suite (Task 8), specifically so
// this file never has to push the shared, global cost_ledger (one row per
// UTC day, no per-user scoping -- migration 0013) anywhere near its real
// $20/$50 thresholds to exercise the soft/hard branches. The override only
// takes effect inside THIS spawned process (port 3115); any other real
// deployment of the app keeps using the hardcoded defaults. The ledger
// itself is still the one real, shared row for today -- this suite only
// ever ADDS to it via the real atomic cost_guard RPC (never overwrites it),
// the same way any real usage would, so its footprint is bounded to the
// handful of cents this file's own calls spend.
//
// Computed RELATIVE to today's already-spent total (read once, below,
// before the server spawns) rather than hardcoded absolutes: the ledger is
// real and persists across runs (same UTC day), so a fixed "10 cents" cap
// would only ever be crossable once per day -- any later run (this suite
// re-run, or another test file's real usage) would find the day already
// past a hardcoded threshold and misreport "under cap" as degraded. Basing
// both caps on the CURRENT total makes every run idempotent regardless of
// how much this file (or anything else) has already spent today.
let TEST_SOFT_CAP_CENTS: number
let TEST_HARD_CAP_CENTS: number

// Distinct from every other suite's spawned `next dev` (account.test.ts /
// cron-auth.test.ts don't spawn one; url-hash.test.ts is 3112).
const PORT = 3115
const FAKE_PROVIDERS_PORT = 3116
const API_BASE = `http://localhost:${PORT}`

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
const PASSWORD = 'cost-guard-test-' + Math.random().toString(36).slice(2)

function testEmail() {
  return `darcy20080911+calyxacostguard${Date.now()}@gmail.com`
}

// Service-role client: fixture setup/teardown, and reading (never writing)
// the shared cost_ledger row for assertions (session.test.ts discipline).
const admin = createClient(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } })

let server: ChildProcess
let fakeProviders: Server
let user: { id: string }
let token: string

let anthropicCalls = 0
let whisperCalls = 0
let ttsCalls = 0

// --- Combined fake Anthropic + Whisper + ElevenLabs backend ---
// One HTTP stand-in on one port, path-routed, mirroring ai-turn.test.ts's
// fake Anthropic and voice.test.ts's fake Whisper/ElevenLabs exactly (same
// response shapes) but combined, since this file's routes span all three
// providers.
function startFakeProviders(): Promise<Server> {
  return new Promise((resolveServer) => {
    const srv = http.createServer((req, res) => {
      const chunks: Buffer[] = []
      req.on('data', (chunk) => chunks.push(chunk))
      req.on('end', () => {
        if (req.url === '/v1/messages') {
          anthropicCalls++
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(
            JSON.stringify({
              id: 'msg_fake',
              type: 'message',
              role: 'assistant',
              model: 'claude-haiku-4-5-20251001',
              content: [{ type: 'text', text: 'a known fake reply' }],
              stop_reason: 'end_turn',
              stop_sequence: null,
              usage: { input_tokens: 1, output_tokens: 1 },
            })
          )
          return
        }

        if (req.url === '/audio/transcriptions') {
          whisperCalls++
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ text: 'a known transcript' }))
          return
        }

        if (req.url?.startsWith('/text-to-speech/') && req.url.endsWith('/stream')) {
          ttsCalls++
          res.writeHead(200, { 'Content-Type': 'audio/mpeg' })
          res.end(Buffer.from('a known audio payload'))
          return
        }

        res.writeHead(404)
        res.end()
      })
    })
    srv.listen(FAKE_PROVIDERS_PORT, () => resolveServer(srv))
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

async function turn(body: Record<string, unknown>) {
  const res = await fetch(`${API_BASE}/api/ai/turn`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return { status: res.status, json: await res.json() }
}

async function stt(body: Buffer) {
  const res = await fetch(`${API_BASE}/api/voice/stt`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'audio/webm' },
    body: new Uint8Array(body),
  })
  return { status: res.status, json: await res.json() }
}

async function tts(text: string) {
  const res = await fetch(`${API_BASE}/api/voice/tts`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  })
  return { status: res.status, json: res.headers.get('content-type')?.includes('json') ? await res.json() : null }
}

// Reads today's real cost_ledger row (UTC day, migration 0013). Never
// written directly by this suite -- only ever read, for assertions, or
// added to via the real cost_guard RPC (padUp below).
async function todaysSpentCents(): Promise<number> {
  const day = new Date().toISOString().slice(0, 10)
  const { data } = await admin.from('cost_ledger').select('spent_cents').eq('day', day).maybeSingle()
  return data?.spent_cents ?? 0
}

// Pads the shared ledger up by exactly `cents` via the REAL atomic
// cost_guard RPC (never a raw overwrite -- additive only, so this can never
// clobber concurrent real spend). A huge cap pair guarantees this call
// itself never trips soft/hard, regardless of where today's real total
// already sits.
async function padLedgerBy(cents: number, authedClient: SupabaseClient) {
  const { error } = await authedClient.rpc('cost_guard', {
    p_estimated_cents: cents,
    p_soft_cap_cents: 1_000_000_000,
    p_hard_cap_cents: 1_000_000_000,
  })
  if (error) throw new Error(`padLedgerBy failed: ${error.message}`)
}

let bearerClient: SupabaseClient

beforeAll(async () => {
  const baseline = await todaysSpentCents()
  TEST_SOFT_CAP_CENTS = baseline + 10
  TEST_HARD_CAP_CENTS = baseline + 20

  fakeProviders = await startFakeProviders()

  const require = createRequire(import.meta.url)
  const nextBin = require.resolve('next/dist/bin/next')
  server = spawn(process.execPath, [nextBin, 'dev', '-p', String(PORT)], {
    cwd: process.cwd(),
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      ANTHROPIC_API_KEY: 'sk-ant-test-fake-key-not-real',
      ANTHROPIC_BASE_URL: `http://localhost:${FAKE_PROVIDERS_PORT}`,
      OPENAI_API_KEY: 'sk-test-fake-key-not-real',
      OPENAI_BASE_URL: `http://localhost:${FAKE_PROVIDERS_PORT}`,
      ELEVENLABS_API_KEY: 'el-test-fake-key-not-real',
      ELEVENLABS_VOICE_ID: 'fake-voice-id',
      ELEVENLABS_API_BASE_URL: `http://localhost:${FAKE_PROVIDERS_PORT}/text-to-speech`,
      COST_SOFT_CAP_CENTS_OVERRIDE: String(TEST_SOFT_CAP_CENTS),
      COST_HARD_CAP_CENTS_OVERRIDE: String(TEST_HARD_CAP_CENTS),
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

  bearerClient = createClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { autoRefreshToken: false, persistSession: false },
  })
}, 40000)

afterAll(async () => {
  if (user) {
    await admin.from('session_interactions').delete().eq('user_id', user.id)
    await admin.from('sessions').delete().eq('user_id', user.id)
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

  await new Promise<void>((resolveClose) => fakeProviders.close(() => resolveClose()))
}, 20000)

describe('under the cap: providers proceed normally', () => {
  it('a text turn calls the (fake) provider and carries no degraded flag', async () => {
    const before = anthropicCalls
    const { status, json } = await turn({ messages: [{ role: 'user', content: 'hi' }] })
    expect(status).toBe(200)
    expect(json.degraded).toBeUndefined()
    expect(anthropicCalls).toBe(before + 1)
  })

  it('STT calls the (fake) provider and returns a transcript', async () => {
    const before = whisperCalls
    const { status, json } = await stt(Buffer.from('fake audio bytes'))
    expect(status).toBe(200)
    expect(json.transcript).toBe('a known transcript')
    expect(json.degraded).toBeUndefined()
    expect(whisperCalls).toBe(before + 1)
  })

  it('TTS calls the (fake) provider and returns audio', async () => {
    const before = ttsCalls
    const res = await fetch(`${API_BASE}/api/voice/tts`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'hello there' }),
    })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('audio/mpeg')
    expect(ttsCalls).toBe(before + 1)
  })
})

describe('over the soft cap: voice degrades, text is flagged but still proceeds', () => {
  beforeAll(async () => {
    const spent = await todaysSpentCents()
    // Pad up to just under the (overridden) soft cap, then cross it with
    // the very next real call each test below makes -- proves the guard is
    // called BEFORE the provider on the exact turn that trips it, not just
    // "eventually".
    const short = Math.max(0, TEST_SOFT_CAP_CENTS - spent - 1)
    if (short > 0) await padLedgerBy(short, bearerClient)
  })

  it('a text turn still proceeds (calls the provider) but is flagged degraded', async () => {
    const before = anthropicCalls
    const { status, json } = await turn({ messages: [{ role: 'user', content: 'hi again' }] })
    expect(status).toBe(200)
    expect(json.degraded).toBe(true)
    expect(json.reply).toBeTruthy()
    expect(anthropicCalls).toBe(before + 1)
  })

  it('STT degrades to text: no provider call, { degraded: true }', async () => {
    const before = whisperCalls
    const { status, json } = await stt(Buffer.from('fake audio bytes'))
    expect(status).toBe(200)
    expect(json).toEqual({ degraded: true })
    expect(whisperCalls).toBe(before)
  })

  it('TTS degrades to text: no provider call, { degraded: true }', async () => {
    const before = ttsCalls
    const { status, json } = await tts('hello there')
    expect(status).toBe(200)
    expect(json).toEqual({ degraded: true })
    expect(ttsCalls).toBe(before)
  })
})

describe('over the hard cap: new AI turns are refused, never a 500 or a provider call', () => {
  beforeAll(async () => {
    const spent = await todaysSpentCents()
    const short = Math.max(0, TEST_HARD_CAP_CENTS - spent - 1)
    if (short > 0) await padLedgerBy(short, bearerClient)
  })

  it('a text turn returns the friendly resting message, no provider call, never a 500', async () => {
    const before = anthropicCalls
    const { status, json } = await turn({ messages: [{ role: 'user', content: 'one more?' }] })
    expect(status).toBe(200)
    expect(json.degraded).toBe(true)
    expect(json.reply).toMatch(/resting for today/)
    expect(anthropicCalls).toBe(before)
  })

  it('STT still degrades (no provider call), never a 500', async () => {
    const before = whisperCalls
    const { status, json } = await stt(Buffer.from('fake audio bytes'))
    expect(status).toBe(200)
    expect(json).toEqual({ degraded: true })
    expect(whisperCalls).toBe(before)
  })

  it('TTS still degrades (no provider call), never a 500', async () => {
    const before = ttsCalls
    const { status, json } = await tts('hello there')
    expect(status).toBe(200)
    expect(json).toEqual({ degraded: true })
    expect(ttsCalls).toBe(before)
  })
})

describe('cost_guard RPC atomicity', () => {
  it('concurrent calls cannot both slip under the cap -- every estimate lands exactly once', async () => {
    const CONCURRENT_CALLS = 25
    const PER_CALL_CENTS = 3
    const before = await todaysSpentCents()

    // A cap pair far above anything this adds, so soft/hard never trips --
    // this test is only about the ledger arithmetic being atomic, not the
    // threshold branches (those are covered above).
    const results = await Promise.all(
      Array.from({ length: CONCURRENT_CALLS }, () =>
        bearerClient.rpc('cost_guard', {
          p_estimated_cents: PER_CALL_CENTS,
          p_soft_cap_cents: 1_000_000_000,
          p_hard_cap_cents: 1_000_000_000,
        })
      )
    )

    expect(results.every((r) => r.error === null)).toBe(true)

    const after = await todaysSpentCents()
    expect(after - before).toBe(CONCURRENT_CALLS * PER_CALL_CENTS)
  })
})
