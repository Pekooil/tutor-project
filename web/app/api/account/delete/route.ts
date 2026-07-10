import { NextResponse } from 'next/server'
import { clientFromBearerOrCookie } from '@/lib/auth/bearer'

// Sprint 16 / Task 5 (ADR-035): Phase 1 of the two-phase erasure — queue,
// don't delete. Sets erasure_requested_at (the durable queue marker the
// hard-delete-sweep cron, Task 6, keys on) and deleted_at (immediate logical
// erasure: RLS hides the row and sessions stop right away, PLAN §2.7) on the
// caller's OWN users row — no service-role client, no in-request cascade.
//
// Sprint 16 / Task 8: this calls the queue_own_erasure() RPC (migration
// 0016) rather than a raw `.update()`. A raw client-side update cannot
// actually set deleted_at here: users_select_own's policy is `auth.uid() =
// id and deleted_at is null`, and Postgres additionally requires an
// UPDATE's new row to still satisfy the table's SELECT policy unless the
// UPDATE policy's own WITH CHECK explicitly covers the transition (it
// doesn't) — so the update was always rejected with a 42501 RLS violation
// for every real user. queue_own_erasure is SECURITY DEFINER, scoped hard
// to auth.uid() (no user-id parameter), the same shape as start_session/
// cost_guard's existing RPCs for exactly this "RLS structurally can't do
// this write" class of problem.
//
// Idempotent by construction, not by an explicit check: the RPC's own
// `where deleted_at is null` means a second call matches zero rows and
// just re-reads the already-set timestamps, rather than erroring.

export async function POST(request: Request) {
  const auth = await clientFromBearerOrCookie(request)

  if ('error' in auth) {
    return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })
  }

  const { error } = await auth.supabase.rpc('queue_own_erasure')

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
