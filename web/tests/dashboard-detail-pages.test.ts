import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'

// Render tests for the drill-down routes: misconception detail and the study-kit
// viewer, plus the retirement redirects the Notebook Studio replaced. Each is an
// async Server Component that reads the auth'd user then a detail read; here
// server-only, next/navigation, the cookie client, and the detail reads are
// mocked, and the resolved element is SSR-rendered (renderToStaticMarkup) — the
// same pattern as dashboard-pages.test.ts.

const {
  createClientMock,
  redirectMock,
  permanentRedirectMock,
  notFoundMock,
  conceptMock,
  misconceptionMock,
  kitMock,
  kitConceptMock,
} = vi.hoisted(() => ({
  createClientMock: vi.fn(),
  redirectMock: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`)
  }),
  permanentRedirectMock: vi.fn((url: string) => {
    throw new Error(`PERMANENT_REDIRECT:${url}`)
  }),
  notFoundMock: vi.fn(() => {
    throw new Error('NOT_FOUND')
  }),
  conceptMock: vi.fn(),
  misconceptionMock: vi.fn(),
  kitMock: vi.fn(),
  kitConceptMock: vi.fn(),
}))

vi.mock('server-only', () => ({}))
vi.mock('next/navigation', () => ({
  redirect: redirectMock,
  permanentRedirect: permanentRedirectMock,
  notFound: notFoundMock,
}))
vi.mock('@/lib/supabase/server', () => ({ createClient: createClientMock }))
vi.mock('@/components/dashboard/premium/detail-read', () => ({
  loadConceptDetail: conceptMock,
  loadMisconceptionDetail: misconceptionMock,
}))
vi.mock('@/components/dashboard/premium/kit-read', () => ({ loadStudyKit: kitMock }))
vi.mock('@/components/studio/kit-target', () => ({ resolveKitConcept: kitConceptMock }))

const conceptPage = await import('../app/(dashboard)/concepts/[conceptKey]/page')
const reviewPage = await import('../app/(dashboard)/review/[conceptKey]/page')
const quizPage = await import('../app/(dashboard)/quiz/[conceptKey]/page')
const flashcardsPage = await import('../app/(dashboard)/flashcards/[conceptKey]/page')
const notebookPage = await import('../app/(dashboard)/notebook/page')
const notebookSubjectPage = await import('../app/(dashboard)/notebook/[subject]/page')
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

// The Notebook Studio replaced four pre-studio routes. Each is kept as a
// permanent redirect rather than deleted, so a bookmark or an in-the-wild link
// still lands on the view that superseded it. These tests are the guard that the
// mapping doesn't silently drift or start 404ing.
describe('Retired pre-studio routes redirect into the studio', () => {
  it('/concepts/[conceptKey] → the concept notes', async () => {
    await expect(
      conceptPage.default({ params: Promise.resolve({ conceptKey: NODE.conceptKey }) })
    ).rejects.toThrow(`PERMANENT_REDIRECT:/notes/${NODE.conceptKey}`)
  })

  it('/review/[conceptKey] → the notes, whose in-panel quiz records the completion', async () => {
    // Points straight at /notes rather than via /quiz: the quiz is a panel state
    // inside the notes now, and chaining redirects would be gratuitous.
    await expect(
      reviewPage.default({ params: Promise.resolve({ conceptKey: NODE.conceptKey }) })
    ).rejects.toThrow(`PERMANENT_REDIRECT:/notes/${NODE.conceptKey}`)
  })

  it('/quiz/[conceptKey] → the notes that now host the quiz', async () => {
    await expect(
      quizPage.default({ params: Promise.resolve({ conceptKey: NODE.conceptKey }) })
    ).rejects.toThrow(`PERMANENT_REDIRECT:/notes/${NODE.conceptKey}`)
  })

  it('/flashcards/[conceptKey] → the notes that now host the deck', async () => {
    await expect(
      flashcardsPage.default({ params: Promise.resolve({ conceptKey: NODE.conceptKey }) })
    ).rejects.toThrow(`PERMANENT_REDIRECT:/notes/${NODE.conceptKey}`)
  })

  it('/notebook → the dashboard browser', async () => {
    await expect(notebookPage.default()).rejects.toThrow('PERMANENT_REDIRECT:/dashboard')
  })

  it('/notebook/[subject] → the dashboard browser, whatever the subject', async () => {
    // The page ignores the segment entirely — every subject lands on the browser.
    await expect(notebookSubjectPage.default()).rejects.toThrow('PERMANENT_REDIRECT:/dashboard')
  })

  it('passes the concept key through without double-encoding it', async () => {
    // Next hands the segment over still URL-encoded; re-encoding would turn a
    // key like `algebra.quadratics.factoring` into an unresolvable one.
    await expect(
      conceptPage.default({ params: Promise.resolve({ conceptKey: 'algebra.quadratics.factoring' }) })
    ).rejects.toThrow('PERMANENT_REDIRECT:/notes/algebra.quadratics.factoring')
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

// /kits/[key] is the one URL the SHIPPED extension deep-links to, so it must
// never dead-end. It now forwards into the studio when it can resolve a concept,
// and falls back to the viewer when it can't.
describe('Study-kit route (/kits/[key]) forwards into the studio', () => {
  it('redirects a session id to that session’s concept notes', async () => {
    createClientMock.mockResolvedValue(fakeSupabase(USER))
    kitConceptMock.mockResolvedValue('algebra.quadratics.factoring')
    await expect(kitPage.default({ params: Promise.resolve({ key: 'session-13' }) })).rejects.toThrow(
      'REDIRECT:/notes/algebra.quadratics.factoring'
    )
  })

  it('uses a temporary redirect, not a permanent one', async () => {
    // The session → concept mapping is derived from data; a 308 would be cached by
    // the browser forever and could never be corrected.
    createClientMock.mockResolvedValue(fakeSupabase(USER))
    kitConceptMock.mockResolvedValue('x.y')
    await expect(kitPage.default({ params: Promise.resolve({ key: 'k' }) })).rejects.toThrow(/^REDIRECT:/)
    expect(permanentRedirectMock).not.toHaveBeenCalled()
  })

  it('encodes the concept key on the way out', async () => {
    createClientMock.mockResolvedValue(fakeSupabase(USER))
    kitConceptMock.mockResolvedValue('a b/c')
    await expect(kitPage.default({ params: Promise.resolve({ key: 'k' }) })).rejects.toThrow(
      'REDIRECT:/notes/a%20b%2Fc'
    )
  })
})

describe('Study-kit viewer (/kits/[key]) fallback', () => {
  it('renders notes, a solution toggle and flashcard content when no concept resolves', async () => {
    createClientMock.mockResolvedValue(fakeSupabase(USER))
    // A kit whose turns never recorded a concept — the viewer is still the answer,
    // because the link is out in the wild and must not 404.
    kitConceptMock.mockResolvedValue(null)
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
    kitConceptMock.mockResolvedValue(null)
    kitMock.mockResolvedValue(null)
    await expect(kitPage.default({ params: Promise.resolve({ key: 'nope' }) })).rejects.toThrow('NOT_FOUND')
  })
})
