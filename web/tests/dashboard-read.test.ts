import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { retrievability } from '@calyxa/learning-model'
import { getConcept } from '@calyxa/curriculum'

// Sprint 22 Task 8 (ADR-047): dashboard-read.ts / profile-read.ts both carry
// `import 'server-only'` as a defensive marker (Next's bundler aliases it away;
// plain vitest has no such condition), neutralized here exactly as
// onboarding.test.ts / predict.test.ts do — the standard way in this workspace
// to unit-test server-side read logic against a REAL Supabase client without a
// dev server, since loadDashboard/loadProfile are plain async functions taking a
// SupabaseClient and touch nothing in Next's request lifecycle.
vi.mock('server-only', () => ({}))

import { loadDashboard, type DashboardMasteryNode } from '../lib/learning/dashboard-read'
import { loadProfile } from '../lib/learning/profile-read'
import { COURSE_ORDER, COURSE_LABELS } from '../lib/curriculum/courses'

// vitest doesn't auto-load .env.local the way `next dev`/`next build` do
// (rls.test.ts / onboarding.test.ts convention).
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
const PASSWORD = 'dashboard-read-test-' + Math.random().toString(36).slice(2)

function testEmail(label: string) {
  return `darcy20080911+calyxadashread${label}${Date.now()}@gmail.com`
}

// Real concept keys from @calyxa/curriculum, one per strand (strandOf = the
// dotted prefix), so titles resolve and each node lands in a distinct strand.
const ALGEBRA_KEY = 'algebra.linear-equations.one-variable'
const GEOMETRY_KEY = 'geometry.angles.parallel-lines'
const CALCULUS_KEY = 'calculus.limits.formal'
const STATS_KEY = 'stats.descriptive.measures' // userB only — the RLS decoy

const admin = createClient(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } })

function daysAgoIso(days: number) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()
}

let userA: { id: string }
let clientA: SupabaseClient
let userB: { id: string }
let clientB: SupabaseClient
let userC: { id: string }
let clientC: SupabaseClient

async function makeSignedInUser(label: string): Promise<{ id: string; client: SupabaseClient }> {
  const email = testEmail(label)
  const { data: created, error } = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true })
  if (error || !created.user) throw new Error(`fixture setup failed for ${label}: ${error?.message}`)

  const client = createClient(url, anonKey)
  const { error: signInErr } = await client.auth.signInWithPassword({ email, password: PASSWORD })
  if (signInErr) throw new Error(`sign-in failed for ${label}: ${signInErr.message}`)

  return { id: created.user.id, client }
}

// The stored node values (pre-decay). Kept here so the decay-parity test can
// recompute the expected read-time value from the SAME inputs the read uses.
const NODES_A = [
  {
    concept_key: ALGEBRA_KEY,
    mastery: 0.82,
    stability: 6,
    state: 'mastered',
    confidence_band: 'high',
    observation_count: 12,
    last_practiced_at: daysAgoIso(3),
  },
  {
    concept_key: GEOMETRY_KEY,
    mastery: 0.4,
    stability: 2,
    state: 'weak',
    confidence_band: 'medium',
    observation_count: 4,
    last_practiced_at: daysAgoIso(12),
  },
  {
    concept_key: CALCULUS_KEY,
    mastery: 0.25,
    stability: 1,
    state: 'learning',
    confidence_band: 'low',
    observation_count: 2,
    last_practiced_at: daysAgoIso(1),
  },
] as const

