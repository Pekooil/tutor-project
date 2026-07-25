import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getConcept } from '@calyxa/curriculum'
import { costGuard } from '@/lib/tier/cost-guard'
import { estimateCost } from '@/lib/tier/cost-model'
import { restructureNotebook } from './restructure'
import { isEmptyNotebook, parseNotebook, type Notebook } from './tool'

// ADR-054 (v3): the ONE-OFF notebook migration pass. Existing `concept_notebook`
// rows are in the v2 {summary, mustKnow, method} shape; `parseNotebook` lifts
// them so they still render, but a lifted notebook shows headings and steps with
// no prose sections. This walks every row and rewrites it in the real v3 shape.
//
// Posture, deliberately conservative — this touches every user's own notes:
//   - IDEMPOTENT. A row whose stored content already has a non-empty `sections`
//     array is skipped without a model call, so re-running is cheap and safe.
//   - NON-DESTRUCTIVE. A row is written only if the restructured notebook is
//     non-empty, has sections, and passes `preservesContent` below. Anything
//     else leaves the existing row exactly as it was — the same "never clobber
//     the real notebook" rule updateConceptNotebook follows.
//   - `session_count` and `source_session_id` are PRESERVED. No session happened;
//     incrementing the count would misreport how much tutoring fed these notes.
//   - COST-GUARDED per row against the same global daily ledger as every other
//     model call, and sequential so one over-cap row stops the run instead of
//     racing the rest past the cap.
//   - DRY-RUN FIRST. `dryRun: true` reports exactly which rows would be rewritten
//     and makes no model call and no write.
//
// It needs the service-role client: the migration spans every user's rows, which
// RLS correctly forbids a request-scoped client from seeing.

export type BackfillOutcome =
  | 'migrated'
  | 'already-v3'
  | 'empty'
  | 'would-migrate'
  | 'refused-cost'
  | 'lossy'
  | 'failed'

export type BackfillRow = {
  userId: string
  conceptKey: string
  outcome: BackfillOutcome
  /** Present on 'lossy' / 'failed' — why the row was left alone. */
  detail?: string
}

export type BackfillReport = {
  scanned: number
  migrated: number
  alreadyV3: number
  skipped: number
  failed: number
  /** True when the run stopped early on the hard cost cap. */
  stoppedOnCost: boolean
  rows: BackfillRow[]
}

/** Upper bound on one run, so an accidental invocation can't walk the whole
 *  table in a single request. Mirrors the admin invite route's MAX_BATCH. */
export const MAX_BACKFILL_ROWS = 500

type NotebookRow = {
  user_id: string
  concept_key: string
  content: unknown
  session_count: number | null
  source_session_id: string | null
}

/** Already migrated? Reads the RAW stored jsonb, not the parsed notebook —
 *  `parseNotebook` synthesizes `sections` for v2 rows, so the parsed value can
 *  never tell the two formats apart. */
function isStoredV3(content: unknown): boolean {
  if (typeof content !== 'object' || content === null) return false
  const sections = (content as Record<string, unknown>).sections
  return Array.isArray(sections) && sections.length > 0
}

/** The anti-loss guard. A restructure must not quietly discard the student's
 *  material — above all the recorded mistakes, which are the whole point of the
 *  notebook. Compared through the derived v2 view so both sides are the same
 *  shape regardless of how the model grouped things. */
function preservesContent(before: Notebook, after: Notebook): string | null {
  const mistakesBefore = before.method.filter((s) => s.mistake !== null).length
  const mistakesAfter = after.method.filter((s) => s.mistake !== null).length
  if (mistakesAfter < mistakesBefore) {
    return `dropped ${mistakesBefore - mistakesAfter} of ${mistakesBefore} step mistake(s)`
  }
  if (after.method.length < before.method.length) {
    return `dropped ${before.method.length - after.method.length} of ${before.method.length} method step(s)`
  }
  if (before.summary !== '' && after.summary === '') {
    return 'dropped the overview'
  }
  const pointsBefore = before.mustKnow.length + before.keyPoints.length
  if (pointsBefore > 0 && after.keyPoints.length === 0 && after.sections.length === 0) {
    return 'dropped every key point'
  }
  return null
}

function titleFor(conceptKey: string): string {
  return getConcept(conceptKey)?.title ?? conceptKey
}

