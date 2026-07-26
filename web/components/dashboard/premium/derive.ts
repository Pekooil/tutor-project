import type { DashboardData } from '@/lib/learning/dashboard-read'
import { strandStyle } from './theme'

// Pure view-model derivations that shape the real `loadDashboard` data into the
// dashboard home's one daily-loop surface (the "Today's Review" queue,
// weakest concepts). Dates are handled in UTC to match loadDashboard's UTC day
// buckets (activity.day / mastery_snapshot.day). No 'server-only' so client
// screens can share these helpers.

const MS_PER_DAY = 86_400_000

function utcDayStr(d: Date): string {
  return d.toISOString().slice(0, 10)
}
function parseUtcDay(s: string): number {
  return new Date(s + 'T00:00:00Z').getTime()
}

// ── Date ───────────────────────────────────────────────────────────────────
//
// `greeting()` ("Good morning" / "Good afternoon" / "Good evening") lived here
// and is deliberately gone: the studio's page headings are plain tab names now
// ("Dashboard", "Progress"), not time-of-day copy addressed to the student.

export function longDate(now: Date): string {
  return now.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })
}

// ── Header stats (accuracy · streak · mastered) ────────────────────────────

export type OverviewStats = {
  mastered: number
  masteredSub: string
  activeMisconceptions: number
  accuracy: number | null
  accuracySub: string
  streak: number
  streakSince: string | null
}

export function overviewStats(data: DashboardData): OverviewStats {
  const activeMisconceptions = data.misconceptions.filter((m) => m.status === 'active').length

  // Accuracy over the last 14 activity days.
  const recent = data.activity.slice(-14)
  let correct = 0
  let graded = 0
  for (const day of recent) {
    correct += day.correct
    graded += day.correct + day.partial + day.incorrect
  }
  const accuracy = graded > 0 ? Math.round((correct / graded) * 100) : null

  // Streak: consecutive study days ending on the most recent activity day.
  const studied = new Set(data.activity.filter((d) => d.sessions > 0).map((d) => d.day))
  let streak = 0
  let streakSince: string | null = null
  if (studied.size > 0) {
    const days = [...studied].sort()
    let cursor = parseUtcDay(days[days.length - 1])
    while (studied.has(utcDayStr(new Date(cursor)))) {
      streak++
      streakSince = utcDayStr(new Date(cursor))
      cursor -= MS_PER_DAY
    }
  }

  return {
    mastered: data.stateCounts.mastered,
    masteredSub: `${data.totalConcepts} practiced`,
    activeMisconceptions,
    accuracy,
    accuracySub: graded > 0 ? `over ${graded} recent` : 'no answers yet',
    streak,
    streakSince,
  }
}

// ── Today's Review + weakest concepts (the daily loop) ──────────────────────
//
// The dashboard home is action-oriented: the adaptive scheduler
// (`reinforcement_schedule` → data.dueQueue) drives a "Today's Review" queue of
// CONCEPTS, and the weakest practiced concepts get quick-review cards. Pure
// view-model derivations over the same `loadDashboard` read.

/** A concept-level review target used across the dashboard's action surfaces. */
export type ReviewConcept = {
  conceptKey: string
  title: string
  strand: string
  strandShort: string
  strandColor: string
  /** Decay-adjusted mastery in [0,1], or null when the concept is unpracticed. */
  mastery: number | null
  /** ISO due date from the reinforcement schedule, or null when unscheduled. */
  dueAt: string | null
  /** True when due_at has passed. */
  overdue: boolean
}

// A conceptKey → decay-adjusted mastery lookup across every strand's nodes.
function masteryByKey(data: DashboardData): Map<string, number> {
  const map = new Map<string, number>()
  for (const s of data.strands) for (const n of s.nodes) map.set(n.conceptKey, n.mastery)
  return map
}

// Human "when is this due" label, relative to `now` (UTC-day granularity).
export function relativeDueLabel(dueAtIso: string | null, now: Date): string {
  if (!dueAtIso) return 'Not scheduled'
  const today = parseUtcDay(utcDayStr(now))
  const due = parseUtcDay(utcDayStr(new Date(dueAtIso)))
  const diff = Math.round((due - today) / MS_PER_DAY)
  if (diff < 0) return diff === -1 ? 'Due yesterday' : `Overdue ${-diff} days`
  if (diff === 0) return 'Due today'
  if (diff === 1) return 'Tomorrow'
  if (diff <= 6) return new Date(dueAtIso).toLocaleDateString(undefined, { weekday: 'long', timeZone: 'UTC' })
  return new Date(dueAtIso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' })
}

// A rough "how long will this take" estimate for the review queue — ~2.5 min of
// notes + flashcards + a few questions per concept. Display-only.
export function reviewMinutes(count: number): number {
  return count === 0 ? 0 : Math.max(3, Math.round(count * 2.5))
}

function reviewConcept(item: DashboardData['dueQueue'][number], mByKey: Map<string, number>): ReviewConcept {
  const st = strandStyle(item.strand)
  const m = mByKey.get(item.conceptKey)
  return {
    conceptKey: item.conceptKey,
    title: item.title,
    strand: item.strand,
    strandShort: st.short,
    strandColor: st.color,
    mastery: m ?? null,
    dueAt: item.dueAt,
    overdue: item.overdue,
  }
}

// "Today's Review": concepts whose review date has arrived (overdue or due
// today), overdue-first then soonest-due. This is the dominant dashboard action.
export function todaysReview(data: DashboardData, now: Date): ReviewConcept[] {
  const mByKey = masteryByKey(data)
  const todayEnd = parseUtcDay(utcDayStr(now)) + MS_PER_DAY // exclusive end of today (UTC)
  return data.dueQueue
    .filter((d) => parseUtcDay(utcDayStr(new Date(d.dueAt))) < todayEnd)
    .sort((a, b) => Number(b.overdue) - Number(a.overdue) || a.dueAt.localeCompare(b.dueAt))
    .map((d) => reviewConcept(d, mByKey))
}

// The weakest practiced concepts (decay-adjusted mastery ascending), each
// annotated with its next review date when the scheduler has one. Powers the
// "Weakest concepts" quick-review cards.
export function weakestConcepts(data: DashboardData, limit = 5): ReviewConcept[] {
  const dueByKey = new Map(data.dueQueue.map((d) => [d.conceptKey, d]))
  return data.strands
    .flatMap((s) => s.nodes)
    .filter((n) => n.observationCount > 0)
    .sort((a, b) => a.mastery - b.mastery)
    .slice(0, limit)
    .map((n) => {
      const st = strandStyle(n.strand)
      const due = dueByKey.get(n.conceptKey)
      return {
        conceptKey: n.conceptKey,
        title: n.title,
        strand: n.strand,
        strandShort: st.short,
        strandColor: st.color,
        mastery: n.mastery,
        dueAt: due?.dueAt ?? null,
        overdue: due?.overdue ?? false,
      }
    })
}