beforeAll(async () => {
  const [a, b, c] = await Promise.all([
    makeSignedInUser('a'),
    makeSignedInUser('b'),
    makeSignedInUser('c'),
  ])
  userA = { id: a.id }
  clientA = a.client
  userB = { id: b.id }
  clientB = b.client
  userC = { id: c.id }
  clientC = c.client

  // ---- userA: a rich, multi-strand graph ----
  const { error: nodesErr } = await admin
    .from('knowledge_nodes')
    .insert(NODES_A.map((n) => ({ user_id: userA.id, ...n })))
  if (nodesErr) throw new Error(`seed knowledge_nodes A failed: ${nodesErr.message}`)

  const { error: mcErr } = await admin.from('misconceptions').insert([
    {
      user_id: userA.id,
      concept_key: GEOMETRY_KEY,
      category: 'sign-error',
      description: 'drops the negative on the alternate angle',
      status: 'active',
      occurrence_count: 3,
      consecutive_correct: 1,
    },
    {
      user_id: userA.id,
      concept_key: ALGEBRA_KEY,
      category: 'transposition',
      status: 'resolved',
      occurrence_count: 5,
      consecutive_correct: 4,
      resolved_at: daysAgoIso(2),
    },
    // 'pending' must be EXCLUDED by the read (confirmed-only, like loadProfile).
    // NOT-NULL occurrence_count/consecutive_correct are set explicitly: a bulk
    // insert with heterogeneous keys NULLs a row's missing columns rather than
    // applying their defaults, so every row in the batch carries them.
    { user_id: userA.id, concept_key: CALCULUS_KEY, category: 'unconfirmed', status: 'pending', occurrence_count: 1, consecutive_correct: 0 },
  ])
  if (mcErr) throw new Error(`seed misconceptions A failed: ${mcErr.message}`)

  const { error: schedErr } = await admin.from('reinforcement_schedule').insert([
    { user_id: userA.id, concept_key: GEOMETRY_KEY, due_at: daysAgoIso(2), priority: 0.9, interval_days: 3, lapses: 1 },
    { user_id: userA.id, concept_key: ALGEBRA_KEY, due_at: daysAgoIso(-5), priority: 0.3, interval_days: 7, lapses: 0 },
  ])
  if (schedErr) throw new Error(`seed reinforcement_schedule A failed: ${schedErr.message}`)

  // Activity: two sessions across two UTC days, mixed outcomes.
  const { data: sessions, error: sessErr } = await admin
    .from('sessions')
    .insert([{ user_id: userA.id, mode: 'text' }, { user_id: userA.id, mode: 'text' }])
    .select('id')
  if (sessErr || !sessions || sessions.length < 2) throw new Error(`seed sessions A failed: ${sessErr?.message}`)
  const [s1, s2] = sessions

  const day1 = daysAgoIso(2)
  const day2 = daysAgoIso(1)
  const { error: intErr } = await admin.from('session_interactions').insert([
    { session_id: s1.id, user_id: userA.id, turn_index: 0, concept_key: ALGEBRA_KEY, outcome: 'correct', created_at: day1 },
    { session_id: s1.id, user_id: userA.id, turn_index: 1, concept_key: ALGEBRA_KEY, outcome: 'correct', created_at: day1 },
    { session_id: s1.id, user_id: userA.id, turn_index: 2, concept_key: GEOMETRY_KEY, outcome: 'incorrect', created_at: day1 },
    { session_id: s2.id, user_id: userA.id, turn_index: 0, concept_key: GEOMETRY_KEY, outcome: 'partial', created_at: day2 },
    // A 'none' turn: counts toward the session, not toward any accuracy segment.
    { session_id: s2.id, user_id: userA.id, turn_index: 1, concept_key: null, outcome: 'none', created_at: day2 },
  ])
  if (intErr) throw new Error(`seed session_interactions A failed: ${intErr.message}`)

  // ---- userB: a single node on a strand userA has NONE of (the RLS decoy) ----
  const { error: bErr } = await admin
    .from('knowledge_nodes')
    .insert({ user_id: userB.id, concept_key: STATS_KEY, mastery: 0.5, observation_count: 3, state: 'weak' })
  if (bErr) throw new Error(`seed knowledge_nodes B failed: ${bErr.message}`)

  // ---- userC: nothing (cold start) ----
}, 30000)

afterAll(async () => {
  for (const user of [userA, userB, userC]) {
    if (!user) continue
    await admin.from('session_interactions').delete().eq('user_id', user.id)
    await admin.from('reinforcement_schedule').delete().eq('user_id', user.id)
    await admin.from('misconceptions').delete().eq('user_id', user.id)
    await admin.from('knowledge_nodes').delete().eq('user_id', user.id)
    await admin.from('sessions').delete().eq('user_id', user.id)
    await admin.from('users').delete().eq('id', user.id)
    await admin.auth.admin.deleteUser(user.id)
  }
}, 30000)

function allNodes(strands: { nodes: DashboardMasteryNode[] }[]): DashboardMasteryNode[] {
  return strands.flatMap((s) => s.nodes)
}

