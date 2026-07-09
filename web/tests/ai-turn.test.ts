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

// Sprint 08: a second fixture user, seeded with one knowledge_nodes row, so
// the "live profile in the prompt" test has a non-calibrating profile to
// assert against without polluting `user`/`token` (which every other test in
// this file relies on staying at zero nodes -- the cold-start case).
let userWithProfile: { id: string }
let tokenWithProfile: string
const SEEDED_CONCEPT_KEY = 'algebra.quadratics.factoring'

// Sprint 09 Task 7: a third fixture user, seeded with an old, low-stability
// knowledge_nodes row, isolating the "decay-on-read" assertion from
// `userWithProfile` above (which intentionally stays undecayed -- raw
// mastery === rendered mastery -- as its own back-compat check).
let userDecayed: { id: string }
let tokenDecayed: string
const DECAY_CONCEPT_KEY = 'algebra.quadratics.formula'
const DECAY_RAW_MASTERY = 0.65
const DECAY_DAYS_AGO = 30
// retrievability(stability=1, days=30) = (1 + 30/9)^-1 = 3/13; 0.65 * 3/13 =
// 0.15 exactly, so the decayed value below isn't a rounding coincidence.
const DECAY_EXPECTED_MASTERY = '0.15'

// Sprint 11 Task 8: a fourth fixture user for the due-resurfacing + topic-
// bias read (ADR-020/ADR-021). Two seeded nodes -- a weak one (ordered
// first by the default weakest-first read) and a strong PAGE-RELEVANT one
// (ordered first only when topic bias kicks in) -- plus one already-overdue
// reinforcement_schedule row on the weak concept, so the same user
// exercises both the "Fading / due for review" rendering and the query-1
// reorder. Kept separate from the three users above, whose tests all
// assert the exact PRE-topic-bias prompt rendering (the back-compat side).
let userDue: { id: string }
let tokenDue: string
const DUE_WEAK_CONCEPT = 'algebra.linear-equations.one-variable'
const DUE_TOPIC_CONCEPT = 'algebra.quadratics.factoring'
const DUE_OVERDUE_DAYS = 2

// --- Sprint 13 Task 9: a fifth fixture user for the tag + callback grounding
// gate (ADR-024/026). One node + one active misconception on TAG_MASTERY_CONCEPT
// (reviewing/strength/known-gap targets), one due item on TAG_DUE_CONCEPT
// (due-review target), and a real prior ENDED session on TAG_CALLBACK_CONCEPT
// -- driven through a genuine turn + apply + end, so the priorWork digest
// (profile-read.ts) has real history to ground a callback against, not a
// fixture row that never went through the write path. TAG_UNGROUNDED_CONCEPT
// is a valid curriculum key this user has NO signal on at all -- the target
// for every "this profile doesn't support that claim" drop case.
let userTags: { id: string }
let tokenTags: string
const TAG_MASTERY_CONCEPT = 'algebra.quadratics.factoring'
const TAG_DUE_CONCEPT = 'algebra.linear-equations.one-variable'
const TAG_DUE_TITLE = 'One-variable linear equations'
const TAG_CALLBACK_CONCEPT = 'algebra.exponents.power-rule'
const TAG_UNGROUNDED_CONCEPT = 'algebra.polynomials.expanding'

// --- Sprint 13 Task 9: a sixth fixture user for the event-ping thresholds
// (ADR-026). Each ping test seeds its own concept's knowledge_nodes/
// misconceptions row directly (fixture data, not the write path -- the
// PING computation is the thing under test) and drives one real,
// sessionId-bearing turn, since `pings` only rides the response when
// persistInteraction actually scheduled the apply (a real, owned session).
let userPings: { id: string }
let tokenPings: string
// A SECOND pings user (Sprint 14 Task 5/9): the base 8-concept curriculum
// means every `it()` above already claims one concept key each against
// userPings, so the four Task 5 widening tests (the two stored-"unseen"
// transitions + the two mastery-progress threshold cases) need their OWN
// user to seed fresh knowledge_nodes rows without colliding with an
// earlier test's fixture for the same concept.
let userPingsWide: { id: string }
let tokenPingsWide: string

// A seventh fixture user (design-handoff feature, check-in 5b's
// personalized sticking-point candidates): one knowledge_nodes row on
// STICKING_CONCEPT (so the profile doesn't calibrate-empty, which would
// force activeMisconceptions to [] regardless of the misconceptions rows
// below) plus FOUR active misconceptions rows on that SAME concept, seeded
// with deliberately distinct occurrence_count/last_seen_at so the ranked-
// top-3 + the dropped 4th are both independently verifiable. A DEDICATED
// user (row scoping is per-user via RLS, so reusing the same concept key
// other fixtures already use is fine -- e.g. TAG_MASTERY_CONCEPT is the
// same key -- but sharing userTags's own ONE existing misconceptions row
// here would have broken its "exactly one active misconception" framing).
let userSticking: { id: string }
let tokenSticking: string
const STICKING_CONCEPT = 'algebra.quadratics.factoring'

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

// Every other fake response in this file uses fakeTextMessage, which -- since
// it never carries a tool_use content block -- only ever exercises
// runTutorTurn's FALLBACK path (the missing-tool-use degrade), regardless of
// the `tool_choice: { type: 'tool', ... }` the real route always sends. That
// leaves the actual forced-tool path (what the live Anthropic API really
// does) unexercised by this suite. This helper mocks a genuine tool_use
// response so the session-start assembly test below (assembleSessionStartEnvelope,
// claude.ts) exercises the real primary path, not the degrade one.
function fakeToolUseMessage(toolName: string, input: Record<string, unknown>) {
  return {
    id: 'msg_fake_tool',
    type: 'message',
    role: 'assistant',
    model: 'claude-haiku-4-5-20251001',
    content: [{ type: 'tool_use', id: 'toolu_fake', name: toolName, input }],
    stop_reason: 'tool_use',
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

// Sprint 13 (ADR-025/026): pings only ride the response when persistInteraction
// actually scheduled the off-critical-path apply -- which needs a REAL,
// owned sessionId (session.test.ts's start/end helpers, reproduced here so
// this file's ping/tag-grounding fixtures don't need session.test.ts's
// spawned server).
async function start(bearer: string, body: Record<string, unknown> = {}) {
  const res = await fetch(`${API_BASE}/api/session/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${bearer}` },
    body: JSON.stringify(body),
  })
  return { status: res.status, json: await res.json() }
}

