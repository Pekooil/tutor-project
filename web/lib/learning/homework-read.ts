import type { SupabaseClient } from '@supabase/supabase-js'

// The Studio v4 dashboard's homework reads (ADR-047's discipline: RLS-scoped,
// server-rendered, per-request-fresh, no cache).
//
// Everything here is a read of `homework_session` (migration 0029) — the mirror
// the extension pushes when a set completes or pauses. The extension's local
// store remains the source of truth for a LIVE set; this is what the web app is
// allowed to know about.

export type HomeworkOutcome = 'ok' | 'shaky' | 'tutored'

export type HomeworkProblem = {
  index: number
  label: string
  outcome: HomeworkOutcome
  seconds: number
  pageGrade?: 'correct' | 'incorrect'
}

export type HomeworkSessionRow = {
  id: string
  tutoringSessionId: string | null
  title: string | null
  concept: string | null
  denominator: number
  graded: boolean
  status: 'active' | 'paused' | 'complete'
  problems: HomeworkProblem[]
  totalSeconds: number
  longestUnaidedRun: number
  startedAt: string
  endedAt: string | null
}

const COLUMNS =
  'id, tutoring_session_id, title, concept, denominator, graded, status, problems, total_seconds, longest_unaided_run, started_at, ended_at'

const OUTCOMES: readonly string[] = ['ok', 'shaky', 'tutored']

/**
 * Defensive unwrap of the jsonb column. `problems` is written by the sync route
 * from an already-validated payload, but it is still jsonb — a row written by
 * an older extension build must degrade to a shorter timeline, never crash a
 * server render.
 */
