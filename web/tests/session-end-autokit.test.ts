import { describe, it, expect, vi, beforeEach } from 'vitest'

// The auto study-kit hook in POST /api/session/end.
//
// Rewritten 2026-07-26: kits now generate after EVERY session that practised
// something (recap.concepts), not only one that spotted a new misconception —
// a clean session still produced work worth revising, and the extension recap
// now shows the kit being built instead of offering a button.
//
// It also moved into after(), so the model call no longer delays the recap.
// These tests run `after` callbacks inline (see the next/server mock) because
// there is no Next request lifecycle here to flush them.
//
// Unchanged: it must never turn an already-successful end into an error, must
// stay idempotent against an existing kit, and must obey the kill switch.

const { clientFromBearerMock, endSessionMock, reconcileMock, recapMock, generateMock } = vi.hoisted(() => ({
  clientFromBearerMock: vi.fn(),
  endSessionMock: vi.fn(),
  reconcileMock: vi.fn(async () => {}),
  recapMock: vi.fn(),
  generateMock: vi.fn(async () => ({ kit: { notes: ['n'], problems: [], flashcards: [] } })),
}))

vi.mock('server-only', () => ({}))
// Run after() callbacks immediately. Everything else in next/server (notably
// NextResponse, which the route returns) must stay real.
vi.mock('next/server', async () => {
  const actual = await vi.importActual<typeof import('next/server')>('next/server')
  return { ...actual, after: (fn: () => unknown) => { void fn() } }
})
vi.mock('@/lib/auth/bearer', () => ({ clientFromBearer: clientFromBearerMock }))
vi.mock('@/lib/tier/session-gate', () => ({ endSession: endSessionMock }))
vi.mock('@/lib/learning/apply', () => ({ reconcileSession: reconcileMock }))
vi.mock('@/lib/learning/recap', () => ({ buildSessionRecap: recapMock }))
vi.mock('@/lib/study/generate-and-persist', () => ({ generateAndPersistStudyKit: generateMock }))

const { POST } = await import('../app/api/session/end/route')

const SESSION = 'session-1'
const USER = 'user-1'

// A fake cookie/bearer client whose study_artifact count query resolves to
// `existingKits` (the idempotency signal).
function fakeSupabase(existingKits: number) {
  return {
    from: () => ({
      select: () => ({
        // study_artifact count (the idempotency signal) awaits the eq() itself;
        // the sessions score_at_start read chains .maybeSingle() off it. One
        // shape serves both.
        eq: Object.assign(async () => ({ count: existingKits, error: null }), {
          maybeSingle: async () => ({ data: { score_at_start: null }, error: null }),
        }),
      }),
    }),
  }
}

function req() {
  return new Request('http://localhost/api/session/end', {
    method: 'POST',
    body: JSON.stringify({ sessionId: SESSION }),
    headers: { 'content-type': 'application/json' },
  })
}

function setup(opts: { concepts?: unknown[]; misconceptionsAdded?: unknown[]; existingKits: number }) {
  const supabase = fakeSupabase(opts.existingKits)
  clientFromBearerMock.mockResolvedValue({ supabase, user: { id: USER } })
  endSessionMock.mockResolvedValue({ data: [{ id: SESSION, ended_at: '2026-07-15T00:00:00Z', interaction_count: 3 }], error: null })
  recapMock.mockResolvedValue({
    // A practised concept is now what gates generation.
    concepts: opts.concepts ?? [{ conceptKey: 'algebra.factoring' }],
    misconceptionsAdded: opts.misconceptionsAdded ?? [],
    misconceptionsResolved: [],
    nextReviews: [],
    trends: [],
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  delete process.env.CALYXA_DISABLE_AUTO_STUDY_KIT // default-on for these assertions
  reconcileMock.mockResolvedValue(undefined)
  generateMock.mockResolvedValue({ kit: { notes: ['n'], problems: [], flashcards: [] } })
})

describe('session/end auto study-kit hook (every session)', () => {
  it('generates a kit after ANY session that practised something', async () => {
    setup({ existingKits: 0 })
    const res = await POST(req())
    expect(res.status).toBe(200)
    expect(generateMock).toHaveBeenCalledTimes(1)
    expect(generateMock).toHaveBeenCalledWith(expect.anything(), USER, SESSION)
  })

  it('does NOT generate when the session practised nothing gradable', async () => {
    setup({ concepts: [], existingKits: 0 })
    const res = await POST(req())
    expect(res.status).toBe(200)
    expect(generateMock).not.toHaveBeenCalled()
  })

  it('does NOT generate when a kit already exists for the session (idempotent)', async () => {
    setup({ existingKits: 2 })
    const res = await POST(req())
    expect(res.status).toBe(200)
    expect(generateMock).not.toHaveBeenCalled()
  })

  it('does NOT generate when the kill switch is set', async () => {
    setup({ existingKits: 0 })
    process.env.CALYXA_DISABLE_AUTO_STUDY_KIT = '1'
    const res = await POST(req())
    expect(res.status).toBe(200)
    expect(generateMock).not.toHaveBeenCalled()
  })

  it('still returns a successful end even if generation throws', async () => {
    setup({ existingKits: 0 })
    generateMock.mockRejectedValue(new Error('model down'))
    const res = await POST(req())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.sessionId).toBe(SESSION)
  })
})
