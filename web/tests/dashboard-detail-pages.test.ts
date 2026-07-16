import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'

// Render tests for the drill-down routes added with the interactive dashboard
// pass: concept detail, misconception detail, and the study-kit viewer. Each is
// an async Server Component that reads the auth'd user then a detail read; here
// server-only, next/navigation, the cookie client, and the detail reads are
// mocked, and the resolved element is SSR-rendered (renderToStaticMarkup) — the
// same pattern as dashboard-pages.test.ts.

const { createClientMock, redirectMock, notFoundMock, conceptMock, misconceptionMock, kitMock } = vi.hoisted(() => ({
  createClientMock: vi.fn(),
  redirectMock: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`)
  }),
  notFoundMock: vi.fn(() => {
    throw new Error('NOT_FOUND')
  }),
  conceptMock: vi.fn(),
  misconceptionMock: vi.fn(),
  kitMock: vi.fn(),
}))

vi.mock('server-only', () => ({}))
vi.mock('next/navigation', () => ({ redirect: redirectMock, notFound: notFoundMock }))
vi.mock('@/lib/supabase/server', () => ({ createClient: createClientMock }))
vi.mock('@/components/dashboard/premium/detail-read', () => ({
  loadConceptDetail: conceptMock,
  loadMisconceptionDetail: misconceptionMock,
}))
vi.mock('@/components/dashboard/premium/kit-read', () => ({ loadStudyKit: kitMock }))

const conceptPage = await import('../app/(dashboard)/mastery/[conceptKey]/page')
const misconceptionPage = await import('../app/(dashboard)/misconceptions/[id]/page')
const kitPage = await import('../app/(dashboard)/kits/[key]/page')

const USER = { id: 'u1' }
function fakeSupabase(user: { id: string } | null) {
  return { auth: { getUser: async () => ({ data: { user }, error: null }) } }
}

const NODE = {
  conceptKey: 'algebra.linear-equations.one-variable',
  title: 'Solving linear equations',
  strand: 'algebra',
  strandLabel: 'Algebra 1',
  mastery: 0.72,
  state: 'weak' as const,
  confidenceBand: 'medium' as const,
  observationCount: 5,
  lastPracticedAt: '2026-07-12T00:00:00.000Z',
}

afterEach(() => vi.clearAllMocks())

describe('Concept detail (/mastery/[conceptKey])', () => {
  it('renders mastery, prerequisites and a practice-kit link', async () => {
    createClientMock.mockResolvedValue(fakeSupabase(USER))
    conceptMock.mockResolvedValue({
      conceptKey: NODE.conceptKey,
      title: NODE.title,
      strandLabel: 'Algebra 1',
      strandColor: '#9a3412',
      node: NODE,
      prerequisites: [{ conceptKey: 'algebra.basics', title: 'Order of operations', mastery: 0.9, state: 'mastered' }],
      dependents: [],
      misconceptions: [],
      kitHref: 'session-9',
    })
    const html = renderToStaticMarkup(await conceptPage.default({ params: Promise.resolve({ conceptKey: NODE.conceptKey }) }))
    expect(html).toContain('Solving linear equations')
    expect(html).toContain('Order of operations')
    expect(html).toContain('Practice with study kit')
    expect(html).toContain('/kits/session-9')
  })

  it('404s an unknown concept', async () => {
    createClientMock.mockResolvedValue(fakeSupabase(USER))
    conceptMock.mockResolvedValue(null)
    await expect(conceptPage.default({ params: Promise.resolve({ conceptKey: 'nope' }) })).rejects.toThrow('NOT_FOUND')
  })

  it('redirects when signed out', async () => {
    createClientMock.mockResolvedValue(fakeSupabase(null))
    await expect(conceptPage.default({ params: Promise.resolve({ conceptKey: NODE.conceptKey }) })).rejects.toThrow('REDIRECT:/login')
  })
})

describe('Misconception detail (/misconceptions/[id])', () => {
  it('renders description, resolution progress (of 3) and history', async () => {
    createClientMock.mockResolvedValue(fakeSupabase(USER))
    misconceptionMock.mockResolvedValue({
      misconception: {
        id: 'm1',
        conceptKey: 'geometry.circle',
        title: 'Treats radius as diameter',
        strand: 'geometry',
        strandLabel: 'Geometry',
        category: 'reading',
        description: 'Uses the full diameter in A = πr².',
        status: 'active',
        occurrenceCount: 4,
        consecutiveCorrect: 1,
        firstSeenAt: '2026-07-01T00:00:00.000Z',
        lastSeenAt: '2026-07-10T00:00:00.000Z',
        resolvedAt: null,
      },
      strandColor: '#166534',
      conceptNode: null,
      kitHref: null,
      resolutionStreak: 3,
    })
    const html = renderToStaticMarkup(await misconceptionPage.default({ params: Promise.resolve({ id: 'm1' }) }))
    expect(html).toContain('Treats radius as diameter')
    expect(html).toContain('1 of 3')
    expect(html).toContain('Times seen')
  })

  it('404s an unknown misconception', async () => {
    createClientMock.mockResolvedValue(fakeSupabase(USER))
    misconceptionMock.mockResolvedValue(null)
    await expect(misconceptionPage.default({ params: Promise.resolve({ id: 'nope' }) })).rejects.toThrow('NOT_FOUND')
  })
})

describe('Study-kit viewer (/kits/[key])', () => {
  it('renders notes, a solution toggle and flashcard content', async () => {
    createClientMock.mockResolvedValue(fakeSupabase(USER))
    kitMock.mockResolvedValue({
      title: 'Unit circle & radian measure',
      meta: 'From your Jul 13 session · Trig & Precalculus',
      notes: ['sin is the y-coordinate'],
      problems: [{ statement: 'Evaluate sin(π/6)', solution: '1/2' }],
      flashcards: [{ front: 'cos(0)', back: '1' }],
      empty: false,
    })
    const html = renderToStaticMarkup(await kitPage.default({ params: Promise.resolve({ key: 'session-13' }) }))
    expect(html).toContain('Unit circle &amp; radian measure')
    expect(html).toContain('sin is the y-coordinate')
    expect(html).toContain('Show solution')
    expect(html).toContain('cos(0)')
  })

  it('404s an unknown kit', async () => {
    createClientMock.mockResolvedValue(fakeSupabase(USER))
    kitMock.mockResolvedValue(null)
    await expect(kitPage.default({ params: Promise.resolve({ key: 'nope' }) })).rejects.toThrow('NOT_FOUND')
  })
})