async function end(bearer: string, sessionId: string) {
  const res = await fetch(`${API_BASE}/api/session/end`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${bearer}` },
    body: JSON.stringify({ sessionId }),
  })
  return { status: res.status, json: await res.json() }
}

// The off-critical-path apply (ADR-019) means no request in this file's
// vocabulary is a hard sync point for "the write has landed" -- the
// session.test.ts polling convention, reproduced here for the priorWork
// fixture below (which needs a real FSRS write to exist before the
// grounding turn reads it back via loadProfile).
async function waitFor(check: () => Promise<void>, timeoutMs = 5000, intervalMs = 200): Promise<void> {
  const deadline = Date.now() + timeoutMs
  let lastError: unknown
  while (Date.now() < deadline) {
    try {
      await check()
      return
    } catch (err) {
      lastError = err
      await new Promise((r) => setTimeout(r, intervalMs))
    }
  }
  throw lastError
}

// Module scope (not inside a single describe) -- Sprint 13 Task 9's new
// grounding/ping describe blocks assert the same "nothing new persisted"
// shape as the Sprint 12 annotations test this was first pinned for.
const EXPECTED_SESSION_INTERACTIONS_COLUMNS = [
  'id',
  'session_id',
  'user_id',
  'turn_index',
  'concept_key',
  'student_transcript',
  'tutor_response',
  'outcome',
  'self_confidence',
  'response_latency_ms',
  'misconception_category',
  'applied_to_profile',
  'created_at',
  'deleted_at',
  'reasoning_quality',
  'misconception_description',
  'claimed_at',
].sort()

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

  // Sprint 08 fixture: a second user with one knowledge_nodes row inserted
  // directly via the service role (fixture setup, not an assertion). Mirrors
  // /supabase/seed/seed.sql's dev-only seed, just scoped to this test's own
  // disposable user instead of the shared dev account.
  const profileEmail = `darcy20080911+calyxaaiturnprofile${Date.now()}@gmail.com`
  const { data: createdProfile, error: profileErr } = await admin.auth.admin.createUser({
    email: profileEmail,
    password: PASSWORD,
    email_confirm: true,
  })
  if (profileErr || !createdProfile.user) {
    throw new Error(`fixture setup failed (profile user): ${profileErr?.message}`)
  }
  userWithProfile = { id: createdProfile.user.id }

  const { error: seedErr } = await admin.from('knowledge_nodes').insert({
    user_id: userWithProfile.id,
    concept_key: SEEDED_CONCEPT_KEY,
    mastery: 0.42,
    state: 'learning',
    confidence_band: 'medium',
    observation_count: 4,
  })
  if (seedErr) throw new Error(`fixture setup failed (knowledge_nodes seed): ${seedErr.message}`)

  const profileClient = createClient(url, anonKey)
  const { data: signInProfile, error: signInProfileErr } = await profileClient.auth.signInWithPassword({
    email: profileEmail,
    password: PASSWORD,
  })
  if (signInProfileErr || !signInProfile.session) {
    throw new Error(`sign-in failed (profile user): ${signInProfileErr?.message}`)
  }
  tokenWithProfile = signInProfile.session.access_token

  // Sprint 09 Task 7 fixture: a node practiced DECAY_DAYS_AGO days ago at
  // MIN_STABILITY (1.0) -- low stability so the power-decay curve has
  // visibly bitten by day 30. Inserted directly via the service role since
  // last_practiced_at has no "now" default to override (0004_knowledge_graph.sql).
  const decayedEmail = `darcy20080911+calyxaaiturndecayed${Date.now()}@gmail.com`
  const { data: createdDecayed, error: decayedErr } = await admin.auth.admin.createUser({
    email: decayedEmail,
    password: PASSWORD,
    email_confirm: true,
  })
  if (decayedErr || !createdDecayed.user) {
    throw new Error(`fixture setup failed (decayed user): ${decayedErr?.message}`)
  }
  userDecayed = { id: createdDecayed.user.id }

  const { error: decaySeedErr } = await admin.from('knowledge_nodes').insert({
    user_id: userDecayed.id,
    concept_key: DECAY_CONCEPT_KEY,
    mastery: DECAY_RAW_MASTERY,
    stability: 1.0,
    state: 'learning',
    confidence_band: 'medium',
    observation_count: 4,
    last_practiced_at: new Date(Date.now() - DECAY_DAYS_AGO * 24 * 60 * 60 * 1000).toISOString(),
  })
  if (decaySeedErr) throw new Error(`fixture setup failed (decayed knowledge_nodes seed): ${decaySeedErr.message}`)

  const decayedClient = createClient(url, anonKey)
  const { data: signInDecayed, error: signInDecayedErr } = await decayedClient.auth.signInWithPassword({
    email: decayedEmail,
    password: PASSWORD,
  })
  if (signInDecayedErr || !signInDecayed.session) {
    throw new Error(`sign-in failed (decayed user): ${signInDecayedErr?.message}`)
  }
  tokenDecayed = signInDecayed.session.access_token

  // Sprint 11 Task 8 fixture (ADR-020/ADR-021): the due/topic user. Both
  // nodes are practiced "now" so read-time decay is negligible and the
  // rendered mastery values below are stable for the test run's duration;
  // the strong node's high stability (50) makes that doubly true. The
  // schedule row is ALREADY overdue (due_at 2 days in the past) -- seeded
  // directly rather than driven through the scheduler because this file
  // tests the READ side; the scheduler's own write behaviour is
  // session.test.ts's job.
  const dueEmail = `darcy20080911+calyxaaiturndue${Date.now()}@gmail.com`
  const { data: createdDue, error: dueErr } = await admin.auth.admin.createUser({
    email: dueEmail,
    password: PASSWORD,
    email_confirm: true,
  })
  if (dueErr || !createdDue.user) {
    throw new Error(`fixture setup failed (due user): ${dueErr?.message}`)
  }
  userDue = { id: createdDue.user.id }

  const { error: dueSeedErr } = await admin.from('knowledge_nodes').insert([
    {
      user_id: userDue.id,
      concept_key: DUE_WEAK_CONCEPT,
      mastery: 0.2,
      stability: 1.0,
      state: 'weak',
      confidence_band: 'low',
      observation_count: 2,
      last_practiced_at: new Date().toISOString(),
    },
    {
      user_id: userDue.id,
      concept_key: DUE_TOPIC_CONCEPT,
      mastery: 0.8,
      stability: 50,
      state: 'learning',
      confidence_band: 'medium',
      observation_count: 6,
      last_practiced_at: new Date().toISOString(),
    },
  ])
  if (dueSeedErr) throw new Error(`fixture setup failed (due knowledge_nodes seed): ${dueSeedErr.message}`)

  const { error: dueScheduleErr } = await admin.from('reinforcement_schedule').insert({
    user_id: userDue.id,
    concept_key: DUE_WEAK_CONCEPT,
    due_at: new Date(Date.now() - DUE_OVERDUE_DAYS * 24 * 60 * 60 * 1000).toISOString(),
    interval_days: 1.0,
    priority: 0.9,
    lapses: 1,
  })
  if (dueScheduleErr) throw new Error(`fixture setup failed (reinforcement_schedule seed): ${dueScheduleErr.message}`)

  const dueClient = createClient(url, anonKey)
  const { data: signInDue, error: signInDueErr } = await dueClient.auth.signInWithPassword({
    email: dueEmail,
    password: PASSWORD,
  })
  if (signInDueErr || !signInDue.session) {
    throw new Error(`sign-in failed (due user): ${signInDueErr?.message}`)
  }
  tokenDue = signInDue.session.access_token

  // --- userTags fixture (Sprint 13 Task 9) ---
  const tagsEmail = `darcy20080911+calyxaaiturntags${Date.now()}@gmail.com`
  const { data: createdTags, error: tagsErr } = await admin.auth.admin.createUser({
    email: tagsEmail,
    password: PASSWORD,
    email_confirm: true,
  })
  if (tagsErr || !createdTags.user) throw new Error(`fixture setup failed (tags user): ${tagsErr?.message}`)
  userTags = { id: createdTags.user.id }

  const { error: tagsNodeErr } = await admin.from('knowledge_nodes').insert({
    user_id: userTags.id,
    concept_key: TAG_MASTERY_CONCEPT,
    mastery: 0.5,
    stability: 5,
    state: 'learning',
    confidence_band: 'medium',
    observation_count: 4,
    last_practiced_at: new Date().toISOString(),
  })
  if (tagsNodeErr) throw new Error(`fixture setup failed (tags knowledge_nodes seed): ${tagsNodeErr.message}`)

  const { error: tagsMisconceptionErr } = await admin.from('misconceptions').insert({
    user_id: userTags.id,
    concept_key: TAG_MASTERY_CONCEPT,
    category: 'sign-errors',
    description: 'drops the negative sign when distributing',
    status: 'active',
    occurrence_count: 2,
    consecutive_correct: 0,
  })
  if (tagsMisconceptionErr) {
    throw new Error(`fixture setup failed (tags misconceptions seed): ${tagsMisconceptionErr.message}`)
  }

  const { error: tagsScheduleErr } = await admin.from('reinforcement_schedule').insert({
    user_id: userTags.id,
    concept_key: TAG_DUE_CONCEPT,
    due_at: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
    interval_days: 1.0,
    priority: 0.5,
    lapses: 0,
  })
  if (tagsScheduleErr) throw new Error(`fixture setup failed (tags reinforcement_schedule seed): ${tagsScheduleErr.message}`)

  const tagsClient = createClient(url, anonKey)
  const { data: signInTags, error: signInTagsErr } = await tagsClient.auth.signInWithPassword({
    email: tagsEmail,
    password: PASSWORD,
  })
  if (signInTagsErr || !signInTags.session) throw new Error(`sign-in failed (tags user): ${signInTagsErr?.message}`)
  tokenTags = signInTags.session.access_token

  // A REAL prior ended session on TAG_CALLBACK_CONCEPT -- priorWork
  // (profile-read.ts) only ever digests genuine session_interactions rows
  // from an ended session, so the callback-grounding test needs an actual
  // turn + off-critical-path apply + end, not a fixture row.
  const tagsStarted = await start(tokenTags, { mode: 'text' })
  if (tagsStarted.status !== 200) throw new Error('fixture setup failed (tags callback session start)')
  nextResponse = {
    status: 200,
    body: fakeTextMessage(
      JSON.stringify({
        say: 'Nice, clean use of the power rule.',
        assessment: {
          concept_key: TAG_CALLBACK_CONCEPT,
          outcome: 'correct',
          reasoning_quality: 'sound',
          self_confidence: 'high',
          confidence: 'high',
        },
      })
    ),
  }
  const tagsCallbackTurn = await turn(tokenTags, {
    sessionId: tagsStarted.json.sessionId,
    messages: [{ role: 'user', content: '(x^2)^3 = x^6' }],
  })
  if (tagsCallbackTurn.status !== 200) throw new Error('fixture setup failed (tags callback turn)')
  const tagsEnded = await end(tokenTags, tagsStarted.json.sessionId)
  if (tagsEnded.status !== 200) throw new Error('fixture setup failed (tags callback session end)')

  // Confirms the off-critical-path apply actually landed (a real
  // knowledge_nodes row) before any grounding test runs against this
  // user's profile -- without this wait, a still-in-flight apply would make
  // the callback digest flakily empty depending on timing.
  await waitFor(async () => {
    const { data, error } = await admin
      .from('knowledge_nodes')
      .select('mastery')
      .eq('user_id', userTags.id)
      .eq('concept_key', TAG_CALLBACK_CONCEPT)
      .single()
    if (error || !data) throw new Error('tags callback knowledge_nodes row not yet written')
  })

  // --- userPings fixture (Sprint 13 Task 9) ---
  const pingsEmail = `darcy20080911+calyxaaiturnpings${Date.now()}@gmail.com`
  const { data: createdPings, error: pingsErr } = await admin.auth.admin.createUser({
    email: pingsEmail,
    password: PASSWORD,
    email_confirm: true,
  })
  if (pingsErr || !createdPings.user) throw new Error(`fixture setup failed (pings user): ${pingsErr?.message}`)
  userPings = { id: createdPings.user.id }

  const pingsClient = createClient(url, anonKey)
  const { data: signInPings, error: signInPingsErr } = await pingsClient.auth.signInWithPassword({
    email: pingsEmail,
    password: PASSWORD,
  })
  if (signInPingsErr || !signInPings.session) throw new Error(`sign-in failed (pings user): ${signInPingsErr?.message}`)
  tokenPings = signInPings.session.access_token

  // --- userPingsWide fixture (Sprint 14 Task 5/9 -- see the declaration's comment) ---
  const pingsWideEmail = `darcy20080911+calyxaaiturnpingswide${Date.now()}@gmail.com`
  const { data: createdPingsWide, error: pingsWideErr } = await admin.auth.admin.createUser({
    email: pingsWideEmail,
    password: PASSWORD,
    email_confirm: true,
  })
  if (pingsWideErr || !createdPingsWide.user) {
    throw new Error(`fixture setup failed (pings-wide user): ${pingsWideErr?.message}`)
  }
  userPingsWide = { id: createdPingsWide.user.id }

  const pingsWideClient = createClient(url, anonKey)
  const { data: signInPingsWide, error: signInPingsWideErr } = await pingsWideClient.auth.signInWithPassword({
    email: pingsWideEmail,
    password: PASSWORD,
  })
  if (signInPingsWideErr || !signInPingsWide.session) {
    throw new Error(`sign-in failed (pings-wide user): ${signInPingsWideErr?.message}`)
  }
  tokenPingsWide = signInPingsWide.session.access_token

  // --- userSticking fixture (design-handoff feature -- see the declaration's
  // comment): one knowledge_nodes row + four misconceptions rows on the SAME
  // concept, occurrence_count/last_seen_at deliberately staggered so the
  // ranked order is unambiguous and independent of insertion order.
  const stickingEmail = `darcy20080911+calyxaaiturnsticking${Date.now()}@gmail.com`
  const { data: createdSticking, error: stickingErr } = await admin.auth.admin.createUser({
    email: stickingEmail,
    password: PASSWORD,
    email_confirm: true,
  })
  if (stickingErr || !createdSticking.user) {
    throw new Error(`fixture setup failed (sticking user): ${stickingErr?.message}`)
  }
  userSticking = { id: createdSticking.user.id }

  const { error: stickingNodeErr } = await admin.from('knowledge_nodes').insert({
    user_id: userSticking.id,
    concept_key: STICKING_CONCEPT,
    mastery: 0.4,
    stability: 3,
    state: 'weak',
    confidence_band: 'low',
    observation_count: 5,
    last_practiced_at: new Date().toISOString(),
  })
  if (stickingNodeErr) throw new Error(`fixture setup failed (sticking knowledge_nodes seed): ${stickingNodeErr.message}`)

  const now = Date.now()
  const { error: stickingMisconceptionsErr } = await admin.from('misconceptions').insert([
    {
      user_id: userSticking.id,
      concept_key: STICKING_CONCEPT,
      category: 'sign-errors',
      description: 'drops the negative sign when distributing',
      status: 'active',
      occurrence_count: 5,
      last_seen_at: new Date(now).toISOString(),
    },
    {
      user_id: userSticking.id,
      concept_key: STICKING_CONCEPT,
      category: 'setup-errors',
      description: 'writes the equation with the wrong sign on b',
      status: 'active',
      occurrence_count: 3,
      last_seen_at: new Date(now - 1 * 24 * 60 * 60 * 1000).toISOString(),
    },
    {
      user_id: userSticking.id,
      concept_key: STICKING_CONCEPT,
      category: 'method-choice',
      description: 'guesses between factoring and the formula',
      status: 'active',
      occurrence_count: 2,
      last_seen_at: new Date(now - 2 * 24 * 60 * 60 * 1000).toISOString(),
    },
    // A 4th, deliberately the LOWEST-ranked -- must never surface once the
    // route caps stickingCandidates at 3.
    {
      user_id: userSticking.id,
      concept_key: STICKING_CONCEPT,
      category: 'extra-mistake',
      description: 'should never appear -- capped at 3',
      status: 'active',
      occurrence_count: 1,
      last_seen_at: new Date(now - 3 * 24 * 60 * 60 * 1000).toISOString(),
    },
  ])
  if (stickingMisconceptionsErr) {
    throw new Error(`fixture setup failed (sticking misconceptions seed): ${stickingMisconceptionsErr.message}`)
  }

  const stickingClient = createClient(url, anonKey)
  const { data: signInSticking, error: signInStickingErr } = await stickingClient.auth.signInWithPassword({
    email: stickingEmail,
    password: PASSWORD,
  })
  if (signInStickingErr || !signInSticking.session) {
    throw new Error(`sign-in failed (sticking user): ${signInStickingErr?.message}`)
  }
  tokenSticking = signInSticking.session.access_token
}, 45000)

afterAll(async () => {
  // No FK in this schema cascades (0007's comment: erasure is an explicit,
  // ordered service-role sweep, not a DB-level cascade), so each user's rows
  // are cleared child-first in the PLAN §2.7 order: session_interactions ->
  // sessions -> reinforcement_schedule -> misconceptions -> knowledge_nodes
  // -> users -> auth user. `user` needs this too as of Sprint 11: the
  // ADR-019 positive-path test drives a real session + interaction + apply
  // for it (before Sprint 11 that user owned no rows at all).
  for (const fixture of [userSticking, userPingsWide, userPings, userTags, userDue, userDecayed, userWithProfile, user]) {
    if (!fixture) continue
    await admin.from('session_interactions').delete().eq('user_id', fixture.id)
    await admin.from('sessions').delete().eq('user_id', fixture.id)
    await admin.from('reinforcement_schedule').delete().eq('user_id', fixture.id)
    await admin.from('misconceptions').delete().eq('user_id', fixture.id)
    await admin.from('knowledge_nodes').delete().eq('user_id', fixture.id)
    await admin.from('users').delete().eq('id', fixture.id)
    await admin.auth.admin.deleteUser(fixture.id)
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

  it('the system prompt carries the math-only rule, the Socratic pedagogy block, and the live (cold-start) profile; the page-context slot is empty', async () => {
    const { status } = await turn(token, {
      messages: [{ role: 'user', content: 'How do I factor x^2+5x+6?' }],
    })

    expect(status).toBe(200)
    expect(receivedRequests).toHaveLength(1)

    const system = receivedRequests[0].system as string
    expect(typeof system).toBe('string')
    expect(system).toContain('NEVER answer anything outside mathematics')
    expect(system).toContain('DEFAULT MODE IS SOCRATIC')
    // `user` has zero knowledge_nodes -- loadProfile's cold-start fallback
    // (ADR-014), replacing the retired HARDCODED_PROFILE (ADR-009).
    expect(system).toContain('(no mastery data yet)')
    expect(system).toContain('(none active)')
    expect(system).toContain('Calibrating — early estimate.')
    expect(system).toContain('(no page context this turn)')

    expect(receivedRequests[0].messages).toEqual([
      { role: 'user', content: 'How do I factor x^2+5x+6?' },
    ])
  })

  // --- Sprint 08 Task 7: live profile read replaces HARDCODED_PROFILE ---

  it('live profile in the prompt: a seeded knowledge_node replaces the calibrating fallback', async () => {
    const { status } = await turn(tokenWithProfile, {
      messages: [{ role: 'user', content: 'How do I factor x^2+5x+6?' }],
    })

    expect(status).toBe(200)
    expect(receivedRequests).toHaveLength(1)

    const system = receivedRequests[0].system as string
    expect(system).toContain(`${SEEDED_CONCEPT_KEY}: mastery 0.42, state learning, confidence medium`)
    expect(system).not.toContain('(no mastery data yet)')
    expect(system).toContain('Confidence: Based on recorded session history.')
  })

  // --- Sprint 09 Task 7: read-time decay (ADR-016, profile-read.ts) ---

  it('decay-on-read: an old, low-stability node reads back with reduced mastery, not the raw stored value', async () => {
    const { status } = await turn(tokenDecayed, {
      messages: [{ role: 'user', content: 'How do I use the quadratic formula here?' }],
    })

    expect(status).toBe(200)
    expect(receivedRequests).toHaveLength(1)

    const system = receivedRequests[0].system as string
    expect(system).toContain(`${DECAY_CONCEPT_KEY}: mastery ${DECAY_EXPECTED_MASTERY}`)
    expect(system).not.toContain(`mastery ${DECAY_RAW_MASTERY.toFixed(2)}`)
  })

  it('writes nothing to knowledge_nodes on a turn (ADR-013 holds for the live profile read)', async () => {
    const before = await admin
      .from('knowledge_nodes')
      .select('mastery, observation_count')
      .eq('user_id', userWithProfile.id)
      .eq('concept_key', SEEDED_CONCEPT_KEY)
      .single()

    const { status } = await turn(tokenWithProfile, {
      messages: [{ role: 'user', content: 'Can you check my work on this one?' }],
    })
    expect(status).toBe(200)

    const after = await admin
      .from('knowledge_nodes')
      .select('mastery, observation_count')
      .eq('user_id', userWithProfile.id)
      .eq('concept_key', SEEDED_CONCEPT_KEY)
      .single()

    // The turn route only reads loadProfile -- the seeded row is untouched.
    expect(after.data).toEqual(before.data)
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

  // ADR-013 ("the turn writes nothing") was explicitly and deliberately
  // reversed by ADR-019 (Sprint 11): the route now writes one
  // session_interactions row per gradable turn, but ONLY when the caller
  // supplies a sessionId AND the model returned an assessment. Neither is
  // true for this turn (no sessionId in the body; the fake Anthropic
  // backend's default canned reply is plain text, which parseEnvelope
  // degrades to `{ say }` with no assessment) -- so this asserts the
  // no-sessionId degrade path still writes nothing, and that whatever the
  // route DOES write (ADR-019) only ever goes through the caller's
  // RLS-scoped bearer client, never the service-role client, and never
  // touches the unrelated `sessions` table directly.
  it('writes nothing when no sessionId is supplied, and never via the service-role client (ADR-019 scope guard)', async () => {
    const sessionsBefore = await admin
      .from('sessions')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', user.id)

    const interactionsBefore = await admin
      .from('session_interactions')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', user.id)

    const { status } = await turn(token, {
      messages: [{ role: 'user', content: 'what equation is this?' }],
      pageContext: { equations: [{ latex: 'x^2 + 5x + 6 = 0' }] },
    })
    expect(status).toBe(200)

    const sessionsAfter = await admin
      .from('sessions')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', user.id)

    const interactionsAfter = await admin
      .from('session_interactions')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', user.id)

    // The AI turn route is entirely separate from /api/session/start and
    // never touches the sessions table.
    expect(sessionsAfter.count).toBe(sessionsBefore.count)

    // No sessionId was sent, so ADR-019's persistence path has nothing to
    // attach a row to and writes nothing.
    expect(interactionsAfter.count).toBe(interactionsBefore.count)

    // Structural guard, mirroring the ADR-011 no-storage-import assertion
    // in voice.test.ts: the route's own source never imports the
    // service-role/write-capable client -- every write ADR-019 added goes
    // through the caller's RLS-scoped bearer client, never an elevated one.
    const source = readFileSync(resolve(process.cwd(), 'app/api/ai/turn/route.ts'), 'utf-8')
    expect(source).not.toMatch(/from\s+['"]@\/lib\/supabase\/admin['"]/)
  })

  // The positive-path counterpart to the guard above, and Task 4's own
  // acceptance gate verified live: a turn WITH a real, owned sessionId AND
  // a model response the envelope parses an assessment out of writes
  // exactly one session_interactions row carrying that assessment plus the
  // client-supplied latency (ADR-019).
  it('writes exactly one session_interactions row with the envelope assessment + latency when sessionId is supplied (ADR-019 positive path)', async () => {
    nextResponse = {
      status: 200,
      body: fakeTextMessage(
        JSON.stringify({
          say: 'Nice, that factoring is correct.',
          mode: 'socratic',
          assessment: {
            concept_key: SEEDED_CONCEPT_KEY,
            outcome: 'correct',
            reasoning_quality: 'sound',
            self_confidence: 'high',
            misconception_category: null,
            confidence: 'high',
          },
        })
      ),
    }

    const started = await fetch(`${API_BASE}/api/session/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ mode: 'text' }),
    })
    const { sessionId } = await started.json()
    expect(sessionId).toBeTruthy()

    const { status, json } = await turn(token, {
      sessionId,
      messages: [{ role: 'user', content: 'x^2 - 4 factors to (x-2)(x+2)' }],
      responseLatencyMs: 4200,
    })

    expect(status).toBe(200)
    expect(json.reply).toBe('Nice, that factoring is correct.')

    const { data, count } = await admin
      .from('session_interactions')
      .select('*', { count: 'exact' })
      .eq('session_id', sessionId)

    expect(count).toBe(1)
    const row = data![0]
    expect(row.turn_index).toBe(1)
    expect(row.concept_key).toBe(SEEDED_CONCEPT_KEY)
    expect(row.outcome).toBe('correct')
    expect(row.reasoning_quality).toBe('sound')
    expect(row.self_confidence).toBe('high')
    expect(row.misconception_category).toBeNull()
    expect(row.response_latency_ms).toBe(4200)
    expect(row.student_transcript).toBe('x^2 - 4 factors to (x-2)(x+2)')
    expect(row.tutor_response).toBe('Nice, that factoring is correct.')
    // applied_to_profile is flipped by the off-critical-path after() hook
    // (Task 4's stub; Task 5 gives it real work to do) -- its exact timing
    // relative to this follow-up query is not guaranteed, so it is
    // deliberately not asserted here.
  })

  // --- Sprint 11 Task 8: the ADR-019 reversal is bounded ---

  it('a turn with a sessionId but no assessment (opening turn / plain-text degrade) writes nothing and still replies', async () => {
    const started = await fetch(`${API_BASE}/api/session/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ mode: 'text' }),
    })
    const { sessionId } = await started.json()
    expect(sessionId).toBeTruthy()

    // Case 1: a valid envelope that simply has no assessment -- the §2.5
    // opening turn ("OMIT this whole key on your opening turn").
    nextResponse = {
      status: 200,
      body: fakeTextMessage(JSON.stringify({ say: 'Welcome! What are we working on today?', mode: 'socratic' })),
    }
    const opening = await turn(token, {
      sessionId,
      messages: [{ role: 'user', content: 'hi, I have algebra homework' }],
      responseLatencyMs: 2500,
    })
    expect(opening.status).toBe(200)
    expect(opening.json.reply).toBe('Welcome! What are we working on today?')

    // Case 2: the model ignored the envelope instruction entirely --
    // parseEnvelope degrades to { say: <raw> } with no assessment, so the
    // student still gets the reply verbatim and nothing is persisted.
    nextResponse = { status: 200, body: fakeTextMessage('Just plain prose, no JSON at all.') }
    const degraded = await turn(token, {
      sessionId,
      messages: [{ role: 'user', content: 'ok what first?' }],
      responseLatencyMs: 2500,
    })
    expect(degraded.status).toBe(200)
    expect(degraded.json.reply).toBe('Just plain prose, no JSON at all.')

    const { count } = await admin
      .from('session_interactions')
      .select('id', { count: 'exact', head: true })
      .eq('session_id', sessionId)
    expect(count).toBe(0)
  })

  it('an unknown or foreign sessionId degrades to no-persistence -- the turn still replies (a persistence failure never fails the turn)', async () => {
    // The fake reply carries a full gradable assessment both times, so the
    // ownership check is the ONLY thing standing between these turns and a
    // write -- exactly the boundary this test pins.
    const gradableEnvelope = () => ({
      status: 200 as const,
      body: fakeTextMessage(
        JSON.stringify({
          say: 'Good, that solve is right.',
          assessment: {
            concept_key: 'algebra.linear-equations.one-variable',
            outcome: 'correct',
            reasoning_quality: 'sound',
            self_confidence: 'high',
            confidence: 'high',
          },
        })
      ),
    })

    // Unknown: a well-formed uuid that matches no sessions row.
    nextResponse = gradableEnvelope()
    const ghostSessionId = crypto.randomUUID()
    const ghost = await turn(token, {
      sessionId: ghostSessionId,
      messages: [{ role: 'user', content: 'x = 4' }],
      responseLatencyMs: 5000,
    })
    expect(ghost.status).toBe(200)
    expect(ghost.json.reply).toBe('Good, that solve is right.')

    const ghostRows = await admin
      .from('session_interactions')
      .select('id', { count: 'exact', head: true })
      .eq('session_id', ghostSessionId)
    expect(ghostRows.count).toBe(0)

    // Foreign: a real session owned by a DIFFERENT user (userWithProfile).
    // The route's explicit ownership check -- not just RLS -- must refuse to
    // attach `user`'s turn to it.
    const started = await fetch(`${API_BASE}/api/session/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenWithProfile}` },
      body: JSON.stringify({ mode: 'text' }),
    })
    const { sessionId: foreignSessionId } = await started.json()
    expect(foreignSessionId).toBeTruthy()

    nextResponse = gradableEnvelope()
    const foreign = await turn(token, {
      sessionId: foreignSessionId,
      messages: [{ role: 'user', content: 'x = 4' }],
      responseLatencyMs: 5000,
    })
    expect(foreign.status).toBe(200)
    expect(foreign.json.reply).toBe('Good, that solve is right.')

    const foreignRows = await admin
      .from('session_interactions')
      .select('id', { count: 'exact', head: true })
      .eq('session_id', foreignSessionId)
    expect(foreignRows.count).toBe(0)
  })

  // --- Sprint 11 Task 8: due resurfacing + topic bias in the read
  // (ADR-020/ADR-021, Task 6) ---

  it('an overdue reinforcement item renders as "Fading / due for review" with the let\'s-revisit opening; the default read stays weakest-first', async () => {
    const { status } = await turn(tokenDue, {
      messages: [{ role: 'user', content: 'hi, ready to practice' }],
    })

    expect(status).toBe(200)
    expect(receivedRequests).toHaveLength(1)

    const system = receivedRequests[0].system as string
    // Query 2 (ADR-020) surfaced into the STUDENT PROFILE block, with the
    // reason built from the schedule row + the joined node state.
    expect(system).toContain('Fading / due for review')
    expect(system).toContain("let's revisit…")
    expect(system).toContain(`- ${DUE_WEAK_CONCEPT} (weak, overdue by ${DUE_OVERDUE_DAYS}d)`)

    // No pageContext -> no topic bias -> the pre-Sprint-11 weakest-first
    // ordering holds: the weak node's mastery line renders before the
    // strong one's.
    const weakLine = system.indexOf(`${DUE_WEAK_CONCEPT}: mastery 0.20`)
    const strongLine = system.indexOf(`${DUE_TOPIC_CONCEPT}: mastery 0.80`)
    expect(weakLine).toBeGreaterThan(-1)
    expect(strongLine).toBeGreaterThan(-1)
    expect(weakLine).toBeLessThan(strongLine)
  })

  it('a page whose math maps to a concept orders that concept FIRST in the profile (ADR-021 topic bias)', async () => {
    const { status } = await turn(tokenDue, {
      // Deliberately topic-neutral transcript: the detection signal here is
      // the pageContext alone (detectTopicKeys also reads the transcript,
      // but that path shouldn't be what makes this test pass).
      messages: [{ role: 'user', content: 'can you help me with what is on my screen?' }],
      pageContext: {
        title: 'Factoring Quadratic Equations — Practice Set',
        text: 'Factor each quadratic expression completely.',
        equations: [{ latex: 'x^2 + 5x + 6 = 0' }],
      },
    })

    expect(status).toBe(200)
    expect(receivedRequests).toHaveLength(1)

    const system = receivedRequests[0].system as string
    // The strong-but-page-relevant node now outranks the weaker one -- the
    // reorder is the ONLY change (both lines still render, nothing dropped).
    const strongLine = system.indexOf(`${DUE_TOPIC_CONCEPT}: mastery 0.80`)
    const weakLine = system.indexOf(`${DUE_WEAK_CONCEPT}: mastery 0.20`)
    expect(strongLine).toBeGreaterThan(-1)
    expect(weakLine).toBeGreaterThan(-1)
    expect(strongLine).toBeLessThan(weakLine)

    // The due signal rides along unchanged, and the page context itself is
    // still injected as before.
    expect(system).toContain('Fading / due for review')
    expect(system).toContain('x^2 + 5x + 6 = 0')
  })

  it('a profile with no due items and no topic match reads exactly as before (back-compat)', async () => {
    const { status } = await turn(tokenWithProfile, {
      messages: [{ role: 'user', content: 'hello again' }],
    })

    expect(status).toBe(200)
    const system = receivedRequests[0].system as string
    // userWithProfile has no reinforcement_schedule rows and this turn has
    // no pageContext -- the Sprint 11 read additions must be invisible.
    expect(system).not.toContain('Fading / due for review')
    expect(system).toContain(`${SEEDED_CONCEPT_KEY}: mastery 0.42, state learning, confidence medium`)
  })

  // --- Sprint 12 Task 8: annotations ride the wire additively (ADR-022/023) ---
  // envelope.test.ts already covers parseAnnotation's own structural
  // validation (valid/invalid shapes, mixed-array filtering, empty-array
  // omission) at the unit level; these assert the SAME behaviour survives
  // at the route boundary -- the actual `{ reply, annotations? }` JSON a
  // caller receives.

  it('returns the envelope\'s validated annotations additively as { reply, annotations }', async () => {
    nextResponse = {
      status: 200,
      body: fakeTextMessage(
        JSON.stringify({
          say: 'Look at the highlighted term.',
          mode: 'socratic',
          annotations: [
            {
              id: 'a1',
              type: 'highlight',
              target: { kind: 'textMatch', text: 'x^2 + 5x + 6 = 0' },
              style: { color: 'amber' },
              label: 'start here',
            },
          ],
        })
      ),
    }

    const { status, json } = await turn(token, {
      messages: [{ role: 'user', content: 'which term do I factor first?' }],
    })

    expect(status).toBe(200)
    expect(json.reply).toBe('Look at the highlighted term.')
    expect(json.annotations).toEqual([
      {
        id: 'a1',
        type: 'highlight',
        target: { kind: 'textMatch', text: 'x^2 + 5x + 6 = 0' },
        style: { color: 'amber' },
        label: 'start here',
      },
    ])
  })

  it('omits the annotations field entirely (not null, not []) when the envelope carries none -- byte-identical to Sprint 11', async () => {
    // Case 1: a well-formed envelope with an explicit empty array.
    nextResponse = {
      status: 200,
      body: fakeTextMessage(JSON.stringify({ say: 'No annotations this turn.', mode: 'socratic', annotations: [] })),
    }
    const empty = await turn(token, { messages: [{ role: 'user', content: 'hi' }] })
    expect(empty.status).toBe(200)
    expect(empty.json.reply).toBe('No annotations this turn.')
    expect(Object.keys(empty.json)).toEqual(['reply'])

    // Case 2: the plain-text degrade path (parseEnvelope's fallback) --
    // exactly the existing "relays the model reply verbatim" fixture shape.
    nextResponse = { status: 200, body: fakeTextMessage('Just plain prose, no envelope at all.') }
    const plain = await turn(token, { messages: [{ role: 'user', content: 'hi' }] })
    expect(plain.status).toBe(200)
    expect(Object.keys(plain.json)).toEqual(['reply'])
  })

  it('drops structurally invalid annotation entries before they reach the client, keeping only the valid ones', async () => {
    nextResponse = {
      status: 200,
      body: fakeTextMessage(
        JSON.stringify({
          say: 'Mixed batch.',
          mode: 'socratic',
          annotations: [
            { id: 'good', type: 'circle', target: { kind: 'textMatch', text: 'x = 4' } },
            { id: '', type: 'circle', target: { kind: 'textMatch', text: 'invalid: empty id' } },
            { id: 'bad-type', type: 'not-a-real-type', target: { kind: 'textMatch', text: 'invalid: bad type' } },
            { id: 'bad-target', type: 'circle', target: { kind: 'nope' } },
          ],
        })
      ),
    }

    const { status, json } = await turn(token, { messages: [{ role: 'user', content: 'check my answer' }] })

    expect(status).toBe(200)
    expect(json.annotations).toEqual([{ id: 'good', type: 'circle', target: { kind: 'textMatch', text: 'x = 4' } }])
  })

  it('a turn with annotations writes the SAME session_interactions row shape as Sprint 11 -- annotations are never persisted (ADR-023)', async () => {
    nextResponse = {
      status: 200,
      body: fakeTextMessage(
        JSON.stringify({
          say: 'Nice, that factoring is correct.',
          mode: 'socratic',
          assessment: {
            concept_key: SEEDED_CONCEPT_KEY,
            outcome: 'correct',
            reasoning_quality: 'sound',
            self_confidence: 'high',
            misconception_category: null,
            confidence: 'high',
          },
          annotations: [{ id: 'a1', type: 'highlight', target: { kind: 'textMatch', text: 'x^2 - 4' } }],
        })
      ),
    }

    const started = await fetch(`${API_BASE}/api/session/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ mode: 'text' }),
    })
    const { sessionId } = await started.json()
    expect(sessionId).toBeTruthy()

    const { status, json } = await turn(token, {
      sessionId,
      messages: [{ role: 'user', content: 'x^2 - 4 factors to (x-2)(x+2)' }],
      responseLatencyMs: 4200,
    })

    expect(status).toBe(200)
    expect(json.annotations).toHaveLength(1)

    const { data, count } = await admin
      .from('session_interactions')
      .select('*', { count: 'exact' })
      .eq('session_id', sessionId)

    expect(count).toBe(1)
    const row = data![0]

    // The exact column set is unchanged from Sprint 11 -- no annotation data
    // anywhere in the row, in any column.
    expect(Object.keys(row).sort()).toEqual(EXPECTED_SESSION_INTERACTIONS_COLUMNS)
    expect(JSON.stringify(row)).not.toContain('annotation')

    // Same shape as the Sprint 11 ADR-019 positive-path test above --
    // annotations changed nothing about what gets written.
    expect(row.turn_index).toBe(1)
    expect(row.concept_key).toBe(SEEDED_CONCEPT_KEY)
    expect(row.outcome).toBe('correct')
    expect(row.tutor_response).toBe('Nice, that factoring is correct.')
  })
})

