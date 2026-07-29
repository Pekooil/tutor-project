// The wire shape of a synced homework session, and its validation.
//
// Pure and dependency-free so both the sync route and its tests can pin it
// without a Supabase client in the room -- the parsePageContext /
// parseStudyKit precedent.
//
// Everything here is defensive by default: this parses a body an extension
// sent, so a malformed field is REJECTED rather than coerced. The one thing
// that is never read from the body is `user_id` -- the route always uses the
// authenticated caller's id.

export const HOMEWORK_OUTCOMES = ['ok', 'shaky', 'tutored'] as const
export type HomeworkOutcome = (typeof HOMEWORK_OUTCOMES)[number]

export const HOMEWORK_STATUSES = ['active', 'paused', 'complete'] as const
export type HomeworkStatus = (typeof HOMEWORK_STATUSES)[number]

export type SyncedProblem = {
  index: number
  label: string
  outcome: HomeworkOutcome
  seconds: number
  pageGrade?: 'correct' | 'incorrect'
}

export type SyncedHomeworkSession = {
  id: string
  tutoringSessionId: string | null
  locationHash: string
  title: string | null
  concept: string | null
  denominator: number
  graded: boolean
  status: HomeworkStatus
  problems: SyncedProblem[]
  totalSeconds: number
  longestUnaidedRun: number
  startedAt: string
  endedAt: string | null
}

/** One push may carry the active set plus anything that failed to sync earlier. */
export const MAX_SESSIONS_PER_SYNC = 20
/** Matches the scanner's own MAX_PROBLEMS bound. */
const MAX_PROBLEMS = 120
const MAX_TITLE_CHARS = 200
const MAX_CONCEPT_CHARS = 120
const MAX_LABEL_CHARS = 8
/** A set that ran longer than a day is a clock bug, not homework. */
const MAX_TOTAL_SECONDS = 86_400

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function str(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed ? trimmed.slice(0, max) : null
}

function boundedInt(value: unknown, min: number, max: number): number | null {
  if (typeof value !== 'number' || !Number.isInteger(value)) return null
  return value >= min && value <= max ? value : null
}

function isoOrNull(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const time = Date.parse(value)
  return Number.isFinite(time) ? new Date(time).toISOString() : null
}

function parseProblem(raw: unknown, denominator: number): SyncedProblem | null {
  if (!raw || typeof raw !== 'object') return null
  const { index, label, outcome, seconds, pageGrade } = raw as Record<string, unknown>

  const parsedIndex = boundedInt(index, 0, denominator - 1)
  if (parsedIndex === null) return null
  if (typeof outcome !== 'string' || !(HOMEWORK_OUTCOMES as readonly string[]).includes(outcome)) return null
  const parsedSeconds = boundedInt(seconds, 0, MAX_TOTAL_SECONDS)
  if (parsedSeconds === null) return null

  return {
    index: parsedIndex,
    label: str(label, MAX_LABEL_CHARS) ?? String(parsedIndex + 1),
    outcome: outcome as HomeworkOutcome,
    seconds: parsedSeconds,
    ...(pageGrade === 'correct' || pageGrade === 'incorrect' ? { pageGrade } : {}),
  }
}

/**
 * Validates ONE session. Returns null on anything malformed -- the caller drops
 * it and keeps the rest of the batch, because one bad row in a retry queue must
 * not cost the student every other set in it.
 *
 * `problems` is additionally checked against `denominator`: a completed set
 * whose array is longer than its own denominator is incoherent, and a timeline
 * built from it would misrender.
 */
export function parseSyncedSession(raw: unknown): SyncedHomeworkSession | null {
  if (!raw || typeof raw !== 'object') return null
  const body = raw as Record<string, unknown>

  const id = typeof body.id === 'string' && UUID.test(body.id) ? body.id : null
  if (!id) return null

  const denominator = boundedInt(body.denominator, 1, MAX_PROBLEMS)
  if (denominator === null) return null

  const status = typeof body.status === 'string' && (HOMEWORK_STATUSES as readonly string[]).includes(body.status)
    ? (body.status as HomeworkStatus)
    : null
  if (!status) return null

  const locationHash = str(body.locationHash, 128)
  if (!locationHash) return null

  const startedAt = isoOrNull(body.startedAt)
  if (!startedAt) return null

  const rawProblems = Array.isArray(body.problems) ? body.problems : []
  if (rawProblems.length > denominator) return null
  const problems: SyncedProblem[] = []
  for (const entry of rawProblems) {
    const parsed = parseProblem(entry, denominator)
    if (!parsed) return null
    problems.push(parsed)
  }

  // A set can only be 'complete' if it actually is -- otherwise the dashboard
  // would fire a celebration summary for an abandoned set (spec §8).
  if (status === 'complete' && problems.length !== denominator) return null

  const tutoringSessionId =
    typeof body.tutoringSessionId === 'string' && UUID.test(body.tutoringSessionId)
      ? body.tutoringSessionId
      : null

  return {
    id,
    tutoringSessionId,
    locationHash,
    title: str(body.title, MAX_TITLE_CHARS),
    concept: str(body.concept, MAX_CONCEPT_CHARS),
    denominator,
    graded: body.graded === true,
    status,
    problems,
    totalSeconds: boundedInt(body.totalSeconds, 0, MAX_TOTAL_SECONDS) ?? 0,
    longestUnaidedRun: boundedInt(body.longestUnaidedRun, 0, denominator) ?? 0,
    startedAt,
    endedAt: isoOrNull(body.endedAt),
  }
}

/** Parses a whole push, dropping malformed entries and capping the batch. */
export function parseSyncBody(body: unknown): SyncedHomeworkSession[] {
  const raw = (body ?? {}) as Record<string, unknown>
  const list = Array.isArray(raw.sessions) ? raw.sessions : []
  const parsed: SyncedHomeworkSession[] = []
  for (const entry of list.slice(0, MAX_SESSIONS_PER_SYNC)) {
    const session = parseSyncedSession(entry)
    if (session) parsed.push(session)
  }
  return parsed
}

/** The DB row a validated session becomes. `user_id` is added by the route. */
export function toRow(session: SyncedHomeworkSession) {
  return {
    id: session.id,
    tutoring_session_id: session.tutoringSessionId,
    location_hash: session.locationHash,
    title: session.title,
    concept: session.concept,
    denominator: session.denominator,
    graded: session.graded,
    status: session.status,
    problems: session.problems,
    total_seconds: session.totalSeconds,
    longest_unaided_run: session.longestUnaidedRun,
    started_at: session.startedAt,
    ended_at: session.endedAt,
  }
}
