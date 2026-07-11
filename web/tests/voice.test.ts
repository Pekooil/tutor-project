import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { spawn, type ChildProcess } from 'node:child_process'
import { createRequire } from 'node:module'
import http, { type Server } from 'node:http'
import { beforeAll, afterAll, beforeEach, describe, it, expect } from 'vitest'
import { createClient } from '@supabase/supabase-js'

// vitest doesn't auto-load .env.local the way `next dev`/`next build` do
// (rls.test.ts / session.test.ts / ai-turn.test.ts convention).
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

// Dedicated ports, distinct from session.test.ts (3100), ai-turn.test.ts
// (3101) and its fake Anthropic backend (3102).
const PORT = 3103
const FAKE_PROVIDERS_PORT = 3104
const API_BASE = `http://localhost:${PORT}`

// Must match /web/app/api/voice/stt/route.ts and tts/route.ts exactly, so the
// "oversized" tests cross the route's real cap rather than an assumed one.
const MAX_AUDIO_BYTES = 5 * 1024 * 1024
const MAX_TEXT_LENGTH = 2000

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
const PASSWORD = 'voice-test-' + Math.random().toString(36).slice(2)

function testEmail() {
  return `darcy20080911+calyxavoice${Date.now()}@gmail.com`
}

// Service-role client: fixture setup/teardown ONLY (session.test.ts discipline).
const admin = createClient(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } })

let server: ChildProcess
let fakeProviders: Server
let user: { id: string }
let token: string

// --- Fake Whisper + ElevenLabs backend ---
// We spawn a REAL `next dev` below (not a direct route-function call), for
// the same reason ai-turn.test.ts and session.test.ts do: it exercises
// proxy.ts for real, which matters here specifically because Task 3 found a
// live bug where proxy.ts redirected the voice routes before they ever ran.
// Mocking `openai` / `/web/lib/voice/elevenlabs.ts` via vi.mock would only
// patch this test process, not that separate child process, so instead we
// point both clients at a single local stand-in server: `openai` reads
// `OPENAI_BASE_URL` by default (see node_modules/openai/client.js), and
// elevenlabs.ts reads the equivalent `ELEVENLABS_API_BASE_URL` (added in
// this task for the same reason). No live provider call, no real keys.
type FakeJsonResponse = { status: number; body?: unknown; headers?: Record<string, string> }
type FakeAudioResponse = { status: number; bytes?: Buffer; headers?: Record<string, string> }

let whisperResponse: FakeJsonResponse = { status: 200, body: { text: 'a known transcript' } }
let ttsResponse: FakeAudioResponse = { status: 200, bytes: Buffer.from('a known audio payload') }
let whisperCalls = 0
let ttsCalls = 0
// Captures the JSON body of the MOST RECENT /text-to-speech/*/stream
// request the fake provider received (Sprint 15 Task 7) -- lets tests
// assert on exactly what elevenlabs.ts actually sent, the same way the
// existing *Calls counters assert on whether it was called at all.
let lastTtsRequestBody: Record<string, unknown> | null = null
// When set, the fake TTS endpoint writes each chunk with a delay in between
// instead of a single res.end() (Sprint 15 Task 8) -- this is what lets the
// streaming test below tell a genuine server-side pass-through (Task 6)
// apart from a route that still buffers the whole reply before responding:
// only a real pass-through can deliver the FIRST chunk well before the LAST
// one has even been produced by the (fake) provider.
let ttsChunkPlan: { chunks: Buffer[]; delayMs: number } | null = null

