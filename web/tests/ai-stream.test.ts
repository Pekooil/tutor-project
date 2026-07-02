import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { spawn, type ChildProcess } from 'node:child_process'
import { createRequire } from 'node:module'
import http, { type Server } from 'node:http'
import { beforeAll, afterAll, beforeEach, describe, it, expect } from 'vitest'
import { createClient } from '@supabase/supabase-js'

// `/api/ai/stream` (Task 6) has no test today — it's real, deployed, and
// additive, but currently unused by the extension (background/index.ts's
// AI_STREAM handler calls the plain, non-streaming /api/ai/turn instead and
// fakes word-by-word delivery client-side — a Turbopack dev-server
// limitation made this route unreliable during Task 6). Covered here as a
// live, auth-gated API surface regardless of whether anything calls it yet.
//
// Mirrors ai-turn.test.ts's pattern (spawn a real `next dev` so proxy.ts
// runs for real, point the Anthropic SDK at a local fake server via
// ANTHROPIC_BASE_URL) but the fake server must speak the SDK's actual
// streaming wire format (named SSE events, not just JSON blobs) since
// runTutorTurnStream uses the SDK's high-level `messages.stream()` helper.

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

// Distinct from every other suite's ports (session 3100, ai-turn 3101/3102,
// voice 3103/3104, session's fake-Anthropic 3105).
const PORT = 3106
const FAKE_ANTHROPIC_PORT = 3107
const API_BASE = `http://localhost:${PORT}`

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
const PASSWORD = 'ai-stream-test-' + Math.random().toString(36).slice(2)

function testEmail() {
  return `darcy20080911+calyxaaistream${Date.now()}@gmail.com`
}

const admin = createClient(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } })

let server: ChildProcess
let fakeAnthropic: Server
let user: { id: string }
let token: string

let nextChunks: string[] = ['default fake reply']
const receivedRequests: Array<{ system?: unknown; messages?: unknown; stream?: unknown }> = []

function sseFrame(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
}

// Builds a minimal but real Anthropic streaming response: message_start ->
// content_block_start -> one content_block_delta per chunk -> content_block_stop
// -> message_delta -> message_stop. @anthropic-ai/sdk's Stream decoder keys
// off the `event:` line (not just the JSON body's own `type` field), and
// MessageStream's internal snapshot accumulator throws "Unexpected event
// order" if message_start doesn't come first or content_block_delta arrives
// before content_block_start — so the order here isn't cosmetic.
function buildAnthropicStreamBody(chunks: string[]): string {
  let body = sseFrame('message_start', {
    type: 'message_start',
    message: {
      id: 'msg_fake',
      type: 'message',
      role: 'assistant',
      model: 'claude-haiku-4-5-20251001',
      content: [],
      stop_reason: null,
      stop_sequence: null,
      usage: { input_tokens: 1, output_tokens: 0 },
    },
  })
  body += sseFrame('content_block_start', {
    type: 'content_block_start',
    index: 0,
    content_block: { type: 'text', text: '' },
  })
  for (const chunk of chunks) {
    body += sseFrame('content_block_delta', {
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'text_delta', text: chunk },
    })
  }
  body += sseFrame('content_block_stop', { type: 'content_block_stop', index: 0 })
  body += sseFrame('message_delta', {
    type: 'message_delta',
    delta: { stop_reason: 'end_turn', stop_sequence: null },
    usage: { output_tokens: chunks.length },
  })
  body += sseFrame('message_stop', { type: 'message_stop' })
  return body
}

function startFakeAnthropic(): Promise<Server> {
  return new Promise((resolveServer) => {
    const srv = http.createServer((req, res) => {
      let raw = ''
      req.on('data', (chunk) => (raw += chunk))
      req.on('end', () => {
        receivedRequests.push(JSON.parse(raw || '{}'))
        res.writeHead(200, { 'Content-Type': 'text/event-stream' })
        res.end(buildAnthropicStreamBody(nextChunks))
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

// Parses THIS app's own SSE wire format (app/api/ai/stream/route.ts's
// sseChunk helper: `data: {"text":...}\n\n` per delta, `data: [DONE]\n\n` to
// close), not Anthropic's — the route re-encodes runTutorTurnStream's yields
// into its own envelope before they ever reach a client.
async function streamTurn(bearer: string | null, body: Record<string, unknown>) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (bearer) headers.Authorization = `Bearer ${bearer}`
  const res = await fetch(`${API_BASE}/api/ai/stream`, { method: 'POST', headers, body: JSON.stringify(body) })

  if (!res.body) return { status: res.status, deltas: [] as string[], errorPayload: undefined as unknown }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  const deltas: string[] = []
  let errorPayload: unknown

  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const frames = buffer.split('\n\n')
    buffer = frames.pop() ?? ''
    for (const frame of frames) {
      const line = frame.trim()
      if (!line.startsWith('data: ')) continue
      const payload = line.slice('data: '.length)
      if (payload === '[DONE]') continue
      const parsed = JSON.parse(payload)
      if (parsed && typeof parsed === 'object' && 'error' in parsed) errorPayload = parsed.error
      else if (parsed && typeof parsed.text === 'string') deltas.push(parsed.text)
    }
  }

  return { status: res.status, deltas, errorPayload }
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
  nextChunks = ['default ', 'fake ', 'reply']
})

describe('/api/ai/stream', () => {
  it('rejects a no-bearer request with 401 and never calls the model', async () => {
    const { status, deltas } = await streamTurn(null, { messages: [{ role: 'user', content: 'hi' }] })

    expect(status).toBe(401)
    expect(deltas).toHaveLength(0)
    expect(receivedRequests).toHaveLength(0)
  })

  it('rejects a garbage bearer with 401 and never calls the model', async () => {
    const { status } = await streamTurn('garbage', { messages: [{ role: 'user', content: 'hi' }] })

    expect(status).toBe(401)
    expect(receivedRequests).toHaveLength(0)
  })

  it('streams text deltas through in order and the assembled reply matches the source chunks', async () => {
    nextChunks = ['The ', 'quadratic ', 'formula ', 'is...']

    const { status, deltas } = await streamTurn(token, {
      messages: [{ role: 'user', content: 'How do I solve this?' }],
    })

    expect(status).toBe(200)
    expect(deltas).toEqual(['The ', 'quadratic ', 'formula ', 'is...'])
    expect(deltas.join('')).toBe('The quadratic formula is...')
  })

  it('rejects malformed messages with 400 and never calls the model', async () => {
    const empty = await streamTurn(token, { messages: [] })
    expect(empty.status).toBe(400)

    const lastNotUser = await streamTurn(token, {
      messages: [
        { role: 'user', content: 'hi' },
        { role: 'assistant', content: 'ok' },
      ],
    })
    expect(lastNotUser.status).toBe(400)

    expect(receivedRequests).toHaveLength(0)
  })

  it('writes nothing to the database on a streamed turn (ADR-013 guard, same discipline as /api/ai/turn)', async () => {
    const before = await admin
      .from('sessions')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', user.id)

    const { status } = await streamTurn(token, { messages: [{ role: 'user', content: 'hi' }] })
    expect(status).toBe(200)

    const after = await admin
      .from('sessions')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', user.id)

    expect(after.count).toBe(before.count)

    const source = readFileSync(resolve(process.cwd(), 'app/api/ai/stream/route.ts'), 'utf-8')
    expect(source).not.toMatch(/from\s+['"]@\/lib\/supabase\/admin['"]/)
    expect(source).not.toMatch(/\.insert\(/)
    expect(source).not.toMatch(/\.upsert\(/)
  })
})
