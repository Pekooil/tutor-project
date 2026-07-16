## ADR-050: Stripe billing — Checkout from the dashboard, idempotent webhooks as the source of truth, a reconcile cron as the safety net, and all Stripe secrets server-only

**Status:** Decided

**Context:** Every billing *seam* has existed for the whole life of the project;
every billing *behavior* is missing. The `users` table has carried
`subscription_tier` (`text not null default 'free' check in ('free','pro')`),
`stripe_customer_id` (unique index, migration 0003), `stripe_subscription_id`,
`subscription_status`, and `subscription_renews_at` since 0001 — behavior-free
placeholders waiting for a payment integration. Crucially, the `start_session` RPC
**already exempts non-free users** from the free-session gate (its predicate is
`subscription_tier = 'free'`; a Pro user's start is a no-op increment →
`degraded = false`, `remaining = null`), so a large part of "Pro removes the limit"
is *already wired* and merely waits for something to set `tier = 'pro'`. Sprint 16
(ADR-036) scaffolded a `stripe-reconcile` **cron stub** — a wired no-op that returns
"not yet implemented — Sprint 23 owns this" — on the `assertCronSecret`-gated
(`web/lib/cron/auth.ts`, fails closed) daily-cron infra in `web/vercel.json`, and
ADR-041 explicitly deferred "invoice-accurate accounting (Stripe/billing)" to this
sprint.

What is absent, confirmed against the code and not recalled:

1. **No Stripe SDK or dependency anywhere** — `web/package.json` has no `stripe`.
2. **No webhook handler, no Checkout code, no portal code** — `web/app/api/billing/`
   does not exist; nothing ever sets `tier = 'pro'`.
3. **No idempotency ledger** — the newest migration on disk is `0021_study_artifact`
   (Sprint 21); there is no `stripe_events` table.
4. The only `subscription_tier` *reads* today are the `start_session` RPC gate and
   the account page's read-only display. No code reads Pro *flags* — the entitlements
   resolver is ADR-051's job; `web/lib/entitlements/` is reserved-but-empty.

This is the GA / monetization gate: turn Calyxa from a free beta into a product a
student can pay for, where a paid subscription actually unlocks the entitlements the
product has designed around since Sprint 03, and where a **dropped webhook self-heals**
rather than silently leaving a paying user on free (or a canceled user on Pro).

**Decision:** Stripe Checkout upgrades a user to Pro; **signed, idempotent webhooks are
the source of truth** for the `users` billing columns; a **daily reconcile cron is the
safety net** that self-heals what webhooks drop; and **every Stripe secret is
server-only** — the extension never imports the SDK, it links out to `/billing`. Six
decisions fix the shape:

1. **Webhooks are the source of truth; the reconcile cron is the safety net.** A
   verified webhook (`checkout.session.completed`, `customer.subscription.updated`,
   `customer.subscription.deleted`, `invoice.payment_failed`) is the fast path that
   updates `users.subscription_tier/status/stripe_subscription_id/subscription_renews_at`,
   matched to the user by `stripe_customer_id`. The daily `stripe-reconcile` cron (stub →
   real, Task 5) is the correctness guarantee: for any user whose
   `subscription_renews_at` has passed or whose status looks stale, it pulls the live
   subscription from the Stripe API and reconciles — so a dropped delivery self-heals
   within one cycle. Fast path + backstop is PLAN §2.8's exact design.

2. **Idempotency is a deny-all `stripe_events` table keyed on the Stripe event id.**
   `stripe_events(event_id text primary key, type text not null, received_at timestamptz
   not null default now())`, RLS Shape 3 (deny-all; only the service-role webhook route
   touches it). The webhook handler inserts the event id first with `on conflict do
   nothing`; a **zero-row insert means "already processed"** → the handler returns 200
   without re-applying. This makes Stripe's retries / dashboard redeliveries safe and is
   PLAN §2.8's "idempotent, keyed on the Stripe event id" mechanism. **It is deliberately
   NOT user-scoped:** Stripe events are processing bookkeeping, not a user's personal
   data — so, unlike every user-scoped table since Sprint 16, `stripe_events` carries **no
   FK-to-users** and is **NOT on the export or erasure lists**. This exception is recorded
   in the migration comment so the ADR-035 "every new table joins the export + erasure"
   invariant is not misapplied to it.

3. **The webhook route reads the RAW body for signature verification, and is public but
   signature-authenticated.** Stripe signature verification needs the exact raw request
   body, not re-serialized JSON. The App Router route reads `await request.text()`,
   verifies with `stripe.webhooks.constructEvent(rawBody, sig, WEBHOOK_SECRET)`, and only
   then parses. The route is **public** (Stripe calls it unauthenticated) — added to the
   public-path list exactly as `/api/waitlist` was — but **its auth is the signature, not
   an absence of auth**: an unverifiable signature is a hard **400 with no processing**
   (fail closed).

4. **Setting `tier = 'pro'` is most of the unlock, for free.** Because `start_session`
   already treats non-free as unlimited + non-degraded, the moment a webhook flips
   `tier = 'pro'` the session cap and the voice degradation are gone with **zero RPC
   change**. This ADR therefore does **not** touch `start_session`, the free-tier
   session-gate, or `FREE_SESSION_LIMIT` (retuned to 20 in ADR-041, unchanged). Billing is
   additive over the locked freemium plumbing.

5. **`past_due` gets a grace window before downgrade — no abrupt mid-session lockout.**
   An `invoice.payment_failed` moves the user to `subscription_status = 'past_due'` with
   **Pro retained** for a defined grace period (a named constant, tuned from real dunning
   behavior). Only a terminal `customer.subscription.deleted` — or grace expiry, enforced
   by the reconcile cron — downgrades to free. A transient payment failure never locks a
   student out mid-session; a genuinely-lapsed subscription is still cleaned up.

