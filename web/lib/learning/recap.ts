import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { retrievability } from '@calyxa/learning-model'
import { getConcept } from '@calyxa/curriculum'

// The session-end recap (Sprint 13, ADR-024/025): a READ of the tables the
// already-awaited reconcileSession just finished writing -- knowledge_nodes,
// misconceptions, reinforcement_schedule -- plus the session's own
// session_interactions rows. No new write, no second source of truth: the
// recap is built in the same request, after the reconcile, so it cannot
// disagree with the real mastery write. Display-ready by contract
// (ADR-024's server-rendered-display rule): every concept key resolves to
// its curriculum title here, server-side; the extension only renders.
// Nothing here is persisted -- the recap rides one response and is gone.

const MS_PER_DAY = 1000 * 60 * 60 * 24

// The trend rollup's conservatism (ADR-026 spec): a trend line is emitted
// ONLY when at least this many consecutive sessions -- including this one --
// show strictly improving outcome quality. Most recaps have no trend line;
// that is the designed outcome ("3rd session in a row" should feel earned).
const TREND_MIN_SESSIONS = 3
// Per touched concept, the per-session quality series looks across at most
// this many recent ended sessions.
const TREND_SESSION_WINDOW = 5
// Bounded scan of recent gradable interactions from ended sessions for the
// trend rollup -- the profile-read.ts LIMIT_PRIOR_WORK_SCAN instinct, sized
// up because this scan feeds up to TREND_SESSION_WINDOW sessions for
// EVERY touched concept, not a ≤3-entry digest.
const TREND_SCAN_LIMIT = 150

export type RecapConcept = {
  conceptKey: string
  title: string
  turns: number
  correct: number
  incorrect: number
  mastery: number
  state: string
}

export type RecapMisconception = {
  conceptKey: string
  title: string
  category: string
  description: string
}

export type RecapNextReview = {
  conceptKey: string
  title: string
  dueAt: string
}

export type RecapTrend = {
  conceptKey: string
  title: string
  sessions: number
  line: string
}

export type SessionRecap = {
  concepts: RecapConcept[]
  misconceptionsAdded: RecapMisconception[]
  misconceptionsResolved: RecapMisconception[]
  nextReviews: RecapNextReview[]
  trends: RecapTrend[]
}

type SessionRow = {
  started_at: string
}

type InteractionRow = {
  concept_key: string
  outcome: string
}

type NodeRow = {
  concept_key: string
  mastery: number
  stability: number
  state: string
  last_practiced_at: string | null
}

type MisconceptionRow = {
  concept_key: string
  category: string
  description: string | null
}

type ScheduleRow = {
  concept_key: string
  due_at: string
}

type TrendScanRow = {
  concept_key: string
  outcome: string
  session_id: string
  created_at: string
}

function daysSince(timestamp: string | null): number {
  if (!timestamp) return 0
  return Math.max(0, (Date.now() - new Date(timestamp).getTime()) / MS_PER_DAY)
}

// Raw-key fallback on curriculum drift, the overview route's convention --
// the recap must never fail over a stale knowledge_nodes concept key.
function titleFor(conceptKey: string): string {
  return getConcept(conceptKey)?.title ?? conceptKey
}

// One session's outcome quality for one concept: correct counts 1, partial
// half, incorrect nothing, over the session's gradable turns on it. Purely
// mechanical -- the trend line can only ever claim what the rows record.
function sessionQuality(rows: readonly TrendScanRow[]): number {
  const correct = rows.filter((r) => r.outcome === 'correct').length
  const partial = rows.filter((r) => r.outcome === 'partial').length
  return (correct + 0.5 * partial) / rows.length
}

