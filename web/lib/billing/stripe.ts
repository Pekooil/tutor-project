import 'server-only'
import Stripe from 'stripe'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createAdminClient } from '@/lib/supabase/admin'

// Sprint 23 / Task 3 (ADR-050): the one server-only entry point to Stripe.
// The `server-only` import turns any accidental import from a Client Component
// (or, transitively, into the extension bundle) into a build error rather than
// a leaked STRIPE_SECRET_KEY — the same guard `web/lib/supabase/admin.ts` uses
// for the service-role key (ADR-003), and the ADR-006 / ADR-050 discipline that
// Stripe is server/web-only: the extension never imports this file, it links
// out to the web `/billing` page.

// The Stripe client is constructed per call, reading STRIPE_SECRET_KEY at call
// time (not module load) — matching this repo's call-time-env convention
// (`web/lib/voice/elevenlabs.ts`, `web/lib/monitoring/init.ts`) so a missing key
// is a clean, catchable error on the request that needs it, never a boot crash,
// and so Task 8's tests can set/mocked the env per case. Construction is a cheap
// object build with no network, so per-call is fine.
//
// `apiVersion` is intentionally NOT pinned here: omitting it lets the installed
// SDK use its own pinned default (and keeps the config typecheck-clean against
// whatever version is installed). Pinning an explicit `apiVersion` is a one-line
// future add if we want to decouple SDK upgrades from API-version bumps.
export function stripeClient(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY
  if (!key) {
    throw new Error('STRIPE_SECRET_KEY is not set — the billing routes cannot reach Stripe.')
  }
  return new Stripe(key)
}

// The single Pro price id (a Stripe Price, `price_...`), from env — never a
// hard-coded literal, so switching the test-mode vs live price, or retuning the
// plan, is an env change, not a code change. Throws (caught by the route → a
// clean 500) if unset, since a checkout can't be built without it.
export function getProPriceId(): string {
  const priceId = process.env.STRIPE_PRICE_ID
  if (!priceId) {
    throw new Error('STRIPE_PRICE_ID is not set — cannot create a Pro checkout session.')
  }
  return priceId
}

// The site's own absolute origin, for Stripe success/cancel/return redirect
// URLs (Stripe requires absolute URLs). `NEXT_PUBLIC_SITE_URL` is the base-URL
// convention already established by the marketing site (Sprint 20); it falls
// back to localhost for dev. Deliberately env-based rather than derived from the
// request Host header, so a spoofed Host can't redirect a post-checkout user off
// to an attacker origin.
export function siteBaseUrl(): string {
  return process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'
}

type EnsureCustomerResult = { customerId: string } | { error: string }

// Ensure the caller has a Stripe Customer, keyed on the existing
// `users.stripe_customer_id` unique index (migration 0003): reuse it if present,
// else create a Customer and store the id back on the caller's own row.
//
// `supabase` is the caller's RLS-scoped client (bearer-or-cookie): the READ is
// scoped by `users_select_own` (Shape 1, 0001). The WRITE-back of the new
// customer id runs on the service-role client since migration 0025 revoked
// client UPDATE on billing columns (stripe_customer_id must be server-managed
// — the webhook + reconcile cron key on it), explicitly scoped to the
// route-verified caller id. The created Customer carries
// `metadata.supabase_user_id` so the webhook (Task 4) and reconcile cron
// (Task 5) can recover the mapping even from the Stripe side.
export async function ensureStripeCustomer(
  supabase: SupabaseClient,
  user: { id: string; email?: string | null }
): Promise<EnsureCustomerResult> {
  const { data, error } = await supabase
    .from('users')
    .select('stripe_customer_id, email')
    .eq('id', user.id)
    .maybeSingle()

  if (error) {
    console.error('billing: could not read the caller users row for customer lookup', error)
    return { error: 'Could not read your billing profile.' }
  }

  // Reuse — the common path once a user has checked out (or been created) once.
  if (data?.stripe_customer_id) {
    return { customerId: data.stripe_customer_id }
  }

  const stripe = stripeClient()
  const customer = await stripe.customers.create({
    email: data?.email ?? user.email ?? undefined,
    metadata: { supabase_user_id: user.id },
  })

  // Service-role write (migration 0025): client UPDATE on billing columns is
  // revoked — the webhook + reconcile cron key on stripe_customer_id, so it
  // is server-managed like every other billing column. The explicit
  // `.eq('id', user.id)` against the route-verified caller id is the scoping
  // (the telemetry-export pattern), not RLS.
  const { error: updateError } = await createAdminClient()
    .from('users')
    .update({ stripe_customer_id: customer.id })
    .eq('id', user.id)

  if (updateError) {
    // The Customer exists in Stripe but we failed to persist the mapping on our
    // side. Don't block the checkout the user is trying to complete — return the
    // id so this request proceeds; the webhook (Task 4) re-associates by
    // stripe_customer_id / metadata.supabase_user_id. Logged loudly because an
    // unpersisted mapping risks a duplicate Customer on a later retry.
    console.error('billing: created a Stripe Customer but failed to store stripe_customer_id', updateError)
  }

  return { customerId: customer.id }
}
