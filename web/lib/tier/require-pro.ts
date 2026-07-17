import 'server-only'
import { NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  resolveEntitlements,
  isEntitlementGranted,
  type EntitlementFlag,
} from '@/lib/entitlements/resolve'

// Sprint 23 / Task 6 (ADR-051): the server-side Pro gate. Any Pro-only endpoint
// calls this FIRST — it RE-DERIVES entitlements from the caller's own users row
// (never from a client-supplied value; the extension's cached ActiveSession
// entitlement is display-only) and refuses the request if the flag isn't
// granted. This is the "client is a display hint only" discipline extended from
// the free-tier gate to entitlements: a user who forges a Pro flag client-side
// is still rejected here because the check reads the row.
//
// Ergonomics mirror assertCronSecret (web/lib/cron/auth.ts): returns a
// NextResponse to short-circuit on failure, or null to proceed — a one-line
// gate at the top of a route:
//
//   const gate = await assertEntitlement(supabase, 'unlimited_history')
//   if (gate) return gate
//   // ...Pro-only work...
//
// Which features are Pro is each feature's own call: Sprint 21's unlimited study
// kits gate on (say) a study-kit flag, Sprint 22's dashboard depth on
// 'full_dashboard' / 'unlimited_history'. This helper is the shared mechanism
// those one-line gates reserve.
//
// `supabase` MUST be the caller's RLS-scoped client (clientFromBearer /
// clientFromBearerOrCookie) — the row read is scoped to the caller by
// `users_select_own` (0001) and the explicit id filter, so this can only ever
// read the caller's own entitlement, never another user's.
//
// Fails CLOSED: an unauthenticated caller → 401; an authenticated caller whose
// row can't be read or whose flag isn't granted → 403. A Pro path never
// proceeds on an unconfirmed entitlement.
export async function assertEntitlement(
  supabase: SupabaseClient,
  flag: EntitlementFlag
): Promise<NextResponse | null> {
  const { data: auth, error: authError } = await supabase.auth.getUser()
  if (authError || !auth?.user) {
    return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })
  }

  const { data, error } = await supabase
    .from('users')
    .select('subscription_tier, subscription_status')
    .eq('id', auth.user.id)
    .maybeSingle()

  if (error || !data) {
    // Can't confirm the entitlement (missing row / read error) → deny.
    console.error('assertEntitlement: could not read caller billing row', error)
    return NextResponse.json({ error: 'Forbidden.' }, { status: 403 })
  }

  const entitlements = resolveEntitlements(data.subscription_tier, data.subscription_status)

  if (!isEntitlementGranted(entitlements[flag])) {
    return NextResponse.json(
      { error: 'This feature requires Calyxa Pro.', flag },
      { status: 403 }
    )
  }

  return null
}
