import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import type { DashboardData } from '../lib/learning/dashboard-read'
import { STRAND_ORDER, STRAND_LABELS } from '../lib/onboarding/item-bank'

// Render test for the dashboard home (/dashboard) after the IA redesign
// collapsed the old five-view analytics dashboard into a single daily-loop
// surface (ContinueLearningScreen). The page is an async Server Component that
// (1) reads the auth'd user via the cookie client, redirecting to /login when
// signed out, then (2) loads its data (loadDashboard + loadNavUser +
// loadStudyKits + loadRecentSessions) and renders the "Today's Review" home.
// These tests pin that contract WITHOUT a browser or DB: every read is mocked
// and the resolved element is SSR-rendered (renderToStaticMarkup, the same way
// Next first paints it). loadDashboard's own real behavior is covered by
// dashboard-read.test.ts; the deleted /mastery, /misconceptions, /activity index
// pages (replaced by the Notebook + Library) are no longer part of this suite.

const { createClientMock, loadDashboardMock, redirectMock, navUserMock, kitsMock, recentSessionsMock } = vi.hoisted(
  () => ({
    createClientMock: vi.fn(),
    loadDashboardMock: vi.fn(),
    // Next's real redirect() throws to halt rendering; the mock does the same so
    // the page stops exactly where the real one would, and the call is asserted.
    redirectMock: vi.fn((url: string) => {
      throw new Error(`REDIRECT:${url}`)
    }),
    navUserMock: vi.fn(),
    kitsMock: vi.fn(),
    recentSessionsMock: vi.fn(),
  })
)

// The page's reads import `server-only`-guarded helpers; neutralize the guard so
// the modules import under vitest (the convention across the suite).
vi.mock('server-only', () => ({}))
vi.mock('next/navigation', () => ({ redirect: redirectMock }))
vi.mock('@/lib/supabase/server', () => ({ createClient: createClientMock }))
vi.mock('@/lib/learning/dashboard-read', () => ({ loadDashboard: loadDashboardMock }))
vi.mock('@/lib/learning/activity-read', () => ({ loadRecentSessions: recentSessionsMock }))
vi.mock('@/components/dashboard/premium/user-info', () => ({ loadNavUser: navUserMock }))
// ContinueLearningScreen imports kitHrefForConcept from kits-read; stub it to
// "no kit" so review links fall back to the concept workspace.
vi.mock('@/components/dashboard/premium/kits-read', () => ({
  loadStudyKits: kitsMock,
  kitHrefForConcept: () => null,
}))

const dashboardPage = await import('../app/(dashboard)/dashboard/page')

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

async function render(user: { id: string } | null, data: DashboardData): Promise<string> {
  createClientMock.mockResolvedValue(fakeSupabase(user))
  loadDashboardMock.mockResolvedValue(data)
  navUserMock.mockResolvedValue({ name: 'Ada Lovelace', initials: 'AL', planLabel: 'Free' })
  kitsMock.mockResolvedValue([])
  recentSessionsMock.mockResolvedValue([])
  return renderToStaticMarkup(await dashboardPage.default())
}

beforeEach(() => {
  createClientMock.mockReset()
  loadDashboardMock.mockReset()
  navUserMock.mockReset()
  kitsMock.mockReset()
  recentSessionsMock.mockReset()
  redirectMock.mockClear()
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('Dashboard home (/dashboard)', () => {
  it('renders the daily-loop home for an authed user with data', async () => {
    const html = await render(USER, RICH_DATA)
    // Greeting uses the first name; Today's Review is the dominant action; the
    // weakest practiced concept surfaces in the "Get ahead" cards.
    expect(html).toContain('Ada')
    expect(html).toContain('Start review')
    expect(html).toContain('Weakest concepts')
    expect(html).toContain(NODE_TITLE)
    expect(loadDashboardMock).toHaveBeenCalledOnce()
  })

  it('renders the activation state for a fresh user (no crash)', async () => {
    const html = await render(USER, EMPTY_DATA)
    // Cold start → a single "set up + first session" call, not the daily loop.
    expect(html).toContain('Welcome to Calyxa')
    expect(html).toContain('Start your first session')
    expect(html).toContain('Set up Calyxa')
    expect(html).toContain('/welcome')
    // No daily-loop surfaces for an empty account.
    expect(html).not.toContain('Weakest concepts')
    expect(html).not.toContain('Start review')
  })

  it('redirects to /login when unauthed', async () => {
    await expect(render(null, RICH_DATA)).rejects.toThrow('REDIRECT:/login')
    expect(redirectMock).toHaveBeenCalledWith('/login')
    // Never reads dashboard data for a signed-out request.
    expect(loadDashboardMock).not.toHaveBeenCalled()
  })
})
