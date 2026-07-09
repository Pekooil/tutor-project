import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertCronSecret } from '@/lib/cron/auth'

// Sprint 16 / Task 6 (ADR-035 Phase 2, ADR-036): executes the erasure queue
// Task 5's POST /api/account/delete writes to (erasure_requested_at,
// migration 0013). Finds users past the grace window and deletes each
// auth.users row via the service-role admin client — the existing FK
// `on delete cascade` (migrations 0002/0004/0007/0008) removes
// public.users and every user-scoped table under it — then re-selects to
// VERIFY absence rather than trusting the delete call. Bounded batch,
// delete-if-present: safe to re-run same day.
const ERASURE_GRACE_DAYS = 7
const SWEEP_BATCH_LIMIT = 100

export async function GET(request: Request) {
  const authError = assertCronSecret(request)
  if (authError) return authError

  const cutoff = new Date(Date.now() - ERASURE_GRACE_DAYS * 24 * 60 * 60 * 1000).toISOString()
  const supabase = createAdminClient()

  const { data: queued, error: queryError } = await supabase
    .from('users')
    .select('id')
    .not('erasure_requested_at', 'is', null)
    .lte('erasure_requested_at', cutoff)
    .limit(SWEEP_BATCH_LIMIT)

  if (queryError) {
    console.error('cron/hard-delete-sweep: query failed', queryError)
    return NextResponse.json({ error: 'Sweep query failed' }, { status: 500 })
  }

  let deletedCount = 0
  const failedIds: string[] = []

  for (const user of queued ?? []) {
    const { error: deleteError } = await supabase.auth.admin.deleteUser(user.id)

    if (deleteError) {
      console.error('cron/hard-delete-sweep: delete failed', user.id, deleteError)
      failedIds.push(user.id)
      continue
    }

    const { data: remaining, error: verifyError } = await supabase
      .from('users')
      .select('id')
      .eq('id', user.id)

    if (verifyError || (remaining && remaining.length > 0)) {
      console.error('cron/hard-delete-sweep: verify failed, row still present', user.id, verifyError)
      failedIds.push(user.id)
      continue
    }

    deletedCount++
  }

  return NextResponse.json({ ok: failedIds.length === 0, deletedCount, failedIds })
}
