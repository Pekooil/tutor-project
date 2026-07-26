import { describe, expect, it } from 'vitest'
import type { DashboardActivityDay, DashboardData, DashboardMisconception } from '@/lib/learning/dashboard-read'
import type { MasteryTrendDay } from '@/lib/learning/analytics-read'
import type { AnalyticsInput } from '@/components/studio/analytics'
import {
  footerStats,
  gapsCard,
  progressData,
  progressScore,
  reviewCard,
  strandRows,
} from '@/components/studio/analytics'

// The Progress tab's derivations. These are the numbers a student reads as a
// judgement on their own work, so the properties under test are less "the
// arithmetic is right" than "the page cannot lie":
//
//   · a signal with too small a sample reads `null`, never a confident number
//   · the score renormalises over the signals it HAS rather than counting a
//     missing one as zero
//   · the week-on-week delta is suppressed unless last week's score was
//     computable from the SAME signals
//   · the trend line has a point only where a real snapshot exists, and ends on
//     the score printed beside it
//   · the narrative names the limiting signal and backs it with a COUNT the
//     student can go and check, never an adjective
//
// `now` is injected, so none of this depends on the wall clock.

const NOW = new Date('2026-07-25T12:00:00Z')
const MS_PER_DAY = 86_400_000

const day = (offset: number) => new Date(NOW.getTime() - offset * MS_PER_DAY).toISOString().slice(0, 10)
const iso = (offset: number) => new Date(NOW.getTime() - offset * MS_PER_DAY).toISOString()

function node(conceptKey: string, mastery: number, state = 'learning') {
  return {
    conceptKey,
    title: conceptKey,
    strand: conceptKey.split('.')[0],
    strandLabel: conceptKey.split('.')[0],
    mastery,
    state: state as DashboardData['strands'][number]['nodes'][number]['state'],
    confidenceBand: 'medium' as const,
    observationCount: 3,
    lastPracticedAt: iso(1),
  }
}

const EMPTY_COUNTS = { unseen: 0, learning: 0, weak: 0, mastered: 0, forgotten: 0 }

function strand(name: string, nodes: ReturnType<typeof node>[]) {
  return {
    strand: name,
    strandLabel: name,
    nodes: [...nodes].sort((a, b) => a.mastery - b.mastery),
    averageMastery: nodes.reduce((a, n) => a + n.mastery, 0) / Math.max(1, nodes.length),
    stateCounts: { ...EMPTY_COUNTS, learning: nodes.length },
  }
}

/** `count` consecutive study days ending `endOffset` days ago, ASCENDING by day
 *  — the order `loadDashboard` returns. */
function activityRun(count: number, endOffset: number, turnsPerDay = 4): DashboardActivityDay[] {
  return Array.from({ length: count }, (_, i) => ({
    day: day(endOffset + count - 1 - i),
    sessions: 1,
    correct: turnsPerDay - 1,
    partial: 0,
    incorrect: 1,
  }))
}

function dashboard(over: Partial<DashboardData> = {}): DashboardData {
  return {
    strands: [],
    stateCounts: { ...EMPTY_COUNTS },
    totalConcepts: 0,
    misconceptions: [],
    dueQueue: [],
    activity: [],
    isEmpty: true,
    ...over,
  }
}

function input(over: Partial<DashboardData> = {}, trend: MasteryTrendDay[] = []): AnalyticsInput {
  return { dashboard: dashboard(over), trend, nowIso: NOW.toISOString() }
}

/** A payload with all three signals comfortably unlocked. */
function warmInput(trend: MasteryTrendDay[] = []): AnalyticsInput {
  return input(
    {
      strands: [strand('algebra', [node('algebra.a', 0.8), node('algebra.b', 0.6), node('algebra.c', 0.4)])],
      activity: activityRun(20, 0),
    },
    trend
  )
}

const trendOf = (days: number, from = 0.4, step = 0.01): MasteryTrendDay[] =>
  Array.from({ length: days }, (_, i) => ({
    day: day(days - 1 - i),
    mastery: from + i * step,
    concepts: 5,
    mastered: 1,
  }))

