import { NextResponse } from 'next/server'
import { clientFromBearerOrCookie } from '@/lib/auth/bearer'

// Sprint 16 / Task 5 (ADR-035): GDPR data portability. Reads as the
// AUTHENTICATED caller (clientFromBearerOrCookie) — never the service-role
// admin client — so RLS is the guarantee that this can only ever return the
// caller's own rows, not a `select` we could get wrong. Every table is
// `select('*')` with no hand-listed column subset, deliberately: a future
// column added to any of these six tables is exported automatically, with
// nothing here to fall out of date. `users`/`sessions`/`knowledge_nodes`/
// `misconceptions`/`session_interactions`/`reinforcement_schedule` are the
// complete set of user-scoped tables today (per docs/architecture.md);
// any new user-scoped table this sprint's "what the next sprint needs to
// know" flags MUST be added here too.

const EXPORT_SCHEMA_VERSION = 1

const EXPORTED_TABLES = [
  'users',
  'sessions',
  'knowledge_nodes',
  'misconceptions',
  'session_interactions',
  'reinforcement_schedule',
] as const

export async function GET(request: Request) {
  const auth = await clientFromBearerOrCookie(request)

  if ('error' in auth) {
    return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })
  }

  try {
    const rows = await Promise.all(
      EXPORTED_TABLES.map(async (table) => {
        const { data, error } = await auth.supabase.from(table).select('*')

        if (error) {
          throw error
        }

        return [table, data ?? []] as const
      })
    )

    const payload = {
      schemaVersion: EXPORT_SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      userId: auth.user.id,
      ...Object.fromEntries(rows),
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
