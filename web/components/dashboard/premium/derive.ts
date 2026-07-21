import type { DashboardData, DashboardMisconception } from '@/lib/learning/dashboard-read'
import type { MasteryState } from '@/lib/ai/profile'
import { pct, strandStyle, C } from './theme'

// Pure view-model derivations that shape the real `loadDashboard` data into the
// premium design's screens. No 'server-only' here so the Mastery client screen
// can import the same node-formatting helpers. Dates are handled in UTC to match
// loadDashboard's UTC day buckets (activity.day / mastery_snapshot.day).

const MS_PER_DAY = 86_400_000

function utcDayStr(d: Date): string {
  return d.toISOString().slice(0, 10)
}
function parseUtcDay(s: string): number {
  return new Date(s + 'T00:00:00Z').getTime()
}
function wholeDaysBetween(fromIso: string, toIso: string): number {
  return Math.round((new Date(toIso).getTime() - new Date(fromIso).getTime()) / MS_PER_DAY)
}

// ── Greeting / date ────────────────────────────────────────────────────────

export function greeting(now: Date): string {
  const h = now.getHours()
  if (h < 12) return 'Good morning'
  if (h < 18) return 'Good afternoon'
  return 'Good evening'
}

export function longDate(now: Date): string {
  return now.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })
}

// ── Overview: stat strip ───────────────────────────────────────────────────

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

// ── Overview: "Practice next" (active misconceptions to work through) ───────

export type PracticeRow = {
  id: string
  conceptKey: string
  title: string
  sub: string
  streak: string
}

function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' })
}

// Active misconceptions, most-recurring first, as the Overview's practice list.
// The caller resolves each row's study-kit href (server-only helper) — this
// pure derivation only shapes the display fields.
export function practiceNext(data: DashboardData, limit = 5): PracticeRow[] {
  return data.misconceptions
    .filter((m) => m.status === 'active')
    .slice(0, limit)
    .map((m) => {
      const filled = Math.min(RESOLUTION_STREAK, Math.max(0, m.consecutiveCorrect))
      const category = m.category ? m.category.charAt(0).toUpperCase() + m.category.slice(1) : 'Pattern'
      return {
        id: m.id,
        conceptKey: m.conceptKey,
        title: m.title,
        sub: `${strandStyle(m.strand).short} · ${category} · seen ${m.occurrenceCount}×`,
        streak: `${filled} of ${RESOLUTION_STREAK}`,
      }
    })
}

// ── Overview: mastery-by-strand mini list ──────────────────────────────────

export type OvStrandRow = {
  short: string
  color: string
  width: string
  pct: string
  rowBg: string
  pctBg: string
  pctColor: string
  delay: string
}

export function ovStrands(data: DashboardData): { rows: OvStrandRow[]; attention: string | null } {
  const withAvg = data.strands.map((s) => ({
    short: strandStyle(s.strand).short,
    color: strandStyle(s.strand).color,
    avg: pct(s.averageMastery),
    empty: s.nodes.length === 0,
  }))
  const sorted = [...withAvg].sort((a, b) => b.avg - a.avg)
  // Weakest non-empty strand gets the highlight + attention line.
  const nonEmpty = sorted.filter((s) => !s.empty)
  const weakest = nonEmpty.length > 0 ? nonEmpty[nonEmpty.length - 1] : null
  const rows = sorted.map((s, i) => {
    const isWeakest = weakest != null && s.short === weakest.short
    return {
      short: s.short,
      color: s.color,
      width: s.avg + '%',
      pct: s.avg + '%',
      rowBg: isWeakest ? 'rgba(146,64,14,.05)' : 'transparent',
      pctBg: isWeakest ? 'rgba(146,64,14,.09)' : 'rgba(28,28,26,.05)',
      pctColor: isWeakest ? '#92400e' : '#1c1c1a',
      delay: (0.35 + i * 0.08).toFixed(2) + 's',
    }
  })
  return { rows, attention: weakest ? `${weakest.short} needs the most attention` : null }
}

// ── Overview: recent activity feed (derived from real events) ──────────────

export type ActivityEvent = {
  key: string
  tag: string
  tagBg: string
  tagColor: string
  title: string
  detail: string
  when: string
  ts: number
}

