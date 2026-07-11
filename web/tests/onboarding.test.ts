import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { CONCEPTS, prerequisitesOf } from '@calyxa/curriculum'
import { MASTERED_THRESHOLD, WEAK_THRESHOLD } from '@calyxa/learning-model'

// Sprint 17 Task 8 (ADR-042). seed.ts / profile-read.ts carry
// `import 'server-only'` as a defensive marker; mocked here exactly as
// predict.test.ts does for predict.ts -- the standard way in this
// workspace to unit-test server-side logic against a REAL Supabase client
// (rls.test.ts's own precedent) without spawning a dev server, since none
// of this file's assertions touch Next's request lifecycle (unlike
// learning-events.test.ts's off-critical-path apply() hook, which genuinely
// needs one -- seedFromAssessment/loadProfile are both plain async
// functions taking a SupabaseClient, called directly here).
vi.mock('server-only', () => ({}))

import { selectAssessmentItems, MAX_ASSESSMENT_ITEMS, MIN_ASSESSMENT_ITEMS } from '../lib/onboarding/item-bank'
import { seedFromAssessment } from '../lib/onboarding/seed'
import { loadProfile } from '../lib/learning/profile-read'
import type { AssessmentResult } from '../lib/onboarding/item-bank'

// vitest doesn't auto-load .env.local the way `next dev`/`next build` do
// (rls.test.ts / ai-turn.test.ts convention).
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
const PASSWORD = 'onboarding-test-' + Math.random().toString(36).slice(2)

function testEmail(label: string) {
  return `darcy20080911+calyxaonboarding${label}${Date.now()}@gmail.com`
}

// Service-role client: fixture setup/teardown ONLY (rls.test.ts discipline).
const admin = createClient(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } })

// User A: the basic seeding / row-shape / onboarding_completed_at / loadProfile
// assertions. User B: kept separate so the prerequisite-propagation test's
// "seed-if-absent, never overwrite a real node" fixture (which plants a real
// node BEFORE seeding) can't be confused by A's own seeding side effects.
let userA: { id: string }
let clientA: SupabaseClient
let userB: { id: string }
let clientB: SupabaseClient
let userC: { id: string }
let clientC: SupabaseClient

async function makeSignedInUser(label: string): Promise<{ id: string; client: SupabaseClient }> {
  const email = testEmail(label)
  const { data: created, error } = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
  })
  if (error || !created.user) throw new Error(`fixture setup failed for ${label}: ${error?.message}`)

  const client = createClient(url, anonKey)
  const { error: signInErr } = await client.auth.signInWithPassword({ email, password: PASSWORD })
  if (signInErr) throw new Error(`sign-in failed for ${label}: ${signInErr.message}`)

  return { id: created.user.id, client }
}

beforeAll(async () => {
  const a = await makeSignedInUser('a')
  userA = { id: a.id }
  clientA = a.client

  const b = await makeSignedInUser('b')
  userB = { id: b.id }
  clientB = b.client

  const c = await makeSignedInUser('c')
  userC = { id: c.id }
  clientC = c.client
})

afterAll(async () => {
  for (const user of [userA, userB, userC]) {
    if (!user) continue
    await admin.from('knowledge_nodes').delete().eq('user_id', user.id)
    await admin.from('users').delete().eq('id', user.id)
    await admin.auth.admin.deleteUser(user.id)
  }
})

describe('selectAssessmentItems (pure, over @calyxa/curriculum)', () => {
  it('picks between MIN and MAX items', () => {
    const items = selectAssessmentItems()
    expect(items.length).toBeGreaterThanOrEqual(MIN_ASSESSMENT_ITEMS)
    expect(items.length).toBeLessThanOrEqual(MAX_ASSESSMENT_ITEMS)
  })

  it('spans all 6 strands', () => {
    const items = selectAssessmentItems()
    const strands = new Set(items.map((item) => item.strand))
    expect(strands.size).toBe(6)
  })

  it('is deterministic across calls -- no per-user randomness to seed differently', () => {
    expect(selectAssessmentItems()).toEqual(selectAssessmentItems())
  })
})

