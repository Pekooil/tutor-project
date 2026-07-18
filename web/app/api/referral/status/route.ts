import { NextResponse } from 'next/server'
import { clientFromBearerOrCookie } from '@/lib/auth/bearer'
import { readReferralStatus } from '@/lib/referral/referral'

// ADR-053: the caller's referral state — code/link (if already allocated),
// referred-signup count, progress to the next +10-session reward, spendable
// bonus balance, and completed-session count (the extension uses the latter
// two to decide when to OFFER the referral card: the 5-completed-sessions
// milestone and the out-of-sessions moment). Bearer (extension) or cookie
// (dashboard), like /api/study/list. Read-only: allocating a code is
// POST /api/referral/link.
export async function GET(request: Request) {
  const auth = await clientFromBearerOrCookie(request)

  if ('error' in auth) {
    return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })
  }

  const status = await readReferralStatus(auth.supabase, auth.user.id)

  if (!status) {
    return NextResponse.json(
      { error: 'Could not load your referral status right now.' },
      { status: 502 }
    )
  }

  return NextResponse.json(status)
}
