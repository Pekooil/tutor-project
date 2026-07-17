import { NextResponse } from 'next/server'
import type Stripe from 'stripe'
import { stripeClient } from '@/lib/billing/stripe'
import { createAdminClient } from '@/lib/supabase/admin'

// Sprint 23 / Task 4 (ADR-050): the Stripe webhook — the SOURCE OF TRUTH for the
// users billing columns. PUBLIC (Stripe calls it unauthenticated) but
// SIGNATURE-authenticated: its security is the Stripe signature, not a session.
// Added to proxy.ts's public-path allowlist like /api/waitlist was.
//
// Runs on the Node runtime (default): constructEvent uses Node crypto, and we
// read the exact RAW body via request.text() — a parsed/re-serialized body would
// silently break signature verification.
export const runtime = 'nodejs'

// The order is the plan's acceptance gate:
//   1. verify the raw-body signature → 400 on failure, NO processing (fail closed)
//   2. record the event id FIRST in stripe_events (deny-all; service-role) with
//      on-conflict-do-nothing → a zero-row insert means already processed → 200
//      (idempotent; Stripe retries / dashboard redeliveries never double-apply)
//   3. apply the event to the matching user's billing columns
//
// If step 3 fails after step 2 recorded the event, the daily reconcile cron
// (Task 5) is the backstop that self-heals the dropped apply — webhooks are the
// fast path, reconcile is the correctness guarantee (ADR-050 decision 1).

// Pro is retained through active, trialing, AND past_due (the grace window —
// ADR-050 §5 / ADR-051): a transient payment failure never locks a student out
// mid-session. Everything terminal or not-yet-paid resolves to free; only a
// customer.subscription.deleted or the reconcile cron's grace expiry downgrades.
function tierForStatus(status: Stripe.Subscription.Status): 'free' | 'pro' {
  switch (status) {
    case 'active':
    case 'trialing':
    case 'past_due':
      return 'pro'
    default:
      // canceled, unpaid, incomplete, incomplete_expired, paused
      return 'free'
  }
}

function customerIdOf(
  ref: string | { id: string } | null | undefined
): string | null {
  if (!ref) return null
  return typeof ref === 'string' ? ref : ref.id
}

type AdminClient = ReturnType<typeof createAdminClient>

// Service-role update, matched by the existing stripe_customer_id unique index
// (0003). The webhook has no user session, so this deliberately bypasses RLS —
// the only sanctioned service-role write to a user row from a billing path.
async function updateUserByCustomer(
  admin: AdminClient,
  customerId: string,
  fields: Record<string, unknown>
): Promise<void> {
  const { error } = await admin.from('users').update(fields).eq('stripe_customer_id', customerId)
  if (error) {
    throw new Error(`users update failed for customer ${customerId}: ${error.message}`)
  }
}

// checkout.session.completed + customer.subscription.updated share this: map the
// subscription's status → tier + status, and its period end → renews_at. In
// stripe@22 the period end lives on the subscription ITEM, not the subscription
// top-level (a recent API change), so it is read from items.data[0].
async function applySubscription(admin: AdminClient, sub: Stripe.Subscription): Promise<void> {
  const customerId = customerIdOf(sub.customer)
  if (!customerId) return

  const periodEnd = sub.items.data[0]?.current_period_end
  await updateUserByCustomer(admin, customerId, {
    subscription_tier: tierForStatus(sub.status),
    subscription_status: sub.status,
    stripe_subscription_id: sub.id,
    subscription_renews_at: periodEnd ? new Date(periodEnd * 1000).toISOString() : null,
  })
}

export async function POST(request: Request) {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET
  if (!webhookSecret) {
    console.error('billing/webhook: STRIPE_WEBHOOK_SECRET is not set')
    return NextResponse.json({ error: 'Billing webhook is not configured.' }, { status: 500 })
  }

  let stripe: Stripe
  try {
    stripe = stripeClient()
  } catch (err) {
    console.error('billing/webhook: Stripe client unavailable', err)
    return NextResponse.json({ error: 'Billing is not configured.' }, { status: 500 })
  }

  const signature = request.headers.get('stripe-signature')
  if (!signature) {
    return NextResponse.json({ error: 'Missing signature.' }, { status: 400 })
  }

  // The EXACT raw bytes — never request.json() (a re-serialized body fails
  // verification).
  const rawBody = await request.text()

  let event: Stripe.Event
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret)
  } catch (err) {
    // Unverifiable signature → hard 400, no processing (fail closed).
    console.error('billing/webhook: signature verification failed', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'Invalid signature.' }, { status: 400 })
  }

  const admin = createAdminClient()

  // Idempotency: record the event id FIRST. `ignoreDuplicates` emits
  // INSERT ... ON CONFLICT (event_id) DO NOTHING; `.select()` returns the
  // inserted row(s) — empty on a conflict, i.e. an already-processed redelivery.
  const { data: inserted, error: insertError } = await admin
    .from('stripe_events')
    .upsert({ event_id: event.id, type: event.type }, { onConflict: 'event_id', ignoreDuplicates: true })
    .select('event_id')

  if (insertError) {
    // Couldn't record the event — return 500 so Stripe retries; the event is
    // NOT yet marked seen, so the retry processes it cleanly (no double-apply).
    console.error('billing/webhook: could not record event id', insertError)
    return NextResponse.json({ error: 'Could not record event.' }, { status: 500 })
  }

  if (!inserted || inserted.length === 0) {
    // Already processed — idempotent no-op (Stripe retry / dashboard redelivery).
    return NextResponse.json({ received: true, duplicate: true })
  }

  // First time seeing this event — apply it. A failure here is logged and still
  // returns 200: the event is recorded, and the daily reconcile cron (Task 5)
  // self-heals the dropped apply. Re-returning 500 would only make Stripe retry
  // a delivery the idempotency guard now blocks from re-applying.
  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session
        const subId = customerIdOf(session.subscription as string | { id: string } | null)
        if (subId) {
          // Retrieve the full subscription so this event applies the same
          // status→tier + period→renews_at as customer.subscription.updated.
          const sub = await stripe.subscriptions.retrieve(subId)
          await applySubscription(admin, sub)
        }
        break
      }

      case 'customer.subscription.updated': {
        await applySubscription(admin, event.data.object as Stripe.Subscription)
        break
      }

      case 'customer.subscription.deleted': {
        // Terminal — always downgrade to free, clear the renewal.
        const sub = event.data.object as Stripe.Subscription
        const customerId = customerIdOf(sub.customer)
        if (customerId) {
          await updateUserByCustomer(admin, customerId, {
            subscription_tier: 'free',
            subscription_status: sub.status,
            subscription_renews_at: null,
          })
        }
        break
      }

      case 'invoice.payment_failed': {
        // Move to past_due; tier deliberately RETAINED (grace window). Only a
        // terminal deleted or the reconcile cron's grace expiry downgrades.
        const invoice = event.data.object as Stripe.Invoice
        const customerId = customerIdOf(invoice.customer)
        if (customerId) {
          await updateUserByCustomer(admin, customerId, { subscription_status: 'past_due' })
        }
        break
      }

      default:
        // Recorded for idempotency, no billing action (we only subscribe to the
        // four above, but Stripe may deliver others).
        break
    }
  } catch (err) {
    console.error('billing/webhook: apply failed; reconcile cron will heal', event.type, err)
  }

  return NextResponse.json({ received: true })
}
