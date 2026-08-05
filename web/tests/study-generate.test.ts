import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CONCEPT_KEYS } from '@calyxa/curriculum'
import { FREE_SESSION_LIMIT } from '../lib/tier/session-gate'

// Sprint 21 Task 7 (ADR-049). Two halves, both without a live table:
//   1. parseStudyKit -- a PURE validator (tool.ts): a well-formed tool output
//      passes; anything malformed degrades to the deterministic empty kit,
//      never a throw and never a half-parsed kit; concept keys are constrained
//      to CONCEPT_KEYS; the per-kind caps are enforced.
//   2. POST /api/study/generate -- the route's OWN control flow, at the module
//      boundary with its collaborators mocked (the feedback.test.ts /
//      waitlist.test.ts mocked-module pattern). The load-bearing assertions the
//      plan names: costGuard runs BEFORE the Claude call and a hard cap refuses
//      WITHOUT generating; a malformed/empty kit persists nothing; and the
//      persisted rows carry the AUTHENTICATED caller's user_id (RLS-scoping the
//      write), never the body's.
//
// tool.ts / cost-model.ts carry `import 'server-only'` as a defensive marker;
// neutralized the standard way (predict.test.ts / feedback.test.ts).

const { clientFromBearerOrCookie } = vi.hoisted(() => ({ clientFromBearerOrCookie: vi.fn() }))
const { costGuard } = vi.hoisted(() => ({ costGuard: vi.fn() }))
const { loadSessionSource } = vi.hoisted(() => ({ loadSessionSource: vi.fn() }))
const { generateStudyKit } = vi.hoisted(() => ({ generateStudyKit: vi.fn() }))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/auth/bearer', () => ({ clientFromBearerOrCookie }))
vi.mock('@/lib/tier/cost-guard', () => ({ costGuard }))
vi.mock('@/lib/study/source', () => ({ loadSessionSource }))
vi.mock('@/lib/study/generate', () => ({ generateStudyKit }))

import * as route from '../app/api/study/generate/route'
import {
  STUDY_KIT_TOOL,
  parseStudyKit,
  isEmptyStudyKit,
  EMPTY_STUDY_KIT,
  MAX_NOTES,
  MAX_PROBLEMS,
  MAX_FLASHCARDS,
  type StudyKit,
} from '../lib/study/tool'

// A real curriculum key, so parseStudyKit's getConcept() drift guard keeps it.
const REAL_KEY = CONCEPT_KEYS[0]

describe('parseStudyKit (pure)', () => {
  it('passes a well-formed kit through, trimming strings and keeping a valid concept key', () => {
    const kit = parseStudyKit({
      notes: ['  Factor by grouping.  ', 'Check by expanding.'],
      problems: [{ statement: 'Factor x^2 + 5x + 6.', solution: '(x + 2)(x + 3)', concept_key: REAL_KEY }],
      flashcards: [{ front: 'What multiplies to 6, adds to 5?', back: '2 and 3' }],
    })

    expect(kit.notes).toEqual(['Factor by grouping.', 'Check by expanding.'])
    expect(kit.problems).toEqual([{ statement: 'Factor x^2 + 5x + 6.', solution: '(x + 2)(x + 3)', conceptKey: REAL_KEY }])
    expect(kit.flashcards).toEqual([{ front: 'What multiplies to 6, adds to 5?', back: '2 and 3' }])
    expect(isEmptyStudyKit(kit)).toBe(false)
  })

  it('degrades any non-object input to the empty kit, never throwing', () => {
    for (const bad of [undefined, null, 42, 'a string', [], true]) {
      const kit = parseStudyKit(bad)
      expect(kit).toEqual(EMPTY_STUDY_KIT)
      expect(isEmptyStudyKit(kit)).toBe(true)
    }
  })

  it('drops malformed items instead of throwing or persisting a half-kit', () => {
    const kit = parseStudyKit({
      notes: ['keep me', '', '   ', 5, null, { not: 'a string' }],
      // a problem missing its solution is not a usable practice problem (the
      // solution is ADR-049's deliberate superset) -- dropped, not kept.
      problems: [
        { statement: 'no solution' },
        { statement: '', solution: 'no statement' },
        { statement: 'good', solution: 'good', concept_key: null },
        'not an object',
      ],
      flashcards: [{ front: 'only front' }, { back: 'only back' }, { front: 'f', back: 'b' }],
    })

    expect(kit.notes).toEqual(['keep me'])
    expect(kit.problems).toEqual([{ statement: 'good', solution: 'good', conceptKey: null }])
    expect(kit.flashcards).toEqual([{ front: 'f', back: 'b' }])
  })

  it('constrains a problem concept key to CONCEPT_KEYS, nulling an unknown one', () => {
    const kit = parseStudyKit({
      notes: [],
      problems: [
        { statement: 's1', solution: 'x1', concept_key: 'not.a.real.curriculum.key' },
        { statement: 's2', solution: 'x2', concept_key: REAL_KEY },
      ],
      flashcards: [],
    })

    expect(kit.problems[0].conceptKey).toBeNull()
    expect(kit.problems[1].conceptKey).toBe(REAL_KEY)
  })

  // Regression guard for the Task 8 live-find: STUDY_KIT_TOOL.input_examples
  // hardcoded a concept_key ('algebra.factoring.trinomials') that is NOT a real
  // CONCEPT_KEYS value, so every real forced-tool call 400'd ("Example ... not
  // valid under the anyOf") -- Anthropic validates each input_example against
  // input_schema, and the schema constrains concept_key to nullableEnum(
  // CONCEPT_KEYS). The mocked route tests can't see this (generation is
  // stubbed); pin it structurally instead so it can never regress.
  it('every concept key in STUDY_KIT_TOOL.input_examples is null or a real CONCEPT_KEYS value', () => {
    const examples = (STUDY_KIT_TOOL.input_examples ?? []) as Array<{ problems?: Array<{ concept_key?: unknown }> }>
    const keys = examples.flatMap((ex) => (ex.problems ?? []).map((p) => p.concept_key))

    expect(keys.length).toBeGreaterThan(0)
    for (const key of keys) {
      if (key !== null) expect(CONCEPT_KEYS).toContain(key)
    }
  })

  it('enforces the per-kind caps', () => {
    const kit = parseStudyKit({
      notes: Array.from({ length: MAX_NOTES + 5 }, (_, i) => `note ${i}`),
      problems: Array.from({ length: MAX_PROBLEMS + 5 }, (_, i) => ({ statement: `s${i}`, solution: `x${i}`, concept_key: null })),
      flashcards: Array.from({ length: MAX_FLASHCARDS + 5 }, (_, i) => ({ front: `f${i}`, back: `b${i}` })),
    })

    expect(kit.notes).toHaveLength(MAX_NOTES)
    expect(kit.problems).toHaveLength(MAX_PROBLEMS)
    expect(kit.flashcards).toHaveLength(MAX_FLASHCARDS)
  })
})

