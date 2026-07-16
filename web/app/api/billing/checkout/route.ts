import { NextResponse } from 'next/server'
import { clientFromBearerOrCookie } from '@/lib/auth/bearer'
import { ensureStripeCustomer, getProPriceId, siteBaseUrl, stripeClient } from '@/lib/billing/stripe'

// Sprint 23 / Task 3 (ADR-050): POST — start a Stripe Checkout for the Pro plan.
// Order: auth → ensure a Stripe Customer (keyed on the existing
// users.stripe_customer_id unique index) → create a subscription Checkout
// Session for the Pro price with success/cancel URLs back to the dashboard →
// return the session URL for the client to redirect to.
//
// Auth is bearer-OR-cookie: the dashboard `/billing` page (Task 7) calls with a
// cookie session; a bearer token also works. RLS on `auth.supabase` is the
// ownership guarantee — the Customer read/write only ever touches the caller's
// own row, so a user can never create a checkout against another user's billing
// profile (the acceptance gate's "RLS-scoped" requirement).
//
// No Pro/entitlement gate here — a free user is exactly who should reach
// checkout. Stripe is server-only (ADR-006): nothing here is bundled into the
// extension, and STRIPE_SECRET_KEY never leaves the server.
//
// Response shapes:
//   200 { url }        — the Stripe-hosted Checkout URL to redirect to
//   401 { error }      — not signed in
//   500 { error }      — server misconfig (STRIPE_SECRET_KEY / STRIPE_PRICE_ID unset)
//   502 { error }      — Stripe API call failed (generic; never leak Stripe error text)

export async function POST(request: Request) {
  const auth = await clientFromBearerOrCookie(request)

  if ('error' in auth) {
    return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })
  }

  // Resolve the price id first so a config defect is a clean 500 before we touch
  // Stripe or create a Customer.
  let priceId: string
  try {
    priceId = getProPriceId()
  } catch (err) {
    console.error('billing/checkout: Stripe price not configured', err)
    return NextResponse.json({ error: 'Billing is not configured.' }, { status: 500 })
  }

  const customer = await ensureStripeCustomer(auth.supabase, {
    id: auth.user.id,
    email: auth.user.email,
  })

  if ('error' in customer) {
    return NextResponse.json({ error: customer.error }, { status: 502 })
  }

  const base = siteBaseUrl()

  try {
    const session = await stripeClient().checkout.sessions.create({
      mode: 'subscription',
      customer: customer.customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      // Back to the dashboard billing page either way; the page (Task 7) reads
      // the `checkout` query param to show a confirmation / cancelled notice.
      success_url: `${base}/billing?checkout=success`,
      cancel_url: `${base}/billing?checkout=cancelled`,
    })

    if (!session.url) {
      // Stripe returned a session with no hosted URL — treat as a provider fault.
      console.error('billing/checkout: Stripe returned a session with no url')
      return NextResponse.json({ error: 'Could not start checkout.' }, { status: 502 })
    }

    return NextResponse.json({ url: session.url })
  } catch (err) {
    console.error('billing/checkout: Stripe checkout.sessions.create failed', err)
    return NextResponse.json({ error: 'Could not start checkout.' }, { status: 502 })
  }
}
