import { NextResponse } from 'next/server'
import { clientFromBearerOrCookie } from '@/lib/auth/bearer'
import { siteBaseUrl, stripeClient } from '@/lib/billing/stripe'

// Sprint 23 / Task 3 (ADR-050): POST — open the Stripe customer portal so a Pro
// user can manage or cancel their subscription. Stripe's hosted portal is the V1
// management surface (no bespoke manage/cancel UI — out of scope this sprint).
//
// Auth is bearer-OR-cookie; RLS on `auth.supabase` scopes the customer-id read
// to the caller's own row. A user with no Stripe Customer yet (never checked
// out) has nothing to manage → 400, not a Stripe call.
//
// Response shapes:
//   200 { url }        — the Stripe-hosted billing-portal URL to redirect to
//   401 { error }      — not signed in
//   400 { error }      — no Stripe customer on file (nothing to manage)
//   502 { error }      — Stripe API call failed (generic; never leak Stripe error text)

export async function POST(request: Request) {
  const auth = await clientFromBearerOrCookie(request)

  if ('error' in auth) {
    return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })
  }

  const { data, error } = await auth.supabase
    .from('users')
    .select('stripe_customer_id')
    .eq('id', auth.user.id)
    .maybeSingle()

  if (error) {
    console.error('billing/portal: could not read the caller users row', error)
    return NextResponse.json({ error: 'Could not read your billing profile.' }, { status: 502 })
  }

  if (!data?.stripe_customer_id) {
    return NextResponse.json(
      { error: 'No subscription to manage yet.' },
      { status: 400 }
    )
  }

  try {
    const session = await stripeClient().billingPortal.sessions.create({
      customer: data.stripe_customer_id,
      return_url: `${siteBaseUrl()}/billing`,
    })

    return NextResponse.json({ url: session.url })
  } catch (err) {
    console.error('billing/portal: Stripe billingPortal.sessions.create failed', err)
    return NextResponse.json({ error: 'Could not open the billing portal.' }, { status: 502 })
  }
}