// --- Sprint 14 Task 3 (ADR-027/028): solutionProgress + session thread
// through the wire additively -- envelope.test.ts already pins the PARSE
// contract (clamping, malformed-drops-the-whole-field); these assert the
// SEPARATE thread-through-only behaviour at the route: present when the
// envelope carried it, OMITTED (not null) when it didn't, and -- per
// ADR-028 -- never persisted (session_interactions keeps its Sprint 11
// shape regardless of either field).
describe('/api/ai/turn: solutionProgress + session (Sprint 14, ADR-027/028)', () => {
  it('threads solutionProgress + session onto the response when the envelope carries both', async () => {
    nextResponse = {
      status: 200,
      body: fakeTextMessage(
        JSON.stringify({
          say: 'Now closing tutoring session.',
          assessment: {
            concept_key: SEEDED_CONCEPT_KEY,
            outcome: 'correct',
            reasoning_quality: 'sound',
            self_confidence: 'high',
            misconception_category: null,
            confidence: 'high',
          },
          solution_progress: 1,
          session: { complete: true, reason: 'solved' },
        })
      ),
    }

    const started = await start(token, { mode: 'text' })
    const { status, json } = await turn(token, {
      sessionId: started.json.sessionId,
      messages: [{ role: 'user', content: 'x^2 - 4 = 0 -> x = 2 or x = -2' }],
    })

    expect(status).toBe(200)
    expect(json.solutionProgress).toBe(1)
    expect(json.session).toEqual({ complete: true, reason: 'solved' })
  })

  it('omits both fields entirely (not null, not present) when the envelope carries neither -- byte-identical to Sprint 13', async () => {
    nextResponse = {
      status: 200,
      body: fakeTextMessage(
        JSON.stringify({
          say: 'What do you get when you expand that?',
          assessment: {
            concept_key: SEEDED_CONCEPT_KEY,
            outcome: 'correct',
            reasoning_quality: 'sound',
            self_confidence: 'high',
            misconception_category: null,
            confidence: 'high',
          },
        })
      ),
    }

    const started = await start(token, { mode: 'text' })
    const { status, json } = await turn(token, {
      sessionId: started.json.sessionId,
      messages: [{ role: 'user', content: 'still working on it' }],
    })

    expect(status).toBe(200)
    expect(json.solutionProgress).toBeUndefined()
    expect(json.session).toBeUndefined()
    expect(Object.prototype.hasOwnProperty.call(json, 'solutionProgress')).toBe(false)
    expect(Object.prototype.hasOwnProperty.call(json, 'session')).toBe(false)
  })

  it('neither field is persisted -- session_interactions keeps its Sprint 11 shape regardless of progress/completion', async () => {
    nextResponse = {
      status: 200,
      body: fakeTextMessage(
        JSON.stringify({
          say: 'Now closing tutoring session.',
          assessment: {
            concept_key: SEEDED_CONCEPT_KEY,
            outcome: 'correct',
            reasoning_quality: 'sound',
            self_confidence: 'high',
            misconception_category: null,
            confidence: 'high',
          },
          solution_progress: 1,
          session: { complete: true, reason: 'solved' },
        })
      ),
    }

    const started = await start(token, { mode: 'text' })
    const { sessionId } = started.json
    const { status } = await turn(token, {
      sessionId,
      messages: [{ role: 'user', content: 'x^2 - 4 = 0 -> x = 2 or x = -2' }],
    })
    expect(status).toBe(200)

    const { data, count } = await admin
      .from('session_interactions')
      .select('*', { count: 'exact' })
      .eq('session_id', sessionId)

    expect(count).toBe(1)
    expect(Object.keys(data![0]).sort()).toEqual(EXPECTED_SESSION_INTERACTIONS_COLUMNS)
    expect(JSON.stringify(data![0])).not.toContain('solution_progress')
    expect(JSON.stringify(data![0])).not.toContain('"session"')
  })
})

