import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { checkRateLimit, clientBucket, tooManyRequests } from '@/lib/rate-limit/limiter'

// Sprint 19 / Task 5 (ADR-045): validate an invite code from a signed-out
// context — a tester checking their code before (or during) signup. Public and
// rate-limited like /api/waitlist (proxy.ts exempts /api/invite from the
// cookie gate). It returns ONLY whether the code maps to an invited waitlist
// row — never the associated email — so it is a boolean oracle at worst, and
// 128-bit codes make guessing infeasible even before the rate limit.
//
// This endpoint is a UX convenience, NOT the security boundary: POST
// /api/auth/signup does its OWN allowlist check server-side (email-on-invited-
// row OR a valid code) before creating any user. The waitlist stays deny-all;
// this read uses the service-role client.

export async function POST(request: Request) {
  const admin = createAdminClient()

  const rate = await checkRateLimit(admin, 'invite', clientBucket(request, 'invite'))
  if (!rate.allowed) return tooManyRequests(rate.retryAfterSeconds)

  let body: { code?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ valid: false }, { status: 400 })
  }

  const code = typeof body.code === 'string' ? body.code.trim() : ''
  if (!code) return NextResponse.json({ valid: false })

  // Valid iff the code sits on an INVITED waitlist row (invited_at not null).
  const { data } = await admin
    .from('waitlist')
    .select('id')
    .eq('invite_code', code)
    .not('invited_at', 'is', null)
    .maybeSingle()

  return NextResponse.json({ valid: !!data })
}