describe('seedFromAssessment (live Supabase) — writes through the same FSRS path a tutoring turn uses', () => {
  it('writes a knowledge_nodes row in the same shape apply.ts writes, in the weak band, never mastered', async () => {
    const [directItem] = selectAssessmentItems()
    const results: AssessmentResult[] = [
      { conceptKey: directItem.conceptKey, outcome: 'correct', selfConfidence: 'high' },
    ]

    const { seededCount } = await seedFromAssessment(clientA, userA.id, results)
    expect(seededCount).toBeGreaterThanOrEqual(1)

    const { data: node, error } = await admin
      .from('knowledge_nodes')
      .select('mastery, stability, difficulty, state, confidence_band, observation_count, last_practiced_at')
      .eq('user_id', userA.id)
      .eq('concept_key', directItem.conceptKey)
      .single()

    expect(error).toBeNull()
    expect(node).toBeTruthy()
    // "Modest prior, not confident mastery" (ADR-042): the row has the exact
    // columns a real tutoring turn's applyMasteryUpdate upsert writes, but
    // the mastery value stays in the weak band, never MASTERED_THRESHOLD.
    expect(node!.mastery).toBeGreaterThan(0)
    expect(node!.mastery).toBeLessThan(WEAK_THRESHOLD)
    expect(node!.mastery).toBeLessThan(MASTERED_THRESHOLD)
    expect(node!.state).not.toBe('mastered')
    expect(node!.observation_count).toBe(1)
    expect(node!.last_practiced_at).not.toBeNull()
    expect(node!.stability).toBeGreaterThan(0)
  })

  it('writes onboarding_completed_at', async () => {
    const { data, error } = await admin
      .from('users')
      .select('onboarding_completed_at')
      .eq('id', userA.id)
      .single()

    expect(error).toBeNull()
    expect(data!.onboarding_completed_at).not.toBeNull()
  })

  it("a subsequent loadProfile no longer returns the CALIBRATING_PROFILE fallback", async () => {
    const profile = await loadProfile(clientA)
    expect(profile.masteryNodes.length).toBeGreaterThan(0)
    expect(profile.confidenceNote).not.toMatch(/calibrating/i)
  })

  it('propagates a confident-correct to its DIRECT prerequisites, seed-if-absent, never overwriting a real node', async () => {
    const withPrereqs = CONCEPTS.find((concept) => concept.prerequisites.length > 0)
    expect(withPrereqs).toBeTruthy()
    const targetKey = withPrereqs!.key
    const prereqKeys = prerequisitesOf(targetKey)
    expect(prereqKeys.length).toBeGreaterThan(0)

    // Plant a REAL, already-mastered node on the first prerequisite BEFORE
    // onboarding -- seed-if-absent must never clobber it.
    const protectedPrereq = prereqKeys[0]
    const plantedAt = new Date().toISOString()
    const { error: plantErr } = await admin.from('knowledge_nodes').upsert(
      {
        user_id: userB.id,
        concept_key: protectedPrereq,
        mastery: 0.93,
        stability: 10,
        difficulty: 0.2,
        state: 'mastered',
        confidence_band: 'high',
        observation_count: 20,
        last_practiced_at: plantedAt,
      },
      { onConflict: 'user_id,concept_key' }
    )
    expect(plantErr).toBeNull()

    const results: AssessmentResult[] = [{ conceptKey: targetKey, outcome: 'correct', selfConfidence: 'high' }]
    await seedFromAssessment(clientB, userB.id, results)

    // The pre-existing real node is untouched.
    const { data: protectedNode, error: protectedErr } = await admin
      .from('knowledge_nodes')
      .select('mastery, state, last_practiced_at')
      .eq('user_id', userB.id)
      .eq('concept_key', protectedPrereq)
      .single()
    expect(protectedErr).toBeNull()
    expect(protectedNode!.mastery).toBe(0.93)
    expect(protectedNode!.state).toBe('mastered')
    // Postgres round-trips the timestamp with a `+00:00` offset instead of a
    // `Z` suffix -- compare the moment in time, not the string encoding.
    expect(new Date(protectedNode!.last_practiced_at).getTime()).toBe(new Date(plantedAt).getTime())

    // Any OTHER (previously absent) prerequisite gets seeded at a modest prior.
    if (prereqKeys.length > 1) {
      const freshPrereq = prereqKeys[1]
      const { data: freshNode, error: freshErr } = await admin
        .from('knowledge_nodes')
        .select('mastery, state')
        .eq('user_id', userB.id)
        .eq('concept_key', freshPrereq)
        .maybeSingle()
      expect(freshErr).toBeNull()
      expect(freshNode).toBeTruthy()
      expect(freshNode!.mastery).toBeGreaterThan(0)
      expect(freshNode!.mastery).toBeLessThan(WEAK_THRESHOLD)
      expect(freshNode!.state).not.toBe('mastered')
    }
  })

  it('a non-confident answer does NOT propagate to prerequisites', async () => {
    // A dedicated third user -- total isolation from the confident-correct
    // propagation test above, so there is no ambiguity about which test
    // seeded what.
    const withPrereqs = CONCEPTS.find((concept) => concept.prerequisites.length > 0)
    expect(withPrereqs).toBeTruthy()
    const prereqKeys = prerequisitesOf(withPrereqs!.key)
    expect(prereqKeys.length).toBeGreaterThan(0)

    const results: AssessmentResult[] = [
      { conceptKey: withPrereqs!.key, outcome: 'incorrect', selfConfidence: 'unknown' },
    ]
    await seedFromAssessment(clientC, userC.id, results)

    for (const prereq of prereqKeys) {
      const { data } = await admin
        .from('knowledge_nodes')
        .select('id')
        .eq('user_id', userC.id)
        .eq('concept_key', prereq)
        .maybeSingle()
      expect(data).toBeNull()
    }
  })
})
