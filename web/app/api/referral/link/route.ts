import { NextResponse } from 'next/server'
import { clientFromBearerOrCookie } from '@/lib/auth/bearer'
import { createAdminClient } from '@/lib/supabase/admin'
import { ensureReferralCode, referralLink } from '@/lib/referral/referral'

// ADR-053: allocate (create-if-absent, idempotent) the caller's referral code
// and return the shareable link. The code is a server-managed column — written
// only here, via the service role — so a client can never choose or overwrite
// its own code; auth still comes first from the caller's bearer/cookie
// session, and the admin write is scoped to that verified user id.
export async function POST(request: Request) {
  const auth = await clientFromBearerOrCookie(request)

  if ('error' in auth) {
    return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })
  }

  const code = await ensureReferralCode(createAdminClient(), auth.user.id)

  if (!code) {
    return NextResponse.json(
      { error: 'Could not create your referral link right now.' },
      { status: 502 }
    )
  }

  return NextResponse.json({ code, link: referralLink(code) })
}