const FAKE_USER_ID = 'user-study-generate-test-1'

let insert: ReturnType<typeof vi.fn>

function post(body: unknown) {
  return route.POST(
    new Request('http://localhost/api/study/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    })
  )
}

const SOURCE = {
  turns: [],
  concepts: [{ conceptKey: REAL_KEY, title: 'T', turns: 1, correct: 1, incorrect: 0, mastery: 0.3, state: 'learning' }],
  misconceptionsAdded: [],
  misconceptionsResolved: [],
}

const KIT: StudyKit = {
  notes: ['Factor by grouping.'],
  problems: [{ statement: 'Factor x^2 + 7x + 12.', solution: '(x + 3)(x + 4)', conceptKey: REAL_KEY }],
  flashcards: [{ front: 'q', back: 'a' }],
}

describe('POST /api/study/generate', () => {
  beforeEach(() => {
    insert = vi.fn().mockResolvedValue({ error: null })
    clientFromBearerOrCookie.mockReset()
    costGuard.mockReset()
    loadSessionSource.mockReset()
    generateStudyKit.mockReset()

    clientFromBearerOrCookie.mockResolvedValue({
      supabase: {
        from: (table: string) => {
          // `users` is read by userOverFreeCap (the per-user free-session gate
          // that runs alongside the cost guard). Default fixture: an in-quota
          // free user, so these cases exercise the paths under test rather than
          // the cap. The over-cap case has its own test below.
          if (table === 'users') {
            return {
              select: () => ({
                eq: () => ({
                  maybeSingle: async () => ({
                    data: {
                      subscription_tier: 'free',
                      free_session_count: 0,
                      free_period_started_at: new Date().toISOString(),
                      referral_bonus_sessions: 0,
                    },
                    error: null,
                  }),
                }),
              }),
            }
          }
          if (table !== 'study_artifact') throw new Error(`unexpected table: ${table}`)
          return { insert }
        },
      },
      user: { id: FAKE_USER_ID },
    })
    costGuard.mockResolvedValue({ softExceeded: false, hardExceeded: false })
    loadSessionSource.mockResolvedValue(SOURCE)
    generateStudyKit.mockResolvedValue(KIT)
  })

  it('cost-guards BEFORE the Claude call: a hard cap refuses without reading or generating', async () => {
    costGuard.mockResolvedValue({ softExceeded: false, hardExceeded: true })

    const response = await post({ sessionId: 'sess-1' })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ refused: 'cost' })
    // The whole point of "before the call": neither the read nor the generation ran.
    expect(loadSessionSource).not.toHaveBeenCalled()
    expect(generateStudyKit).not.toHaveBeenCalled()
    expect(insert).not.toHaveBeenCalled()
  })

  it('free-cap: an out-of-sessions free user refuses BEFORE the Claude call', async () => {
    // The leak this closes: study-kit generation is a paid model call that had
    // no per-user gate, reachable both from the recap card and automatically at
    // session end — so a free user past their monthly allowance could bill a
    // generation on every session they finished. The global cost guard is
    // explicitly under-cap here to prove the FREE cap is what refuses.
    costGuard.mockResolvedValue({ softExceeded: false, hardExceeded: false })
    clientFromBearerOrCookie.mockResolvedValue({
      supabase: {
        from: (table: string) => {
          if (table === 'users') {
            return {
              select: () => ({
                eq: () => ({
                  maybeSingle: async () => ({
                    data: {
                      subscription_tier: 'free',
                      free_session_count: FREE_SESSION_LIMIT,
                      free_period_started_at: new Date().toISOString(),
                      referral_bonus_sessions: 0,
                    },
                    error: null,
                  }),
                }),
              }),
            }
          }
          if (table !== 'study_artifact') throw new Error(`unexpected table: ${table}`)
          return { insert }
        },
      },
      user: { id: FAKE_USER_ID },
    })

    const response = await post({ sessionId: 'sess-1' })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ refused: 'cost' })
    // No provider spend: neither the source read nor the model call happened.
    expect(loadSessionSource).not.toHaveBeenCalled()
    expect(generateStudyKit).not.toHaveBeenCalled()
    expect(insert).not.toHaveBeenCalled()
  })

  it('generates + persists a kit, and the cost guard ran before generation', async () => {
    const response = await post({ sessionId: 'sess-42', userId: 'someone-else' })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ kit: KIT })

    // costGuard was invoked strictly before generateStudyKit (mock call order).
    expect(costGuard.mock.invocationCallOrder[0]).toBeLessThan(generateStudyKit.mock.invocationCallOrder[0])
  })

  it('scopes the persisted rows to the AUTHENTICATED caller (RLS write scope), never the body', async () => {
    await post({ sessionId: 'sess-42', userId: 'someone-else' })

    expect(insert).toHaveBeenCalledTimes(1)
    const rows = insert.mock.calls[0][0] as Array<Record<string, unknown>>
    // One row per non-empty artifact kind (ADR-049 decision 3).
    expect(rows.map((r) => r.kind).sort()).toEqual(['flashcards', 'notes', 'problems'])
    for (const row of rows) {
      expect(row.user_id).toBe(FAKE_USER_ID)
      expect(row.session_id).toBe('sess-42')
    }
    // The problems payload is { statement, solution } only (migration 0021's
    // documented shape) -- the per-problem conceptKey is not stored per row.
    const problemsRow = rows.find((r) => r.kind === 'problems')!
    expect(problemsRow.payload).toEqual([{ statement: 'Factor x^2 + 7x + 12.', solution: '(x + 3)(x + 4)' }])
  })

  it("refuses with 'empty' and persists nothing when the session has nothing to generate from", async () => {
    loadSessionSource.mockResolvedValue(undefined)

    const response = await post({ sessionId: 'sess-1' })

    expect(await response.json()).toEqual({ refused: 'empty' })
    expect(generateStudyKit).not.toHaveBeenCalled()
    expect(insert).not.toHaveBeenCalled()
  })

  it("refuses with 'empty' and persists NO half-kit when generation returns an empty kit", async () => {
    generateStudyKit.mockResolvedValue({ notes: [], problems: [], flashcards: [] })

    const response = await post({ sessionId: 'sess-1' })

    expect(await response.json()).toEqual({ refused: 'empty' })
    expect(insert).not.toHaveBeenCalled()
  })

  it('surfaces a persist failure as 502 without leaking the DB error', async () => {
    insert.mockResolvedValue({ error: { message: 'connection refused' } })

    const response = await post({ sessionId: 'sess-1' })

    expect(response.status).toBe(502)
    expect(JSON.stringify(await response.json())).not.toContain('connection refused')
  })

  it('surfaces a read/model failure as 502 without leaking details', async () => {
    loadSessionSource.mockRejectedValue(new Error('transcript read failed: secret detail'))

    const response = await post({ sessionId: 'sess-1' })

    expect(response.status).toBe(502)
    expect(JSON.stringify(await response.json())).not.toContain('secret detail')
  })

  it('401s when not signed in, never touching the cost guard', async () => {
    clientFromBearerOrCookie.mockResolvedValue({ error: 401 })

    const response = await post({ sessionId: 'sess-1' })

    expect(response.status).toBe(401)
    expect(costGuard).not.toHaveBeenCalled()
  })

  it('400s on a missing or empty sessionId, never touching the cost guard', async () => {
    for (const body of [{}, { sessionId: '' }, { sessionId: '   ' }, { sessionId: 42 }]) {
      const response = await post(body)
      expect(response.status).toBe(400)
    }
    expect(costGuard).not.toHaveBeenCalled()
  })

  it('400s on a non-JSON body', async () => {
    const response = await post('not json')
    expect(response.status).toBe(400)
  })
})
