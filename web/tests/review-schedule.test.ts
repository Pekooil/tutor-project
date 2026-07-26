import { describe, expect, it } from 'vitest'
import type { DashboardActivityDay, DashboardDueItem } from '@/lib/learning/dashboard-read'
import { agoLabel, lateLabel, reviewSchedule } from '@/components/studio/schedule'

// The dashboard's review schedule. The properties worth pinning are the ones a
// student would notice as a lie:
//
//   · a past day never shows a scheduled count — the row is rewritten the moment
//     a concept is reviewed, so any number there would be invented
//   · today's cell counts everything already due, so it agrees with the Today's
//     Review card sitting directly above it
//   · "already done" reads `last_review_at`, the only record of a COMPLETED
//     review, and never shows a future stamp

const NOW = new Date('2026-07-22T15:00:00Z')
const MS_PER_DAY = 86_400_000
const shift = (days: number) => new Date(NOW.getTime() + days * MS_PER_DAY).toISOString()
const dayOf = (days: number) => shift(days).slice(0, 10)

function due(over: Partial<DashboardDueItem> & { conceptKey: string }): DashboardDueItem {
  return {
    title: over.conceptKey,
    strand: 'algebra',
    strandLabel: 'Algebra',
    dueAt: shift(0),
    intervalDays: 3,
    priority: 1,
    lapses: 0,
    lastReviewAt: null,
    overdue: false,
    ...over,
  }
}

const studied = (offsets: number[]): DashboardActivityDay[] =>
  offsets.map((o) => ({ day: dayOf(-o), sessions: 1, correct: 3, partial: 0, incorrect: 1 }))

describe('the strip', () => {
  it('spans a fortnight with today in it', () => {
    const s = reviewSchedule([], [], NOW)
    expect(s.strip).toHaveLength(14)
    expect(s.strip.filter((d) => d.isToday)).toHaveLength(1)
    expect(s.strip.filter((d) => d.isPast)).toHaveLength(7)
  })

  it('never puts a scheduled count on a past day', () => {
    // A concept due three days ago is still IN the queue (overdue), but the day
    // it was scheduled for must not display a count — the schedule row has since
    // moved, so that number would describe a state that no longer exists.
    const s = reviewSchedule([due({ conceptKey: 'late', dueAt: shift(-3) })], [], NOW)
    expect(s.strip.filter((d) => d.isPast).every((d) => d.count === 0)).toBe(true)
  })

  it("counts everything already due into today, so it matches Today's Review", () => {
    const s = reviewSchedule(
      [
        due({ conceptKey: 'late-a', dueAt: shift(-3) }),
        due({ conceptKey: 'late-b', dueAt: shift(-1) }),
        due({ conceptKey: 'now', dueAt: shift(0) }),
        due({ conceptKey: 'later', dueAt: shift(2) }),
      ],
      [],
      NOW
    )
    const today = s.strip.find((d) => d.isToday)!
    expect(today.count).toBe(3)
    expect(s.due).toHaveLength(3)
    expect(s.overdueCount).toBe(2)
  })

  it('marks the past days that had a session', () => {
    const s = reviewSchedule([], studied([1, 3, 4]), NOW)
    expect(s.strip.filter((d) => d.isPast && d.studied).map((d) => d.day).sort()).toEqual(
      [dayOf(-1), dayOf(-3), dayOf(-4)].sort()
    )
  })
})

describe('coming up', () => {
  it('groups by day, in order, and never includes today', () => {
    const s = reviewSchedule(
      [
        due({ conceptKey: 'now', dueAt: shift(0) }),
        due({ conceptKey: 'a', dueAt: shift(2) }),
        due({ conceptKey: 'b', dueAt: shift(2) }),
        due({ conceptKey: 'c', dueAt: shift(5) }),
      ],
      [],
      NOW
    )
    expect(s.upcoming.map((u) => [u.day, u.count])).toEqual([
      [dayOf(2), 2],
      [dayOf(5), 1],
    ])
    expect(s.upcomingTotal).toBe(3)
  })

  it('counts days beyond the strip into the total, so nothing silently vanishes', () => {
    const s = reviewSchedule([due({ conceptKey: 'far', dueAt: shift(40) })], [], NOW)
    expect(s.strip.every((d) => d.count === 0)).toBe(true)
    expect(s.upcomingTotal).toBe(1)
  })
})

describe('already done', () => {
  it('reads last_review_at, newest first', () => {
    const s = reviewSchedule(
      [
        due({ conceptKey: 'old', dueAt: shift(3), lastReviewAt: shift(-5) }),
        due({ conceptKey: 'recent', dueAt: shift(4), lastReviewAt: shift(-1) }),
      ],
      [],
      NOW
    )
    expect(s.done.map((d) => d.conceptKey)).toEqual(['recent', 'old'])
    expect(s.done[0].daysAgo).toBe(1)
  })

  it('ignores concepts never reviewed, and anything older than the window', () => {
    const s = reviewSchedule(
      [
        due({ conceptKey: 'never', dueAt: shift(1) }),
        due({ conceptKey: 'ancient', dueAt: shift(1), lastReviewAt: shift(-40) }),
      ],
      [],
      NOW
    )
    expect(s.done).toEqual([])
  })

  it('never shows a review stamped in the future', () => {
    // Clock skew between the scheduler's `now` and this read would otherwise
    // surface as "reviewed in -1 days".
    const s = reviewSchedule([due({ conceptKey: 'skewed', dueAt: shift(1), lastReviewAt: shift(3) })], [], NOW)
    expect(s.done).toEqual([])
  })
})

describe('readiness and phrasing', () => {
  it('is not ready with an empty queue, so the section is omitted', () => {
    expect(reviewSchedule([], studied([1, 2]), NOW).ready).toBe(false)
    expect(reviewSchedule([due({ conceptKey: 'x' })], [], NOW).ready).toBe(true)
  })

  it('phrases lateness and recency in whole days', () => {
    expect(lateLabel(0)).toBe('due today')
    expect(lateLabel(1)).toBe('1 day late')
    expect(lateLabel(4)).toBe('4 days late')
    expect(agoLabel(0)).toBe('today')
    expect(agoLabel(1)).toBe('yesterday')
    expect(agoLabel(6)).toBe('6 days ago')
  })
})
