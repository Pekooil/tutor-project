import type { DashboardActivityDay, DashboardDueItem } from '@/lib/learning/dashboard-read'

// The review schedule as a three-part model: what you already did, what is due
// now, and what is coming.
//
// The spacing schedule (`reinforcement_schedule`, driven by `scheduler.ts`) has
// always been the engine behind Today's Review, but the dashboard never showed
// it — concepts simply appeared, with no way to see when they would come back or
// what had already been cleared. This turns the raw queue into something a
// student can plan around.
//
// Pure and `now`-injected, so it is unit-testable without a database and the
// screen stays a renderer.

const MS_PER_DAY = 86_400_000

function dayStr(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}
function dayMs(day: string): number {
  return Date.parse(`${day}T00:00:00Z`)
}
function floorDay(ms: number): number {
  return dayMs(dayStr(ms))
}

/** Days of history shown in the strip, and days ahead. 7 + today + 6 = a
 *  fortnight, which is both a readable row and the horizon the spacing
 *  intervals actually operate on early. */
const PAST_DAYS = 7
const AHEAD_DAYS = 6

/** How far back "recently done" looks, and how many it names. */
const DONE_WINDOW_DAYS = 14
const DONE_LIMIT = 4
/** Named concepts per column before collapsing to "+N more". */
export const TASK_LIMIT = 4
/** Days of the upcoming queue grouped into the third column. */
const UPCOMING_LIMIT = 4

export type StripDay = {
  day: string
  /** Single-letter weekday for the axis. */
  tick: string
  dayOfMonth: number
  /** Concepts scheduled to come back that day. TODAY counts everything due now,
   *  overdue included, so the cell agrees with the Today's Review card directly
   *  above it — a strip reading 2 beside a card reading 6 is just confusing.
   *  How much of that is late is carried by `overdueCount` instead. */
  count: number
  /** Past days only: was there a tutoring session that day. */
  studied: boolean
  isPast: boolean
  isToday: boolean
}

export type ScheduleTask = {
  conceptKey: string
  title: string
  strand: string
  /** Whole days past due; 0 when due today. */
  daysLate: number
}

export type UpcomingDay = {
  day: string
  /** "Thu Jul 24". */
  label: string
  count: number
  /** First few concept titles, for the row's caption. */
  titles: string[]
}

export type DoneTask = {
  conceptKey: string
  title: string
  strand: string
  /** "Jul 22". */
  label: string
  daysAgo: number
}

export type ReviewSchedule = {
  strip: StripDay[]
  /** Due today or earlier, worst-late first. */
  due: ScheduleTask[]
  overdueCount: number
  upcoming: UpcomingDay[]
  /** Total concepts scheduled beyond today, including days past the strip. */
  upcomingTotal: number
  done: DoneTask[]
  /** False when the schedule has nothing in it at all — the section is omitted
   *  rather than rendering three empty columns. */
  ready: boolean
}

export function reviewSchedule(
  dueQueue: DashboardDueItem[],
  activity: DashboardActivityDay[],
  now: Date
): ReviewSchedule {
  const today = floorDay(now.getTime())
  const studiedDays = new Set(activity.filter((d) => d.sessions > 0).map((d) => d.day))

  // Concepts scheduled per future day, keyed by UTC calendar day.
  const perDay = new Map<string, DashboardDueItem[]>()
  for (const item of dueQueue) {
    const key = dayStr(floorDay(Date.parse(item.dueAt)))
    const list = perDay.get(key)
    if (list) list.push(item)
    else perDay.set(key, [item])
  }

  const strip: StripDay[] = Array.from({ length: PAST_DAYS + 1 + AHEAD_DAYS }, (_, i) => {
    const ms = today + (i - PAST_DAYS) * MS_PER_DAY
    const day = dayStr(ms)
    const isPast = ms < today
    return {
      day,
      tick: new Date(ms).toLocaleDateString('en-US', { weekday: 'narrow', timeZone: 'UTC' }),
      dayOfMonth: new Date(ms).getUTCDate(),
      // A past day's scheduled count is meaningless after the fact — the row was
      // rewritten the moment the concept was reviewed — so only today and
      // forward carry one. Today absorbs everything already due.
      count: isPast
        ? 0
        : ms === today
          ? dueQueue.filter((item) => floorDay(Date.parse(item.dueAt)) <= today).length
          : (perDay.get(day)?.length ?? 0),
      studied: isPast && studiedDays.has(day),
      isPast,
      isToday: ms === today,
    }
  })

  const due: ScheduleTask[] = dueQueue
    .filter((item) => floorDay(Date.parse(item.dueAt)) <= today)
    .map((item) => ({
      conceptKey: item.conceptKey,
      title: item.title,
      strand: item.strand,
      daysLate: Math.max(0, Math.round((today - floorDay(Date.parse(item.dueAt))) / MS_PER_DAY)),
    }))
    .sort((a, b) => b.daysLate - a.daysLate || a.title.localeCompare(b.title))

  const futureDays = [...perDay.entries()]
    .filter(([day]) => dayMs(day) > today)
    .sort((a, b) => a[0].localeCompare(b[0]))

  const upcoming: UpcomingDay[] = futureDays.slice(0, UPCOMING_LIMIT).map(([day, items]) => ({
    day,
    label: new Date(`${day}T00:00:00Z`).toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      timeZone: 'UTC',
    }),
    count: items.length,
    titles: items.map((i) => i.title),
  }))

  const done: DoneTask[] = dueQueue
    .filter((item) => {
      if (!item.lastReviewAt) return false
      const age = today - floorDay(Date.parse(item.lastReviewAt))
      return age >= 0 && age <= DONE_WINDOW_DAYS * MS_PER_DAY
    })
    .sort((a, b) => (b.lastReviewAt ?? '').localeCompare(a.lastReviewAt ?? ''))
    .slice(0, DONE_LIMIT)
    .map((item) => {
      const at = floorDay(Date.parse(item.lastReviewAt!))
      const daysAgo = Math.round((today - at) / MS_PER_DAY)
      return {
        conceptKey: item.conceptKey,
        title: item.title,
        strand: item.strand,
        label: new Date(at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }),
        daysAgo,
      }
    })

  return {
    strip,
    due,
    overdueCount: due.filter((d) => d.daysLate > 0).length,
    upcoming,
    upcomingTotal: futureDays.reduce((a, [, items]) => a + items.length, 0),
    done,
    ready: dueQueue.length > 0,
  }
}

/** "3 days late" / "due today" — the one place that phrasing is decided. */
export function lateLabel(daysLate: number): string {
  if (daysLate <= 0) return 'due today'
  return daysLate === 1 ? '1 day late' : `${daysLate} days late`
}

/** "today" / "yesterday" / "3 days ago". */
export function agoLabel(daysAgo: number): string {
  if (daysAgo <= 0) return 'today'
  return daysAgo === 1 ? 'yesterday' : `${daysAgo} days ago`
}
