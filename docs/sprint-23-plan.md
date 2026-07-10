# Sprint 23 — Stripe billing + Pro entitlements (GA / monetization gate)

> **Post-beta / GA sprint.** ADR numbers written concretely from next-free at time of
> writing (latest ADR = 043; Sprints 18/19/21/22 claim 044–049) → this sprint =
> **050/051**; migration **0021**. **Provisional** — parallel tracks (Sprint 24/25)
> may claim intervening numbers; confirm next-free at execution.

## Goal
Turn Calyxa from a free beta into a **monetizable product**: a student can subscribe
to **Pro** via Stripe, a paid subscription actually **unlocks** the entitlements the
product has been designing around since Sprint 03, and dropped webhooks **self-heal**.
This is the GA gate. By the end:

1. **Stripe Checkout** from the dashboard creates a Customer + Checkout Session and, on
   success, marks the user Pro.
2. **Idempotent webhooks** (`checkout.session.completed`,
   `customer.subscription.updated`, `customer.subscription.deleted`,
   `invoice.payment_failed`) update `users.subscription_tier/status/stripe_*/renews_at`
   — each processed exactly once, keyed on the Stripe event id.
3. **The reconciliation cron gets a real body** — the Sprint 16 `stripe-reconcile` stub
   becomes a daily pull from the Stripe API for any user whose `subscription_renews_at`
   has passed or whose status looks stale, so a dropped webhook self-heals within a day.
4. **An entitlements resolver** computes the PLAN §2.8 flag set from
   `subscription_tier + status`, rides the session-start response for display, and is
   **re-checked server-side on every Pro-only path** (never trusting the cached client
   value).
5. **Upsell + manage-subscription UI**: an upgrade CTA (dashboard + the popup's
   degraded state) and a Stripe customer-portal link to manage/cancel.

```
dashboard "Upgrade" ──▶ POST /api/billing/checkout ──▶ Stripe Checkout ──▶ success
Stripe ──webhook (signed, idempotent via stripe_events)──▶ POST /api/billing/webhook
     └─ set users.subscription_tier='pro', status, stripe_*, renews_at
daily cron /api/cron/stripe-reconcile (stub → real) ──pull Stripe API──▶ self-heal stale rows
entitlements: resolve(tier,status) ──▶ {voice_premium, unlimited_history, full_dashboard, ...}
     └─ attached to /api/session/start response (display) + re-checked server-side per Pro path
```

