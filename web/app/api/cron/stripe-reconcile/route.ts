import { NextResponse } from 'next/server'
import type Stripe from 'stripe'
import { stripeClient } from '@/lib/billing/stripe'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertCronSecret } from '@/lib/cron/auth'

// Sprint 23 / Task 5 (ADR-050 decision 1): the daily reconcile cron — the SAFETY
// NET beneath the webhook. Webhooks (Task 4) are the fast path and the source of
// truth, but a delivery can be dropped (Stripe outage, a 500 on our side, a
// missed retry). This cron pulls the LIVE Stripe state for every billing-engaged
// user and heals any drift, so a dropped webhook self-heals within one cycle —
// PLAN §2.8's exact backstop. Webhooks make billing state correct quickly;
// this cron makes it correct *eventually and guaranteed*.
//
// It also OWNS the grace-window downgrade: an `invoice.payment_failed` webhook
// moves a user to `past_due` with Pro RETAINED (no mid-session lockout), and
// only a terminal `customer.subscription.deleted` or THIS cron's grace expiry
// flips them back to free. Stripe's dunning (Smart Retries) can keep a
// subscription `past_due` for ~2 weeks before it cancels; PAST_DUE_GRACE_DAYS
// covers that window so a transient failure never locks a student out, while an
// abandoned subscription is still eventually downgraded.
//
// Runs on the Node runtime (Stripe SDK uses Node crypto/http). CRON_SECRET-gated
// via the shared `assertCronSecret` (fails CLOSED — it holds the service-role
// admin client). Service-role because it reads/writes across every user (RLS is
// per-user and would block a bulk cross-user reconcile). Idempotent: every write
// sets the row to Stripe's current state, so re-running the same day is a no-op
// against unchanged rows (the diff below skips them) — safe to re-run.
export const runtime = 'nodejs'

const MS_PER_DAY = 1000 * 60 * 60 * 24

// How many users to page per query; each is then reconciled against Stripe.
const USER_BATCH = 100
// Safety ceiling on pages so a query bug can never spin forever (100k users).
const MAX_PAGES = 1000

// The past_due grace window. Stripe's default Smart Retries dun a failed
// invoice for up to ~2 weeks before the subscription auto-cancels; keeping Pro
// through 14 days of `past_due` comfortably covers that so a recoverable
// payment failure never downgrades a paying student, while an abandoned
// subscription (Stripe never recovers it) is downgraded here at expiry rather
// than waiting indefinitely for a `deleted` event. A named, tunable constant.
const PAST_DUE_GRACE_DAYS = 14

// Live = a subscription that should confer Pro (matching the webhook's
// tierForStatus). past_due is "live" (grace); the day-count check below is what
// expires it. A canceled/unpaid/incomplete subscription is not live.
const LIVE_STATUSES = new Set<Stripe.Subscription.Status>(['active', 'trialing', 'past_due'])

// Status → tier. Deliberately mirrors the webhook's tierForStatus so the two
// billing-write paths agree on what "Pro" means (kept local to stay within
// Task 5's file scope; a shared helper in lib/billing is a future refactor —
// see the handoff note in the sprint plan).
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

// In stripe@22 the period end lives on the subscription ITEM, not the
// subscription top-level (the same read the webhook's applySubscription uses).
function periodEndOf(sub: Stripe.Subscription): number | null {
  return sub.items.data[0]?.current_period_end ?? null
}

// Pick the subscription that decides the user's tier from everything Stripe has
// for the customer: prefer a live one (active/trialing/past_due), the latest by
// period end if several; if none is live, fall back to the latest of whatever
// exists (so a lone canceled sub still supplies its status). null only when the
// customer has no subscriptions at all.
function pickSubscription(subs: Stripe.Subscription[]): Stripe.Subscription | null {
  if (subs.length === 0) return null
  const live = subs.filter((s) => LIVE_STATUSES.has(s.status))
  const pool = live.length > 0 ? live : subs
  return pool.reduce((best, s) => ((periodEndOf(s) ?? 0) > (periodEndOf(best) ?? 0) ? s : best))
}

type BillingRow = {
  id: string
  stripe_customer_id: string
  stripe_subscription_id: string | null
  subscription_tier: 'free' | 'pro'
  subscription_status: string | null
  subscription_renews_at: string | null
}

type BillingFields = {
  subscription_tier: 'free' | 'pro'
  subscription_status: string | null
  subscription_renews_at: string | null
  stripe_subscription_id: string | null
}