function startFakeProviders(): Promise<Server> {
  return new Promise((resolveServer) => {
    const srv = http.createServer((req, res) => {
      const chunks: Buffer[] = []
      req.on('data', (chunk) => chunks.push(chunk))
      req.on('end', () => {
        if (req.url === '/audio/transcriptions') {
          whisperCalls++
          const { status, body, headers } = whisperResponse
          res.writeHead(status, { 'Content-Type': 'application/json', ...headers })
          res.end(JSON.stringify(body ?? {}))
          return
        }

        if (req.url?.startsWith('/text-to-speech/') && req.url.endsWith('/stream')) {
          ttsCalls++
          try {
            lastTtsRequestBody = JSON.parse(Buffer.concat(chunks).toString('utf-8'))
          } catch {
            lastTtsRequestBody = null
          }

          if (ttsChunkPlan) {
            const { chunks: planChunks, delayMs } = ttsChunkPlan
            res.writeHead(200, { 'Content-Type': 'audio/mpeg' })
            let index = 0
            const writeNext = () => {
              if (index >= planChunks.length) {
                res.end()
                return
              }
              res.write(planChunks[index])
              index++
              setTimeout(writeNext, delayMs)
            }
            writeNext()
            return
          }

          const { status, bytes, headers } = ttsResponse
          res.writeHead(status, { 'Content-Type': 'audio/mpeg', ...headers })
          res.end(bytes ?? Buffer.alloc(0))
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

async function stt(bearer: string | null, body: Buffer, mimeType: string | null) {
  const headers: Record<string, string> = {}
  if (bearer) headers.Authorization = `Bearer ${bearer}`
  if (mimeType) headers['Content-Type'] = mimeType
  // A fresh Uint8Array, not the Buffer directly — DOM lib's BodyInit doesn't
  // accept Node's Buffer<ArrayBufferLike> type, though both carry the same
  // bytes over the wire.
  const res = await fetch(`${API_BASE}/api/voice/stt`, { method: 'POST', headers, body: new Uint8Array(body) })
  return { status: res.status, json: await res.json() }
}

async function tts(bearer: string | null, body: Record<string, unknown>) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (bearer) headers.Authorization = `Bearer ${bearer}`
  return fetch(`${API_BASE}/api/voice/tts`, { method: 'POST', headers, body: JSON.stringify(body) })
}

beforeAll(async () => {
  fakeProviders = await startFakeProviders()

  const require = createRequire(import.meta.url)
  const nextBin = require.resolve('next/dist/bin/next')
  server = spawn(process.execPath, [nextBin, 'dev', '-p', String(PORT)], {
    cwd: process.cwd(),
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      // Fake keys + local base URLs: even if a future change makes a route
      // call a provider unexpectedly, there is no real key for it to use and
      // no route to api.openai.com / api.elevenlabs.io from this process.
      OPENAI_API_KEY: 'sk-test-fake-key-not-real',
      OPENAI_BASE_URL: `http://localhost:${FAKE_PROVIDERS_PORT}`,
      ELEVENLABS_API_KEY: 'el-test-fake-key-not-real',
      ELEVENLABS_VOICE_ID: 'fake-voice-id',
      ELEVENLABS_API_BASE_URL: `http://localhost:${FAKE_PROVIDERS_PORT}/text-to-speech`,
      // Sprint 16's cost guardrail (ADR-041): both voice routes check
      // costGuard() and short-circuit to `{ degraded: true }` (never
      // reaching Whisper/ElevenLabs at all) once the GLOBAL, day-scoped
      // `cost_ledger` counter crosses its cap -- a counter shared with every
      // other process hitting this same live Supabase project today, real
      // usage included. This file tests the STT/TTS relay itself, not the
      // cost guardrail (that's cost-guard.test.ts's job, which deliberately
      // tunes these same two env vars the other direction to test
      // degradation on purpose). Set effectively infinite so this suite's
      // calls are never degraded regardless of the day's real cumulative
      // spend.
      COST_SOFT_CAP_CENTS_OVERRIDE: '999999999',
      COST_HARD_CAP_CENTS_OVERRIDE: '999999999',
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
  // A cold `next dev` compile on a 2-core CI runner can exceed the old 45s
  // hook budget (Sprint 18 CI); 120s is CI-slowness headroom, not a
  // correctness signal (cf. testTimeout).
}, 120000)

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

  await new Promise<void>((resolveClose) => fakeProviders.close(() => resolveClose()))
}, 20000)

beforeEach(() => {
  whisperCalls = 0
  ttsCalls = 0
  whisperResponse = { status: 200, body: { text: 'a known transcript' } }
  ttsResponse = { status: 200, bytes: Buffer.from('a known audio payload') }
  lastTtsRequestBody = null
  ttsChunkPlan = null
})

describe('/api/voice/stt', () => {
  it('rejects a no-bearer request with 401 and never calls Whisper', async () => {
    const { status } = await stt(null, Buffer.from('fake audio bytes'), 'audio/webm')

    expect(status).toBe(401)
    expect(whisperCalls).toBe(0)
  })

  it('rejects a garbage bearer with 401 and never calls Whisper', async () => {
    const { status } = await stt('garbage', Buffer.from('fake audio bytes'), 'audio/webm')

    expect(status).toBe(401)
    expect(whisperCalls).toBe(0)
  })

  it('relays the transcript and reports sttMs', async () => {
    whisperResponse = { status: 200, body: { text: 'how do I factor x^2+5x+6' } }

    const { status, json } = await stt(token, Buffer.from('fake audio bytes'), 'audio/webm')

    expect(status).toBe(200)
    expect(json.transcript).toBe('how do I factor x^2+5x+6')
    expect(typeof json.sttMs).toBe('number')
    expect(whisperCalls).toBe(1)
  })

  it('rejects a missing Content-Type with 400 and never calls Whisper', async () => {
    const { status } = await stt(token, Buffer.from('fake audio bytes'), null)

    expect(status).toBe(400)
    expect(whisperCalls).toBe(0)
  })

  it('rejects an empty body with 400 and never calls Whisper', async () => {
    const { status } = await stt(token, Buffer.alloc(0), 'audio/webm')

    expect(status).toBe(400)
    expect(whisperCalls).toBe(0)
  })

  it('rejects an oversized body with 400 and never calls Whisper', async () => {
    const { status } = await stt(token, Buffer.alloc(MAX_AUDIO_BYTES + 1), 'audio/webm')

    expect(status).toBe(400)
    expect(whisperCalls).toBe(0)
  })

  it('sanitises a Whisper failure into a 502 with no key/error leakage', async () => {
    whisperResponse = {
      status: 500,
      body: { error: { message: 'FAKE_OPENAI_SECRET sk-test-totally-real-should-not-leak' } },
      headers: { 'x-should-retry': 'false' },
    }

    const { status, json } = await stt(token, Buffer.from('fake audio bytes'), 'audio/webm')

    expect(status).toBe(502)
    const raw = JSON.stringify(json)
    expect(raw).not.toContain('FAKE_OPENAI_SECRET')
    expect(raw).not.toContain('sk-test-totally-real-should-not-leak')
    expect(json.error).toBe('Could not transcribe audio right now.')
  })

  it('imports no storage/Blob/DB client (ADR-011 guard)', () => {
    const source = readFileSync(resolve(process.cwd(), 'app/api/voice/stt/route.ts'), 'utf-8')

    expect(source).not.toMatch(/from\s+['"]@supabase/)
    expect(source).not.toMatch(/from\s+['"]node:fs['"]/)
    expect(source).not.toMatch(/from\s+['"]fs['"]/)
    expect(source).not.toMatch(/@vercel\/blob/)
  })
})

describe('/api/voice/tts', () => {
  it('rejects a no-bearer request with 401 and never calls ElevenLabs', async () => {
    const res = await tts(null, { text: 'hello' })

    expect(res.status).toBe(401)
    expect(ttsCalls).toBe(0)
  })

  it('rejects a garbage bearer with 401 and never calls ElevenLabs', async () => {
    const res = await tts('garbage', { text: 'hello' })

    expect(res.status).toBe(401)
    expect(ttsCalls).toBe(0)
  })

  it('relays the audio bytes and the x-tts-ms header', async () => {
    ttsResponse = { status: 200, bytes: Buffer.from('a known audio payload') }

    const res = await tts(token, { text: 'How do I factor this?' })

    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('audio/mpeg')
    expect(res.headers.get('x-tts-ms')).toMatch(/^\d+$/)
    const bytes = Buffer.from(await res.arrayBuffer())
    expect(bytes.toString()).toBe('a known audio payload')
    expect(ttsCalls).toBe(1)
  })

  it('pins model_id and voice_settings explicitly on every request (Sprint 15 Task 7, ADR-033)', async () => {
    const res = await tts(token, { text: 'How do I factor this?' })

    expect(res.status).toBe(200)
    // Must match web/lib/voice/elevenlabs.ts's MODEL_ID/VOICE_SETTINGS
    // constants exactly -- this test fails the moment either pin is
    // dropped from the request body (verified by reverting one, Task 7's
    // own acceptance gate), which is the whole point: a request that
    // silently falls back to ElevenLabs' provider-side defaults is exactly
    // the drift class ADR-033 closes.
    expect(lastTtsRequestBody?.model_id).toBe('eleven_flash_v2_5')
    expect(lastTtsRequestBody?.voice_settings).toEqual({
      stability: 0.5,
      similarity_boost: 0.75,
      style: 0,
      use_speaker_boost: true,
    })
  })

  it('streams the response body through as it arrives, rather than buffering server-side (Sprint 15 Task 6, ADR-033)', async () => {
    // Three chunks, 250ms apart -- if the route buffered the whole reply
    // before responding (the pre-Task-6 behavior), the client would only
    // ever observe one read resolving with everything at once, ~750ms+
    // after the request; a real pass-through delivers the first chunk
    // almost immediately and the rest as they land.
    ttsChunkPlan = {
      chunks: [Buffer.from('chunk-one-'), Buffer.from('chunk-two-'), Buffer.from('chunk-three')],
      delayMs: 250,
    }

    const startedAt = Date.now()
    const res = await tts(token, { text: 'stream this reply' })
    expect(res.status).toBe(200)
    expect(res.body).not.toBeNull()

    const reader = res.body!.getReader()
    const { value: firstChunk, done: firstDone } = await reader.read()
    const firstChunkAt = Date.now() - startedAt
    expect(firstDone).toBe(false)
    expect(firstChunk).toBeDefined()

    // Drain the rest.
    let allDone = false
    while (!allDone) {
      const { done } = await reader.read()
      allDone = done
    }
    const totalAt = Date.now() - startedAt

    // The first chunk arrives well before the full 500ms (2 delays) it takes
    // the fake provider to produce the LAST one -- proof this is a genuine
    // pass-through, not a buffer-then-relay that would make firstChunkAt and
    // totalAt roughly equal.
    expect(firstChunkAt).toBeLessThan(400)
    expect(totalAt - firstChunkAt).toBeGreaterThanOrEqual(400)
  })

  it('rejects empty text with 400 and never calls ElevenLabs', async () => {
    const res = await tts(token, { text: '' })

    expect(res.status).toBe(400)
    expect(ttsCalls).toBe(0)
  })

  it('rejects oversized text with 400 and never calls ElevenLabs', async () => {
    const res = await tts(token, { text: 'x'.repeat(MAX_TEXT_LENGTH + 1) })

    expect(res.status).toBe(400)
    expect(ttsCalls).toBe(0)
  })

  it('sanitises an ElevenLabs failure into a 502 with no key/error leakage', async () => {
    ttsResponse = {
      status: 500,
      bytes: Buffer.from('FAKE_ELEVENLABS_SECRET el-test-totally-real-should-not-leak'),
    }

    const res = await tts(token, { text: 'hello' })

    expect(res.status).toBe(502)
    const json = await res.json()
    const raw = JSON.stringify(json)
    expect(raw).not.toContain('FAKE_ELEVENLABS_SECRET')
    expect(raw).not.toContain('el-test-totally-real-should-not-leak')
    expect(json.error).toBe('Could not generate audio right now.')
  })
})