// The ≥3-consecutive-improving-sessions rule (ADR-026 spec), strictly:
// walking back from THIS session, every step must be a strict quality
// improvement over the session before it. Equal scores, dips, short
// histories, or a concept whose most recent session isn't this one (a
// concurrent session on another device ended later) all emit nothing --
// ambiguity is silence, by design.
function deriveTrends(rows: readonly TrendScanRow[], touchedKeys: readonly string[], sessionId: string): RecapTrend[] {
  const trends: RecapTrend[] = []

  for (const conceptKey of touchedKeys) {
    const conceptRows = rows.filter((r) => r.concept_key === conceptKey)
    if (conceptRows.length === 0) continue

    // Group by session, ranked by each session's newest interaction (the
    // derivePriorWork recency convention -- interaction order stands in
    // for session order, so the ended_at embed never needs reading).
    const bySession = new Map<string, TrendScanRow[]>()
    for (const row of conceptRows) {
      const group = bySession.get(row.session_id)
      if (group) group.push(row)
      else bySession.set(row.session_id, [row])
    }

    const ordered = [...bySession.entries()]
      .map(([id, sessionRows]) => ({
        id,
        latest: Math.max(...sessionRows.map((r) => new Date(r.created_at).getTime())),
        quality: sessionQuality(sessionRows),
      }))
      .sort((a, b) => a.latest - b.latest)
      .slice(-TREND_SESSION_WINDOW)

    // The run must END at this session, or "including this one" is false.
    if (ordered[ordered.length - 1]?.id !== sessionId) continue

    let run = 1
    while (run < ordered.length && ordered[ordered.length - run].quality > ordered[ordered.length - run - 1].quality) {
      run++
    }

    if (run >= TREND_MIN_SESSIONS) {
      trends.push({
        conceptKey,
        title: titleFor(conceptKey),
        sessions: run,
        line: `${run} sessions in a row improving`,
      })
    }
  }

  return trends
}

function throwOnError(error: { message: string } | null, leg: string): void {
  if (error) throw new Error(`recap ${leg} read failed: ${error.message}`)
}