// --- Sprint 13 Task 9: the tag + callback grounding gate (ADR-024/026;
// re-surfaced as memory pins by ADR-034) ---
// envelope.test.ts already pins parseProfileTag's own structural contract;
// these assert the SEPARATE, decisive authority -- turn-complete.ts's
// groundProfileTags, which verifies each structurally-valid tag against the
// EXACT LearningProfile this request injected, using userTags's fixture
// profile (one mastery node + active misconception on TAG_MASTERY_CONCEPT,
// one due item on TAG_DUE_CONCEPT, one real prior-session digest entry on
// TAG_CALLBACK_CONCEPT). Since ADR-034 the response carries no profileTags
// field at all: the two cross-session kinds (due-review / callback)
// surface as memory-category status pins, and the other three kinds
// (reviewing / strength / known-gap) are grounding-only -- a grounded one
// and a dropped one are both invisible in the response, which is exactly
// the contract these first three cases pin. envelope.ts's MAX_PROFILE_TAGS
// caps the parsed array at 2 BEFORE grounding ever runs, so each case below
// sends exactly one tag to isolate what's under test.
describe('/api/ai/turn: profile-tag grounding gate -> memory pins', () => {
  it('a grounded "reviewing" tag no longer surfaces anywhere in the response (grounding-only kind)', async () => {
    nextResponse = {
      status: 200,
      body: fakeTextMessage(
        JSON.stringify({
          say: 'Let\'s keep working on this.',
          profile_tags: [{ kind: 'reviewing', concept_key: TAG_MASTERY_CONCEPT, label: 'model-written label' }],
        })
      ),
    }

    const { status, json } = await turn(tokenTags, { messages: [{ role: 'user', content: 'more factoring practice' }] })

    expect(status).toBe(200)
    expect(Object.keys(json)).toEqual(['reply'])
  })

  it('a grounded "strength" tag no longer surfaces anywhere in the response (grounding-only kind)', async () => {
    nextResponse = {
      status: 200,
      body: fakeTextMessage(
        JSON.stringify({
          say: 'Building on what you know.',
          profile_tags: [{ kind: 'strength', concept_key: TAG_MASTERY_CONCEPT, label: 'model-written label' }],
        })
      ),
    }

    const { status, json } = await turn(tokenTags, { messages: [{ role: 'user', content: 'another one' }] })

    expect(status).toBe(200)
    expect(Object.keys(json)).toEqual(['reply'])
  })

  it('a grounded "known-gap" tag no longer surfaces anywhere in the response (grounding-only kind)', async () => {
    nextResponse = {
      status: 200,
      body: fakeTextMessage(
        JSON.stringify({
          say: 'Watch that sign.',
          profile_tags: [{ kind: 'known-gap', concept_key: TAG_MASTERY_CONCEPT, label: 'sign errors' }],
        })
      ),
    }

    const { status, json } = await turn(tokenTags, { messages: [{ role: 'user', content: '-(x+2) = -x+2' }] })

    expect(status).toBe(200)
    expect(Object.keys(json)).toEqual(['reply'])
  })

  it('a grounded "due-review" tag surfaces as a memory pin, title-resolved by the grounding gate', async () => {
    nextResponse = {
      status: 200,
      body: fakeTextMessage(
        JSON.stringify({
          say: "Let's revisit this one.",
          profile_tags: [{ kind: 'due-review', concept_key: TAG_DUE_CONCEPT, label: 'model-written label' }],
        })
      ),
    }

    const { status, json } = await turn(tokenTags, { messages: [{ role: 'user', content: 'ready to review' }] })

    expect(status).toBe(200)
    // The model's own label never survives: the grounding gate replaced it
    // with the curriculum title, and the pin copy is built from that.
    expect(json.pins).toEqual([
      { category: 'memory', kind: 'due-review', conceptKey: TAG_DUE_CONCEPT, label: `Reviewing: ${TAG_DUE_TITLE}` },
    ])
  })

  it('a grounded "callback" tag surfaces as a memory pin with FIXED copy -- the model\'s phrasing belongs in `say`, never the pin', async () => {
    nextResponse = {
      status: 200,
      body: fakeTextMessage(
        JSON.stringify({
          say: 'This connects to what you worked through a few sessions ago.',
          profile_tags: [{ kind: 'callback', concept_key: TAG_CALLBACK_CONCEPT, label: 'a few sessions ago' }],
        })
      ),
    }

    const { status, json } = await turn(tokenTags, { messages: [{ role: 'user', content: 'x^3 * x^4' }] })

    expect(status).toBe(200)
    expect(json.pins).toEqual([
      { category: 'memory', kind: 'callback', conceptKey: TAG_CALLBACK_CONCEPT, label: 'Building on a previous session' },
    ])
  })

  it('a "known-gap" tag on a concept with NO active misconception is dropped -- no field appears, not an empty one', async () => {
    nextResponse = {
      status: 200,
      body: fakeTextMessage(
        JSON.stringify({
          say: 'Nice work.',
          profile_tags: [{ kind: 'known-gap', concept_key: TAG_UNGROUNDED_CONCEPT, label: 'a made-up gap' }],
        })
      ),
    }

    const { status, json } = await turn(tokenTags, { messages: [{ role: 'user', content: 'expand (x+1)(x+2)' }] })

    expect(status).toBe(200)
    expect(Object.keys(json)).toEqual(['reply'])
  })

  it('a "callback" tag naming a session/concept absent from priorWork is dropped -- no memory pin rides', async () => {
    nextResponse = {
      status: 200,
      body: fakeTextMessage(
        JSON.stringify({
          say: 'Nice work.',
          profile_tags: [{ kind: 'callback', concept_key: TAG_UNGROUNDED_CONCEPT, label: 'a session that never happened' }],
        })
      ),
    }

    const { status, json } = await turn(tokenTags, { messages: [{ role: 'user', content: 'expand (x+1)(x+2)' }] })

    expect(status).toBe(200)
    expect(Object.keys(json)).toEqual(['reply'])
  })

  it('a "due-review" tag on a concept that is not actually due is dropped -- no memory pin rides', async () => {
    nextResponse = {
      status: 200,
      body: fakeTextMessage(
        JSON.stringify({
          say: 'Nice work.',
          profile_tags: [{ kind: 'due-review', concept_key: TAG_UNGROUNDED_CONCEPT, label: 'made up' }],
        })
      ),
    }

    const { status, json } = await turn(tokenTags, { messages: [{ role: 'user', content: 'expand (x+1)(x+2)' }] })

    expect(status).toBe(200)
    expect(Object.keys(json)).toEqual(['reply'])
  })

  it('a grounded tag is never persisted -- session_interactions keeps its Sprint 11 shape', async () => {
    nextResponse = {
      status: 200,
      body: fakeTextMessage(
        JSON.stringify({
          say: 'Nice, that factoring is correct.',
          profile_tags: [{ kind: 'reviewing', concept_key: TAG_MASTERY_CONCEPT, label: 'model-written label' }],
          assessment: {
            concept_key: TAG_MASTERY_CONCEPT,
            outcome: 'correct',
            reasoning_quality: 'sound',
            self_confidence: 'high',
            misconception_category: null,
            confidence: 'high',
          },
        })
      ),
    }

    const started = await start(tokenTags, { mode: 'text' })
    expect(started.status).toBe(200)

    const { status, json } = await turn(tokenTags, {
      sessionId: started.json.sessionId,
      messages: [{ role: 'user', content: 'x^2 - 4 factors to (x-2)(x+2)' }],
    })

    expect(status).toBe(200)
    expect(json.profileTags).toBeUndefined()

    const { data, count } = await admin
      .from('session_interactions')
      .select('*', { count: 'exact' })
      .eq('session_id', started.json.sessionId)

    expect(count).toBe(1)
    expect(Object.keys(data![0]).sort()).toEqual(EXPECTED_SESSION_INTERACTIONS_COLUMNS)
    expect(JSON.stringify(data![0])).not.toContain('reviewing')
  })
})