export function recentActivity(data: DashboardData): ActivityEvent[] {
  const events: ActivityEvent[] = []

  // Recent study days.
  for (const day of data.activity.slice(-6)) {
    const graded = day.correct + day.partial + day.incorrect
    events.push({
      key: 'sess-' + day.day,
      tag: 'Session',
      tagBg: C.greenBg,
      tagColor: C.greenInk,
      title: `${day.sessions} session${day.sessions === 1 ? '' : 's'}`,
      detail: `${graded} answered · ${day.correct} correct`,
      when: shortDate(day.day),
      ts: parseUtcDay(day.day),
    })
  }

  // Mastered concepts (most recently practiced first).
  const mastered = data.strands
    .flatMap((s) => s.nodes)
    .filter((n) => n.state === 'mastered' && n.lastPracticedAt)
    .sort((a, b) => (b.lastPracticedAt ?? '').localeCompare(a.lastPracticedAt ?? ''))
    .slice(0, 3)
  for (const n of mastered) {
    events.push({
      key: 'mast-' + n.conceptKey,
      tag: 'Mastered',
      tagBg: 'rgba(134,239,172,.3)',
      tagColor: C.greenDeep,
      title: n.title,
      detail: `After ${n.observationCount} observations`,
      when: shortDate(n.lastPracticedAt!),
      ts: new Date(n.lastPracticedAt!).getTime(),
    })
  }

  // Misconceptions: resolved + active-with-streak.
  for (const m of data.misconceptions) {
    if (m.status === 'resolved' && m.resolvedAt) {
      events.push({
        key: 'res-' + m.conceptKey,
        tag: 'Resolved',
        tagBg: 'rgba(134,239,172,.3)',
        tagColor: C.greenDeep,
        title: m.title,
        detail: `After ${m.occurrenceCount} occurrences`,
        when: shortDate(m.resolvedAt),
        ts: new Date(m.resolvedAt).getTime(),
      })
    } else if (m.status === 'active' && m.consecutiveCorrect > 0) {
      events.push({
        key: 'streak-' + m.conceptKey,
        tag: 'Streak',
        tagBg: 'rgba(146,64,14,.09)',
        tagColor: C.amber,
        title: m.title,
        detail: `Corrected ${m.consecutiveCorrect} in a row — ${4 - m.consecutiveCorrect} more to resolve`,
        when: shortDate(m.lastSeenAt),
        ts: new Date(m.lastSeenAt).getTime(),
      })
    }
  }

  return events.sort((a, b) => b.ts - a.ts).slice(0, 5)
}

// ── Overview: month calendar ───────────────────────────────────────────────

export type CalCell = {
  n: string
  today: boolean
  bg: string
  color: string
  weight: number
  studiedDot: boolean
}

export function monthCalendar(data: DashboardData, now: Date): { cells: CalCell[]; footer: string } {
  const year = now.getUTCFullYear()
  const month = now.getUTCMonth()
  const first = new Date(Date.UTC(year, month, 1))
  const firstDow = first.getUTCDay()
  const todayN = now.getUTCDate()

  const studied = new Set(
    data.activity.filter((d) => d.sessions > 0 && d.day.startsWith(utcDayStr(first).slice(0, 7))).map((d) => Number(d.day.slice(8, 10)))
  )

  const cells: CalCell[] = []
  for (let i = 0; i < 42; i++) {
    const d = new Date(Date.UTC(year, month, 1 - firstDow + i))
    const n = d.getUTCDate()
    const inMonth = d.getUTCMonth() === month
    const isToday = inMonth && n === todayN
    const s = inMonth && studied.has(n)
    cells.push({
      n: String(n),
      today: isToday,
      bg: s && !isToday ? 'rgba(134,239,172,.2)' : 'transparent',
      color: !inMonth ? '#c9c7c0' : isToday || s ? '#14532d' : '#1c1c1a',
      weight: isToday ? 600 : s ? 500 : 400,
      studiedDot: s,
    })
  }
  return {
    cells,
    footer: `${studied.size} study day${studied.size === 1 ? '' : 's'} this month`,
  }
}

// ── Overview: concept-state donut ──────────────────────────────────────────

const DONUT_ORDER: { state: MasteryState; color: string }[] = [
  { state: 'mastered', color: '#166534' },
  { state: 'learning', color: '#2563eb' },
  { state: 'weak', color: '#92400e' },
  { state: 'forgotten', color: '#b91c1c' },
]

export type ConceptStates = {
  practiced: number
  total: number
  notCovered: number
  gradient: string
  legend: { label: string; count: number; dot: string; chipBg: string; chipColor: string }[]
}