describe('progress score — signal unlocking', () => {
  it('is null when nothing has unlocked', () => {
    expect(progressScore(input()).score).toBeNull()
  })

  it('withholds mastery below three tutored concepts rather than averaging two', () => {
    const two = progressScore(input({ strands: [strand('algebra', [node('algebra.a', 0.9), node('algebra.b', 0.9)])] }))
    expect(two.signals.find((s) => s.key === 'mastery')?.value).toBeNull()

    const three = progressScore(
      input({ strands: [strand('algebra', [node('algebra.a', 0.9), node('algebra.b', 0.9), node('algebra.c', 0.9)])] })
    )
    expect(three.signals.find((s) => s.key === 'mastery')?.value).toBe(90)
  })

  it('withholds accuracy under eight graded answers', () => {
    const thin = progressScore(input({ activity: [{ day: day(1), sessions: 1, correct: 3, partial: 0, incorrect: 1 }] }))
    expect(thin.signals.find((s) => s.key === 'accuracy')?.value).toBeNull()
  })

  it('gives a partial half credit', () => {
    // 6 correct + 4 partial + 2 incorrect = 8 credit over 12 graded → 67%.
    const p = progressScore(input({ activity: [{ day: day(1), sessions: 1, correct: 6, partial: 4, incorrect: 2 }] }))
    expect(p.signals.find((s) => s.key === 'accuracy')?.value).toBe(67)
  })

  it('withholds consistency until there is a week of history to judge', () => {
    const young = progressScore(input({ activity: activityRun(3, 0) }))
    expect(young.signals.find((s) => s.key === 'consistency')?.value).toBeNull()

    const older = progressScore(input({ activity: activityRun(12, 0) }))
    expect(older.signals.find((s) => s.key === 'consistency')?.value).not.toBeNull()
  })

  it('renormalises over the signals it has instead of scoring a missing one as zero', () => {
    // Accuracy only: 10 correct of 10 → 100. If the two missing signals counted
    // as zero the weighted score would be 30, not 100.
    const p = progressScore(input({ activity: [{ day: day(1), sessions: 1, correct: 10, partial: 0, incorrect: 0 }] }))
    expect(p.used).toBe(1)
    expect(p.score).toBe(100)
  })

  it('weights mastery above accuracy above consistency', () => {
    const weights = Object.fromEntries(progressScore(warmInput()).signals.map((s) => [s.key, s.weight]))
    expect(weights.mastery).toBeGreaterThan(weights.accuracy)
    expect(weights.accuracy).toBeGreaterThan(weights.consistency)
    expect(weights.mastery + weights.accuracy + weights.consistency).toBeCloseTo(1)
  })
})

describe('progress score — delta and trend', () => {
  it('suppresses the delta when last week had no mastery snapshot', () => {
    expect(progressScore(warmInput()).delta).toBeNull()
  })

  it('reports a delta once a snapshot at least a week old exists', () => {
    expect(progressScore(warmInput(trendOf(30))).delta).not.toBeNull()
  })

  it('draws no line below four real snapshot days', () => {
    const p = progressScore(warmInput(trendOf(2)))
    expect(p.series).toBeNull()
    expect(p.range).toBeNull()
  })

  it('never invents a point for a day with no snapshot', () => {
    // Snapshots on days 10, 9, 8 and 7 only — a nine-day span with a five-day
    // hole. The series must have the snapshot days plus today and nothing in
    // between: an interpolated line would be a claim about days the cron never
    // recorded.
    const sparse: MasteryTrendDay[] = [10, 9, 8, 7].map((offset) => ({
      day: day(offset),
      mastery: 0.5,
      concepts: 5,
      mastered: 1,
    }))
    const series = progressScore(warmInput(sparse)).series!
    expect(series.map((p) => p.day)).toEqual([day(10), day(9), day(8), day(7), day(0)])
  })

  it('ends the line on the score printed beside it', () => {
    const p = progressScore(warmInput(trendOf(30)))
    expect(p.series![p.series!.length - 1]).toEqual({ day: day(0), score: p.score })
    expect(p.range).toEqual({ from: p.series![0].score, to: p.score })
  })
})

describe('progress score — the narrative', () => {
  it('names the weakest live signal and backs it with a real count', () => {
    // Strong mastery and consistency, deliberately poor accuracy.
    const p = progressScore(
      input({
        strands: [strand('algebra', [node('algebra.a', 0.95), node('algebra.b', 0.95), node('algebra.c', 0.95)])],
        activity: [
          ...activityRun(12, 1),
          { day: day(0), sessions: 1, correct: 2, partial: 9, incorrect: 9 },
        ],
      })
    )
    expect(p.limiting).toBe('accuracy')
    expect(p.narrative.emphasis).toContain('Accuracy')
    // The tail must be checkable — a partial count over a graded count.
    expect(p.narrative.tail).toMatch(/\d+ of your last \d+ graded answers/)
  })

  it('says so plainly when nothing is holding the score back', () => {
    const p = progressScore(
      input({
        strands: [strand('algebra', [node('algebra.a', 0.95), node('algebra.b', 0.9), node('algebra.c', 0.92)])],
        activity: activityRun(14, 0, 20),
      })
    )
    expect(p.limiting).toBeNull()
    expect(p.narrative.emphasis).toMatch(/strong/)
  })

  it('describes the formula that is actually being used, not the full one', () => {
    // Accuracy only — the three-part sentence would be a lie here.
    const partial = progressScore(input({ activity: [{ day: day(1), sessions: 1, correct: 10, partial: 0, incorrect: 0 }] }))
    expect(partial.scoreMath).not.toContain('Half of the score')
    expect(partial.scoreMath).toContain('accuracy')

    const full = progressScore(warmInput())
    expect(full.scoreMath).toContain('Half of the score')
  })
})

