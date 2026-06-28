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
}, 45000)

afterAll(async () => {
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

  it('the system prompt carries the math-only rule, the Socratic pedagogy block, and the hardcoded profile; the page-context slot is empty', async () => {
    const { status } = await turn(token, {
      messages: [{ role: 'user', content: 'How do I factor x^2+5x+6?' }],
    })

    expect(status).toBe(200)
    expect(receivedRequests).toHaveLength(1)

    const system = receivedRequests[0].system as string
    expect(typeof system).toBe('string')
    expect(system).toContain('NEVER answer anything outside mathematics')
    expect(system).toContain('DEFAULT MODE IS SOCRATIC')
    expect(system).toContain('sign_error.distribution') // the hardcoded misconception (ADR-009)
    expect(system).toContain('(no page context this turn)')

    expect(receivedRequests[0].messages).toEqual([
      { role: 'user', content: 'How do I factor x^2+5x+6?' },
    ])
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
