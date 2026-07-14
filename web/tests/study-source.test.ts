import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { CONCEPT_KEYS } from '@calyxa/curriculum'

// Sprint 21 Task 7 (ADR-049). loadSessionSource (Task 3) is the shared read the
// study-kit generator prompts from -- it CALLS buildSessionRecap and passes its
// concepts/misconceptions straight through, then adds its own transcript read.
// This proves the two claims the plan names, against a LIVE session:
//   - PARITY: loadSessionSource's concepts/misconceptions are exactly what
//     buildSessionRecap reports for the same session (reuse, not a divergent
//     second read), and its transcript additionally includes the ungraded
//     opening turn recap deliberately excludes from its stats.
//   - RLS: a second user's client cannot read the first user's session, even
//     when the app-level user_id filter would match -- RLS is the guard.
//
// recap.ts / source.ts carry `import 'server-only'` as a defensive marker;
// mocked the standard way (onboarding.test.ts / predict.test.ts) so they can be
// imported + called directly with a real signed-in client, no dev server.
vi.mock('server-only', () => ({}))

import { loadSessionSource } from '../lib/study/source'
import { buildSessionRecap } from '../lib/learning/recap'

// vitest doesn't auto-load .env.local (rls.test.ts / onboarding.test.ts convention).
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

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
const PASSWORD = 'study-source-test-' + Math.random().toString(36).slice(2)

// A real curriculum key so titleFor() resolves it identically in both reads.
const CONCEPT_KEY = CONCEPT_KEYS[0]

function testEmail(label: string) {
  return `darcy20080911+calyxastudysource${label}${Date.now()}@gmail.com`
}

// Service-role client: fixture setup/teardown ONLY (rls.test.ts discipline).
const admin = createClient(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } })

let userA: { id: string }
let clientA: SupabaseClient
let userB: { id: string }
let clientB: SupabaseClient
let mainSessionId: string // A's session with an ungraded opening turn + a gradable turn
let emptySessionId: string // A's session with ONLY an ungraded turn (nothing to generate)

async function makeSignedInUser(label: string): Promise<{ id: string; client: SupabaseClient }> {
  const email = testEmail(label)
  const { data: created, error } = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true })
  if (error || !created.user) throw new Error(`fixture setup failed for ${label}: ${error?.message}`)

  const client = createClient(url, anonKey)
  const { error: signInErr } = await client.auth.signInWithPassword({ email, password: PASSWORD })
  if (signInErr) throw new Error(`sign-in failed for ${label}: ${signInErr.message}`)

  return { id: created.user.id, client }
}

async function seedSession(userId: string): Promise<string> {
  const { data: session, error } = await admin
    .from('sessions')
    .insert({ user_id: userId, mode: 'text' })
    .select('id')
    .single()
  if (error || !session) throw new Error(`seed session failed: ${error?.message}`)
  return session.id as string
}

beforeAll(async () => {
  const a = await makeSignedInUser('a')
  userA = { id: a.id }
  clientA = a.client
  const b = await makeSignedInUser('b')
  userB = { id: b.id }
  clientB = b.client

  mainSessionId = await seedSession(userA.id)
  emptySessionId = await seedSession(userA.id)

  // Main session: turn 0 is the ungraded opening scan (concept_key null,
  // outcome 'none') -- recap EXCLUDES it from stats, loadSessionSource's
  // transcript read INCLUDES it (the problem statement often first appears
  // there). Turn 1 is a gradable turn on a real concept.
  const { error: interErr } = await admin.from('session_interactions').insert([
    {
      session_id: mainSessionId,
      user_id: userA.id,
      turn_index: 0,
      concept_key: null,
      outcome: 'none',
      student_transcript: null,
      tutor_response: "Let's look at the problem 2x + 3 = 7.",
    },
    {
      session_id: mainSessionId,
      user_id: userA.id,
      turn_index: 1,
      concept_key: CONCEPT_KEY,
      outcome: 'correct',
      student_transcript: 'x = 2',
      tutor_response: 'Exactly right.',
    },
  ])
  if (interErr) throw new Error(`seed session_interactions failed: ${interErr.message}`)

  // Empty session: only an ungraded opening turn -> no gradable interactions ->
  // buildSessionRecap returns undefined -> loadSessionSource returns undefined.
  const { error: emptyErr } = await admin.from('session_interactions').insert({
    session_id: emptySessionId,
    user_id: userA.id,
    turn_index: 0,
    concept_key: null,
    outcome: 'none',
    tutor_response: 'Scanning the page…',
  })
  if (emptyErr) throw new Error(`seed empty session_interactions failed: ${emptyErr.message}`)
}, 30000)

afterAll(async () => {
  for (const user of [userA, userB]) {
    if (!user) continue
    await admin.from('session_interactions').delete().eq('user_id', user.id)
    await admin.from('sessions').delete().eq('user_id', user.id)
    await admin.from('users').delete().eq('id', user.id)
    await admin.auth.admin.deleteUser(user.id)
  }
}, 30000)

describe('loadSessionSource (live Supabase)', () => {
  it('reports the SAME concepts/misconceptions buildSessionRecap does (reuse, not a divergent read)', async () => {
    const source = await loadSessionSource(clientA, userA.id, mainSessionId)
    const recap = await buildSessionRecap(clientA, userA.id, mainSessionId)

    expect(source).toBeTruthy()
    expect(recap).toBeTruthy()
    // Passed straight through from buildSessionRecap -- byte-for-byte identical.
    expect(source!.concepts).toEqual(recap!.concepts)
    expect(source!.misconceptionsAdded).toEqual(recap!.misconceptionsAdded)
    expect(source!.misconceptionsResolved).toEqual(recap!.misconceptionsResolved)
    // The one real concept practiced this session is present.
    expect(source!.concepts.map((c) => c.conceptKey)).toEqual([CONCEPT_KEY])
  })

  it('includes EVERY turn in the transcript -- the ungraded opening recap drops from its stats', async () => {
    const source = await loadSessionSource(clientA, userA.id, mainSessionId)

    // Both turns, in order -- including turn 0 (ungraded, concept_key null),
    // which the recap's `concept_key not null / outcome != none` filter excludes.
    expect(source!.turns.map((t) => t.turnIndex)).toEqual([0, 1])
    expect(source!.turns[0].conceptKey).toBeNull()
    expect(source!.turns[0].tutorResponse).toContain('2x + 3 = 7')
    expect(source!.turns[1].conceptKey).toBe(CONCEPT_KEY)
    expect(source!.turns[1].studentTranscript).toBe('x = 2')
    expect(source!.turns[1].outcome).toBe('correct')
  })

  it('returns undefined for a session with nothing worth generating (no gradable turns)', async () => {
    const source = await loadSessionSource(clientA, userA.id, emptySessionId)
    expect(source).toBeUndefined()
  })

  it("is RLS-scoped: a second user's client cannot read the first user's session", async () => {
    // Passing userA.id as the userId with clientB: the app-level
    // `.eq('user_id', userA.id)` filter WOULD match A's session, so anything
    // that comes back (or the read failing outright) is RLS doing the scoping,
    // not the query -- the account.test.ts "RLS proven, not a query we could
    // get wrong" discipline. RLS filters the session row out entirely, so the
    // recap's `.single()` read fails and loadSessionSource rejects; either way
    // B never receives A's data.
    await expect(loadSessionSource(clientB, userA.id, mainSessionId)).rejects.toThrow()
  })
})
