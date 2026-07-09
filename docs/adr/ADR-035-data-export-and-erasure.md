## ADR-035: Data export + two-phase erasure — the GDPR portability and right-to-erasure flows

**Status:** Decided

**Context:** The age gate (`MIN_AGE = 13`, `web/lib/consent.ts`), GDPR consent
capture at signup, and RLS on every user table (ADR-003, ADR-004) all shipped and
work. What PLAN §2.7 named but never built are the two user-facing data-rights
flows: **portability** (export everything we hold about you) and **erasure**
(delete your account and everything under it). This sprint's audit confirmed there
is no export route, no deletion route, and no cascade path in the code today. Two
structural facts make both flows tractable: (a) RLS is already `ENABLE`d on every
user-scoped table with `auth.uid() = user_id` policies, so a read through the
authenticated client can *only* return the caller's own rows; and (b) all domain
tables (`sessions`, `knowledge_nodes`, `misconceptions`, `session_interactions`,
`reinforcement_schedule`) are `user_id`-keyed with FK `on delete cascade` to
`users` (migrations 0002/0004/0007/0008) — so a real hard-delete is a single
`delete` of the root row, the cascade is already declared.

**Decision:**

1. **Export is an RLS-scoped read → JSON. RLS is the guarantee, not a `WHERE`
   clause.** `GET /api/account/export`, bearer/cookie-authed, reads the caller's
   rows from all six user-scoped tables (`users`, `sessions`, `knowledge_nodes`,
   `misconceptions`, `session_interactions`, `reinforcement_schedule`) through the
   **authenticated user's** RLS-scoped client — so it can only ever serialize the
   caller's own data, by construction, even if we forget a filter. It returns
   `application/json` with a `Content-Disposition: attachment` header and a
   schema/version stamp on the document. It uses **no service-role client** (there
   is nothing to elevate — RLS is the boundary). JSON is chosen over CSV for
   fidelity of the nested learning graph (PLAN §2.7); a CSV-per-table zip is a
   possible later convenience, explicitly out of scope now.

2. **Deletion is a two-phase erasure, not an in-request cascade.** The account
   route *queues* the deletion; a cron sweep (ADR-036) *executes* it.
   - **Phase 1 — queue (in-request, fast).** `POST /api/account/delete`,
     bearer/cookie-authed, sets `erasure_requested_at = now()` **and**
     `deleted_at = now()` on the caller's own `users` row (an RLS-scoped update),
     signs the user out, and returns `200`. `deleted_at` gives *immediate logical
     erasure* — RLS hides the row and sessions stop the instant it's set, so the
     user experiences erasure immediately; `erasure_requested_at` is the durable
     *queue marker* the sweep keys on. The route does **not** delete in-request.
     It is **idempotent**: a second call is a no-op (the row is already flagged).
   - **Phase 2 — sweep (cron, ADR-036).** The `hard-delete-sweep` cron finds users
     whose `erasure_requested_at` is past the **grace window**, deletes each
     `auth.users` row via the service-role admin client (`web/lib/supabase/
     admin.ts`) — which cascades `public.users` and every user-scoped table via the
     existing FK `on delete cascade` — then re-selects to **verify absence** and
     logs a count. The service-role admin client is the *only* path that touches
     `auth.users` and the only one that runs without a user session; it is
     `CRON_SECRET`-gated (ADR-036) so nothing but Vercel Cron can invoke it.

3. **The grace window is 7 days.** `ERASURE_GRACE_DAYS = 7`: the sweep only
   hard-deletes rows flagged for erasure at least 7 days ago. The window is a
   recoverable buffer against accidental deletion or a compromised account — the
   user already sees immediate erasure (Phase 1's `deleted_at`), so the window is
   purely an internal safety/audit buffer before the irreversible step. Seven days
   sits comfortably inside PLAN §2.7's "hard delete within 30 days" GDPR
   commitment (sweep runs daily, so the actual delete lands at grace-window + ≤1
   day). The value is a named constant, tunable in one line.

4. **The two-phase design exists for speed, retryability, and auditability — not
   because the cascade is complicated.** Queuing keeps the delete request fast (one
   row update, no fan-out), makes the destructive step retryable (the sweep is
   `delete-if-present`, safe to re-run), and gives an auditable window between
   request and irreversible deletion. The cascade itself is trivial: delete the
   root, the FKs do the rest.

**Rationale:**
- Leaning on RLS for export (rather than a hand-written per-table `where user_id =
  …`) makes cross-user leakage impossible at the database layer even if the route
  has a bug — the same defense-in-depth posture the whole app already relies on.
- Splitting queue-from-execute matches PLAN §2.8's "enqueue a hard-delete job"
  language and keeps the user-facing request instant while the heavy, irreversible
  work happens in a controlled, re-runnable, secret-gated job.
- Using the declared FK cascade (not a hand-written FK-safe delete order) means a
  future table added under `users` is deleted automatically *if* it carries the
  same FK — which is exactly why "every new user-scoped table MUST carry FK `on
  delete cascade`" becomes a load-bearing rule (below), enforced by the sweep's
  verify-absence step and the test that asserts it.

**Consequences:**
- Enables: GDPR portability + right-to-erasure at V1, the compliance floor for a
  public beta with minors.
- Requires: `users.erasure_requested_at` (migration 0013); the two `/api/account/*`
  routes; the account-page controls (Export / Delete, reusing existing Card/Alert/
  Button primitives — no new component system); and ADR-036's sweep to consume the
  queue.
- Forecloses (this sprint): in-request cascade deletion; a self-serve consent
  dashboard beyond export + delete (PLAN keeps this Phase 3+); Stripe customer
  deletion / subscription cancellation in the cascade (Sprint 23 owns Stripe — the
  sweep deletes only the data tables + auth user).
- **Load-bearing for every future sprint:** any new user-scoped table MUST (a)
  carry FK `on delete cascade` to `users` — or the sweep will orphan its personal
  data — and (b) be added to the export route, or the export is silently
  incomplete. Both are now requirements, not conveniences; the sweep's
  verify-absence assertion and the export-completeness test are where a violation
  surfaces.

See ADR-041 (cost guardrail) and ADR-036 (cron infra + URL hashing) for the other
two halves of Sprint 16's pre-beta gate. The cron sweep that executes Phase 2 is
specified in ADR-036.