// --- Sprint 13 Task 9: turn-time learning-event pins (ADR-026; renamed and
// re-shaped by ADR-034's status pins) ---
// Learning-event pins only ride the response when persistInteraction
// actually scheduled the off-critical-path apply (a real, owned sessionId),
// so every case here starts a real session first. Each concept is seeded
// directly via the service role (fixture data, not the write path --
// computeStatusPins' READ of it is what's under test) and touched by
// exactly one real turn.
describe('/api/ai/turn: learning-event pins', () => {
  async function seedNode(
    conceptKey: string,
    row: {
      mastery: number
      stability: number
      difficulty?: number
      state: string
      confidenceBand: string
      observationCount: number
    },
    userId: string = userPings.id
  ) {
    const { error } = await admin.from('knowledge_nodes').insert({
      user_id: userId,
      concept_key: conceptKey,
      mastery: row.mastery,
      stability: row.stability,
      difficulty: row.difficulty ?? 0.3,
      state: row.state,
      confidence_band: row.confidenceBand,
      observation_count: row.observationCount,
      last_practiced_at: new Date().toISOString(),
    })
    if (error) throw new Error(`ping fixture seed failed for ${conceptKey}: ${error.message}`)
  }

  async function seedMisconception(conceptKey: string, consecutiveCorrect: number, userId: string = userPings.id) {
    const { error } = await admin.from('misconceptions').insert({
      user_id: userId,
      concept_key: conceptKey,
      category: 'sign-errors',
      description: 'drops the negative sign when distributing',
      status: 'active',
      occurrence_count: 2,
      consecutive_correct: consecutiveCorrect,
    })
    if (error) throw new Error(`ping fixture misconception seed failed for ${conceptKey}: ${error.message}`)
  }

  async function soundCorrectTurn(
    conceptKey: string,
    misconceptionCategory: string | null = null,
    bearer: string = tokenPings
  ) {
    const started = await start(bearer, { mode: 'text' })
    expect(started.status).toBe(200)

    nextResponse = {
      status: 200,
      body: fakeTextMessage(
        JSON.stringify({
          say: 'Nice work.',
          assessment: {
            concept_key: conceptKey,
            outcome: misconceptionCategory ? 'incorrect' : 'correct',
            reasoning_quality: misconceptionCategory ? 'shallow' : 'sound',
            self_confidence: misconceptionCategory ? 'low' : 'high',
            misconception_category: misconceptionCategory,
            confidence: 'high',
          },
        })
      ),
    }

    return turn(bearer, { sessionId: started.json.sessionId, messages: [{ role: 'user', content: 'my attempt' }] })
  }

  it('a state-crossing update (weak -> learning) fires exactly one concept-understood pin', async () => {
    const conceptKey = 'algebra.polynomials.expanding'
    await seedNode(conceptKey, { mastery: 0.45, stability: 5, state: 'weak', confidenceBand: 'low', observationCount: 2 })

    const { status, json } = await soundCorrectTurn(conceptKey)

    expect(status).toBe(200)
    expect(json.pins).toEqual([
      {
        category: 'progress',
        kind: 'concept-understood',
        conceptKey,
        label: 'Key concept understood: Expanding polynomials',
      },
    ])
  })

  it('an in-state tick (learning -> learning) fires no pin', async () => {
    const conceptKey = 'algebra.inequalities.linear'
    await seedNode(conceptKey, { mastery: 0.6, stability: 10, state: 'learning', confidenceBand: 'medium', observationCount: 5 })

    const { status, json } = await soundCorrectTurn(conceptKey)

    expect(status).toBe(200)
    expect(json.pins).toBeUndefined()
  })

  it('mastery already at the mastered threshold but held in "learning" by a low confidence band fires no pin (a band-gated state, not a boundary crossing)', async () => {
    const conceptKey = 'algebra.quadratics.formula'
    // mastery 0.9 would clear MASTERED_THRESHOLD, but confidence_band 'low'
    // (observation_count 1) blocks deriveState's mastered branch, so the
    // STORED state is 'learning' -- and stays 'learning' after this turn,
    // since observationCount is still < the low/medium boundary. No
    // MasteryState transition occurs, so no pin -- exactly the "band
    // upticks alone never ping" contract (ADR-026), since the pin
    // computation only ever looks at the state label, never the band.
    await seedNode(conceptKey, {
      mastery: 0.9,
      stability: 20,
      state: 'learning',
      confidenceBand: 'low',
      observationCount: 1,
    })

    const { status, json } = await soundCorrectTurn(conceptKey)

    expect(status).toBe(200)
    expect(json.pins).toBeUndefined()
  })

  it('a first-ever (unseen) observation fires no pin -- first contact is never an improvement', async () => {
    // No seed row at all -- computeNodeUpdate reads priorState 'unseen'.
    // Under the current constants a fresh node's mastery can only reach
    // ~0.3 on one observation (BASE_K=0.3, confidenceWeight(0)=1), which
    // deriveState reads as 'weak', not 'learning' -- 'unseen->weak' isn't a
    // named upward transition either, so this also pins the exclusion at
    // the only value first contact can actually produce. The ~0.3 delta
    // comfortably clears MASTERY_PROGRESS_THRESHOLD (0.1) too, so this ALSO
    // pins the progress kind's "(and not from unseen)" exclusion (Sprint 14
    // Task 5/9) -- a big single-turn gain from a truly unseen concept still
    // produces no pin of either kind, since 'unseen' is never a member of
    // MASTERY_PROGRESS_STATES regardless of the transition it lands on.
    const conceptKey = 'algebra.linear-equations.two-variable'

    const { status, json } = await soundCorrectTurn(conceptKey)

    expect(status).toBe(200)
    expect(json.pins).toBeUndefined()
  })

  it('a stored "unseen" row that jumps straight to "learning" on one turn fires concept-understood (Sprint 14 Task 5\'s first-contact widening)', async () => {
    // Unlike the no-seed-row case above, an EXISTING row can be explicitly
    // stored with state 'unseen' (priorState reads the stored column
    // verbatim, apply.ts) at a mastery high enough that one sound-correct
    // crosses straight into 'learning' -- exactly ADR-026's amendment: first
    // contact that lands at a real level now celebrates, where Sprint 13
    // kept ALL first contact silent. Same mastery/stability/observationCount
    // as the 'weak->learning' fixture above (proven to land at 0.505,
    // still 'learning') -- only the STORED prior state label differs. Runs
    // against userPingsWide: every base-curriculum concept is already
    // claimed once against userPings by the tests above.
    const conceptKey = 'algebra.polynomials.expanding'
    await seedNode(
      conceptKey,
      { mastery: 0.45, stability: 5, state: 'unseen', confidenceBand: 'low', observationCount: 2 },
      userPingsWide.id
    )

    const { status, json } = await soundCorrectTurn(conceptKey, null, tokenPingsWide)

    expect(status).toBe(200)
    expect(json.pins).toEqual([
      {
        category: 'progress',
        kind: 'concept-understood',
        conceptKey,
        label: 'Key concept understood: Expanding polynomials',
      },
    ])
  })

  it('a stored "unseen" row that jumps straight to "mastered" on one turn fires concept-understood (Sprint 14 Task 5\'s first-contact widening)', async () => {
    // Same mastery/stability/observationCount as the mastered-crossing
    // fixture above (0.84 -> clears MASTERED_THRESHOLD), stored state
    // 'unseen' instead of 'learning'. userPingsWide again (fresh user).
    const conceptKey = 'algebra.quadratics.formula'
    await seedNode(
      conceptKey,
      { mastery: 0.84, stability: 20, state: 'unseen', confidenceBand: 'medium', observationCount: 3 },
      userPingsWide.id
    )

    const { status, json } = await soundCorrectTurn(conceptKey, null, tokenPingsWide)

    expect(status).toBe(200)
    expect(json.pins).toEqual([
      { category: 'progress', kind: 'concept-understood', conceptKey, label: 'Mastered: The quadratic formula' },
    ])
  })

  it('an in-state gain >= MASTERY_PROGRESS_THRESHOLD (0.10) fires exactly one progress pin (Sprint 14 Task 5)', async () => {
    // observationCount 0 -> K = BASE_K(0.3) * confidenceWeight(0)(=1) = 0.3;
    // mastery 0.5 -> 0.5 + 0.3*(1-0.5) = 0.65, a 0.15 delta, comfortably
    // over the 0.10 threshold, both ends inside 'learning' (no crossing --
    // concept-understood's exclusive branch never fires, so this is the
    // ONLY pin). userPingsWide again (fresh user).
    const conceptKey = 'algebra.quadratics.factoring'
    await seedNode(
      conceptKey,
      { mastery: 0.5, stability: 20, state: 'learning', confidenceBand: 'medium', observationCount: 0 },
      userPingsWide.id
    )

    const { status, json } = await soundCorrectTurn(conceptKey, null, tokenPingsWide)

    expect(status).toBe(200)
    expect(json.pins).toEqual([
      { category: 'progress', kind: 'progress', conceptKey, label: 'Progress: Factoring quadratics' },
    ])
  })

  it('an in-state gain BELOW MASTERY_PROGRESS_THRESHOLD fires no pin (a routine tick, not a celebration-worthy jump)', async () => {
    // observationCount 1 -> K = 0.3 * confidenceWeight(1)(=0.5) = 0.15;
    // mastery 0.7 -> 0.7 + 0.15*(1-0.7) = 0.745, a 0.045 delta -- well under
    // 0.10, both ends inside 'learning' (no crossing). userPingsWide again.
    const conceptKey = 'algebra.linear-equations.one-variable'
    await seedNode(
      conceptKey,
      { mastery: 0.7, stability: 20, state: 'learning', confidenceBand: 'medium', observationCount: 1 },
      userPingsWide.id
    )

    const { status, json } = await soundCorrectTurn(conceptKey, null, tokenPingsWide)

    expect(status).toBe(200)
    expect(json.pins).toBeUndefined()
  })

  it('a correct/sound answer that completes the 3-correct resolution streak fires exactly one pattern-broken pin, NEVER also streak-progress on the same (completing) turn (Sprint 14 Task 5\'s superseding rule)', async () => {
    const conceptKey = 'algebra.exponents.product-rule'
    // Mastery stays inside 'learning' before and after (no crossing), so the
    // pattern-broken pin is the ONLY pin this turn produces. Structural, not
    // a runtime special-case (events.ts): the resolving/almostResolving
    // checks are mutually exclusive (RESOLUTION_STREAK vs. RESOLUTION_STREAK
    // - 1 can never both match one row's post-turn consecutive_correct), so
    // the exact-array assertion below is what actually pins "never both."
    await seedNode(conceptKey, { mastery: 0.8, stability: 20, state: 'learning', confidenceBand: 'medium', observationCount: 6 })
    await seedMisconception(conceptKey, 2)

    const { status, json } = await soundCorrectTurn(conceptKey)

    expect(status).toBe(200)
    expect(json.pins).toEqual([
      { category: 'progress', kind: 'pattern-broken', conceptKey, label: 'Pattern broken: sign errors' },
    ])
  })

  it('a correct/sound answer at streak 1 -> 2 (RESOLUTION_STREAK - 1, not yet resolved) fires exactly one streak-progress pin (Sprint 14 Task 5 -- Sprint 13 kept this silent, deliberately reversed)', async () => {
    const conceptKey = 'algebra.exponents.power-rule'
    await seedNode(conceptKey, { mastery: 0.8, stability: 20, state: 'learning', confidenceBand: 'medium', observationCount: 6 })
    await seedMisconception(conceptKey, 1)

    const { status, json } = await soundCorrectTurn(conceptKey)

    expect(status).toBe(200)
    expect(json.pins).toEqual([
      { category: 'progress', kind: 'streak-progress', conceptKey, label: 'Almost broken: sign errors (2 of 3)' },
    ])
  })

  it('the SERVER never auto-computes a pin for a newly detected misconception (only the model can, via a signal)', async () => {
    // A new (not-yet-recorded) misconception produces no server-side
    // learning-event pin -- the deterministic FSRS path stays silent on new
    // gaps (ADR-026). The MODEL may still surface it by emitting a
    // "misconception-detected" signal (ADR-034); this turn emits none, so
    // with no signals and no server event, no pin rides.
    const conceptKey = 'algebra.linear-equations.one-variable'

    const { status, json } = await soundCorrectTurn(conceptKey, 'sign_error.distribution')

    expect(status).toBe(200)
    expect(json.pins).toBeUndefined()
  })

  it('the model\'s own signals become pins with fixed product copy, enriched from the assessment (ADR-034 -- the primary driver)', async () => {
    // No seeded mastery/misconception rows -> no server-computed learning
    // pin. The pins here come entirely from the model's `signals` array,
    // proving the model is the volume driver. `misconception-detected`'s
    // label is enriched with the flagged category; the teaching move keeps
    // its fixed copy; both carry the assessed conceptKey.
    const conceptKey = 'algebra.functions.notation'
    const started = await start(tokenPingsWide, { mode: 'text' })
    expect(started.status).toBe(200)

    nextResponse = {
      status: 200,
      body: fakeTextMessage(
        JSON.stringify({
          say: 'Let me break this into smaller steps.',
          assessment: {
            concept_key: conceptKey,
            outcome: 'incorrect',
            reasoning_quality: 'shallow',
            self_confidence: 'low',
            misconception_category: 'notation-confusion',
            confidence: 'high',
          },
          signals: ['teaching-decompose', 'misconception-detected'],
        })
      ),
    }

    const { status, json } = await turn(tokenPingsWide, {
      sessionId: started.json.sessionId,
      messages: [{ role: 'user', content: 'f(x) attempt' }],
    })

    expect(status).toBe(200)
    expect(json.pins).toEqual([
      { category: 'teaching', kind: 'teaching-decompose', conceptKey, label: 'Breaking it into smaller steps' },
      { category: 'prediction', kind: 'misconception-detected', conceptKey, label: 'New misconception spotted: notation confusion' },
    ])
  })

  it('a flagged misconception matching an ACTIVE recorded one fires a prediction-confirmed pin (ADR-034) -- recurrence, never first occurrence', async () => {
    const conceptKey = 'algebra.systems.elimination-substitution'
    // The stored category is 'sign-errors'; the model flags "sign errors" --
    // the same separator/case folding the tag grounding gate uses must
    // bridge that gap, or a real recurrence would never confirm.
    await seedNode(
      conceptKey,
      { mastery: 0.6, stability: 10, state: 'learning', confidenceBand: 'medium', observationCount: 5 },
      userPingsWide.id
    )
    await seedMisconception(conceptKey, 0, userPingsWide.id)

    const { status, json } = await soundCorrectTurn(conceptKey, 'sign errors', tokenPingsWide)

    expect(status).toBe(200)
    expect(json.pins).toEqual([
      { category: 'prediction', kind: 'prediction-confirmed', conceptKey, label: 'Misconception confirmed: sign errors' },
    ])
  })

  it('pins are never persisted -- session_interactions keeps its Sprint 11 shape', async () => {
    const conceptKey = 'algebra.quadratics.factoring'
    await seedNode(conceptKey, { mastery: 0.45, stability: 5, state: 'weak', confidenceBand: 'low', observationCount: 2 })

    const { status, json } = await soundCorrectTurn(conceptKey)
    expect(status).toBe(200)
    expect(json.pins).toHaveLength(1)

    const { data, count } = await admin
      .from('session_interactions')
      .select('*', { count: 'exact' })
      .eq('user_id', userPings.id)
      .eq('concept_key', conceptKey)

    expect(count).toBe(1)
    expect(Object.keys(data![0]).sort()).toEqual(EXPECTED_SESSION_INTERACTIONS_COLUMNS)
    expect(JSON.stringify(data![0])).not.toContain('concept-understood')
  })
})

