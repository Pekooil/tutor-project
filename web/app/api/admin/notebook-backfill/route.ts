import 'server-only'
import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertCronSecret } from '@/lib/cron/auth'
import { backfillNotebooks, MAX_BACKFILL_ROWS } from '@/lib/notebook/backfill'

// ADR-054 (v3): the one-off notebook migration endpoint — rewrites existing
// v2 `concept_notebook` rows into the v3 document shape (see lib/notebook/
// backfill.ts for the conservative rules it follows).
//
// Service-role, CRON_SECRET-guarded — the same bearer gate /api/cron/* and
// /api/admin/invite use, and the same reason: this holds the admin client and
// spans every user's rows. proxy.ts exempts /api/admin from the cookie gate so a
// bearer request isn't redirected to /login; THIS check is the real gate and it
// fails closed.
//
// It is a manual, one-off pass, NOT a cron: it should be run once (dry-run
// first), watched, and re-run only if it reports leftovers. Deliberately not
// added to any schedule.
//
// Usage:
//   curl -X POST https://calyxa.app/api/admin/notebook-backfill \
//     -H "Authorization: Bearer $CRON_SECRET" \
//     -H 'content-type: application/json' \
//     -d '{"dryRun": true}'
//
// Body:
//   dryRun?: boolean  default TRUE — a bare call never spends
//   limit?:  number   rows per run, capped at MAX_BACKFILL_ROWS
//   force?:  boolean  also re-restructure rows already in v3 (use after a
//                     generation-prompt improvement); costs one call per row
export async function POST(request: Request) {
  const denied = assertCronSecret(request)
  if (denied) return denied

  let body: { dryRun?: unknown; limit?: unknown; force?: unknown } = {}
  if (request.headers.get('content-length') !== '0') {
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 })
    }
  }

  // Defaults to a DRY RUN. Spending real money across every user's notebooks
  // has to be asked for explicitly — `{"dryRun": false}` is the opt-in.
  const dryRun = body.dryRun !== false

  const rawLimit = typeof body.limit === 'number' ? Math.floor(body.limit) : MAX_BACKFILL_ROWS
  if (!Number.isFinite(rawLimit) || rawLimit < 1) {
    return NextResponse.json({ error: 'limit must be a positive number.' }, { status: 400 })
  }
  const limit = Math.min(rawLimit, MAX_BACKFILL_ROWS)
  // Re-restructure rows already in v3 — for when the generation prompt improves.
  const force = body.force === true

  try {
    const report = await backfillNotebooks(createAdminClient(), { limit, dryRun, force })
    return NextResponse.json({ dryRun, limit, force, ...report })
  } catch (err) {
    console.error('notebook-backfill: run failed', err)
    return NextResponse.json({ error: 'The backfill could not run right now.' }, { status: 502 })
  }
}