describe('by subject', () => {
  it('ranks strongest first and links the weakest concept in each', () => {
    const rows = strandRows(
      input({
        strands: [
          strand('algebra', [node('algebra.a', 0.4), node('algebra.b', 0.6)]),
          strand('geometry', [node('geometry.a', 0.9), node('geometry.b', 0.7)]),
        ],
      })
    )
    expect(rows.map((r) => r.strand)).toEqual(['geometry', 'algebra'])
    expect(rows[0].weakest?.conceptKey).toBe('geometry.b')
    expect(rows[1].mastery).toBe(50)
  })

  it('omits strands with nothing practised rather than showing them at zero', () => {
    const unseen = { ...node('calculus.z', 0), observationCount: 0 }
    const rows = strandRows(
      input({ strands: [strand('algebra', [node('algebra.a', 0.5)]), strand('calculus', [unseen])] })
    )
    expect(rows.map((r) => r.strand)).toEqual(['algebra'])
  })
})

describe('reviews due', () => {
  const due = (inDays: number, lapses = 0, key = `c${inDays}`) => ({
    conceptKey: key,
    title: key,
    strand: 'algebra',
    strandLabel: 'Algebra',
    dueAt: new Date(NOW.getTime() + inDays * MS_PER_DAY).toISOString(),
    intervalDays: 3,
    priority: 1,
    lapses,
    lastReviewAt: null,
    overdue: inDays < 0,
  })

  it('counts only what has actually come due, and flags the overdue subset', () => {
    const card = reviewCard(input({ dueQueue: [due(-3), due(-1), due(0), due(2), due(9)] }))
    expect(card.due).toHaveLength(3)
    expect(card.overdue).toBe(2)
  })

  it('sends "Start review" to the worst concept, whose notes host the quiz', () => {
    const card = reviewCard(input({ dueQueue: [due(0, 0, 'fresh'), due(-2, 5, 'worst')] }))
    expect(card.due[0].conceptKey).toBe('worst')
    expect(card.startHref).toBe('/notes/worst')
  })

  it('offers no start link and no estimate when nothing is due', () => {
    const card = reviewCard(input({ dueQueue: [due(4)] }))
    expect(card.due).toHaveLength(0)
    expect(card.startHref).toBeNull()
    expect(card.minutes).toBe(0)
  })
})

describe('open gaps', () => {
  const gap = (over: Partial<DashboardMisconception>): DashboardMisconception => ({
    id: 'x',
    conceptKey: 'algebra.a',
    title: 'Quadratics & Factoring',
    strand: 'algebra',
    strandLabel: 'Algebra',
    category: 'sign-error',
    description: 'drops the sign when c is negative',
    status: 'active',
    occurrenceCount: 1,
    consecutiveCorrect: 0,
    firstSeenAt: iso(10),
    lastSeenAt: iso(1),
    resolvedAt: null,
    ...over,
  })

  it('puts confirmed patterns above one-off slips, worst first', () => {
    const card = gapsCard(
      input({
        misconceptions: [
          gap({ id: 'watched', status: 'pending' }),
          gap({ id: 'mild', status: 'active', occurrenceCount: 2 }),
          gap({ id: 'stubborn', status: 'active', occurrenceCount: 6 }),
        ],
      })
    )
    expect(card.open.map((g) => g.id)).toEqual(['stubborn', 'mild', 'watched'])
  })

  it('counts what has been fixed and keeps it out of the open list', () => {
    const card = gapsCard(
      input({
        misconceptions: [gap({ id: 'a' }), gap({ id: 'b', status: 'resolved', resolvedAt: iso(2) })],
      })
    )
    expect(card.open.map((g) => g.id)).toEqual(['a'])
    expect(card.resolved).toBe(1)
  })

  it('falls back to the category when a gap has no description', () => {
    const card = gapsCard(input({ misconceptions: [gap({ description: '', category: 'sign_error' })] }))
    expect(card.open[0].description).toBe('sign error')
  })
})

describe('the footer line', () => {
  it('counts study days inside the last seven, not the whole history', () => {
    // Five days in the last week, plus an old run that must not be counted.
    const stats = footerStats(input({ activity: [...activityRun(9, 40), ...activityRun(5, 0)] }))
    expect(stats.studiedLast7).toBe(5)
    expect(stats.bestStreak).toBe(9)
  })

  it('counts tutored concepts, not scheduled ones', () => {
    const unseen = { ...node('algebra.z', 0), observationCount: 0 }
    const stats = footerStats(input({ strands: [strand('algebra', [node('algebra.a', 0.5), unseen])] }))
    expect(stats.conceptsTutored).toBe(1)
  })
})

describe('the page as a whole', () => {
  it('reports a cold start when there is nothing real to show', () => {
    expect(progressData(input()).cold).toBe(true)
  })

  it('is no longer cold once a single section has data', () => {
    expect(progressData(input({ strands: [strand('algebra', [node('algebra.a', 0.5)])] })).cold).toBe(false)
  })
})