6. **All Stripe secrets are server-only.** `STRIPE_SECRET_KEY` and the webhook signing
   secret live in env, read only in `web/lib/billing/` and the billing routes, never in
   any bundle. The extension never sees Stripe: it reads the relayed entitlement flags
   (ADR-051) and opens the web `/billing` page as an ordinary link — ADR-006's
   single-egress / no-secret-in-bundle discipline unchanged, and the Sprint 18 no-secret
   CI gate's key list is extended to grep the built bundle for the Stripe key too.

**Rationale:**
- **Webhooks-as-truth + reconcile-as-safety-net is the only design that survives dropped
  deliveries.** Webhooks alone leave a paying user stranded on free (or a canceled user on
  Pro) whenever Stripe fails to reach us; a poll alone is slow and wasteful. The fast path
  gives immediacy, the daily pull gives correctness, and both are testable independently
  (idempotency + self-heal).
- **Event-id idempotency is the minimal correct guard against redelivery.** Stripe retries
  and the dashboard "resend" button both redeliver; an insert-on-conflict-do-nothing keyed
  on the primary key is a one-statement, race-safe "process exactly once" with no
  application-level dedup logic.
- **`stripe_events` is genuinely not personal data.** It records *that event `evt_…` of
  type `…` was seen at `…`* — processing metadata, not anything about a user. Forcing it
  onto the export/erasure paths would misclassify bookkeeping as personal data and couple
  an internal ledger to a user-facing right; the explicit migration comment prevents the
  ADR-035 invariant from being cargo-culted onto it.
- **Raw-body + fail-closed signature verification is non-negotiable for a public route.**
  The webhook is the one unauthenticated write surface in the app; the signature *is* its
  security, so reading the exact bytes `constructEvent` needs (a parsed-then-restringified
  body silently breaks verification) and refusing any unverifiable event with a 400-and-no
  -processing is the safe posture.
- **Leaning on the existing RPC tier exemption keeps the sprint additive.** Re-plumbing the
  session gate to "understand Pro" would risk the locked, race-proof freemium machinery;
  flipping a column the RPC already reads is a smaller, safer change that ships the same
  unlock.
- **A grace window matches real dunning.** Cards fail transiently constantly; downgrading
  on the first `payment_failed` would punish honest users, while never downgrading would
  give free Pro forever. A named grace constant enforced by the cron is the tuned middle.

**Consequences:**
- **Enables:** a monetizable product — a student subscribes via Stripe Checkout, is marked
  Pro by an idempotent webhook, and (via ADR-051's resolver) sees and receives Pro
  entitlements; dropped webhooks self-heal within a day; the GA gate is met.
- **Requires:** a new `stripe_events` migration (deny-all, keyed on event id, **not**
  user-scoped, **not** on export/erasure — rationale in the comment); the `stripe` server
  SDK in `web/package.json`; `web/lib/billing/stripe.ts` (server-only client + customer
  lookup/create keyed on the existing `stripe_customer_id` unique index); the
  `checkout` / `portal` / `webhook` routes under `web/app/api/billing/`; the webhook added
  to the public-path list in `web/proxy.ts`; the `stripe-reconcile` cron stub filled in
  with the real self-heal + grace-expiry body; and the Sprint 18 no-secret CI gate's key
  list extended to the Stripe key. It **does not touch** the AI/learning paths, the
  free-tier RPC / `session-gate.ts`, or the cost guard (`cost-guard.ts`) — all explicitly
  out of scope.
- **Forecloses (this sprint):** team / family / school plans, seats, coupons, and trials
  (V1 is a single $12/mo Pro per PLAN §2.8; B2B is Phase 3+); **in-extension checkout**
  (Stripe stays server/web-only, the popup links out); tax / invoicing / dunning UI beyond
  Stripe's hosted customer portal (the portal is the V1 management surface); and **building
  the Pro-only features themselves** (which features are Pro is each feature's own one-line
  `assertEntitlement` call, per ADR-051 — this ADR wires payment + the billing-column truth,
  not the feature set).
- **Privacy disclosure (a new standing coupling):** Stripe now processes customer + billing
  data on our behalf (Stripe is the **processor**, not a recipient of user content). Before
  GA billing reaches real users, the Sprint 19 `/privacy` page + the Chrome data-safety
  disclosure (ADR-046) must list Stripe customer/billing data as a processed data type —
  the same "any new collection updates the disclosure first" coupling ADR-046 records.
  Flagged in the handoff.

> **Numbering + migration note:** this ADR is **050** (the plan's number). The latest ADR
> on disk at execution is **049** (study-materials generation), so 050 / 051 are the true
> next-free pair per this repo's "next free number at execution, no renumber" convention.
> **However, the `stripe_events` migration is NOT the plan's `0021`.** The plan was written
> when the newest migration was 0017; since then Sprint 22 landed `0020_mastery_snapshot`
> and Sprint 21 landed `0021_study_artifact`, so the next-free migration number at
> execution is **`0022`** — `0022_stripe_events.sql` (confirm again at Task 2, in case a
> parallel track claims 0022 first). See ADR-051 (the entitlements resolver this billing
> feeds), ADR-041 (the cost guard, orthogonal and untouched), ADR-036 (the cron infra the
> reconcile cron reuses), ADR-035 (export + erasure — the invariant `stripe_events`
> deliberately does NOT join), ADR-007 / ADR-027 (the free-tier gate + tier exemption Pro
> unlocks without change), ADR-046 (the data-safety disclosure this now amends), and
> ADR-006 (the extension single-egress / no-secret rule Stripe-server-only follows).