export function conceptStates(data: DashboardData, totalCurriculum: number): ConceptStates {
  const counts = data.stateCounts
  const practiced = counts.mastered + counts.learning + counts.weak + counts.forgotten
  const segs = DONUT_ORDER.map((d) => ({ ...d, count: counts[d.state] }))
  let acc = 0
  const stops: string[] = []
  for (const seg of segs) {
    const frac = practiced > 0 ? seg.count / practiced : 0
    const start = (acc * 360).toFixed(1)
    acc += frac
    const end = (acc * 360).toFixed(1)
    stops.push(`${seg.color} ${start}deg ${end}deg`)
  }
  const gradient =
    practiced > 0 ? `conic-gradient(${stops.join(', ')})` : 'conic-gradient(rgba(28,28,26,.07) 0 360deg)'

  const legend = [
    { label: 'Mastered', count: counts.mastered, dot: '#166534', chipBg: 'rgba(134,239,172,.3)', chipColor: '#14532d' },
    { label: 'Learning', count: counts.learning, dot: '#2563eb', chipBg: 'rgba(37,99,235,.08)', chipColor: '#2563eb' },
    { label: 'Weak', count: counts.weak, dot: '#92400e', chipBg: 'rgba(146,64,14,.09)', chipColor: '#92400e' },
    { label: 'Forgotten', count: counts.forgotten, dot: '#b91c1c', chipBg: '#fef2f2', chipColor: '#b91c1c' },
  ]

  return {
    practiced,
    total: totalCurriculum,
    notCovered: Math.max(0, totalCurriculum - practiced),
    gradient,
    legend,
  }
}

// ── Mastery: per-node meta (shared with the client sort screen) ────────────

export function nodeMeta(obs: number, band: string, lastPracticedAt: string | null, now: Date): string {
  if (obs === 0) return 'Not practiced yet'
  let ld = ''
  if (lastPracticedAt) {
    const days = wholeDaysBetween(lastPracticedAt, now.toISOString())
    ld = days <= 0 ? 'today' : days === 1 ? 'yesterday' : `${days} d ago`
  }
  return `${obs} obs · ${band} confidence${ld ? ' · ' + ld : ''}`
}

// ── Misconceptions ─────────────────────────────────────────────────────────

// Consecutive-correct answers that resolve a misconception — mirrors
// RESOLUTION_STREAK in lib/learning/apply.ts (3). Kept as a literal here so this
// pure module stays client-importable (apply.ts is server-only).
export const RESOLUTION_STREAK = 3

export type MiscCard = {
  id: string
  key: string
  category: string
  strandLabel: string
  strandColor: string
  strandBg: string
  title: string
  description: string
  seen: string
  dots: boolean[]
  progress: string
}

export function misconceptionCards(data: DashboardData): {
  active: MiscCard[]
  resolved: DashboardMisconception[]
  activeCount: number
  resolvedCount: number
} {
  const active = data.misconceptions
    .filter((m) => m.status === 'active')
    .map((m) => {
      const st = strandStyle(m.strand)
      const filled = Math.min(RESOLUTION_STREAK, Math.max(0, m.consecutiveCorrect))
      return {
        id: m.id,
        key: m.id,
        category: m.category ? m.category.charAt(0).toUpperCase() + m.category.slice(1) : 'Pattern',
        strandLabel: st.label,
        strandColor: st.color,
        strandBg: st.tileBg,
        title: m.title,
        description: m.description || 'A recurring error pattern Calyxa has noticed.',
        seen: `Seen ${m.occurrenceCount} time${m.occurrenceCount === 1 ? '' : 's'} · last ${shortDate(m.lastSeenAt)}`,
        dots: Array.from({ length: RESOLUTION_STREAK }, (_, i) => i < filled),
        progress: `${filled} of ${RESOLUTION_STREAK}`,
      }
    })
  const resolved = data.misconceptions.filter((m) => m.status === 'resolved')
  return { active, resolved, activeCount: active.length, resolvedCount: resolved.length }
}

export function resolvedLine(m: DashboardMisconception): string {
  const when = m.resolvedAt ? shortDate(m.resolvedAt) : '—'
  return `Resolved ${when} · after ${m.occurrenceCount} occurrences`
}

// ── Activity ───────────────────────────────────────────────────────────────

function heatColor(sessions: number): string {
  if (sessions <= 0) return 'rgba(28,28,26,.06)'
  if (sessions === 1) return '#bbf7d0'
  if (sessions === 2) return '#4ade80'
  return '#1f9d5b'
}