// --- Sprint 14 Task 4/9: the opening-scan request shape (ADR-030) ---
// Detected by `{ opening: true }` alone (no `messages`) -- same auth, same
// topic-biased loadProfile read, same grounding gate as an ordinary turn;
// only the response shape and the never-relayed assessment/progress/
// completion fields are unique to this branch.
describe('/api/ai/turn: the opening scan (Sprint 14 Task 4, ADR-030)', () => {
  const minimalPageContext = { title: 'Practice problem', text: 'Solve x^2 - 4 = 0', equations: [] }

  it('returns { reply, annotations?, profileTags? } with assessment, solutionProgress, and session ALWAYS absent -- even when the model smuggles them', async () => {
    nextResponse = {
      status: 200,
      body: fakeTextMessage(
        JSON.stringify({
          say: "Looks like you're working on factoring a quadratic. Is that what you need help with?",
          annotations: [{ id: 'a1', type: 'highlight', target: { kind: 'textMatch', text: 'x^2 - 4 = 0' } }],
          // None of these should ever survive to the opening-scan response --
          // the route builds `{ reply, annotations?, profileTags? }` from the
          // envelope explicitly, never spreading assessment/solutionProgress/
          // session through, regardless of what parseEnvelope happened to
          // parse off a non-conforming model output.
          assessment: {
            concept_key: SEEDED_CONCEPT_KEY,
            outcome: 'correct',
            reasoning_quality: 'sound',
            self_confidence: 'high',
            misconception_category: null,
            confidence: 'high',
          },
          solution_progress: 0.5,
          session: { complete: true, reason: 'solved' },
        })
      ),
    }

    const { status, json } = await turn(token, { opening: true, pageContext: minimalPageContext })

    expect(status).toBe(200)
    expect(json.reply).toBe("Looks like you're working on factoring a quadratic. Is that what you need help with?")
    expect(json.annotations).toHaveLength(1)
    expect(json.assessment).toBeUndefined()
    expect(json.solutionProgress).toBeUndefined()
    expect(json.session).toBeUndefined()
    expect(Object.keys(json).sort()).toEqual(['annotations', 'reply'])
  })

  it('requires a pageContext -- 400s without one, and never calls the model', async () => {
    nextResponse = { status: 200, body: fakeTextMessage('should never be reached') }

    const { status, json } = await turn(token, { opening: true })

    expect(status).toBe(400)
    expect(json.error).toContain('pageContext')
  })

  it('still 401s with no bearer for the opening-scan request shape too', async () => {
    const { status } = await turn(null, { opening: true, pageContext: minimalPageContext })
    expect(status).toBe(401)
  })

  it('degrades to an empty reply when the model finds nothing confident to say', async () => {
    nextResponse = { status: 200, body: fakeTextMessage(JSON.stringify({ say: '' })) }

    const { status, json } = await turn(token, { opening: true, pageContext: minimalPageContext })

    expect(status).toBe(200)
    expect(json.reply).toBe('')
    expect(json.annotations).toBeUndefined()
    expect(json.profileTags).toBeUndefined()
  })

  // "factoring" + "quadratics" are curriculum aliases for
  // algebra.quadratics.factoring — the word-boundary match the alias table
  // actually performs, unlike minimalPageContext's bare equation. Shared by
  // both the topic test and the stickingCandidates test below, since both
  // need the SAME detected concept (algebra.quadratics.factoring ==
  // STICKING_CONCEPT).
  const quadraticsPageContext = {
    title: 'Factoring quadratics practice',
    text: 'Factor each quadratic expression.',
    equations: [],
  }

  it('carries the page-detected topic additively (check-in 5a) — detectTopicKeys grounded, title-resolved; absent when the page names no known concept', async () => {
    nextResponse = { status: 200, body: fakeTextMessage(JSON.stringify({ say: 'Quadratics on this page.' })) }
    const withTopic = await turn(token, { opening: true, pageContext: quadraticsPageContext })
    expect(withTopic.status).toBe(200)
    expect(withTopic.json.topic).toEqual({ conceptKey: 'algebra.quadratics.factoring', title: 'Factoring quadratics' })

    nextResponse = { status: 200, body: fakeTextMessage(JSON.stringify({ say: 'Hmm.' })) }
    const withoutTopic = await turn(token, { opening: true, pageContext: minimalPageContext })
    expect(withoutTopic.status).toBe(200)
    expect(withoutTopic.json.topic).toBeUndefined()
  })

  it('carries up to 3 of the student\'s OWN recorded misconceptions for the detected topic, ranked occurrence/recency-first (check-in 5b) — capped at 3, absent when the profile has none for this concept', async () => {
    nextResponse = { status: 200, body: fakeTextMessage(JSON.stringify({ say: 'Quadratics on this page.' })) }

    const withHistory = await turn(tokenSticking, { opening: true, pageContext: quadraticsPageContext })
    expect(withHistory.status).toBe(200)
    // Ranked by occurrence_count desc, last_seen_at desc (the fixture's own
    // seed order) -- the 4th, lowest-ranked seeded row must never appear.
    expect(withHistory.json.stickingCandidates).toEqual([
      { category: 'sign-errors', description: 'drops the negative sign when distributing' },
      { category: 'setup-errors', description: 'writes the equation with the wrong sign on b' },
      { category: 'method-choice', description: 'guesses between factoring and the formula' },
    ])

    // The cold-start `user` fixture has the SAME detected topic (so `topic`
    // still appears) but zero knowledge_nodes -- the profile calibrates
    // entirely, forcing activeMisconceptions (and so stickingCandidates) to
    // [], additively omitted rather than an empty array.
    nextResponse = { status: 200, body: fakeTextMessage(JSON.stringify({ say: 'Quadratics on this page.' })) }
    const withoutHistory = await turn(token, { opening: true, pageContext: quadraticsPageContext })
    expect(withoutHistory.status).toBe(200)
    expect(withoutHistory.json.topic).toEqual({ conceptKey: 'algebra.quadratics.factoring', title: 'Factoring quadratics' })
    expect(withoutHistory.json.stickingCandidates).toBeUndefined()
  })

  it('persistOpeningInteraction writes an assessment-less session_interactions row in BOTH the found-something and found-nothing cases -- never skips the row', async () => {
    const started = await start(token, { mode: 'text' })
    expect(started.status).toBe(200)
    const { sessionId } = started.json

    nextResponse = {
      status: 200,
      body: fakeTextMessage(
        JSON.stringify({ say: "Looks like you're working on a quadratic. Is that the one?" })
      ),
    }
    const found = await turn(token, { opening: true, pageContext: minimalPageContext, sessionId })
    expect(found.status).toBe(200)

    nextResponse = { status: 200, body: fakeTextMessage(JSON.stringify({ say: '' })) }
    const foundNothing = await turn(token, { opening: true, pageContext: minimalPageContext, sessionId })
    expect(foundNothing.status).toBe(200)

    const { data, count } = await admin
      .from('session_interactions')
      .select('*', { count: 'exact' })
      .eq('session_id', sessionId)
      .order('turn_index', { ascending: true })

    expect(count).toBe(2)
    for (const row of data!) {
      expect(row.concept_key).toBeNull()
      expect(row.student_transcript).toBeNull()
      expect(row.outcome).toBe('none')
      expect(row.self_confidence).toBe('unknown')
      expect(row.reasoning_quality).toBe('none')
      expect(row.applied_to_profile).toBe(false)
    }
    expect(data![0].tutor_response).toBe("Looks like you're working on a quadratic. Is that the one?")
    expect(data![1].tutor_response).toBe('')
  })
})