// The billing state the user's row SHOULD hold given Stripe's live view.
// Mirrors the webhook's write shape, plus the grace-window rule this cron owns.
function reconcileFields(current: BillingRow, sub: Stripe.Subscription | null, now: number): BillingFields {
  if (sub && tierForStatus(sub.status) === 'pro') {
    const periodEnd = periodEndOf(sub)
    const renews = periodEnd != null ? new Date(periodEnd * 1000).toISOString() : null

    // Grace expiry: a past_due subscription older than the grace window is
    // downgraded to free HERE. tier is the grace authority — the RPC gates on
    // subscription_tier and the entitlements resolver keys on it, so flipping
    // tier to free (while subscription_status still mirrors Stripe's `past_due`)
    // is the downgrade; a still-`past_due` row with tier `pro` = in grace.
    const graceExpired =
      sub.status === 'past_due' &&
      periodEnd != null &&
      (now - periodEnd * 1000) / MS_PER_DAY > PAST_DUE_GRACE_DAYS

    return {
      subscription_tier: graceExpired ? 'free' : 'pro',
      subscription_status: sub.status,
      subscription_renews_at: renews,
      // Self-heals a dropped checkout.session.completed: the local id may be
      // null even though Stripe has an active subscription.
      stripe_subscription_id: sub.id,
    }
  }

  // No live subscription (none exist, or the only ones are terminal) → free.
  // Keep the existing subscription id for audit (mirrors the webhook's
  // subscription.deleted handler, which does not clear it).
  return {
    subscription_tier: 'free',
    subscription_status: sub?.status ?? current.subscription_status ?? 'canceled',
    subscription_renews_at: null,
    stripe_subscription_id: current.stripe_subscription_id ?? sub?.id ?? null,
  }
}

// Instant-aware timestamp equality — a Postgres timestamptz ("...+00:00") and a
// JS ISO string ("...Z") for the same moment are not string-equal, so compare
// by epoch to avoid a phantom diff that would rewrite the row every run.
function sameInstant(a: string | null, b: string | null): boolean {
  if (a === null || b === null) return a === b
  return new Date(a).getTime() === new Date(b).getTime()
}

// Only the fields whose value actually changes, so an unchanged row is skipped
// (idempotent re-runs, meaningful `reconciled` count, no churned updated_at).
function changedFields(current: BillingRow, target: BillingFields): Partial<BillingFields> {
  const changed: Partial<BillingFields> = {}
  if (target.subscription_tier !== current.subscription_tier) {
    changed.subscription_tier = target.subscription_tier
  }
  if (target.subscription_status !== current.subscription_status) {
    changed.subscription_status = target.subscription_status
  }
  if (!sameInstant(target.subscription_renews_at, current.subscription_renews_at)) {
    changed.subscription_renews_at = target.subscription_renews_at
  }
  if (target.stripe_subscription_id !== current.stripe_subscription_id) {
    changed.stripe_subscription_id = target.stripe_subscription_id
  }
  return changed
}

export async function GET(request: Request) {
  const authError = assertCronSecret(request)
  if (authError) return authError

  let stripe: Stripe
  try {
    stripe = stripeClient()
  } catch (err) {
    console.error('cron/stripe-reconcile: Stripe client unavailable', err)
    return NextResponse.json({ error: 'Billing is not configured.' }, { status: 500 })
  }

  const supabase = createAdminClient()
  const now = Date.now()

  let usersScanned = 0
  let reconciled = 0
  const failedUsers: string[] = []

  // Reconcile every billing-ENGAGED user — anyone with a stripe_customer_id.
  // That set is exactly the users whose row could have drifted from Stripe (a
  // customer id is only ever set when they reach checkout), and it is the
  // honest superset of the plan's "renews_at passed OR status looks stale"
  // filters: it also catches a dropped checkout.session.completed (still `free`
  // locally, active in Stripe) that a renews_at/status pre-filter would miss.
  // At beta scale this is a handful of customers; a pre-filter to narrow the
  // Stripe pulls is a future optimization (noted in the sprint plan) if the
  // customer count ever grows large.
  for (let page = 0; page < MAX_PAGES; page++) {
    const from = page * USER_BATCH
    const { data: users, error: usersError } = await supabase
      .from('users')
      .select(
        'id, stripe_customer_id, stripe_subscription_id, subscription_tier, subscription_status, subscription_renews_at'
      )
      .not('stripe_customer_id', 'is', null)
      .is('deleted_at', null)
      .order('id', { ascending: true })
      .range(from, from + USER_BATCH - 1)

    if (usersError) {
      console.error('cron/stripe-reconcile: user page query failed', page, usersError)
      return NextResponse.json({ error: 'Reconcile query failed' }, { status: 500 })
    }

    const batch = (users ?? []) as BillingRow[]

    for (const user of batch) {
      usersScanned++
      try {
        // Pull the live Stripe view for this customer. status:'all' so canceled
        // subscriptions are visible (needed to downgrade a stale `pro` row);
        // limit is generous for single-plan V1 (a customer has at most a couple
        // of subscription records over its lifetime).
        const subs = await stripe.subscriptions.list({
          customer: user.stripe_customer_id,
          status: 'all',
          limit: 10,
        })

        const target = reconcileFields(user, pickSubscription(subs.data), now)
        const changed = changedFields(user, target)

        if (Object.keys(changed).length === 0) continue

        const { error: updateError } = await supabase.from('users').update(changed).eq('id', user.id)
        if (updateError) {
          console.error('cron/stripe-reconcile: user update failed', user.id, updateError)
          failedUsers.push(user.id)
          continue
        }

        reconciled++
      } catch (err) {
        // A per-user Stripe/DB failure must not abort the whole run — the next
        // day's run (or a live webhook) will heal this user.
        console.error('cron/stripe-reconcile: reconcile failed for user', user.id, err)
        failedUsers.push(user.id)
      }
    }

    // A short (or empty) page means we've reached the end of the customer set.
    if (batch.length < USER_BATCH) break
  }

  return NextResponse.json({
    ok: failedUsers.length === 0,
    usersScanned,
    reconciled,
    failedUsers,
  })
}
