// The advertised price of Pro, in one place.
//
// This exists because the number had already drifted. `components/marketing/
// Pricing.tsx` said $10 and the post-login account page said "$8 / month" — two
// hand-written copies of one fact, and the signed-in surface (the one a paying
// customer reads) was the stale one. Every surface that prints a price now
// imports from here, and `tests/pricing.test.ts` binds them so a future edit to
// one cannot silently disagree with the others.
//
// NOT the source of truth for what a customer is actually CHARGED. That is the
// Stripe Price object behind `STRIPE_PRICE_ID`, which lives in the Stripe
// dashboard, not in this repo — Checkout renders its amount, not this constant.
// Changing this number changes the marketing copy only. If the two disagree, the
// fix is to update the Stripe Price (or point STRIPE_PRICE_ID at a new one) and
// then match it here.
//
// Deliberately dependency-free so a client component can import it without
// dragging in `@supabase/supabase-js` — the reason the free-session allowance
// (`FREE_SESSION_LIMIT` in lib/tier/session-gate) has to be mirrored by hand
// instead of shared.

/** Pro, in whole US dollars per month. */
export const PRO_MONTHLY_USD = 10

/** "$10" — the bare figure, for a price row that supplies its own "/ month". */
export const PRO_PRICE = `$${PRO_MONTHLY_USD}`

/** "$10 / month" — the full phrase. */
export const PRO_PRICE_PER_MONTH = `${PRO_PRICE} / month`
