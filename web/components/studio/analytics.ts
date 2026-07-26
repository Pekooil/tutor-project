import type { DashboardActivityDay, DashboardData } from '@/lib/learning/dashboard-read'
import type { MasteryTrendDay } from '@/lib/learning/analytics-read'

// The Progress tab's derivations. Everything here is a PURE function of the two
// server reads (`loadDashboard` + `loadMasteryTrend`) plus an explicit `now`, so
// every number is unit-testable without a database and the screen can stay a
// thin renderer.
//
// One rule governs the file, and it is the reason the shapes below carry so many
// `| null`s: **nothing is invented.** Every value traces to a real row. Where the
// data cannot support a number the derivation returns null and the screen says
// so in words — it never interpolates a missing day, estimates a figure, or
// pads a sample to reach a threshold.

const MS_PER_DAY = 86_400_000

function dayStr(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

function dayMs(day: string): number {
  return Date.parse(`${day}T00:00:00Z`)
}

/** The UTC calendar day `ms` falls in, as epoch ms at midnight. */
function floorDay(ms: number): number {
  return dayMs(dayStr(ms))
}

// ─────────────────────────────────────────────────────────────────────────────
// The input the screen derives from — the plain, serialisable payload the server
// page hands the client component.
// ─────────────────────────────────────────────────────────────────────────────

export type AnalyticsInput = {
  dashboard: DashboardData
  trend: MasteryTrendDay[]
  /** The server's `now`, so SSR and hydration derive identical values. */
  nowIso: string
}

// ─────────────────────────────────────────────────────────────────────────────
// The progress score
//
// One 0-100 number, and it is a CONSTRUCT — so the design never shows it alone.
// The three signals it is made of are always rendered beneath it, and a plain
// sentence spells out the arithmetic, because a score a student cannot take
// apart is a score they cannot act on.
//
// The three answer three different questions, which is why any one alone would
// mislead:
//   · mastery     — "how much do you actually know?"   (the durable stock)
//   · accuracy    — "how are you doing right now?"     (the recent flow)
//   · consistency — "are you showing up?"              (the habit)
//
// Weights favour mastery because it is the only signal that survives a good
// week; accuracy is noisy over a handful of turns; consistency is smallest
// because a student can study daily and still not learn.
// ─────────────────────────────────────────────────────────────────────────────

export type SignalKey = 'mastery' | 'accuracy' | 'consistency'

const WEIGHTS: Record<SignalKey, number> = { mastery: 0.5, accuracy: 0.3, consistency: 0.2 }

/** Rolling window for the two time-based signals. Two weeks is long enough to
 *  survive one bad session and short enough to still mean "right now". */
const WINDOW_DAYS = 14

/** Unlock thresholds. Below these a signal is `null` rather than a number
 *  computed off a sample too small to mean anything. */
const MIN_GRADED_TURNS = 8
const MIN_PRACTISED_CONCEPTS = 3
const MIN_HISTORY_DAYS = 7

/** Studying 5 days in 7 reads as full marks — the target is a sustainable
 *  habit, not a perfect-attendance record no one keeps. */
const CONSISTENCY_TARGET_PER_WEEK = 5

/** The sparkline needs enough real snapshot days to be a line and not a hint. */
const MIN_TREND_POINTS = 4

/** A signal at or above this is not what is holding the score back. */
const STRONG_SIGNAL = 75

export type Signal = {
  key: SignalKey
  label: string
  /** 0-100, or null when the data cannot support the number honestly. */
  value: number | null
  weight: number
  /** Shown in place of the bar when `value` is null. */
  unlock: string
}

export type ProgressScore = {
  /** 0-100, or null when not one signal has unlocked. */
  score: number | null
  /** Change vs. the same score seven days ago. Null unless every signal in
   *  today's score also had a value then — a delta between two different
   *  formulas is worse than no delta. */
  delta: number | null
  signals: Signal[]
  /** How many of the three signals the score currently rests on. */
  used: number
  /** The weakest live signal — the one the narrative names. */
  limiting: SignalKey | null
  /** The lead paragraph, split so the middle clause can be emphasised. */
  narrative: { lead: string; emphasis: string; tail: string }
  /** The plain-language arithmetic, shown under the signal bars. */
  scoreMath: string
  /** Score-over-time, one point per day with a real mastery snapshot. Null
   *  below `MIN_TREND_POINTS`. */
  series: { day: string; score: number }[] | null
  /** First and last point of `series`, for the "58 → 71" caption. */
  range: { from: number; to: number } | null
}

type RawSignals = Record<SignalKey, number | null>

/** Weighted mean over the signals that HAVE a value, weights renormalised over
 *  that subset. A missing signal must not drag the score toward zero — the
 *  screen instead discloses how many signals are in play. */
function combine(raw: RawSignals, only?: Set<SignalKey>): { score: number | null; used: number } {
  let weighted = 0
  let weight = 0
  let used = 0
  for (const key of Object.keys(WEIGHTS) as SignalKey[]) {
    if (only && !only.has(key)) continue
    const value = raw[key]
    if (value === null) continue
    weighted += value * WEIGHTS[key]
    weight += WEIGHTS[key]
    used += 1
  }
  if (weight === 0) return { score: null, used: 0 }
  return { score: Math.round(weighted / weight), used }
}

function windowDays(activity: DashboardActivityDay[], endDayMs: number, span: number): DashboardActivityDay[] {
  const startMs = endDayMs - (span - 1) * MS_PER_DAY
  return activity.filter((d) => {
    const ms = dayMs(d.day)
    return ms >= startMs && ms <= endDayMs
  })
}

/** Credit-weighted accuracy: a partial answer is genuinely half-right, and
 *  scoring it as a miss would punish the exact "nearly there" turns the tutor is
 *  designed to produce. `none` turns carry no grade and are excluded. */
function accuracyOf(days: DashboardActivityDay[]): { value: number | null; graded: number; partial: number } {
  let credit = 0
  let graded = 0
  let partial = 0
  for (const d of days) {
    credit += d.correct + d.partial * 0.5
    graded += d.correct + d.partial + d.incorrect
    partial += d.partial
  }
  if (graded < MIN_GRADED_TURNS) return { value: null, graded, partial }
  return { value: Math.round((credit / graded) * 100), graded, partial }
}

function consistencyOf(
  activity: DashboardActivityDay[],
  endDayMs: number,
  span: number
): { value: number | null; active: number; target: number } {
  const target = Math.round((span * CONSISTENCY_TARGET_PER_WEEK) / 7)
  // Scanned for the MINIMUM rather than taking `activity[0]`: the read returns
  // days ascending, but a signal this load-bearing should not silently invert if
  // a caller ever hands it the other order.
  let firstMs = Infinity
  for (const d of activity) {
    if (d.sessions > 0) firstMs = Math.min(firstMs, dayMs(d.day))
  }
  // A three-day-old account is not "30% consistent" — it has no habit to measure
  // yet. Require a week of history before the signal means anything.
  if (firstMs === Infinity || endDayMs - firstMs < MIN_HISTORY_DAYS * MS_PER_DAY) {
    return { value: null, active: 0, target }
  }
  const active = windowDays(activity, endDayMs, span).filter((d) => d.sessions > 0).length
  return { value: Math.min(100, Math.round((active / target) * 100)), active, target }
}

function practisedNodes(dashboard: DashboardData) {
  return dashboard.strands.flatMap((s) => s.nodes).filter((n) => n.observationCount > 0)
}

function masteryNow(dashboard: DashboardData): { value: number | null; concepts: number } {
  const nodes = practisedNodes(dashboard)
  if (nodes.length < MIN_PRACTISED_CONCEPTS) return { value: null, concepts: nodes.length }
  const sum = nodes.reduce((acc, n) => acc + n.mastery, 0)
  return { value: Math.round((sum / nodes.length) * 100), concepts: nodes.length }
}

/** Mastery AS OF a past day, from the snapshot trend — the only honest source
 *  for a historical reading (`knowledge_nodes` holds current state only). Uses
 *  the latest snapshot on or before the day, so a day the cron missed carries
 *  the last true value forward rather than reading as a collapse. */
function masteryAt(trend: MasteryTrendDay[], asOfDayMs: number): number | null {
  let best: MasteryTrendDay | null = null
  let bestMs = -Infinity
  for (const point of trend) {
    const ms = dayMs(point.day)
    // Order-independent for the same reason as `consistencyOf` — pick the latest
    // qualifying day rather than assuming the array is ascending.
    if (ms > asOfDayMs || ms <= bestMs) continue
    if (point.concepts < MIN_PRACTISED_CONCEPTS) continue
    best = point
    bestMs = ms
  }
  return best ? Math.round(best.mastery * 100) : null
}

function signalsAt(input: AnalyticsInput, asOfDayMs: number): RawSignals {
  const { dashboard, trend } = input
  return {
    mastery: masteryAt(trend, asOfDayMs),
    accuracy: accuracyOf(windowDays(dashboard.activity, asOfDayMs, WINDOW_DAYS)).value,
    consistency: consistencyOf(dashboard.activity, asOfDayMs, WINDOW_DAYS).value,
  }
}

const SIGNAL_LABEL: Record<SignalKey, string> = {
  mastery: 'Mastery',
  accuracy: 'Accuracy',
  consistency: 'Consistency',
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`
}

export function progressScore(input: AnalyticsInput): ProgressScore {
  const { dashboard, trend } = input
  const today = floorDay(Date.parse(input.nowIso))

  const mastery = masteryNow(dashboard)
  const recent = windowDays(dashboard.activity, today, WINDOW_DAYS)
  const accuracy = accuracyOf(recent)
  const consistency = consistencyOf(dashboard.activity, today, WINDOW_DAYS)

  const raw: RawSignals = { mastery: mastery.value, accuracy: accuracy.value, consistency: consistency.value }
  const { score, used } = combine(raw)

  const signals: Signal[] = [
    {
      key: 'mastery',
      label: SIGNAL_LABEL.mastery,
      value: mastery.value,
      weight: WEIGHTS.mastery,
      unlock: `Unlocks at ${MIN_PRACTISED_CONCEPTS} tutored concepts — you have ${mastery.concepts}.`,
    },
    {
      key: 'accuracy',
      label: SIGNAL_LABEL.accuracy,
      value: accuracy.value,
      weight: WEIGHTS.accuracy,
      unlock: `Unlocks at ${MIN_GRADED_TURNS} graded answers in ${WINDOW_DAYS} days — you have ${accuracy.graded}.`,
    },
    {
      key: 'consistency',
      label: SIGNAL_LABEL.consistency,
      value: consistency.value,
      weight: WEIGHTS.consistency,
      unlock: `Unlocks after ${MIN_HISTORY_DAYS} days of history — there is not enough yet.`,
    },
  ]

  // The delta must compare like with like: recompute last week's score using
  // ONLY the signals today's score uses, and suppress it entirely if any of them
  // had no value then.
  const live = signals.filter((s) => s.value !== null)
  const liveKeys = new Set(live.map((s) => s.key))
  const priorRaw = signalsAt(input, today - 7 * MS_PER_DAY)
  const priorComplete = live.length > 0 && [...liveKeys].every((k) => priorRaw[k] !== null)
  const prior = priorComplete ? combine(priorRaw, liveKeys) : { score: null, used: 0 }
  const delta = score !== null && prior.score !== null ? score - prior.score : null

  // One point per day that has a real mastery snapshot — the only days a
  // historical score can be computed for. Days without one are absent from the
  // line, never interpolated.
  const points = trend
    .map((point) => {
      const rawAt = signalsAt(input, dayMs(point.day))
      if (![...liveKeys].every((k) => rawAt[k] !== null)) return null
      const combined = combine(rawAt, liveKeys)
      return combined.score === null ? null : { day: point.day, score: combined.score }
    })
    .filter((p): p is { day: string; score: number } => p !== null)

  // The line must END on the number printed beside it. Today's score comes from
  // live `knowledge_nodes` (decay applied at read) while the last snapshot was
  // frozen when the cron ran, so the two differ by design — and a line that
  // stops short of the headline figure reads as a bug.
  if (points.length > 0 && score !== null) {
    const todayStr = dayStr(today)
    if (points[points.length - 1].day === todayStr) points[points.length - 1] = { day: todayStr, score }
    else points.push({ day: todayStr, score })
  }
  const series = points.length >= MIN_TREND_POINTS ? points : null

  const weakest = live.length > 0 ? live.reduce((a, b) => ((a.value ?? 0) <= (b.value ?? 0) ? a : b)) : null
  const limiting = weakest && (weakest.value ?? 0) < STRONG_SIGNAL ? weakest.key : null

  return {
    score,
    delta,
    signals,
    used,
    limiting,
    narrative: narrativeFor({ score, delta, live, limiting, mastery, accuracy, consistency, dashboard }),
    scoreMath: scoreMathFor(signals, mastery.concepts),
    series,
    range: series ? { from: series[0].score, to: series[series.length - 1].score } : null,
  }
}

// The lead paragraph, in three parts so the screen can emphasise the middle
// clause the way the design does. Every tail is a COUNT the student can go and
// check, never an adjective — "12 of your last 46 answers were only partly
// right" is actionable in a way "accuracy is soft" is not.
function narrativeFor(ctx: {
  score: number | null
  delta: number | null
  live: Signal[]
  limiting: SignalKey | null
  mastery: { concepts: number }
  accuracy: { graded: number; partial: number }
  consistency: { active: number; target: number }
  dashboard: DashboardData
}): { lead: string; emphasis: string; tail: string } {
  if (ctx.score === null || ctx.live.length === 0) {
    return {
      lead: 'No reading yet.',
      emphasis: 'Your score appears once Calyxa has tutored you a few times',
      tail: ' — everything on this page is built from your own sessions.',
    }
  }

  const lead =
    ctx.delta === null
      ? 'This is your first full reading.'
      : ctx.delta > 0
        ? `Up ${plural(ctx.delta, 'point')} this week.`
        : ctx.delta < 0
          ? `Down ${plural(-ctx.delta, 'point')} this week.`
          : 'Level with last week.'

  if (ctx.limiting === null) {
    return {
      lead,
      emphasis: ctx.live.length === 3 ? 'All three signals are strong' : 'Every signal in play is strong',
      tail: ' — keep the sessions coming and the score holds.',
    }
  }

  const emphasis = `${SIGNAL_LABEL[ctx.limiting]} is what's holding the number back`

  if (ctx.limiting === 'mastery') {
    const soft = ctx.dashboard.stateCounts.weak + ctx.dashboard.stateCounts.forgotten
    return {
      lead,
      emphasis,
      tail: ` — ${soft} of your ${ctx.mastery.concepts} tutored concepts still read weak or faded.`,
    }
  }
  if (ctx.limiting === 'accuracy') {
    return {
      lead,
      emphasis,
      tail: ` — ${ctx.accuracy.partial} of your last ${ctx.accuracy.graded} graded answers were only partly right.`,
    }
  }
  return {
    lead,
    emphasis,
    tail: ` — you studied ${ctx.consistency.active} of the last ${WINDOW_DAYS} days, against a target of ${ctx.consistency.target}.`,
  }
}

// The arithmetic in a sentence. When a signal has not unlocked the sentence says
// which ones are counted and what the missing one is waiting for, rather than
// describing a formula that is not the one being used.
function scoreMathFor(signals: Signal[], concepts: number): string {
  const live = signals.filter((s) => s.value !== null)
  if (live.length === 3) {
    return `Half of the score is mastery across your ${plural(concepts, 'tutored concept')}, a third is accuracy over the last ${WINDOW_DAYS} days, the rest is how often you showed up. Nothing here is estimated.`
  }
  if (live.length === 0) return 'Nothing here is estimated — the score waits until there is real work behind it.'
  const counted = live.map((s) => s.label.toLowerCase())
  const listed =
    counted.length === 1 ? counted[0] : `${counted.slice(0, -1).join(', ')} and ${counted[counted.length - 1]}`
  const missing = signals.find((s) => s.value === null)!
  return `Only ${listed} count so far, weighted between them. ${missing.unlock} Nothing here is estimated.`
}

// ─────────────────────────────────────────────────────────────────────────────
// "By subject"
// ─────────────────────────────────────────────────────────────────────────────

export type StrandRow = {
  strand: string
  label: string
  /** 0-100, decay-adjusted mean over the strand's practised concepts. */
  mastery: number
  concepts: number
  /** The strand's weakest practised concept — the one actionable link per row. */
  weakest: { conceptKey: string; title: string } | null
}

/** Strongest strand first. Strands with nothing practised are absent — an empty
 *  row would read as "you are at 0% in Calculus", which is not what an untouched
 *  strand means. */
export function strandRows(input: AnalyticsInput): StrandRow[] {
  return input.dashboard.strands
    .filter((s) => s.nodes.some((n) => n.observationCount > 0))
    .map((s) => {
      const nodes = s.nodes.filter((n) => n.observationCount > 0)
      const weakest = nodes[0] ?? null // the read already sorts weakest-first
      return {
        strand: s.strand,
        label: s.strandLabel,
        mastery: Math.round((nodes.reduce((a, n) => a + n.mastery, 0) / nodes.length) * 100),
        concepts: nodes.length,
        weakest: weakest ? { conceptKey: weakest.conceptKey, title: weakest.title } : null,
      }
    })
    .sort((a, b) => b.mastery - a.mastery)
}

// ─────────────────────────────────────────────────────────────────────────────
// "Worth doing next" — the two action cards
// ─────────────────────────────────────────────────────────────────────────────

export type DueConcept = { conceptKey: string; title: string; strand: string; overdue: boolean }

export type ReviewCard = {
  /** Concepts whose review date has arrived (overdue or due today). */
  due: DueConcept[]
  overdue: number
  /** Rough minutes for the whole queue. Display-only and labelled "about". */
  minutes: number
  /** Where "Start review" goes — the worst concept's notes, which host the quiz. */
  startHref: string | null
}

/** ~2.5 minutes of notes, cards and a few questions per concept. Display-only,
 *  and the design labels it "about" for exactly that reason. */
function reviewMinutes(count: number): number {
  return count === 0 ? 0 : Math.max(3, Math.round(count * 2.5))
}

export function reviewCard(input: AnalyticsInput): ReviewCard {
  const today = floorDay(Date.parse(input.nowIso))
  const due = input.dashboard.dueQueue
    .filter((item) => floorDay(Date.parse(item.dueAt)) <= today)
    .sort((a, b) => Number(b.overdue) - Number(a.overdue) || b.lapses - a.lapses || a.dueAt.localeCompare(b.dueAt))
    .map((item) => ({
      conceptKey: item.conceptKey,
      title: item.title,
      strand: item.strand,
      overdue: item.overdue,
    }))

  return {
    due,
    overdue: due.filter((d) => d.overdue).length,
    minutes: reviewMinutes(due.length),
    startHref: due[0] ? `/notes/${encodeURIComponent(due[0].conceptKey)}` : null,
  }
}

export type OpenGap = {
  id: string
  title: string
  /** The concept it sits under. */
  concept: string
  /** The student-facing description of the wrong idea. */
  description: string
  occurrenceCount: number
  /** Correct answers in a row since; `CLOSES_AT` closes it. */
  consecutiveCorrect: number
  /** `pending` = seen once and being watched; `active` = a confirmed pattern. */
  status: 'pending' | 'active'
}

export type GapsCard = {
  open: OpenGap[]
  resolved: number
}

/** Three right in a row retires a misconception (`lib/learning/apply.ts`). The
 *  screen draws exactly this many dots, so the count is shared rather than
 *  hard-coded twice. */
export const CLOSES_AT_CONSECUTIVE_CORRECT = 3

export function gapsCard(input: AnalyticsInput): GapsCard {
  const all = input.dashboard.misconceptions
  const open: OpenGap[] = all
    .filter((m) => m.status !== 'resolved')
    .map((m) => ({
      id: m.id,
      title: m.title,
      concept: m.title,
      description: m.description || m.category.replace(/[-_]/g, ' '),
      occurrenceCount: m.occurrenceCount,
      consecutiveCorrect: m.consecutiveCorrect,
      status: m.status as 'pending' | 'active',
    }))
    // Confirmed before watched, then by how stubborn it is — the order a student
    // should work them in.
    .sort(
      (a, b) =>
        Number(b.status === 'active') - Number(a.status === 'active') || b.occurrenceCount - a.occurrenceCount
    )

  return { open, resolved: all.filter((m) => m.status === 'resolved').length }
}

// ─────────────────────────────────────────────────────────────────────────────
// The footer line
// ─────────────────────────────────────────────────────────────────────────────

export type FooterStats = {
  conceptsTutored: number
  /** Study days within the last 7, inclusive of today. */
  studiedLast7: number
  /** Longest run of consecutive study days over the WHOLE history. */
  bestStreak: number
}

export function footerStats(input: AnalyticsInput): FooterStats {
  const today = floorDay(Date.parse(input.nowIso))
  const studied = new Set(input.dashboard.activity.filter((d) => d.sessions > 0).map((d) => d.day))

  let studiedLast7 = 0
  for (let i = 0; i < 7; i++) {
    if (studied.has(dayStr(today - i * MS_PER_DAY))) studiedLast7 += 1
  }

  let bestStreak = 0
  let run = 0
  const sorted = [...studied].sort()
  for (let i = 0; i < sorted.length; i++) {
    run = i > 0 && dayMs(sorted[i]) - dayMs(sorted[i - 1]) === MS_PER_DAY ? run + 1 : 1
    bestStreak = Math.max(bestStreak, run)
  }

  return { conceptsTutored: practisedNodes(input.dashboard).length, studiedLast7, bestStreak }
}

// ─────────────────────────────────────────────────────────────────────────────

export type ProgressData = {
  progress: ProgressScore
  strands: StrandRow[]
  review: ReviewCard
  gaps: GapsCard
  footer: FooterStats
  /** True when there is nothing real to show — the screen renders the single
   *  "Nothing to show yet" card rather than a page of empty shells. */
  cold: boolean
}

export function progressData(input: AnalyticsInput): ProgressData {
  const progress = progressScore(input)
  const strands = strandRows(input)
  const review = reviewCard(input)
  const gaps = gapsCard(input)
  const footer = footerStats(input)
  return {
    progress,
    strands,
    review,
    gaps,
    footer,
    cold:
      progress.score === null &&
      strands.length === 0 &&
      review.due.length === 0 &&
      gaps.open.length === 0 &&
      gaps.resolved === 0,
  }
}