## Context
Every billing *seam* exists and every billing *behavior* is missing. The `users` table
has carried `subscription_tier` (`text not null default 'free' check in ('free','pro')`),
`stripe_customer_id` (unique index, 0003), `stripe_subscription_id`,
`subscription_status`, and `subscription_renews_at` since 0001 — behavior-free
placeholders. The `start_session` RPC **already exempts non-free users** from the
free-session gate (`subscription_tier = 'free'` predicate → Pro is treated as unlimited,
not degraded), so a lot of "Pro removes the limit" is *already wired* and just waits for
something to set `tier='pro'`. Sprint 16 scaffolded the `stripe-reconcile` **cron stub**
(returns "not yet implemented — Sprint 23 owns this") on the `assertCronSecret`-gated
(`web/lib/cron/auth.ts`, fails closed) cron infra in `web/vercel.json`. What's absent:
**no Stripe SDK/dependency anywhere**, no webhook handler, no Checkout code, **no
entitlements resolver** (`web/lib/entitlements/` is reserved-but-empty), no code that
ever sets `tier='pro'` or reads Pro flags (the only `subscription_tier` reads are the
RPC gate + the account page's read-only display), and **no `stripe_events` idempotency
table** (newest migration 0017). `FREE_SESSION_LIMIT = 20` (Sprint 16/ADR-041 retuned);
`Pricing.tsx` shows Free = 20 sessions/mo, Pro = $12/mo unlimited.

### Decisions locked for this sprint (recorded in ADR-050/051)
1. **Webhooks are the source of truth; the reconcile cron is the safety net.** Each
   verified webhook is idempotent (keyed on the Stripe event id in a new `stripe_events`
   table — a duplicate delivery is a no-op) and updates the `users` billing columns.
   The daily reconcile cron pulls status from the Stripe API for stale/expired rows so a
   dropped webhook self-heals within one cycle (PLAN §2.8's exact design).
2. **Setting `tier='pro'` is most of the unlock, for free.** The `start_session` RPC
   already treats non-free as unlimited + non-degraded, so flipping `tier` on payment
   immediately removes the session cap and the voice degradation — no RPC change. The
   entitlements resolver adds the *display* + the gating for Pro-only features beyond
   the session cap.
3. **Entitlements are resolved server-side, ride the session for display, and are
   re-checked on every Pro path.** `resolveEntitlements(tier, status)` → the PLAN §2.8
   flag set (`voice_premium, misconception_graph, spaced_reinforcement, full_dashboard,
   unlimited_history, image_capture`). It's attached to the `/api/session/start` response
   (cached in the extension's `ActiveSession` for UX), but **every Pro-only endpoint
   re-derives it server-side** — the cached client value is a hint, never an
   authorization (the locked "client is a display hint only" discipline, extended from
   the free-tier gate to entitlements).
4. **`past_due` gets a grace window before downgrade.** An `invoice.payment_failed`
   moves the user to `past_due` (Pro retained) for a grace period; only a terminal
   `subscription.deleted` (or grace expiry, enforced by the reconcile cron) downgrades to
   free. No abrupt mid-session lockout.
5. **All Stripe secrets are server-only.** `STRIPE_SECRET_KEY` + the webhook signing
   secret live in env, never in any bundle (the Sprint 18 no-secret CI gate covers them);
   the extension never sees Stripe — it only reads the entitlement flags relayed through
   the backend (ADR-006 egress discipline unchanged).

### Reconciliation with `/docs/PLAN.md` (read before Task 1) — what this implements
- **§2.8 "Pro subscription via Stripe"**: Checkout from the dashboard, the four webhook
  events, idempotency keyed on event id, the reconciliation cron, `past_due` grace — all
  named in PLAN §2.8 and all implemented here.
- **§2.8 "Feature-flag system"**: the entitlements resolver computing the exact flag set,
  resolved server-side, cached client-side for display, re-checked per Pro endpoint,
  with `image_capture` supporting a staged rollout (`'off'|'beta'|'on'`).
- **§2.8 freemium**: the free-tier gate + the retuned `FREE_SESSION_LIMIT = 20` are
  unchanged — Pro *lifts* the cap (via the RPC's existing tier exemption), it doesn't
  re-plumb it.

### The RPC already gates on tier — so "unlock" is set-tier + a resolver, not a rewrite (read before Tasks 5, 6)
`start_session` reads `subscription_tier` and only increments/limits when
`= 'free'`; a Pro user's start is a no-op increment → `degraded=false`, `remaining=null`.
So the moment a webhook sets `tier='pro'`, unlimited sessions + full premium voice are
live with zero RPC change. The entitlements resolver's job is the *rest*: flags for
features the RPC doesn't gate (dashboard depth, history length, misconception graph,
image capture), surfaced for display and enforced at each feature's own endpoint. This
keeps Sprint 23 additive over the locked freemium plumbing.

### Idempotency is a deny-all table keyed on the Stripe event id (read before Tasks 2, 4)
`stripe_events(event_id text primary key, type text, received_at)` — RLS Shape 3
(deny-all; only the service-role webhook route touches it). The webhook handler inserts
the event id first (`on conflict do nothing`); a zero-row insert means "already
processed" → the handler returns 200 without re-applying. This makes redelivery safe
(Stripe retries) and is the PLAN §2.8 "idempotent, keyed on Stripe event id" mechanism.
It is **not** user-scoped (events aren't a user's data — they're processing bookkeeping),
so it doesn't join the export/erasure lists (unlike every user table); recorded in the
migration comment so the Sprint 16 invariant isn't misapplied.

### The webhook route must read the raw body for signature verification (read before Task 4)
Stripe signature verification needs the exact raw request body, not a parsed JSON. The
Next.js route reads the raw body (the App Router `await request.text()`), verifies with
`stripe.webhooks.constructEvent(rawBody, sig, WEBHOOK_SECRET)`, and only then parses.
The route is **public** (Stripe calls it, unauthenticated) but *authenticated by the
signature* — added to the public-path list like `/api/waitlist` was, but its security is
the signature check, not an absence of auth. An unverifiable signature → 400, no
processing.

## Execution model
A **single code session** owns this sprint end to end, worked **strictly in order
(1 → 9)**. The chain: ADRs (Task 1); the `stripe_events` migration (Task 2) precedes the
webhook that writes it (Task 4); the Stripe client + Checkout (Task 3) precedes the
webhook (they share the client) which precedes the reconcile cron (Task 5) that self-heals
what webhooks miss; the entitlements resolver (Task 6) precedes the upsell/gating UI
(Task 7); tests (Task 8) gate manual acceptance in Stripe test mode (Task 9). One session
— no handoff.

This sprint touches: a new `supabase/migrations/0021_stripe_events.sql`, `web/package.json`
(the Stripe SDK), new `web/lib/billing/` + `web/lib/entitlements/`, new
`web/app/api/billing/{checkout,webhook,portal}/` routes, the
`web/app/api/cron/stripe-reconcile/route.ts` stub (→ real), `web/app/api/session/start/route.ts`
(attach entitlements to the response), a dashboard `/billing` route + upsell, and the
extension popup's degraded upsell. It does **not** touch the AI/learning paths, the
free-tier RPC (Pro is the existing tier exemption), or the cost guard.

## Files in scope

### Task 1 (ADRs + sprint pointers) creates or edits:
```
/docs/adr/ADR-050-stripe-billing.md      ← new (provisional #) — Checkout from the dashboard; four webhook events → users billing columns; idempotency via stripe_events (deny-all, keyed on event id, NOT user-scoped so not on export/erasure); reconcile cron (stub → real) as the dropped-webhook safety net; past_due grace before downgrade; raw-body signature verification; all Stripe secrets server-only.
/docs/adr/ADR-051-entitlements-resolver.md ← new (provisional #) — resolveEntitlements(tier,status) → the PLAN §2.8 flag set; resolved server-side, attached to /api/session/start for display, RE-CHECKED server-side on every Pro path (cached client value is a hint never an authorization); tier='pro' already unlocks the session cap via the existing RPC exemption (no RPC change); image_capture staged 'off'|'beta'|'on'.
/CLAUDE.md                                ← edit one line: Current sprint → Sprint 23 — Stripe billing + Pro entitlements
/docs/CLAUDE.md                           ← edit one line: Current phase → Sprint 23
/docs/sprint-23-plan.md                   ← this file
/docs/architecture.md                     ← edit: a "Billing" section — Stripe Checkout + idempotent webhooks + reconcile cron; the entitlements resolver (server-resolved, display-cached, re-checked); Pro unlocks via the existing tier exemption
```

### Task 2 (migration — stripe_events idempotency) creates:
```
/supabase/migrations/0021_stripe_events.sql ← new (number at execution) — stripe_events(event_id text primary key, type text not null, received_at timestamptz not null default now()). RLS Shape 3 (deny-all; only the service-role webhook route writes it). NOT user-scoped → deliberately NOT FK-to-users and NOT on the export/erasure lists (processing bookkeeping, not personal data — recorded in the comment so the Sprint 16 invariant isn't misapplied). Optionally: a CHECK on users.subscription_status's allowed values (active/past_due/canceled/...) — additive, only if it doesn't fight Stripe's status strings. RLS-in-migration; re-runs clean.
```

### Task 3 (web — Stripe client + Checkout) creates / edits:
```
/web/package.json          ← edit — add the `stripe` server SDK. Additive; server-only (the extension never imports it).
/web/lib/billing/stripe.ts ← new — stripeClient(): new Stripe(process.env.STRIPE_SECRET_KEY) (server-only, 'server-only' import); the Price/Product id from env; helpers for customer lookup/create keyed on users.stripe_customer_id (the existing unique index).
/web/app/api/billing/checkout/route.ts ← new — POST, authed (clientFromBearerOrCookie): ensure a Stripe Customer for the user (create + store stripe_customer_id if absent), create a Checkout Session for the Pro price with success/cancel URLs back to the dashboard, return the session URL. RLS-scoped to the caller.
/web/app/api/billing/portal/route.ts   ← new — POST, authed: create a Stripe billing-portal session for the caller's customer (manage/cancel), return the URL.
```

### Task 4 (web — webhooks) creates:
```
/web/app/api/billing/webhook/route.ts ← new — POST, PUBLIC but signature-authenticated: read the RAW body (request.text()), verify with stripe.webhooks.constructEvent(raw, sig, WEBHOOK_SECRET) → 400 on failure. Idempotency: insert event_id into stripe_events on-conflict-do-nothing; zero rows → already processed → 200. Handle checkout.session.completed / customer.subscription.updated / customer.subscription.deleted / invoice.payment_failed → update the matching user's subscription_tier ('pro' on active, 'free' on deleted/terminal), subscription_status, stripe_subscription_id, subscription_renews_at (service-role client, matched by stripe_customer_id). past_due → status='past_due', tier retained (grace).
/web/proxy.ts (or the public-path list) ← edit — make /api/billing/webhook public (Stripe is unauthenticated; the signature is the auth), matching how /api/waitlist was exempted.
```

### Task 5 (web — reconcile cron: stub → real) edits:
```
/web/app/api/cron/stripe-reconcile/route.ts ← edit — replace the no-op body: CRON_SECRET-gated (unchanged), for every user whose subscription_renews_at has passed OR whose status looks stale (past_due beyond grace, or a mismatch), pull the live subscription from the Stripe API and reconcile subscription_tier/status/renews_at; a self-heal for dropped webhooks (PLAN §2.8). Service-role client. Bounded batches; idempotent. The grace-window downgrade (past_due → free after N days) is enforced here.
/web/vercel.json ← already has the stripe-reconcile daily entry (Sprint 16); no change unless the schedule needs tuning.
```

### Task 6 (web — entitlements resolver + session attach) creates / edits:
```
/web/lib/entitlements/resolve.ts ← new — resolveEntitlements(tier, status): the PLAN §2.8 flag set { voice_premium, misconception_graph, spaced_reinforcement, full_dashboard, unlimited_history, image_capture }, computed purely from tier + status (past_due keeps Pro flags during grace); image_capture as 'off'|'beta'|'on' (per-user override honored if present). Pure, unit-testable, server-only. The Entitlements type is the single source.
/web/app/api/session/start/route.ts ← edit — after the existing start, attach resolveEntitlements(user.subscription_tier, user.subscription_status) to the response alongside { sessionId, mode, degraded, remaining }. Display hint only.
/web/lib/tier/require-pro.ts ← new — a small server helper: assertEntitlement(supabase, flag) that RE-DERIVES entitlements from the user's row (never the client value) and 401/403s a Pro-only request. Any Pro-gated endpoint (e.g. Sprint 21 unlimited study kits, Sprint 22 full_dashboard/unlimited_history) calls this — the one-line gate those sprints' plans reserved.
```

### Task 7 (UI — upsell + manage) creates / edits:
```
/web/app/(dashboard)/billing/page.tsx ← new — the billing page: current plan (from subscription_tier/status), an "Upgrade to Pro" button → POST /api/billing/checkout → redirect to Stripe; for Pro users, a "Manage subscription" button → POST /api/billing/portal. Server component + client action buttons; on the shadcn/token system.
/web/app/(dashboard)/layout.tsx       ← edit — add "Billing" to the nav (alongside Account, and the Sprint 22 dashboard nav if present).
/web/components/marketing/Pricing.tsx ← edit — the Pro CTA now links to signup→/billing (or /billing if authed) instead of the waitlist, once GA; keep the FREE_SESSIONS_PER_MONTH binding to session-gate (pricing.test.ts).
/extension/src/popup/main.tsx         ← edit — when the session is degraded (free limit reached), the existing message gains an "Upgrade to Pro" link that opens the web /billing page (a link, not in-extension checkout — Stripe never touches the bundle). Reads the entitlement flags from ActiveSession for display only.
```

### Task 8 (tests) creates / edits:
```
/web/tests/billing-webhook.test.ts ← new — signature verification (bad sig → 400, no processing); idempotency (a duplicate event_id is a no-op — the user row isn't double-updated); each of the four events maps to the correct tier/status transition; past_due retains Pro; deleted downgrades to free.
/web/tests/entitlements.test.ts    ← new — resolveEntitlements truth table (free vs pro vs past_due-in-grace vs canceled); image_capture staged values; the require-pro helper re-derives from the row and rejects a free user even if the client claims Pro.
/web/tests/billing-checkout.test.ts ← new — checkout creates/reuses a Customer keyed on stripe_customer_id; the session URL is returned; RLS-scoped (a user can't create a checkout for another).
/web/tests/stripe-reconcile.test.ts ← new — the cron pulls + reconciles a stale row; CRON_SECRET-gated; a dropped-webhook scenario self-heals; past_due-beyond-grace downgrades.
```

### Files explicitly out of scope
```
/web/lib/tier/session-gate.ts + the start_session RPC  (Pro unlocks via the EXISTING tier exemption — no gate change; FREE_SESSION_LIMIT unchanged)
/web/lib/ai/** + the learning paths                    (billing doesn't touch tutoring)
/web/lib/tier/cost-guard.ts                            (the global cost ceiling is orthogonal to per-user billing — unchanged)
The extension bundle / any Stripe code in /extension   (ADR-006: Stripe is server-only; the extension reads entitlement flags relayed through the backend, opens /billing as a web link)
```
Also out of scope (no pre-empting later roadmap sprints):
- **Team/family/school plans, seats, coupons, trials** — V1 is a single $12/mo Pro
  (PLAN §2.8); B2B is Phase 3+ (locked out).
- **In-extension checkout** — Stripe stays server/web-only; the popup links out.
- **Building the Pro-only features themselves** — this sprint wires the *resolver + gate*;
  which features are Pro (unlimited study kits from Sprint 21, full_dashboard/
  unlimited_history from Sprint 22) is each feature's own one-line `assertEntitlement`
  call, reserved by those sprints' plans.
- **Tax/invoicing/dunning UI beyond Stripe's hosted portal** — Stripe's customer portal
  is the V1 management surface.

Do not create any file not listed above. If something seems needed but is not listed,
add it to "What the next sprint needs to know" and ask before creating it.

---

## Task 1 — Billing + entitlements ADRs + sprint pointers (planning / docs)
Write ADR-050/051 in the project format. Fix: webhooks-as-truth + reconcile-as-safety-net,
idempotency keyed on event id (deny-all, not user-scoped), past_due grace, raw-body
signature verification, server-only secrets; the resolver's server-resolve /
display-cache / re-check-per-path discipline; that tier='pro' already unlocks the cap via
the existing RPC exemption. Update pointers + architecture.md.

Acceptance gate before Task 2:
  - Both ADRs read as decisions; the "stripe_events is bookkeeping, not personal data, so
    NOT on export/erasure" call is explicit; no code touched.

## Task 2 — Migration: stripe_events (supabase)
Scope: `0021_stripe_events.sql`. Deny-all, keyed on event id, not user-scoped.

Acceptance gate before Task 3:
  - `db reset` clean; stripe_events is deny-all to clients; the not-on-export/erasure
    rationale is in the comment; typecheck passes with regenerated types.

## Task 3 — Web: Stripe client + Checkout
Scope: the SDK + `billing/stripe.ts` + checkout/portal routes. Server-only; Customer keyed
on the existing unique index.

Acceptance gate before Task 4:
  - A checkout session is created (Stripe test mode) and returns a URL; a Customer is
    created/reused on stripe_customer_id; the portal route returns a management URL; no
    Stripe secret in any bundle.

## Task 4 — Web: webhooks
Scope: the webhook route (raw body, signature, idempotent, four events) + the public-path
exemption.

Acceptance gate before Task 5:
  - A signed test event updates the user's tier/status; a duplicate delivery is a no-op
    (idempotent); a bad signature → 400 with no processing; past_due retains Pro, deleted
    downgrades.

## Task 5 — Web: reconcile cron (stub → real)
Scope: fill the stripe-reconcile body. Self-heals stale rows; enforces grace-window
downgrade.

Acceptance gate before Task 6:
  - A simulated dropped webhook (row stale vs Stripe) is reconciled by the cron within one
    run; CRON_SECRET-gated; past_due-beyond-grace downgrades to free.

## Task 6 — Web: entitlements resolver + session attach
Scope: `resolve.ts` + the session-start attach + `require-pro.ts`. Server-resolved,
display-cached, re-checked.

Acceptance gate before Task 7:
  - resolveEntitlements returns the correct flag set per tier/status; /api/session/start
    relays them; assertEntitlement re-derives from the row and rejects a free user who
    claims Pro client-side.

## Task 7 — UI: upsell + manage
Scope: the `/billing` page + nav + Pricing CTA + the popup upsell link.

Acceptance gate before Task 8:
  - A free user sees "Upgrade to Pro" → Stripe checkout; a Pro user sees "Manage
    subscription" → portal; the popup's degraded state links to /billing; nothing in the
    extension imports Stripe.

## Task 8 — Tests (gate)
Scope: per the annotations. Webhook idempotency + signature, entitlements truth table +
re-check, checkout, reconcile self-heal.

Acceptance gate before Task 9:
  - `turbo run typecheck lint build test` green; the idempotency + re-check tests fail
    meaningfully when their guard is removed.

## Task 9 — Billing acceptance (manual, Stripe test mode)
With Stripe in test mode:
  1. As a free user, hit the free-session limit → the popup shows the upsell → /billing →
     "Upgrade to Pro" → complete Stripe test checkout.
  2. The `checkout.session.completed` webhook flips the user to Pro (verified in `users`);
     the next session start returns `degraded=false`, `remaining=null` (the RPC exemption)
     and Pro entitlement flags.
  3. Cancel via the portal → `customer.subscription.deleted` (or period-end) → the user
     returns to free after the period; sessions gate again.
  4. Simulate a failed payment → `invoice.payment_failed` → status `past_due`, Pro retained
     during grace; force grace expiry → the reconcile cron downgrades to free.
  5. Redeliver a webhook from the Stripe dashboard → idempotent, no double-apply.
  6. Delete a webhook (don't deliver it), let the row go stale → the reconcile cron
     self-heals within a run.
  7. Confirm no Stripe secret in the extension bundle (the Sprint 18 CI gate is green).

## Acceptance criteria (full checklist)
- [ ] ADR-050/051 written; pointers + architecture.md updated
- [ ] stripe_events (deny-all, keyed on event id, NOT user-scoped / not on export-erasure) lands in 0021; db reset clean
- [ ] Checkout creates/reuses a Customer on stripe_customer_id and returns a session URL; portal route works; Stripe SDK server-only
- [ ] Webhook verifies the raw-body signature (bad sig → 400), is idempotent via stripe_events, and maps all four events to the correct tier/status transitions; past_due grace, deleted → free
- [ ] Reconcile cron (stub → real) self-heals stale/dropped-webhook rows daily, CRON_SECRET-gated, enforces grace-window downgrade
- [ ] Entitlements resolver computes the PLAN §2.8 flag set from tier+status; attached to /api/session/start for display; re-checked server-side via assertEntitlement (client value never authorizes)
- [ ] Pro unlocks the session cap via the EXISTING RPC tier exemption (no gate/RPC change); upsell (dashboard + popup) + manage (portal) UI wired
- [ ] No Stripe code/secret in the extension bundle (Sprint 18 CI gate green)
- [ ] `turbo run typecheck lint build test` green; Task 9 Stripe-test-mode pass complete

## Risks
**A dropped webhook leaves a paying user on free (or a canceled user on Pro).**
Mitigation: the reconcile cron pulls the live Stripe state daily for stale rows and
self-heals — the exact PLAN §2.8 backstop; webhooks are the fast path, reconcile is the
correctness guarantee; both are tested (idempotency + self-heal).

**Webhook signature/raw-body handling is subtly wrong and every event 400s (or worse,
none verify).** Mitigation: the route reads `request.text()` for the exact raw body and
uses `constructEvent`; Task 4 verifies a real signed test event end-to-end; a
verification failure is a hard 400 with no processing (fail closed).

**A user forges a Pro entitlement client-side.** Mitigation: the cached entitlement in
`ActiveSession` is display-only; `assertEntitlement` re-derives from the `users` row on
every Pro path — the "client is a display hint only" discipline extended from the
free-tier gate; the test asserts a free user claiming Pro is rejected.

**A Stripe secret leaks into the extension bundle.** Mitigation: Stripe is server/web-only
(the extension links out to /billing, never imports the SDK); the Sprint 18 no-secret CI
gate greps the built bundle for the Stripe key too (extend its key list); ADR-006 egress
discipline unchanged.

**`past_due` handling is too aggressive (locks out a user over a transient failure) or too
lax (free Pro forever).** Mitigation: a defined grace window keeps Pro through `past_due`
and only the reconcile cron (or a terminal `deleted`) downgrades after expiry; the grace
duration is a named constant, tuned from real dunning behavior.

**Double-charging or double-applying on webhook redelivery.** Mitigation: idempotency via
`stripe_events` (insert-on-conflict-do-nothing; zero rows → already processed → 200); Task
8 asserts a redelivered event doesn't double-apply.

## What the next sprint needs to know
**Calyxa is monetizable.** Stripe Checkout upgrades a user to Pro; idempotent webhooks +
a daily reconcile cron keep `users` billing state correct even under dropped deliveries;
an entitlements resolver computes the PLAN §2.8 flags server-side, relays them for display,
and is re-checked on every Pro path; Pro lifts the session cap via the existing RPC
exemption.

- **The Pro-only features** across the product now have their gate: any endpoint calls
  `assertEntitlement(supabase, flag)` — Sprint 21's "unlimited study kits", Sprint 22's
  `full_dashboard`/`unlimited_history`, and `image_capture` (staged) plug in with one line
  each. Deciding *which* features are Pro is a product call per feature, not a re-plumb.
- **The data-safety disclosure (Sprint 19)** must now list Stripe customer/billing data as
  a processed data type (Stripe is the processor) — update /privacy + the CWS data-safety
  form before GA billing goes live to real users.
- **`stripe_events`** is the idempotency ledger — any future Stripe event type handled adds
  to the same table + the same on-conflict guard; it is deliberately NOT on the
  export/erasure lists (bookkeeping, not personal data).
- **GA gating**: the unlisted/invite beta (Sprint 19) can flip to public + open signups
  when billing is proven in test mode and Darcy is ready — a distribution decision, not a
  code change here.
- **Dunning/trials/coupons/team plans** stay deferred (Phase 3+ / single-plan V1); the
  Stripe portal is the management surface until then.
