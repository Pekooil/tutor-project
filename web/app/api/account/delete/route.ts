import { NextResponse } from 'next/server'
import { clientFromBearerOrCookie } from '@/lib/auth/bearer'

// Sprint 16 / Task 5 (ADR-035): Phase 1 of the two-phase erasure — queue,
// don't delete. Sets erasure_requested_at (the durable queue marker the
// hard-delete-sweep cron, Task 6, keys on) and deleted_at (immediate logical
// erasure: RLS hides the row and sessions stop right away, PLAN §2.7) on the
// caller's OWN users row, via an RLS-scoped update — no service-role client,
// no in-request cascade.
//
// Idempotent by construction, not by an explicit check: users_update_own
// (migration 0001, Shape 1) requires `deleted_at is null` in its USING
// clause, so once the first call sets deleted_at, RLS itself blocks a second
// call's update (0 rows affected, no error) — the same discipline this
// codebase already gets for free elsewhere from RLS as the enforcement
// layer, not a `where` clause or an application-level check that could be
// gotten wrong.

export async function POST(request: Request) {
  const auth = await clientFromBearerOrCookie(request)

  if ('error' in auth) {
    return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })
  }

  const now = new Date().toISOString()

  const { error } = await auth.supabase
    .from('users')
    .update({ erasure_requested_at: now, deleted_at: now })
    .eq('id', auth.user.id)

  if (error) {
    // Never relay the DB error text to the client. Deliberately does NOT
    // sign out on failure — if we can't confirm the erasure was queued, the
    // caller keeps a valid session to retry immediately.
    console.error('account/delete: failed to queue erasure', error)
    return NextResponse.json({ error: 'Could not process the deletion request right now.' }, { status: 502 })
  }

  await auth.supabase.auth.signOut()

  return NextResponse.json({ ok: true })
}
