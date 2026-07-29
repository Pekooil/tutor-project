import { NextResponse } from 'next/server'
import { clientFromBearerOrCookie } from '@/lib/auth/bearer'
import { createAdminClient } from '@/lib/supabase/admin'

// Sprint 16 / Task 5 (ADR-035): GDPR data portability. The RLS-scoped tables
// below are read as the AUTHENTICATED caller (clientFromBearerOrCookie) —
// never the service-role admin client — so RLS is the guarantee that this can
// only ever return the caller's own rows, not a `select` we could get wrong.
// Every table is `select('*')` with no hand-listed column subset,
// deliberately: a future column added to any of these tables is exported
// automatically, with nothing here to fall out of date.
//
// Sprint 17 (ADR-039/ADR-043) adds the two beta-observability tables:
//   - `feedback` joins the RLS-scoped set — its `feedback_select_own` policy
//     makes the same authenticated read Just Work.
//   - `telemetry_event` is the ONE deliberate exception to the "never the
//     admin client, RLS is the guarantee" rule (see the block below): it is
//     insert-only for its owner (no client SELECT policy — ADR-043), so the
//     RLS-scoped read would return zero rows; GDPR export still owes the user
//     their own telemetry, so it is read via the service role, explicitly
//     scoped by user_id.

const EXPORT_SCHEMA_VERSION = 1

// Read through the caller's own RLS-scoped client (`auth.supabase`), where the
// database is the scoping guarantee. `users`/`sessions`/`knowledge_nodes`/
// `misconceptions`/`session_interactions`/`reinforcement_schedule` (per
// docs/architecture.md) plus `feedback` (Sprint 17), `mastery_snapshot`
// (Sprint 22), `study_artifact` (Sprint 21), and `concept_notebook` (ADR-054)
// are the complete set of user-scoped tables that expose an owner SELECT
// policy; any new such table a future sprint adds MUST be added here too.
const RLS_SCOPED_TABLES = [
  'users',
  'sessions',
  'knowledge_nodes',
  'misconceptions',
  'session_interactions',
  'reinforcement_schedule',
  'feedback',
  // Sprint 22 (ADR-047): the forward-only mastery trend. Its
  // `mastery_snapshot_select_own` policy makes this authenticated read Just
  // Work; the FK cascade to users covers erasure (migration 0020).
  'mastery_snapshot',
  // Sprint 21 (ADR-049): generated study kits -- the first *generated* content
  // this product persists. Its `study_artifact_select_own` policy makes this
  // authenticated read Just Work (like feedback above, not the service-role
  // exception telemetry_event needs); the FK cascade to users covers erasure
  // (migration 0021). Sprint 16's invariant: every new user-scoped table joins
  // the export here + the erasure sweep (the FK cascade) -- both, asserted in
  // tests/account.test.ts.
  'study_artifact',
  // ADR-054: the per-concept Personal Notebook -- the second *generated*
  // content this product persists (after study_artifact). Its
  // `concept_notebook_select_own` policy makes this authenticated read Just
  // Work (like study_artifact/feedback, not the service-role exception
  // telemetry_event needs); the FK cascade to users covers erasure
  // (migration 0026). Same Sprint 16 invariant: export here + erasure sweep,
  // both asserted in tests/account.test.ts.
  'concept_notebook',
  // Public launch (2026-07-18): the per-user monthly voice-credit ledger
  // (migration 0023). Its `voice_spend_select_own` policy makes this
  // authenticated read Just Work; the FK cascade to users covers erasure.
  'voice_spend',
  // ADR-053: referred signups. `referral_select_own` is keyed on referrer_id
  // (not user_id) -- the RLS-scoped read returns the rows where the CALLER is
  // the referrer, which is exactly their referral data; the row about being
  // referred lives on their own users.referred_by column, already exported
  // above. FK cascades on both user columns cover erasure (migration 0024).
  'referral',
  // ADR-057: synced v4 homework sessions -- denominator, per-problem outcomes
  // and durations, and the set's own totals. Its `homework_session_select_own`
  // policy makes this authenticated read Just Work (like study_artifact /
  // concept_notebook above, not the service-role exception telemetry_event
  // needs); the FK cascade to users covers erasure (migration 0029). Same
  // Sprint 16 invariant: export here + erasure sweep, both asserted in
  // tests/account.test.ts.
  'homework_session',
] as const

export async function GET(request: Request) {
  const auth = await clientFromBearerOrCookie(request)

  if ('error' in auth) {
    return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })
  }

  try {
    const rlsRows = await Promise.all(
      RLS_SCOPED_TABLES.map(async (table) => {
        const { data, error } = await auth.supabase.from(table).select('*')

        if (error) {
          throw error
        }

        return [table, data ?? []] as const
      })
    )

    // telemetry_event: the ONE deliberate departure from this route's
    // "never the admin client" invariant (Sprint 17, ADR-043). The table is
    // insert-only for its owner — it has NO client SELECT policy, by design —
    // so an RLS-scoped read of it returns nothing, yet a GDPR export still
    // owes the user their own telemetry. It is therefore read through the
    // service-role client with an EXPLICIT `.eq('user_id', auth.user.id)`:
    // that filter (not RLS) is what scopes it to the caller, so it is written
    // out literally and is the single line in this route where correct
    // scoping is the code's responsibility rather than the database's. The
    // service-role key is server-only (createAdminClient carries the
    // `server-only` import) and never reaches the client.
    const { data: telemetry, error: telemetryError } = await createAdminClient()
      .from('telemetry_event')
      .select('*')
      .eq('user_id', auth.user.id)

    if (telemetryError) {
      throw telemetryError
    }

    // signup_ip (ADR-053): the SECOND deliberate service-role exception, for
    // the same reason as telemetry_event above -- the table is deny-all
    // (Shape 3, no client SELECT policy), but its one row per account (the
    // salted hash of the signup network address) is still the user's data
    // and a GDPR export owes it to them. Explicitly scoped by user_id; the
    // FK cascade to users covers erasure.
    const { data: signupIp, error: signupIpError } = await createAdminClient()
      .from('signup_ip')
      .select('*')
      .eq('user_id', auth.user.id)

    if (signupIpError) {
      throw signupIpError
    }

    const payload = {
      schemaVersion: EXPORT_SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      userId: auth.user.id,
      ...Object.fromEntries(rlsRows),
      telemetry_event: telemetry ?? [],
      signup_ip: signupIp ?? [],
    }

    return new NextResponse(JSON.stringify(payload, null, 2), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Content-Disposition': 'attachment; filename="calyxa-data-export.json"',
      },
    })
  } catch (error) {
    // Server-side terminal only — never relay the DB error text to the client.
    console.error('account/export: read failed', error)
    return NextResponse.json({ error: 'Could not generate your data export right now.' }, { status: 502 })
  }
}
