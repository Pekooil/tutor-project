import 'server-only'
import { NextResponse } from 'next/server'
import { randomBytes } from 'crypto'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertCronSecret } from '@/lib/cron/auth'

// Sprint 19 / Task 5 (ADR-045): the admin invite route. Service-role,
// CRON_SECRET-guarded (the SAME bearer gate as /api/cron/*, reused). Given a
// batch selector it marks waitlist rows invited_at = now() + mints a unique
// invite_code, and returns the batch (email + code) so the unlisted store link
// + code can be sent — either by hand (send:false, the default) or, once Task 6
// wires sendInvite, automatically (send:true).
//
// NEVER publicly callable: proxy.ts exempts /api/admin from the cookie gate
// (so a bearer request isn't redirected to /login, the same fix /api/cron
// needed), and THIS assertCronSecret check is the real gate — a missing/wrong
// secret fails closed. The waitlist stays deny-all (Shape 3): only this
// service-role path writes the invite columns.

// Upper bound on a single batch, whether selected by explicit emails or by
// `limit`, so an accidental huge invite is impossible.
const MAX_BATCH = 500

function generateInviteCode(): string {
  // 128 bits, URL-safe. Unguessable so the code can gate a signup on its own
  // (the partial unique index on invite_code guarantees no two rows collide).
  return randomBytes(16).toString('base64url')
}

export async function POST(request: Request) {
  const denied = assertCronSecret(request)
  if (denied) return denied

  let body: { emails?: unknown; limit?: unknown; cohort?: unknown; send?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 })
  }

  const cohort =
    typeof body.cohort === 'string' && body.cohort.trim() !== '' ? body.cohort.trim() : null
  const send = body.send === true

  const admin = createAdminClient()

  // Resolve the target UNINVITED waitlist rows: either an explicit email list,
  // or the N oldest uninvited rows (FIFO fairness for the waitlist).
  let targets: { id: string; email: string }[] = []

  if (Array.isArray(body.emails) && body.emails.length > 0) {
    const emails = body.emails
      .filter((e): e is string => typeof e === 'string')
      .map((e) => e.trim().toLowerCase())
      .slice(0, MAX_BATCH)
    const { data, error } = await admin
      .from('waitlist')
      .select('id, email')
      .in('email', emails)
      .is('invited_at', null)
    if (error) return NextResponse.json({ error: 'Selection failed.' }, { status: 500 })
    targets = data ?? []
  } else {
    const rawLimit = typeof body.limit === 'number' ? body.limit : NaN
    if (!Number.isInteger(rawLimit) || rawLimit < 1) {
      return NextResponse.json(
        { error: 'Provide `emails: string[]` or `limit: number` (>= 1).' },
        { status: 400 }
      )
    }
    const limit = Math.min(rawLimit, MAX_BATCH)
    const { data, error } = await admin
      .from('waitlist')
      .select('id, email')
      .is('invited_at', null)
      .order('created_at', { ascending: true })
      .limit(limit)
    if (error) return NextResponse.json({ error: 'Selection failed.' }, { status: 500 })
    targets = data ?? []
  }

  // Mark each target invited with a fresh code. The `.is('invited_at', null)`
  // guard on the UPDATE makes a concurrent double-invite a no-op: a row already
  // grabbed by another call updates zero rows here and is skipped, never
  // re-coded.
  const invited: { email: string; code: string }[] = []
  for (const row of targets) {
    const code = generateInviteCode()
    const { data, error } = await admin
      .from('waitlist')
      .update({ invited_at: new Date().toISOString(), invite_code: code, cohort })
      .eq('id', row.id)
      .is('invited_at', null)
      .select('email, invite_code')
      .maybeSingle()
    // A unique-collision on invite_code is astronomically unlikely (128 bits);
    // skip a failed row rather than fail the whole batch.
    if (error) continue
    if (data?.invite_code) invited.push({ email: data.email, code: data.invite_code })
  }

  const storeUrl = process.env.CALYXA_STORE_URL ?? null

  if (send) {
    // TODO(Task 6, ADR-045): dispatch each invite via
    // sendInvite(email, code, storeUrl) here. sendInvite does not exist yet, so
    // for now we still return the batch below — no invite is lost, and sending
    // is wired in Task 6. `sent` stays false until then.
  }

  return NextResponse.json({
    invited: invited.length,
    cohort,
    storeUrl,
    // The batch for a manual send (send:false): email + code per invited row.
    batch: invited,
    // Task 6 flips this true once sendInvite dispatches. Not yet wired.
    sent: false,
  })
}
