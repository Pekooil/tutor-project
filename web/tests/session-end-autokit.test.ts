import { describe, it, expect, vi, beforeEach } from 'vitest'

// The misconception → auto study-kit hook in POST /api/session/end (workflow
// replacing spaced-repetition review). It must fire generateAndPersistStudyKit
// ONLY when the session spotted a new misconception AND no kit already exists
// for the session — and never turn an already-successful end into an error.

const { clientFromBearerMock, endSessionMock, reconcileMock, recapMock, generateMock } = vi.hoisted(() => ({
  clientFromBearerMock: vi.fn(),
  endSessionMock: vi.fn(),
  reconcileMock: vi.fn(async () => {}),
  recapMock: vi.fn(),
  generateMock: vi.fn(async () => ({ kit: { notes: ['n'], problems: [], flashcards: [] } })),
}))

vi.mock('server-only', () => ({}))
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
        eq: async () => ({ count: existingKits, error: null }),
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

function setup(opts: { misconceptionsAdded: unknown[]; existingKits: number }) {
  const supabase = fakeSupabase(opts.existingKits)
  clientFromBearerMock.mockResolvedValue({ supabase, user: { id: USER } })
  endSessionMock.mockResolvedValue({ data: [{ id: SESSION, ended_at: '2026-07-15T00:00:00Z', interaction_count: 3 }], error: null })
  recapMock.mockResolvedValue({
    concepts: [],
    misconceptionsAdded: opts.misconceptionsAdded,
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

describe('session/end auto study-kit hook', () => {
  it('generates a kit when a new misconception was spotted and none exists yet', async () => {
    setup({ misconceptionsAdded: [{ conceptKey: 'geometry.circle' }], existingKits: 0 })
    const res = await POST(req())
    expect(res.status).toBe(200)
    expect(generateMock).toHaveBeenCalledTimes(1)
    expect(generateMock).toHaveBeenCalledWith(expect.anything(), USER, SESSION)
  })

  it('does NOT generate when the session spotted no new misconception', async () => {
    setup({ misconceptionsAdded: [], existingKits: 0 })
    const res = await POST(req())
    expect(res.status).toBe(200)
    expect(generateMock).not.toHaveBeenCalled()
  })

  it('does NOT generate when a kit already exists for the session (idempotent)', async () => {
    setup({ misconceptionsAdded: [{ conceptKey: 'geometry.circle' }], existingKits: 2 })
    const res = await POST(req())
    expect(res.status).toBe(200)
    expect(generateMock).not.toHaveBeenCalled()
  })

  it('does NOT generate when the kill switch is set', async () => {
    setup({ misconceptionsAdded: [{ conceptKey: 'geometry.circle' }], existingKits: 0 })
    process.env.CALYXA_DISABLE_AUTO_STUDY_KIT = '1'
    const res = await POST(req())
    expect(res.status).toBe(200)
    expect(generateMock).not.toHaveBeenCalled()
  })

  it('still returns a successful end even if generation throws', async () => {
    setup({ misconceptionsAdded: [{ conceptKey: 'geometry.circle' }], existingKits: 0 })
    generateMock.mockRejectedValue(new Error('model down'))
    const res = await POST(req())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.sessionId).toBe(SESSION)
  })
})
