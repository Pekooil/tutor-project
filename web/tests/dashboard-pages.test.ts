import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import type { DashboardData } from '../lib/learning/dashboard-read'
import { STRAND_ORDER, STRAND_LABELS } from '../lib/onboarding/item-bank'

// Render test for the dashboard home (/dashboard) — the Notebook Studio's
// dashboard: today's review, then the subject → concept browser over everything
// tutored. The page is an async Server Component that (1) reads the auth'd user
// via the cookie client, redirecting to /login when signed out, then (2) loads
// its data (loadDashboard + loadNavUser + loadSessionQuota + buildStudioCatalog)
// and renders. These tests pin that contract WITHOUT a browser or DB: every read
// is mocked and the resolved element is SSR-rendered (renderToStaticMarkup, the
// same way Next first paints it). loadDashboard's own real behavior is covered by
// dashboard-read.test.ts.

const { createClientMock, loadDashboardMock, redirectMock, navUserMock, quotaMock, catalogMock } = vi.hoisted(() => ({
  createClientMock: vi.fn(),
  loadDashboardMock: vi.fn(),
  // Next's real redirect() throws to halt rendering; the mock does the same so
  // the page stops exactly where the real one would, and the call is asserted.
  redirectMock: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`)
  }),
  navUserMock: vi.fn(),
  quotaMock: vi.fn(),
  catalogMock: vi.fn(),
}))

// The page's reads import `server-only`-guarded helpers; neutralize the guard so
// the modules import under vitest (the convention across the suite).
vi.mock('server-only', () => ({}))
vi.mock('next/navigation', () => ({ redirect: redirectMock }))
vi.mock('@/lib/supabase/server', () => ({ createClient: createClientMock }))
vi.mock('@/lib/learning/dashboard-read', () => ({ loadDashboard: loadDashboardMock }))
vi.mock('@/lib/learning/activity-read', () => ({ loadSessionQuota: quotaMock }))
vi.mock('@/components/dashboard/premium/user-info', () => ({ loadNavUser: navUserMock }))
// The catalog's supplementary reads (kit counts, notebook keys, session counts)
// hit the DB directly; stub the builder so this test stays a render contract.
vi.mock('@/components/studio/catalog-read', () => ({ buildStudioCatalog: catalogMock }))

const dashboardPage = await import('../app/(dashboard)/dashboard/page')
const notesIndexPage = await import('../app/(dashboard)/notes/page')

function fakeSupabase(user: { id: string } | null) {
  return { auth: { getUser: async () => ({ data: { user }, error: null }) } }
}

const USER = { id: 'user-fixture-id' }

function emptyStateCounts() {
  return { unseen: 0, learning: 0, weak: 0, mastered: 0, forgotten: 0 }
}

// A fresh account: six empty strands, empty sections, isEmpty true.
const EMPTY_DATA: DashboardData = {
  strands: STRAND_ORDER.map((strand) => ({
    strand,
    strandLabel: STRAND_LABELS[strand] ?? strand,
    nodes: [],
    averageMastery: 0,
    stateCounts: emptyStateCounts(),
  })),
  stateCounts: emptyStateCounts(),
  totalConcepts: 0,
  misconceptions: [],
  dueQueue: [],
  activity: [],
  isEmpty: true,
}

const NODE_TITLE = 'Solving linear equations'
const DUE_TITLE = 'Parallel-line angles'
const RICH_DATA: DashboardData = {
  strands: STRAND_ORDER.map((strand) => {
    const nodes =
      strand === 'algebra'
        ? [
            {
              conceptKey: 'algebra.linear-equations.one-variable',
              title: NODE_TITLE,
              strand: 'algebra',
              strandLabel: STRAND_LABELS.algebra,
              mastery: 0.42,
              state: 'weak' as const,
              confidenceBand: 'medium' as const,
              observationCount: 5,
              lastPracticedAt: '2026-07-12T00:00:00.000Z',
            },
          ]
        : []
    return {
      strand,
      strandLabel: STRAND_LABELS[strand] ?? strand,
      nodes,
      averageMastery: nodes.length ? 0.42 : 0,
      stateCounts: { ...emptyStateCounts(), ...(nodes.length ? { weak: 1 } : {}) },
    }
  }),
  stateCounts: { ...emptyStateCounts(), weak: 1 },
  totalConcepts: 1,
  misconceptions: [
    {
      id: 'misc-active-1',
      conceptKey: 'geometry.angles.parallel-lines',
      title: DUE_TITLE,
      strand: 'geometry',
      strandLabel: STRAND_LABELS.geometry,
      category: 'sign-error',
      description: 'drops the negative on the alternate angle',
      status: 'active',
      occurrenceCount: 3,
      consecutiveCorrect: 1,
      firstSeenAt: '2026-07-10T00:00:00.000Z',
      lastSeenAt: '2026-07-12T00:00:00.000Z',
      resolvedAt: null,
    },
  ],
  dueQueue: [
    {
      conceptKey: 'geometry.angles.parallel-lines',
      title: DUE_TITLE,
      strand: 'geometry',
      strandLabel: STRAND_LABELS.geometry,
      dueAt: '2026-07-10T00:00:00.000Z',
      lastReviewAt: '2026-07-07T00:00:00.000Z',
      intervalDays: 3,
      priority: 0.9,
      lapses: 1,
      overdue: true,
    },
  ],
  activity: [
    { day: '2026-07-12', sessions: 1, correct: 2, partial: 0, incorrect: 1 },
    { day: '2026-07-13', sessions: 1, correct: 0, partial: 1, incorrect: 0 },
  ],
  isEmpty: false,
}

// One tutored subject with one concept — enough to prove the browser renders.
const CATALOG = [
  {
    key: 'algebra',
    label: STRAND_LABELS.algebra ?? 'Algebra 1',
    short: 'A1',
    color: '#9a3412',
    averageMastery: 0.42,
    misconceptionCount: 1,
    watchingCount: 0,
    lastPracticedAt: '2026-07-12T00:00:00.000Z',
    concepts: [
      {
        conceptKey: 'algebra.linear-equations.one-variable',
        title: NODE_TITLE,
        mastery: 0.42,
        sessions: 2,
        lastPracticedAt: '2026-07-12T00:00:00.000Z',
        quizCount: 3,
        cardCount: 4,
        misconceptionCount: 1,
        watchingCount: 0,
        hasNotes: true,
        status: 'gap' as const,
        dueAt: null,
      },
    ],
  },
  // A subject with NOTHING confirmed but a slip being watched — proves the
  // watching state surfaces instead of reading as "no gaps".
  {
    key: 'geometry',
    label: STRAND_LABELS.geometry ?? 'Geometry',
    short: 'GE',
    color: '#166534',
    averageMastery: 0.71,
    misconceptionCount: 0,
    watchingCount: 2,
    lastPracticedAt: '2026-07-10T00:00:00.000Z',
    concepts: [
      {
        conceptKey: 'geometry.angles.parallel-lines',
        title: DUE_TITLE,
        mastery: 0.71,
        sessions: 1,
        lastPracticedAt: '2026-07-10T00:00:00.000Z',
        quizCount: 0,
        cardCount: 0,
        misconceptionCount: 0,
        watchingCount: 2,
        hasNotes: false,
        status: 'solid' as const,
        dueAt: null,
      },
    ],
  },
]

const DEFAULT_QUOTA = { tier: 'free', isPro: false, limit: 10, used: 3, remaining: 7, resetsAt: null }

async function render(
  user: { id: string } | null,
  data: DashboardData,
  quota: Record<string, unknown> = DEFAULT_QUOTA
): Promise<string> {
  createClientMock.mockResolvedValue(fakeSupabase(user))
  loadDashboardMock.mockResolvedValue(data)
  navUserMock.mockResolvedValue({ name: 'Ada Lovelace', initials: 'AL', planLabel: 'Free' })
  quotaMock.mockResolvedValue(quota)
  catalogMock.mockResolvedValue(data.isEmpty ? [] : CATALOG)
  return renderToStaticMarkup(await dashboardPage.default())
}

/** The library at /notes, which owns the subject → concept browser since the
 *  2026-07-25 move. Same mocks — it reads the same catalog the dashboard used
 *  to. */
async function renderLibrary(user: { id: string } | null, data: DashboardData): Promise<string> {
  createClientMock.mockResolvedValue(fakeSupabase(user))
  loadDashboardMock.mockResolvedValue(data)
  catalogMock.mockResolvedValue(data.isEmpty ? [] : CATALOG)
  return renderToStaticMarkup(await notesIndexPage.default())
}

beforeEach(() => {
  createClientMock.mockReset()
  loadDashboardMock.mockReset()
  navUserMock.mockReset()
  quotaMock.mockReset()
  catalogMock.mockReset()
  redirectMock.mockClear()
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('Dashboard home (/dashboard)', () => {
  it('renders the studio dashboard for an authed user with data', async () => {
    const html = await render(USER, RICH_DATA)
    // The heading is a plain tab title, NOT a greeting — no time-of-day copy and
    // no first name. Today's Review is the dominant action; the browser lists the
    // tutored subject and its concepts underneath.
    expect(html).toContain('>Dashboard<')
    expect(html).not.toMatch(/Good (morning|afternoon|evening)/)
    expect(html).toContain('Start review')
    // The subject → concept browser moved to /notes; the dashboard is now only
    // "what do I do right now".
    expect(html).not.toContain('Subjects &amp; concepts')
    expect(loadDashboardMock).toHaveBeenCalledOnce()
  })

  it('shows the free-tier session quota in the header', async () => {
    const html = await render(USER, RICH_DATA)
    expect(html).toContain('7 of 10 sessions left this month')
  })

  // The quota pill used to be an inert <span>, and NOTHING in the product linked
  // to /billing — so the Stripe checkout Sprint 23 shipped had no entry point on
  // the surface it was designed to launch from. Pinned here because a dead
  // upgrade path fails silently: everything still renders, it just cannot be
  // reached, which is exactly what happened the first time.
  it('makes the quota pill a route into billing', async () => {
    expect(await render(USER, RICH_DATA)).toContain('href="/billing"')
  })

  it('offers a way out when the free allowance is spent, not just a warning', async () => {
    const html = await render(USER, RICH_DATA, {
      tier: 'free',
      isPro: false,
      limit: 10,
      used: 10,
      remaining: 0,
      resetsAt: '2026-08-12T00:00:00.000Z',
    })
    expect(html).toContain('No sessions left this month')
    expect(html).toContain('Session limit reached')
    // Says when it comes back on its own — a capped student should not have to
    // pay to find out the cap is temporary.
    expect(html).toContain('August 12')
    expect(html).toContain('See plans')
  })

  it('does not nag an account that still has sessions left', async () => {
    expect(await render(USER, RICH_DATA)).not.toContain('Session limit reached')
  })




  it('renders the activation state for a fresh user (no crash)', async () => {
    const html = await render(USER, EMPTY_DATA)
    // Cold start → a single "set up + first session" call, not the daily loop.
    expect(html).toContain('Welcome to Calyxa')
    expect(html).toContain('Start your first session')
    // The cold-start CTA is the Chrome Web Store: sessions only ever start in
    // the extension, and the /welcome walkthrough that used to sit in between
    // was retired with the two-workflow onboarding cleanup (2026-07-25).
    expect(html).toContain('Add Calyxa to Chrome')
    expect(html).toContain('chromewebstore.google.com')
    // No browser surfaces for an empty account.
    expect(html).not.toContain('Everything tutored')
    expect(html).not.toContain('Start review')
  })

  it('redirects to /login when unauthed', async () => {
    await expect(render(null, RICH_DATA)).rejects.toThrow('REDIRECT:/login')
    expect(redirectMock).toHaveBeenCalledWith('/login')
    // Never reads dashboard data for a signed-out request.
    expect(loadDashboardMock).not.toHaveBeenCalled()
  })
})

// The library — the subject → concept browser. It lived at the bottom of the
// dashboard until 2026-07-25; /notes was a bare redirect to the last-touched
// concept, so there was no index anywhere in the product.
describe('Notes index (/notes)', () => {
  it('links a concept row to its notes, not the retired concept workspace', async () => {
    const html = await renderLibrary(USER, RICH_DATA)
    expect(html).toContain('/notes/algebra.linear-equations.one-variable')
    expect(html).not.toContain('/concepts/algebra.linear-equations.one-variable')
  })

  it('shows the per-concept study-material counts', async () => {
    const html = await renderLibrary(USER, RICH_DATA)
    expect(html).toContain('3 quiz')
    expect(html).toContain('4 cards')
    expect(html).toContain('1 misconception')
  })

  it('surfaces a watched slip separately from a confirmed gap', async () => {
    const html = await renderLibrary(USER, RICH_DATA)
    // A concept with nothing confirmed but something watched says so, rather
    // than claiming "No gaps" (which would hide it) or "misconceptions" (which
    // would overstate a single slip).
    expect(html).toContain('2 watching')
    expect(html).toContain('1 to fix')
    // The confirmed count must NOT absorb the watched ones.
    expect(html).not.toContain('3 to fix')
  })

  it('is the index, not a redirect to the last concept', async () => {
    const html = await renderLibrary(USER, RICH_DATA)
    expect(html).toContain('Subjects &amp; concepts')
    expect(redirectMock).not.toHaveBeenCalled()
  })

  it('offers a search box, since scrolling the tree was the problem', async () => {
    expect(await renderLibrary(USER, RICH_DATA)).toContain('Search subjects and concepts')
  })
})