describe('/api/ai/turn: the session-start kickoff (structured sessionStart, no messages)', () => {
  const kickoffPageContext = { title: 'Forces worksheet', text: 'Which calculation gives the force in Newtons? F = ma, m = 250 g', equations: [] }
  const kickoff = {
    question: 'Looks like you\'re working on which calculation gives the force in Newtons',
    stickingPoint: 'converting mass from grams to kilograms',
  }

  it('accepts sessionStart with no messages: SESSION START MODE in the prompt, an honest placeholder user turn, never a fabricated student message', async () => {
    nextResponse = {
      status: 200,
      body: fakeToolUseMessage('submit_session_start_turn', {
        board_text: 'F = m*a',
        opening_question: 'The mass is in grams -- what does it need to be in first?',
        annotations: [],
      }),
    }

    const { status, json } = await turn(token, { sessionStart: kickoff, pageContext: kickoffPageContext })

    expect(status).toBe(200)
    expect(json.reply).toBe('$$F = m*a$$ The mass is in grams -- what does it need to be in first?')

    const sent = receivedRequests[receivedRequests.length - 1]
    const system = String(sent.system)
    expect(system).toContain('SESSION START MODE')
    expect(system).toContain(kickoff.question)
    expect(system).toContain(kickoff.stickingPoint)

    // The one API-required user turn is the route's own meta placeholder --
    // it says what happened (a confirm tap), never words the student didn't
    // type, and never a topic claim.
    const messages = sent.messages as Array<{ role: string; content: string }>
    expect(messages).toHaveLength(1)
    expect(messages[0].role).toBe('user')
    expect(messages[0].content).toContain('Session start')
    expect(messages[0].content).toContain('follow SESSION START MODE')
    expect(messages[0].content).not.toMatch(/I'm working on/i)
  })

  it('degrade path (no tool_use block at all -- a refusal/SDK edge case): never trusts raw freeform text for this turn either, falls straight to the zero-model-text fallback', async () => {
    // Unlike every other turn kind (parseEnvelope's "whole raw string becomes
    // say" degrade, ADR-019), session-start does NOT fall back to trusting
    // arbitrary model text -- that field is exactly what both live-finds
    // came from. A missing tool_use block is treated the same as a rejected
    // opening_question: the deterministic, zero-model-text fallback.
    nextResponse = {
      status: 200,
      body: fakeTextMessage(JSON.stringify({ say: "Looks like you're working on a force problem -- is that what you need help with?" })),
    }

    const { status, json } = await turn(token, { sessionStart: kickoff, pageContext: kickoffPageContext })

    expect(status).toBe(200)
    expect(json.reply).toBe(
      `Let's start right at "${kickoff.stickingPoint}" -- walk me through your first step there.`
    )
  })

  it('the REAL forced-tool path: requests submit_session_start_turn (never submit_tutor_turn) and assembles "say" server-side from board_text + opening_question', async () => {
    nextResponse = {
      status: 200,
      body: fakeToolUseMessage('submit_session_start_turn', {
        board_text: 'F = m*a',
        opening_question: 'The mass is in grams -- what does it need to be in first?',
        annotations: [{ id: 'a1', type: 'highlight', target: { kind: 'textMatch', text: 'F = ma' } }],
      }),
    }

    const { status, json } = await turn(token, { sessionStart: kickoff, pageContext: kickoffPageContext })

    expect(status).toBe(200)
    // Assembled server-side, not taken verbatim from any model-authored
    // single string -- there is no field the model filled that could equal
    // this whole value directly.
    expect(json.reply).toBe('$$F = m*a$$ The mass is in grams -- what does it need to be in first?')
    expect(json.annotations).toEqual([{ id: 'a1', type: 'highlight', target: { kind: 'textMatch', text: 'F = ma' } }])

    const sent = receivedRequests[receivedRequests.length - 1] as unknown as {
      tools?: Array<{ name: string }>
      tool_choice?: { name?: string }
    }
    expect(sent.tools?.map((t) => t.name)).toEqual(['submit_session_start_turn'])
    expect(sent.tool_choice?.name).toBe('submit_session_start_turn')
  })

  it('a still-fabricated opening_question is caught by the backstop, retried once, and replaced with zero-model-text fallback -- never shown to the student', async () => {
    // The 2nd live-find: a model that ignores "your own voice, never the
    // student's words" and writes the fabricated-echo pattern anyway (this
    // exact phrasing, reproduced live) inside the one opening_question
    // string. The fake server returns the SAME bad response on every
    // request, so this also proves the retry genuinely re-calls the API
    // (two tool_use requests below) rather than reusing the first result --
    // and that when the retry doesn't help either, the deterministic
    // fallback (built only from sessionStart's own confirmed data) wins,
    // never the model's fabricated text.
    nextResponse = {
      status: 200,
      body: fakeToolUseMessage('submit_session_start_turn', {
        board_text: '20 - 6 + 4k = 2 - 2k',
        opening_question: "I'm working on one-variable linear equations today -- can we start there?",
        annotations: [],
      }),
    }

    const before = receivedRequests.length
    const { json } = await turn(token, { sessionStart: kickoff, pageContext: kickoffPageContext })

    expect(json.reply).not.toMatch(/i'?m working on/i)
    expect(json.reply).not.toMatch(/can we start there/i)
    expect(json.reply).toBe(
      `$$20 - 6 + 4k = 2 - 2k$$ Let's start right at "${kickoff.stickingPoint}" -- walk me through your first step there.`
    )
    // Exactly one retry -- two tool_use requests total for this one turn.
    expect(receivedRequests.length - before).toBe(2)
  })

  it('the assembly is deterministic no matter what the model puts in either field -- there is no room for a second, uncontrolled reply shape', async () => {
    // A SHORTER, single-sentence misstep -- under the backstop's length/
    // pattern/paragraph checks -- still gets through untouched: the backstop
    // targets the specific multi-paragraph/echoed-confirmation failure
    // shape, not stylistic imperfection. The reply is always exactly
    // `$$<board_text>$$ <opening_question>`, one bubble, in that fixed
    // order -- never a second, uncontrolled shape.
    nextResponse = {
      status: 200,
      body: fakeToolUseMessage('submit_session_start_turn', {
        board_text: '20 - 6 + 4k = 2 - 2k',
        opening_question: "Let's simplify the left side first -- what does 20 - 6 combine to?",
        annotations: [],
      }),
    }

    const { json } = await turn(token, { sessionStart: kickoff, pageContext: kickoffPageContext })

    expect(json.reply).toBe(
      "$$20 - 6 + 4k = 2 - 2k$$ Let's simplify the left side first -- what does 20 - 6 combine to?"
    )
    expect(json.reply.startsWith('$$20 - 6 + 4k = 2 - 2k$$ ')).toBe(true)
  })

  it('still 400s when neither messages nor a well-formed sessionStart is present', async () => {
    nextResponse = { status: 200, body: fakeTextMessage('should never be reached') }

    // Malformed: no question -- the one field the prompt block cannot
    // render without. Degrades to the same 400 as a missing-messages body.
    const { status, json } = await turn(token, { sessionStart: { stickingPoint: 'x' }, pageContext: kickoffPageContext })

    expect(status).toBe(400)
    expect(json.error).toContain('messages')
  })

  it('ignores sessionStart when real messages are present -- a mid-conversation turn can never smuggle the block in', async () => {
    nextResponse = { status: 200, body: fakeTextMessage(JSON.stringify({ say: 'Right, next step.' })) }

    const { status } = await turn(token, {
      messages: [{ role: 'user', content: 'is it 0.25 kg?' }],
      sessionStart: kickoff,
      pageContext: kickoffPageContext,
    })

    expect(status).toBe(200)
    const sent = receivedRequests[receivedRequests.length - 1]
    expect(String(sent.system)).not.toContain('SESSION START MODE')
    const messages = sent.messages as Array<{ role: string; content: string }>
    expect(messages).toEqual([{ role: 'user', content: 'is it 0.25 kg?' }])
  })

  it('the not-sure kickoff (stickingPoint null) reaches the prompt as the watch-for-it branch, never a named weakness', async () => {
    nextResponse = { status: 200, body: fakeTextMessage(JSON.stringify({ say: '$$F = m*a$$ First: what units does force need?' })) }

    const { status } = await turn(token, {
      sessionStart: { question: kickoff.question, stickingPoint: null },
      pageContext: kickoffPageContext,
    })

    expect(status).toBe(200)
    const system = String(receivedRequests[receivedRequests.length - 1].system)
    expect(system).toContain('NOT sure where it usually goes wrong')
    expect(system).not.toContain('which they confirmed')
  })
})
