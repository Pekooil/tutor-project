import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createClient } from '@supabase/supabase-js'

// Vitest globalSetup: a pre-run janitor that deletes leaked integration-test
// users before the suite starts.
//
// Why this exists: every dev-server suite (ai-turn.test.ts, session.test.ts,
// account.test.ts, ...) signs up REAL Supabase Auth users via
// `admin.auth.admin.createUser` and tears them down in `afterAll`. But
// `afterAll` only runs if the suite finishes -- an interrupted run (Ctrl-C, a
// `beforeAll` throw, a `next dev` port-lock collision) skips teardown and
// leaks ~8 users per suite. Left alone that accumulates without bound (it hit
// 510 orphans in the live `users` table before this was added). This sweep
// makes those leaks self-heal: whatever a crashed run left behind gets cleaned
// on the NEXT run, independent of any suite's own teardown.
//
// It runs ONCE per `vitest run`, in vitest's own Node context (not a worker),
// so it loads env itself the same inline way the test files do.

// Every test email is `darcy20080911+<suite><timestamp>@gmail.com` (see each
// test's `testEmail()`); manual verification accounts share the same
// `darcy20080911+` plus-address shape. Requiring the `+` after the local part
// is what makes this safe: the four real accounts -- darcy20080911@gmail.com,
// test@gmail.com, test2@gmail.com, test3@gmail.com -- have no plus tag and can
// never match.
const SWEEP_LIKE = 'darcy20080911+%@gmail.com'
const SWEEP_RE = /^darcy20080911\+.*@gmail\.com$/

// Defense-in-depth: even if the pattern above were ever loosened, refuse to
// touch a known-real account.
const NEVER_DELETE = new Set([
  'darcy20080911@gmail.com',
  'test@gmail.com',
  'test2@gmail.com',
  'test3@gmail.com',
])

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

export default async function sweepLeakedTestUsers() {
  loadEnvLocal()

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceRoleKey) {
    // No creds -> nothing to sweep. Don't fail the run; the tests that need
    // these vars will surface their own clear errors.
    console.warn('[test-sweep] skipped: SUPABASE env not set')
    return
  }

  const admin = createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  try {
    // 1) Profiles: public.users carries the email column and every child FK
    //    (sessions, knowledge_nodes, study_artifact, ...) is ON DELETE
    //    CASCADE, so one delete clears each leaked user's whole graph.
    const { data: profiles, error: selErr } = await admin
      .from('users')
      .select('id, email')
      .like('email', SWEEP_LIKE)
    if (selErr) throw selErr

    const doomed = (profiles ?? []).filter(
      (p) => SWEEP_RE.test(p.email) && !NEVER_DELETE.has(p.email),
    )
    if (doomed.length > 0) {
      const { error: delErr } = await admin
        .from('users')
        .delete()
        .in(
          'id',
          doomed.map((p) => p.id),
        )
      if (delErr) throw delErr
    }

    // 2) Auth rows: no FK links public.users -> auth.users, so the profile
    //    delete above does NOT remove the auth user. Sweep auth separately,
    //    which also catches orphans that leaked before their profile row was
    //    ever created. listUsers has no server-side email filter, so paginate
    //    and match locally.
    let authDeleted = 0
    for (let page = 1; page <= 50; page++) {
      const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 })
      if (error) throw error
      const users = data?.users ?? []
      for (const u of users) {
        const email = u.email ?? ''
        if (SWEEP_RE.test(email) && !NEVER_DELETE.has(email)) {
          await admin.auth.admin.deleteUser(u.id)
          authDeleted++
        }
      }
      if (users.length < 1000) break
    }

    if (doomed.length || authDeleted) {
      console.log(
        `[test-sweep] removed ${doomed.length} leaked profile(s) + ${authDeleted} auth user(s)`,
      )
    }
  } catch (err) {
    // Best-effort: a sweep hiccup must never block the actual test run.
    console.warn('[test-sweep] sweep failed (continuing):', (err as Error).message)
  }
}