/** Runs the migration. `admin` must be the service-role client. Never throws —
 *  every per-row failure is recorded in the report so a partial run is legible
 *  and safely re-runnable. */
export async function backfillNotebooks(
  admin: SupabaseClient,
  {
    limit = MAX_BACKFILL_ROWS,
    dryRun = false,
    force = false,
  }: {
    limit?: number
    dryRun?: boolean
    /** Re-restructure rows that are ALREADY v3. The reason this exists is prompt
     *  improvements: a row migrated under an earlier prompt can be reshaped
     *  again. Safe to repeat because `preservesContent` still gates every write,
     *  but it spends a model call per row, so it is off by default. */
    force?: boolean
  } = {}
): Promise<BackfillReport> {
  const report: BackfillReport = {
    scanned: 0,
    migrated: 0,
    alreadyV3: 0,
    skipped: 0,
    failed: 0,
    stoppedOnCost: false,
    rows: [],
  }

  const { data, error } = await admin
    .from('concept_notebook')
    .select('user_id, concept_key, content, session_count, source_session_id')
    .order('updated_at', { ascending: true })
    .limit(Math.min(Math.max(limit, 1), MAX_BACKFILL_ROWS))

  if (error || !data) {
    console.error('backfillNotebooks: read failed', error)
    report.failed = 1
    report.rows.push({ userId: '', conceptKey: '', outcome: 'failed', detail: 'Could not read concept_notebook.' })
    return report
  }

  for (const row of data as NotebookRow[]) {
    report.scanned += 1
    const { user_id: userId, concept_key: conceptKey } = row

    if (isStoredV3(row.content) && !force) {
      report.alreadyV3 += 1
      report.rows.push({ userId, conceptKey, outcome: 'already-v3' })
      continue
    }

    const existing = parseNotebook(row.content)
    if (isEmptyNotebook(existing)) {
      // Nothing true to restructure. Generating from empty would fabricate.
      report.skipped += 1
      report.rows.push({ userId, conceptKey, outcome: 'empty' })
      continue
    }

    if (dryRun) {
      report.rows.push({ userId, conceptKey, outcome: 'would-migrate' })
      continue
    }

    // Guard BEFORE the model call, against the same global ledger as every
    // other generation path. costGuard fails open, so only a real over-cap
    // reaches this branch.
    const { hardExceeded } = await costGuard(admin, estimateCost('notebook'))
    if (hardExceeded) {
      report.skipped += 1
      report.stoppedOnCost = true
      report.rows.push({ userId, conceptKey, outcome: 'refused-cost' })
      console.warn('backfillNotebooks: hard cost cap reached, stopping the run')
      break
    }

    let restructured: Notebook
    try {
      restructured = await restructureNotebook(existing, titleFor(conceptKey), conceptKey)
    } catch (err) {
      console.error(`backfillNotebooks: restructure failed for ${conceptKey}`, err)
      report.failed += 1
      report.rows.push({ userId, conceptKey, outcome: 'failed', detail: 'Model call failed.' })
      continue
    }

    if (isEmptyNotebook(restructured) || restructured.sections.length === 0) {
      report.failed += 1
      report.rows.push({
        userId,
        conceptKey,
        outcome: 'failed',
        detail: 'Restructure produced no sections; row left unchanged.',
      })
      continue
    }

    const loss = preservesContent(existing, restructured)
    if (loss) {
      report.skipped += 1
      report.rows.push({ userId, conceptKey, outcome: 'lossy', detail: loss })
      console.warn(`backfillNotebooks: ${conceptKey} restructure ${loss}; row left unchanged`)
      continue
    }

    // Content only. session_count and source_session_id are untouched: no new
    // session fed this notebook, and updated_at is the DB trigger's job.
    const { error: writeError } = await admin
      .from('concept_notebook')
      .update({ content: restructured })
      .eq('user_id', userId)
      .eq('concept_key', conceptKey)

    if (writeError) {
      console.error(`backfillNotebooks: write failed for ${conceptKey}`, writeError)
      report.failed += 1
      report.rows.push({ userId, conceptKey, outcome: 'failed', detail: 'Write failed.' })
      continue
    }

    report.migrated += 1
    report.rows.push({ userId, conceptKey, outcome: 'migrated' })
  }

  return report
}