describe('loadDashboard — the FULL per-user graph grouped by strand', () => {
  it('returns all six strands in curriculum order, with the full node set and resolved titles', async () => {
    const data = await loadDashboard(clientA)

    expect(data.isEmpty).toBe(false)
    expect(data.totalConcepts).toBe(NODES_A.length)

    // Every one of the six strands is present, in order — even ones with no
    // practiced node (geometry/algebra/calculus have nodes; the rest are empty
    // but still shown).
    expect(data.strands.slice(0, COURSE_ORDER.length).map((s) => s.strand)).toEqual([...COURSE_ORDER])
    for (const group of data.strands) {
      expect(group.strandLabel).toBe(COURSE_LABELS[group.strand] ?? group.strand)
    }

    // Titles are resolved from the curriculum, not left as raw keys.
    const algebraNode = allNodes(data.strands).find((n) => n.conceptKey === ALGEBRA_KEY)!
    expect(algebraNode).toBeTruthy()
    expect(algebraNode.title).toBe(getConcept(ALGEBRA_KEY)!.title)
    expect(algebraNode.title).not.toBe(ALGEBRA_KEY)
    expect(algebraNode.strand).toBe('algebra-1')
  })

  it('reads back the SAME decay-adjusted mastery loadProfile computes (parity)', async () => {
    const [dashboard, profile] = await Promise.all([loadDashboard(clientA), loadProfile(clientA)])

    const dashAlgebra = allNodes(dashboard.strands).find((n) => n.conceptKey === ALGEBRA_KEY)!
    const profileAlgebra = profile.masteryNodes.find((n) => n.conceptKey === ALGEBRA_KEY)!
    expect(profileAlgebra).toBeTruthy()

    // Same read-time decay formula (mastery * retrievability(stability, daysSince)),
    // called within ms of each other — equal to several decimal places.
    expect(dashAlgebra.mastery).toBeCloseTo(profileAlgebra.mastery, 4)

    // And it matches an independent recomputation from the stored inputs — i.e.
    // it is genuinely decay-adjusted, not the raw stored 0.82.
    const stored = NODES_A[0]
    const days = (Date.now() - new Date(stored.last_practiced_at).getTime()) / (24 * 60 * 60 * 1000)
    const expected = stored.mastery * retrievability(stored.stability, days)
    expect(dashAlgebra.mastery).toBeCloseTo(expected, 4)
    expect(dashAlgebra.mastery).toBeLessThan(stored.mastery)
  })

  it('groups nodes into their strand, weakest-first, with a correct overall state distribution', async () => {
    const data = await loadDashboard(clientA)

    // Course keys, not the retired content-strand names: these users have no
    // course on their metadata, so each concept groups under the course that
    // AUTHORS it (homeCourseOf) — Calculus AB for `calculus.limits.formal`,
    // AP Statistics for `stats.*`.
    const algebra = data.strands.find((s) => s.strand === 'algebra-1')!
    const geometry = data.strands.find((s) => s.strand === 'geometry')!
    const calculus = data.strands.find((s) => s.strand === 'ap-calculus-ab')!
    const stats = data.strands.find((s) => s.strand === 'ap-statistics')!

    expect(algebra.nodes.map((n) => n.conceptKey)).toEqual([ALGEBRA_KEY])
    expect(geometry.nodes.map((n) => n.conceptKey)).toEqual([GEOMETRY_KEY])
    expect(calculus.nodes.map((n) => n.conceptKey)).toEqual([CALCULUS_KEY])
    expect(stats.nodes).toHaveLength(0) // userA has no stats node

    // Overall state distribution: one mastered, one weak, one learning.
    expect(data.stateCounts).toMatchObject({ mastered: 1, weak: 1, learning: 1, forgotten: 0, unseen: 0 })
  })

  it('orders the due queue priority DESC then due_at ASC, flagging overdue vs upcoming', async () => {
    const data = await loadDashboard(clientA)
    expect(data.dueQueue).toHaveLength(2)

    const [first, second] = data.dueQueue
    // Priority DESC: the 0.9 item leads the 0.3 item.
    expect(first.priority).toBeGreaterThan(second.priority)
    expect(first.conceptKey).toBe(GEOMETRY_KEY)
    expect(first.overdue).toBe(true) // due 2 days ago
    expect(second.conceptKey).toBe(ALGEBRA_KEY)
    expect(second.overdue).toBe(false) // due 5 days from now
    expect(first.title).toBe(getConcept(GEOMETRY_KEY)!.title)
  })

  it('returns all three misconception states, preserving each, with their fields', async () => {
    const data = await loadDashboard(clientA)

    const active = data.misconceptions.filter((m) => m.status === 'active')
    const resolved = data.misconceptions.filter((m) => m.status === 'resolved')
    const pending = data.misconceptions.filter((m) => m.status === 'pending')
    expect(active).toHaveLength(1)
    expect(resolved).toHaveLength(1)
    // 'pending' is now READ and surfaced as "watching" — a slip seen once is
    // shown to the student, distinctly from a confirmed misconception. It stays
    // excluded from loadProfile (the tutor's view) — see profile-read.
    expect(pending).toHaveLength(1)
    expect(pending[0].category).toBe('unconfirmed')
    expect(data.misconceptions).toHaveLength(3)
    // The state must be preserved, not coerced to 'active' (the old mapping did
    // exactly that for everything non-resolved).
    expect(data.misconceptions.find((m) => m.category === 'unconfirmed')!.status).toBe('pending')

    expect(active[0].conceptKey).toBe(GEOMETRY_KEY)
    expect(active[0].occurrenceCount).toBe(3)
    expect(active[0].consecutiveCorrect).toBe(1)
    expect(active[0].description).toBe('drops the negative on the alternate angle')
    expect(resolved[0].conceptKey).toBe(ALGEBRA_KEY)
    expect(resolved[0].resolvedAt).not.toBeNull()
  })

  it('aggregates activity by UTC day with per-outcome counts and distinct session counts', async () => {
    const data = await loadDashboard(clientA)
    expect(data.activity).toHaveLength(2)

    // Ascending by day.
    expect(data.activity[0].day.localeCompare(data.activity[1].day)).toBeLessThan(0)

    const [d1, d2] = data.activity
    // Day 1: two correct, one incorrect, one session.
    expect(d1).toMatchObject({ correct: 2, partial: 0, incorrect: 1, sessions: 1 })
    // Day 2: one partial (the 'none' turn counts toward the session, not accuracy).
    expect(d2).toMatchObject({ correct: 0, partial: 1, incorrect: 0, sessions: 1 })
  })
})

