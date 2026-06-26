import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { spawn, type ChildProcess } from 'node:child_process'
import { createRequire } from 'node:module'
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

beforeAll(async () => {
  // Self-contained: spawn this workspace's own `next dev` rather than
  // relying on one already running, so `npm test` needs no manual step and
  // exercises proxy.ts for real (a direct route-function call would not).
  const require = createRequire(import.meta.url)
  const nextBin = require.resolve('next/dist/bin/next')
  server = spawn(process.execPath, [nextBin, 'dev', '-p', String(PORT)], {
    cwd: process.cwd(),
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
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
