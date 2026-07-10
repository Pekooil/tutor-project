import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { spawn, type ChildProcess } from 'node:child_process'
import { createRequire } from 'node:module'
import { beforeAll, afterAll, describe, it, expect, vi } from 'vitest'
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

// A fixed, deterministic salt for this suite -- never depends on a real
// URL_HASH_SALT being configured locally (ai-turn.test.ts's fake
// ANTHROPIC_API_KEY convention). Set before hashPageDomain is ever imported
// or called, and threaded into the spawned server's env below so both sides
// of the "route boundary" assertion hash with the SAME salt.
process.env.URL_HASH_SALT ||= 'url-hash-test-salt-do-not-use-in-prod'

// hashPageDomain (web/lib/privacy/url-hash.ts) is `import 'server-only'`.
// Next's bundler aliases that package away (its `react-server` export
// condition); plain vitest has no such condition, so the real module
// throws on import. Every OTHER suite that needs a server-only module's
// real behavior (session.test.ts's loadProfile comment is explicit about
// this) sidesteps it by only ever observing that behavior through a real
// spawned `next dev` -- this suite does the same for the route-boundary
// assertion below, and additionally neutralizes the guard just for this
// process so the SAME real hashPageDomain can be called directly to compute
// the expected value to assert against (there is no side effect to fake
// here, unlike admin.ts/cost-guard.ts, so there is nothing to mock instead).
vi.mock('server-only', () => ({}))

const { hashPageDomain } = await import('../lib/privacy/url-hash')

// Distinct from every other suite's spawned `next dev` (session.test.ts
// 3100 ... learning-events.test.ts 3110, axe-web-surfaces.test.ts 3108,
// profile-overview.test.ts 3109).
const PORT = 3112
const API_BASE = `http://localhost:${PORT}`

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
const PASSWORD = 'url-hash-test-' + Math.random().toString(36).slice(2)

function testEmail() {
  return `darcy20080911+calyxaurlhash${Date.now()}@gmail.com`
}

// Service-role client: fixture setup/teardown ONLY (session.test.ts discipline).
const admin = createClient(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } })

let server: ChildProcess
let user: { id: string }
let token: string
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

async function start(body: Record<string, unknown>) {
  const res = await fetch(`${API_BASE}/api/session/start`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return { status: res.status, json: await res.json() }
}

beforeAll(async () => {
  // Self-contained: spawn this workspace's own `next dev` (session.test.ts
  // convention) rather than relying on one already running.
  const require = createRequire(import.meta.url)
  const nextBin = require.resolve('next/dist/bin/next')
  server = spawn(process.execPath, [nextBin, 'dev', '-p', String(PORT)], {
    cwd: process.cwd(),
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      URL_HASH_SALT: process.env.URL_HASH_SALT,
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
}, 40000)

afterAll(async () => {
  for (const id of sessionIds) {
    await admin.from('sessions').delete().eq('id', id)
  }
  if (user) {
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
}, 20000)

describe('hashPageDomain', () => {
  it('is deterministic for a given salt', () => {
    expect(hashPageDomain('example.com')).toBe(hashPageDomain('example.com'))
  })

  it('differs across salts', () => {
    const original = process.env.URL_HASH_SALT
    const first = hashPageDomain('example.com')
    process.env.URL_HASH_SALT = original + '-different'
    const second = hashPageDomain('example.com')
    process.env.URL_HASH_SALT = original

    expect(first).not.toBe(second)
  })

  it('returns null for a null or empty domain', () => {
    expect(hashPageDomain(null)).toBeNull()
    expect(hashPageDomain('')).toBeNull()
  })

  it('produces a hex-encoded HMAC-SHA256 (64 hex characters)', () => {
    expect(hashPageDomain('example.com')).toMatch(/^[0-9a-f]{64}$/)
  })
})

describe('POST /api/session/start writes the hash, nulls plaintext domain', () => {
  it('a new session row gets a populated page_url_hash and a null page_domain', async () => {
    const { status, json } = await start({ mode: 'text', pageDomain: 'khanacademy.org' })
    expect(status).toBe(200)
    sessionIds.push(json.sessionId)

    const { data: row, error } = await admin
      .from('sessions')
      .select('page_domain, page_url_hash')
      .eq('id', json.sessionId)
      .single()

    expect(error).toBeNull()
    expect(row!.page_domain).toBeNull()
    expect(row!.page_url_hash).toBe(hashPageDomain('khanacademy.org'))
  })

  it('a session started with no pageDomain gets a null hash too (never a raw domain)', async () => {
    const { status, json } = await start({ mode: 'text' })
    expect(status).toBe(200)
    sessionIds.push(json.sessionId)

    const { data: row } = await admin
      .from('sessions')
      .select('page_domain, page_url_hash')
      .eq('id', json.sessionId)
      .single()

    expect(row!.page_domain).toBeNull()
    expect(row!.page_url_hash).toBeNull()
  })
})
