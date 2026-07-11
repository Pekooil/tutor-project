// @vitest-environment jsdom
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { spawn, type ChildProcess } from 'node:child_process'
import { createRequire } from 'node:module'
import { beforeAll, afterAll, describe, it, expect } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import axe from 'axe-core'

// Task 9 item 4: an axe-core check on the redesigned login/signup/account
// surfaces. Spawns a real `next dev` (same discipline as ai-turn.test.ts /
// session.test.ts) and runs axe against each page's REAL server-rendered
// HTML, loaded into this file's jsdom document via `// @vitest-environment
// jsdom` (the other suites in this workspace stay on vitest's default node
// environment, since they never render a DOM).

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
// voice 3103/3104, session's fake-Anthropic 3105, ai-stream 3106/3107).
const PORT = 3108
const API_BASE = `http://localhost:${PORT}`

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
const PASSWORD = 'axe-web-test-' + Math.random().toString(36).slice(2)

function testEmail() {
  return `darcy20080911+calyxaaxeweb${Date.now()}@gmail.com`
}

const admin = createClient(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } })

let server: ChildProcess
let user: { id: string }
let sessionCookie: string

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

// color-contrast is disabled: jsdom doesn't compute CSS layout/cascade (a
// known, documented limitation — getComputedStyle in jsdom can't reliably
// resolve effective background/foreground colors), so axe's contrast check
// is unreliable here. Contrast on every surface, including the accent-green
// pairs, was verified live in a real browser during Task 8's QA sweep (0
// violations) and is documented with computed ratios in theme.css itself —
// this check covers the structural rules jsdom CAN evaluate (labels, roles,
// aria-*, landmarks, button/link names, form associations).
async function axeCheck(path: string, cookie?: string): Promise<{ path: string; violations: unknown[] }> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: cookie ? { Cookie: cookie } : undefined,
  })
  const html = await res.text()
  document.open()
  document.write(html)
  document.close()
  const results = await axe.run(document, {
    runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] },
    rules: { 'color-contrast': { enabled: false } },
  })
  return { path, violations: results.violations }
}

beforeAll(async () => {
  const require = createRequire(import.meta.url)
  const nextBin = require.resolve('next/dist/bin/next')
  server = spawn(process.execPath, [nextBin, 'dev', '-p', String(PORT)], {
    cwd: process.cwd(),
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: process.env,
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

  // Sign in through the REAL route (not supabase-js directly), so the
  // response carries the actual Set-Cookie headers a browser would get --
  // captured and replayed verbatim on the /account request below, so that
  // page's server component sees a genuinely authenticated request.
  const loginRes = await fetch(`${API_BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD }),
  })
  if (!loginRes.ok) throw new Error(`fixture sign-in failed: ${loginRes.status}`)
  const setCookies = loginRes.headers.getSetCookie()
  sessionCookie = setCookies.map((c) => c.split(';')[0]).join('; ')
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
}, 20000)

describe('web surfaces — WCAG 2.1 A/AA structural smoke (axe-core)', () => {
  it('login renders with no critical a11y violations', async () => {
    const { violations } = await axeCheck('/login')
    expect(violations).toEqual([])
  })

  it('signup renders with no critical a11y violations', async () => {
    const { violations } = await axeCheck('/signup')
    expect(violations).toEqual([])
  })

  it('account (authenticated) renders with no critical a11y violations', async () => {
    expect(sessionCookie).toBeTruthy()
    const { violations } = await axeCheck('/account', sessionCookie)
    expect(violations).toEqual([])
  })

  // Sprint 18 Task 4 (ADR-044): the account page is the only web surface a
  // real user hits that carries the Sprint 16 GDPR controls (export + delete,
  // ADR-035). axeCheck above already ran the whole /account HTML through axe,
  // so those controls are covered for name/role/label violations; this makes
  // the audit of them EXPLICIT and guards against either silently vanishing
  // (a regression that would otherwise pass the "no violations" check on an
  // empty page). axeCheck writes the /account HTML into this jsdom document,
  // so it is queryable here. The delete-CONFIRM step is client-only state
  // (delete-account-button.tsx's useState) so it isn't in this server HTML;
  // it composes the same Alert + Button primitives already audited on /login
  // and /signup, and a component-level render of it is a filed follow-up.
  it('account exposes the export + delete controls with accessible names', async () => {
    expect(sessionCookie).toBeTruthy()
    await axeCheck('/account', sessionCookie)

    const exportLink = Array.from(document.querySelectorAll('a')).find(
      (a) => a.getAttribute('href') === '/api/account/export',
    )
    expect(exportLink, 'the "Export my data" link must be present').toBeTruthy()
    expect(exportLink?.textContent?.trim()).toBe('Export my data')

    const deleteButton = Array.from(document.querySelectorAll('button')).find((b) =>
      /delete my account/i.test(b.textContent ?? ''),
    )
    expect(deleteButton, 'the "Delete my account" control must be present and named').toBeTruthy()
  })
})