function parseProblems(raw: unknown, denominator: number): HomeworkProblem[] {
  if (!Array.isArray(raw)) return []
  const problems: HomeworkProblem[] = []
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue
    const { index, label, outcome, seconds, pageGrade } = entry as Record<string, unknown>
    if (typeof index !== 'number' || index < 0 || index >= denominator) continue
    if (typeof outcome !== 'string' || !OUTCOMES.includes(outcome)) continue
    problems.push({
      index,
      label: typeof label === 'string' && label ? label : String(index + 1),
      outcome: outcome as HomeworkOutcome,
      seconds: typeof seconds === 'number' && seconds >= 0 ? seconds : 0,
      ...(pageGrade === 'correct' || pageGrade === 'incorrect' ? { pageGrade } : {}),
    })
  }
  return problems.sort((a, b) => a.index - b.index)
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function toRow(raw: any): HomeworkSessionRow {
  const denominator = Number(raw.denominator) || 0
  return {
    id: String(raw.id),
    tutoringSessionId: raw.tutoring_session_id ? String(raw.tutoring_session_id) : null,
    title: raw.title ?? null,
    concept: raw.concept ?? null,
    denominator,
    graded: raw.graded === true,
    status: raw.status,
    problems: parseProblems(raw.problems, denominator),
    totalSeconds: Number(raw.total_seconds) || 0,
    longestUnaidedRun: Number(raw.longest_unaided_run) || 0,
    startedAt: raw.started_at,
    endedAt: raw.ended_at ?? null,
  }
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/**
 * The one place a homework read touches Supabase. Returns null on ANY failure
 * — an error shape, a missing table, or a client that throws — so every caller
 * degrades to "no homework data" instead of taking its page down with it.
 */
async function safeRows(
  supabase: SupabaseClient,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  shape: (query: any) => any,
): Promise<HomeworkSessionRow[] | null> {
  try {
    const { data, error } = await shape(supabase.from('homework_session').select(COLUMNS))
    if (error || !Array.isArray(data)) return null
    return data.map(toRow)
  } catch {
    return null
  }
}

export type HomeworkDashboard = {
  /** The set to offer a resume for, or null. */
  paused: HomeworkSessionRow | null
  /** The most recently finished set — what the dashboard's summary block shows. */
  latest: HomeworkSessionRow | null
}

/**
 * The dashboard's two homework reads, in one round trip. Both come off the same
 * `(user_id, started_at desc)` index; splitting them client-side is cheaper
 * than two queries and keeps the "one paused set at a time" rule visible.
 */
export async function loadHomeworkDashboard(supabase: SupabaseClient): Promise<HomeworkDashboard> {
  // FAIL-SOFT, deliberately. The homework blocks are additive to a dashboard
  // that stood on its own before them, so a failed read here must cost the two
  // blocks and nothing else — never the review queue, the schedule, or the
  // page. The try/catch (not just the `error` check) covers a client that
  // throws rather than returning an error shape.
  const rows = await safeRows(supabase, (query) => query.order('started_at', { ascending: false }).limit(20))
  if (rows === null) return { paused: null, latest: null }

  return {
    // Only ever ONE resume offer, even if an older paused set lingers: the
    // newest is the one the student actually walked away from.
    paused: rows.find((row) => row.status === 'paused' || row.status === 'active') ?? null,
    latest: rows.find((row) => row.status === 'complete') ?? null,
  }
}

/** The History view's homework rows, newest first. */
export async function loadHomeworkHistory(
  supabase: SupabaseClient,
  limit = 40,
): Promise<HomeworkSessionRow[]> {
  return (
    (await safeRows(supabase, (query) => query.order('started_at', { ascending: false }).limit(limit))) ?? []
  )
}

/** One set, for the summary detail view. null when it isn't the caller's. */
export async function loadHomeworkSession(
  supabase: SupabaseClient,
  id: string,
): Promise<HomeworkSessionRow | null> {
  try {
    const { data, error } = await supabase.from('homework_session').select(COLUMNS).eq('id', id).maybeSingle()
    if (error || !data) return null
    return toRow(data)
  } catch {
    return null
  }
}

// ---- Derivations the views share ----------------------------------------

export type HomeworkCounts = { ok: number; shaky: number; tutored: number }

export function countsOf(row: HomeworkSessionRow): HomeworkCounts {
  return {
    ok: row.problems.filter((problem) => problem.outcome === 'ok').length,
    shaky: row.problems.filter((problem) => problem.outcome === 'shaky').length,
    tutored: row.problems.filter((problem) => problem.outcome === 'tutored').length,
  }
}

export function totalMinutes(row: HomeworkSessionRow): number {
  return Math.max(1, Math.round(row.totalSeconds / 60))
}

/**
 * The timeline's segments: width proportional to minutes spent, so a problem
 * that took six minutes is visibly six times a problem that took one.
 *
 * A zero-second row (an instant tap) still gets a floor width — a segment the
 * student cannot see is a segment that reads as a missing problem.
 */
export type TimelineSegment = HomeworkProblem & { percent: number; minutes: number }

const MIN_SEGMENT_PERCENT = 4

export function timeline(row: HomeworkSessionRow): TimelineSegment[] {
  const total = row.problems.reduce((sum, problem) => sum + Math.max(problem.seconds, 1), 0)
  if (total === 0) return []
  const raw = row.problems.map((problem) => ({
    ...problem,
    minutes: Math.max(1, Math.round(problem.seconds / 60)),
    percent: (Math.max(problem.seconds, 1) / total) * 100,
  }))
  // Re-normalise after applying the floor so the row still sums to 100%.
  const lifted = raw.map((segment) => ({ ...segment, percent: Math.max(segment.percent, MIN_SEGMENT_PERCENT) }))
  const sum = lifted.reduce((acc, segment) => acc + segment.percent, 0)
  return lifted.map((segment) => ({ ...segment, percent: (segment.percent / sum) * 100 }))
}

/**
 * The honest-scope line (spec §8), restated for the web. It must never imply
 * Calyxa graded a set it could not grade.
 */
export function scopeLine(row: HomeworkSessionRow): string {
  const { tutored } = countsOf(row)
  const worked = `${tutored} ${tutored === 1 ? 'problem' : 'problems'}`
  if (row.graded) {
    return tutored > 0
      ? `Calyxa graded only the ${worked} you worked through together — the page checked the rest.`
      : 'The page checked all of these — Calyxa graded none of them itself.'
  }
  return tutored > 0
    ? `No answer key on this page, so only the ${worked} you worked through together ${tutored === 1 ? 'is' : 'are'} verified. The rest you marked done yourself.`
    : 'No answer key on this page — completion and confidence only. You marked these done yourself.'
}

/** "38 min — 12 faster than last Tuesday", or just the time when there's no peer. */
export function comparisonLine(row: HomeworkSessionRow, history: readonly HomeworkSessionRow[]): string {
  const minutes = totalMinutes(row)
  const key = (row.concept ?? '').trim().toLowerCase()
  const prior = key
    ? history.find(
        (other) =>
          other.id !== row.id &&
          other.status === 'complete' &&
          other.denominator === row.denominator &&
          (other.concept ?? '').trim().toLowerCase() === key &&
          new Date(other.startedAt).getTime() < new Date(row.startedAt).getTime(),
      )
    : undefined

  if (!prior) return `${minutes} min`
  const delta = totalMinutes(prior) - minutes
  if (delta === 0) return `${minutes} min — same as last time`
  return delta > 0 ? `${minutes} min — ${delta} faster than last time` : `${minutes} min`
}
