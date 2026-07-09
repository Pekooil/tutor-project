import { NextResponse } from 'next/server'
import { assertCronSecret } from '@/lib/cron/auth'

// Sprint 16 / Task 6 (ADR-036): a wired no-op. Reserves the cron surface
// (route + vercel.json entry + the CRON_SECRET gate) so Sprint 23/billing
// fills a real body against a known pattern instead of discovering the
// wiring is missing. No Stripe SDK, no reconciliation logic — deliberately.
export async function GET(request: Request) {
  const authError = assertCronSecret(request)
  if (authError) return authError

  return NextResponse.json({ ok: true, note: 'not yet implemented — Sprint 23 owns this' })
}