describe('loadDashboard — RLS scoping', () => {
  it("never returns another user's rows", async () => {
    const a = await loadDashboard(clientA)
    // userB's stats node must not leak into userA's dashboard.
    expect(allNodes(a.strands).some((n) => n.conceptKey === STATS_KEY)).toBe(false)
    const stats = a.strands.find((s) => s.strand === 'ap-statistics')!
    expect(stats.nodes).toHaveLength(0)

    // And userB sees ONLY their own stats node, never userA's three.
    const b = await loadDashboard(clientB)
    const bKeys = allNodes(b.strands).map((n) => n.conceptKey)
    expect(bKeys).toEqual([STATS_KEY])
    expect(bKeys).not.toContain(ALGEBRA_KEY)
  })
})

describe('loadDashboard — cold start', () => {
  it('degrades to an empty dashboard for a user with no data, without throwing', async () => {
    const data = await loadDashboard(clientC)
    expect(data.isEmpty).toBe(true)
    expect(data.totalConcepts).toBe(0)
    // Still the full six-strand scaffold, all empty.
    expect(data.strands).toHaveLength(COURSE_ORDER.length)
    expect(allNodes(data.strands)).toHaveLength(0)
    expect(data.misconceptions).toHaveLength(0)
    expect(data.dueQueue).toHaveLength(0)
    expect(data.activity).toHaveLength(0)
    expect(data.stateCounts).toMatchObject({ unseen: 0, learning: 0, weak: 0, mastered: 0, forgotten: 0 })
  })

  it('returns the same empty dashboard for a signed-out client (never throws)', async () => {
    const anon = createClient(url, anonKey)
    const data = await loadDashboard(anon)
    expect(data.isEmpty).toBe(true)
    expect(data.strands).toHaveLength(COURSE_ORDER.length)
  })
})