export function heatmap(data: DashboardData, now: Date): string[] {
  // 12 columns (weeks) × 7 rows (days), oldest→newest, ending this week.
  const byDay = new Map(data.activity.map((d) => [d.day, d.sessions]))
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  const todayDow = today.getUTCDay()
  // Column-major (12 weeks × 7 days). The final column's bottom-most filled row
  // is today's weekday; each cell is `backFromToday` days before today.
  const cells: string[] = []
  for (let w = 0; w < 12; w++) {
    for (let r = 0; r < 7; r++) {
      const backFromToday = (11 - w) * 7 + (todayDow - r)
      if (backFromToday < 0) {
        cells.push('transparent')
        continue
      }
      const d = new Date(today.getTime() - backFromToday * MS_PER_DAY)
      const sessions = byDay.get(utcDayStr(d)) ?? 0
      cells.push(heatColor(sessions))
    }
  }
  return cells
}

export type AnswerBar = { hc: string; hp: string; hi: string; hs: string; label: string }

export function answerBars(data: DashboardData, now: Date): AnswerBar[] {
  const byDay = new Map(data.activity.map((d) => [d.day, d]))
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  const bars: AnswerBar[] = []
  for (let o = 13; o >= 0; o--) {
    const d = new Date(today.getTime() - o * MS_PER_DAY)
    const dayStr = utcDayStr(d)
    const row = byDay.get(dayStr)
    const px = (v: number) => (v === 0 ? '0px' : Math.max(6, Math.round(v * 8.5)) + 'px')
    bars.push({
      hc: row ? px(row.correct) : '0px',
      hp: row ? px(row.partial) : '0px',
      hi: row ? px(row.incorrect) : '0px',
      hs: row && row.correct + row.partial + row.incorrect > 0 ? '0px' : '3px',
      label: o % 2 === 1 ? d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' }) : '',
    })
  }
  return bars
}

// ── Continue Learning dashboard (the "what should I learn next" surface) ─────
//
// The new post-login dashboard is action-oriented, not analytics-oriented: the
// adaptive scheduler (`reinforcement_schedule` → data.dueQueue) drives a "Today's
// Review" queue of CONCEPTS, weakest concepts get quick-review cards, and the old
// month-calendar is replaced by a forward-looking "Upcoming reviews" list. These
// are pure view-model derivations over the same `loadDashboard` read.

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

export type UpcomingBucket = { label: string; count: number; concepts: string[] }

// Forward-looking review schedule grouped into day buckets (Today / Tomorrow /
// weekday / date) — the replacement for the month calendar. Overdue items fold
// into "Today". Returns up to `maxBuckets` non-empty buckets in chronological
// order.
export function upcomingReviews(data: DashboardData, now: Date, maxBuckets = 5): UpcomingBucket[] {
  const today = parseUtcDay(utcDayStr(now))
  const byLabel = new Map<string, { order: number; concepts: string[] }>()
  for (const d of data.dueQueue) {
    const due = parseUtcDay(utcDayStr(new Date(d.dueAt)))
    const diff = Math.round((due - today) / MS_PER_DAY)
    const order = Math.max(0, diff) // overdue and today share order 0
    const label =
      diff <= 0
        ? 'Today'
        : diff === 1
          ? 'Tomorrow'
          : diff <= 6
            ? new Date(d.dueAt).toLocaleDateString(undefined, { weekday: 'long', timeZone: 'UTC' })
            : new Date(d.dueAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' })
    const bucket = byLabel.get(label)
    if (bucket) bucket.concepts.push(d.title)
    else byLabel.set(label, { order, concepts: [d.title] })
  }
  return [...byLabel.entries()]
    .sort((a, b) => a[1].order - b[1].order)
    .slice(0, maxBuckets)
    .map(([label, b]) => ({ label, count: b.concepts.length, concepts: b.concepts }))
}

export type WeekBar = { height: number; label: string; current: boolean }

export function sessionsPerWeek(data: DashboardData, now: Date): WeekBar[] {
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  const dow = today.getUTCDay()
  const thisWeekStart = new Date(today.getTime() - dow * MS_PER_DAY)
  const weeks: { start: Date; sessions: number }[] = []
  for (let w = 5; w >= 0; w--) {
    weeks.push({ start: new Date(thisWeekStart.getTime() - w * 7 * MS_PER_DAY), sessions: 0 })
  }
  for (const day of data.activity) {
    const t = parseUtcDay(day.day)
    for (const wk of weeks) {
      const s = wk.start.getTime()
      if (t >= s && t < s + 7 * MS_PER_DAY) {
        wk.sessions += day.sessions
        break
      }
    }
  }
  const max = Math.max(1, ...weeks.map((w) => w.sessions))
  return weeks.map((wk, i) => ({
    height: Math.round((wk.sessions / max) * 112) || 4,
    label:
      i === weeks.length - 1
        ? 'This wk'
        : wk.start.toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' }),
    current: i === weeks.length - 1,
  }))
}
