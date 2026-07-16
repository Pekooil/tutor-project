import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DashboardData } from '../lib/learning/dashboard-read'
import { STRAND_ORDER, STRAND_LABELS } from '../lib/onboarding/item-bank'

// Sprint 22 Task 8 (ADR-047): render tests for the dashboard pages. Each page is
// an async Server Component that (1) reads the auth'd user via the cookie
// client, redirecting to /login when signed out, then (2) reads its data via
// loadDashboard and renders. These tests pin that contract WITHOUT a browser or
// a live DB: the cookie client, loadDashboard, and next/navigation's redirect
// are mocked, and the resolved element is SSR-rendered (renderToStaticMarkup,
// the same way Next first paints it — the marketing-sections.test.tsx pattern),
// so we assert: renders for an authed user WITH data, renders a graceful empty
// state for a fresh user, and redirects unauthed. loadDashboard's own real
// behavior is covered by dashboard-read.test.ts; here it is a controlled stub.

const { createClientMock, loadDashboardMock, redirectMock } = vi.hoisted(() => ({
  createClientMock: vi.fn(),
  loadDashboardMock: vi.fn(),
  // Next's real redirect() throws to halt rendering; the mock does the same so
  // the page stops exactly where the real one would, and the call is asserted.
  redirectMock: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`)
  }),
}))

// The Overview/Account pages import a `server-only`-guarded helper (user-info);
// neutralize the guard so the module imports under vitest (the convention used
// across the suite, e.g. dashboard-read.test.ts).
vi.mock('server-only', () => ({}))
vi.mock('next/navigation', () => ({ redirect: redirectMock }))
vi.mock('@/lib/supabase/server', () => ({ createClient: createClientMock }))
vi.mock('@/lib/learning/dashboard-read', () => ({ loadDashboard: loadDashboardMock }))

const overviewPage = await import('../app/(dashboard)/dashboard/page')
const masteryPage = await import('../app/(dashboard)/mastery/page')
const misconceptionsPage = await import('../app/(dashboard)/misconceptions/page')
const activityPage = await import('../app/(dashboard)/activity/page')

type SnapshotRow = { day: string; mastery: number }

// A minimal cookie-client stand-in. `auth.getUser()` returns the given user (or
// null for signed-out); `from(...).select(...).eq(...).order(...)` resolves the
// given snapshot rows (only the Activity page reads a table directly — the
// mastery_snapshot trend).
function fakeSupabase(user: { id: string } | null, snapshotRows: SnapshotRow[] = []) {
  return {
    auth: { getUser: async () => ({ data: { user }, error: null }) },
    from: () => ({
      select: () => ({
        eq: () => ({
          order: async () => ({ data: snapshotRows, error: null }),
        }),
      }),
    }),
  }
}

const USER = { id: 'user-fixture-id' }

function emptyStateCounts() {
  return { unseen: 0, learning: 0, weak: 0, mastered: 0, forgotten: 0 }
}

// A fresh account: six empty strands, empty sections, isEmpty true — the exact
// shape loadDashboard returns for a cold start.
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

// A user with real data across every section.
const NODE_TITLE = 'Solving linear equations'
const MISCONCEPTION_TITLE = 'Parallel-line angles'
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
              mastery: 0.72,
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
      averageMastery: nodes.length ? 0.72 : 0,
      stateCounts: { ...emptyStateCounts(), ...(nodes.length ? { weak: 1 } : {}) },
    }
  }),
  stateCounts: { ...emptyStateCounts(), weak: 1 },
  totalConcepts: 1,
  misconceptions: [
    {
      id: 'misc-active-1',
      conceptKey: 'geometry.angles.parallel-lines',
      title: MISCONCEPTION_TITLE,
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
    {
      id: 'misc-resolved-1',
      conceptKey: 'algebra.linear-equations.one-variable',
      title: 'Transposition',
      strand: 'algebra',
      strandLabel: STRAND_LABELS.algebra,
      category: 'transposition',
      description: '',
      status: 'resolved',
      occurrenceCount: 5,
      consecutiveCorrect: 4,
      firstSeenAt: '2026-07-01T00:00:00.000Z',
      lastSeenAt: '2026-07-08T00:00:00.000Z',
      resolvedAt: '2026-07-09T00:00:00.000Z',
    },
  ],
  dueQueue: [
    {
      conceptKey: 'geometry.angles.parallel-lines',
      title: MISCONCEPTION_TITLE,
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

const RICH_SNAPSHOT: SnapshotRow[] = [
  { day: '2026-07-12', mastery: 0.4 },
  { day: '2026-07-13', mastery: 0.55 },
]

async function render(
  mod: { default: () => Promise<React.ReactElement> },
  user: { id: string } | null,
  data: DashboardData,
  snapshotRows: SnapshotRow[] = []
): Promise<string> {
  createClientMock.mockResolvedValue(fakeSupabase(user, snapshotRows))
  loadDashboardMock.mockResolvedValue(data)
  return renderToStaticMarkup(await mod.default())
}

beforeEach(() => {
  createClientMock.mockReset()
  loadDashboardMock.mockReset()
  redirectMock.mockClear()
})

afterEach(() => {
  vi.clearAllMocks()
})

// Copy markers match the "Calyxa Dashboard Premium" redesign (Design handoff).
const PAGES = [
  {
    name: 'Overview (/dashboard)',
    mod: overviewPage,
    withData: ['By strand', 'Algebra 1', 'Where concepts stand'],
    empty: 'No open misconceptions',
  },
  {
    name: 'Mastery (/mastery)',
    mod: masteryPage,
    withData: [NODE_TITLE, 'Algebra 1'],
    empty: 'No concepts practiced yet',
  },
  {
    name: 'Misconceptions (/misconceptions)',
    mod: misconceptionsPage,
    withData: [MISCONCEPTION_TITLE, 'Resolved'],
    empty: 'Nothing resolved yet',
  },
] as const

describe.each(PAGES)('$name', ({ mod, withData, empty }) => {
  it('renders for an authed user with data', async () => {
    const html = await render(mod, USER, RICH_DATA)
    for (const marker of withData) {
      if (marker) expect(html).toContain(marker)
    }
    expect(html).not.toContain(empty)
    expect(loadDashboardMock).toHaveBeenCalledOnce()
  })

  it('renders a graceful empty state for a fresh user (no crash)', async () => {
    const html = await render(mod, USER, EMPTY_DATA)
    expect(html).toContain(empty)
  })

  it('redirects to /login when unauthed', async () => {
    await expect(render(mod, null, RICH_DATA)).rejects.toThrow('REDIRECT:/login')
    expect(redirectMock).toHaveBeenCalledWith('/login')
    // Never reads data for a signed-out request.
    expect(loadDashboardMock).not.toHaveBeenCalled()
  })
})

// The Activity page also reads mastery_snapshot directly (the forward-only
// trend), so it gets its own tests with snapshot rows in the fake client.
describe('Activity (/activity)', () => {
  it('renders accuracy history and the mastery trend for a user with data', async () => {
    const html = await render(activityPage, USER, RICH_DATA, RICH_SNAPSHOT)
    expect(html).toContain('Study heatmap')
    expect(html).toContain('Answers')
    expect(html).toContain('Mastery over time')
  })

  it('renders honest empty states at launch (no activity, no snapshot history)', async () => {
    const html = await render(activityPage, USER, EMPTY_DATA, [])
    // The charts always render (the design's honest empty state is an empty
    // grid, not a "no data" card); the forward-only trend says so plainly.
    expect(html).toContain('Study heatmap')
    expect(html).toContain('No snapshots yet')
    expect(html).toContain('Builds as you practice')
  })

  it('redirects to /login when unauthed', async () => {
    await expect(render(activityPage, null, RICH_DATA)).rejects.toThrow('REDIRECT:/login')
    expect(redirectMock).toHaveBeenCalledWith('/login')
  })
})