// Builds the recap for a just-ended, just-reconciled session. Returns
// undefined for a session with no gradable interactions (the response then
// stays byte-identical to Sprint 11). Throws on a failed essential read --
// the CALLER (session/end route) logs and omits the recap; a partially
// honest recap (e.g. silently empty misconception lists over a failed
// query) would misinform, which is worse than none. The one exception is
// the trend scan: absence of trends is the designed common case, so a
// failure there degrades to no trend lines rather than costing the recap.
export async function buildSessionRecap(
  supabase: SupabaseClient,
  userId: string,
  sessionId: string
): Promise<SessionRecap | undefined> {
  const [sessionResult, interactionsResult] = await Promise.all([
    supabase
      .from('sessions')
      .select('started_at')
      .eq('id', sessionId)
      .eq('user_id', userId)
      .is('deleted_at', null)
      .single(),
    supabase
      .from('session_interactions')
      .select('concept_key, outcome')
      .eq('session_id', sessionId)
      .eq('user_id', userId)
      .not('concept_key', 'is', null)
      .neq('outcome', 'none')
      .is('deleted_at', null)
      .order('turn_index', { ascending: true }),
  ])

  throwOnError(sessionResult.error, 'sessions')
  throwOnError(interactionsResult.error, 'session_interactions')

  const session = sessionResult.data as SessionRow
  const interactions = (interactionsResult.data ?? []) as InteractionRow[]

  if (interactions.length === 0) return undefined

  // Touched concepts in first-touched order (turn_index above).
  const touchedKeys = [...new Set(interactions.map((row) => row.concept_key))]

  // The misconception window opens at started_at and runs to NOW, not to
  // ended_at: the reconcile sweep that applies any leftover rows runs
  // AFTER end_session stamps ended_at (in this same request), so a
  // misconception it creates or resolves carries a timestamp seconds past
  // ended_at -- an [started_at, ended_at] bound would miss exactly the
  // rows the recap exists to report. Nothing before started_at can belong
  // to this session, which is the bound that keeps prior sessions out.
  const [nodesResult, addedResult, resolvedResult, scheduleResult, trendResult] = await Promise.all([
    supabase
      .from('knowledge_nodes')
      .select('concept_key, mastery, stability, state, last_practiced_at')
      .eq('user_id', userId)
      .in('concept_key', touchedKeys)
      .is('deleted_at', null),
    supabase
      .from('misconceptions')
      .select('concept_key, category, description')
      .eq('user_id', userId)
      .gte('created_at', session.started_at)
      .is('deleted_at', null),
    supabase
      .from('misconceptions')
      .select('concept_key, category, description')
      .eq('user_id', userId)
      .eq('status', 'resolved')
      .gte('resolved_at', session.started_at)
      .is('deleted_at', null),
    supabase
      .from('reinforcement_schedule')
      .select('concept_key, due_at')
      .eq('user_id', userId)
      .in('concept_key', touchedKeys)
      .is('deleted_at', null)
      .order('due_at', { ascending: true }),
    // Trend scan: recent gradable interactions on the touched concepts from
    // ENDED sessions (this one already is -- end_session ran before the
    // reconcile and before this read). The profile-read.ts prior-work scan
    // shape, widened to the recap's session window.
    supabase
      .from('session_interactions')
      .select('concept_key, outcome, session_id, created_at, sessions!inner(ended_at)')
      .eq('user_id', userId)
      .in('concept_key', touchedKeys)
      .neq('outcome', 'none')
      .is('deleted_at', null)
      .not('sessions.ended_at', 'is', null)
      .order('created_at', { ascending: false })
      .limit(TREND_SCAN_LIMIT),
  ])

  throwOnError(nodesResult.error, 'knowledge_nodes')
  throwOnError(addedResult.error, 'misconceptions (added)')
  throwOnError(resolvedResult.error, 'misconceptions (resolved)')
  throwOnError(scheduleResult.error, 'reinforcement_schedule')

  const nodesByKey = new Map(((nodesResult.data ?? []) as NodeRow[]).map((row) => [row.concept_key, row]))

  const concepts: RecapConcept[] = touchedKeys.map((conceptKey) => {
    const conceptInteractions = interactions.filter((row) => row.concept_key === conceptKey)
    const node = nodesByKey.get(conceptKey)

    return {
      conceptKey,
      title: titleFor(conceptKey),
      turns: conceptInteractions.length,
      correct: conceptInteractions.filter((row) => row.outcome === 'correct').length,
      incorrect: conceptInteractions.filter((row) => row.outcome === 'incorrect').length,
      // Decay-adjusted on read, the profile-read.ts convention -- the same
      // number a subsequent overview/profile read would report, so the
      // client-side delta against the panel-open snapshot compares like
      // with like. A node the reconcile somehow never wrote reads as 0 /
      // unseen rather than failing the recap.
      mastery: node ? node.mastery * retrievability(node.stability, daysSince(node.last_practiced_at)) : 0,
      state: node?.state ?? 'unseen',
    }
  })

  const toRecapMisconception = (row: MisconceptionRow): RecapMisconception => ({
    conceptKey: row.concept_key,
    title: titleFor(row.concept_key),
    category: row.category,
    description: row.description ?? '',
  })

  const misconceptionsAdded = ((addedResult.data ?? []) as MisconceptionRow[]).map(toRecapMisconception)
  const misconceptionsResolved = ((resolvedResult.data ?? []) as MisconceptionRow[]).map(toRecapMisconception)

  // The forward look: the dates shown ARE the FSRS schedule (ADR-026) --
  // straight reads of reinforcement_schedule.due_at, humanized client-side.
  const nextReviews: RecapNextReview[] = ((scheduleResult.data ?? []) as ScheduleRow[]).map((row) => ({
    conceptKey: row.concept_key,
    title: titleFor(row.concept_key),
    dueAt: row.due_at,
  }))

  // The embedded `sessions` object only enforced the ended-only filter;
  // the cast drops it (the profile-read.ts prior-work convention). A
  // trend-scan error degrades to no trends -- see the function comment.
  const trendRows = (trendResult.data ?? []) as unknown as TrendScanRow[]
  const trends = deriveTrends(trendRows, touchedKeys, sessionId)

  return { concepts, misconceptionsAdded, misconceptionsResolved, nextReviews, trends }
}
