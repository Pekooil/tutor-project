## ADR-036: First Vercel Cron infrastructure + page identifiers hashed at rest

**Status:** Decided

**Context:** Two gaps this sprint's audit confirmed. First, **no cron
infrastructure exists** — there is no `vercel.json` and no `/api/cron/*` route
anywhere. PLAN §2.8 always named a set of scheduled jobs as owed (the daily
free-tier reset, the Stripe reconciliation, the hard-delete sweep), and the
`start_session` RPC's own comment says "the daily reconciliation cron is deferred
to the billing sprint" — but none have ever been wired. Second, **page identifiers
are not hashed at rest**: `sessions.page_url_hash` has existed as a nullable column
since migration 0003 and is *always* `NULL`, while `page_domain` is written raw.
The extension's `deriveTabDomain` only ever sends the registrable domain (never a
full path or query), so the sensitive "raw URL at rest" was never actually true —
but a bare stored domain is still not the compliant target, and PLAN §2.7 named
server-salted URL hashing as a deliverable.

**Decision:**

1. **First Vercel Cron infra: `vercel.json` + three daily routes, all
   `CRON_SECRET`-gated.** A new `/vercel.json` declares three daily crons; each is a
   route under `/web/app/api/cron/*`; all three share one auth helper.
   - `reset-free-tier` — the **safety net** over `start_session`'s lazy 30-day
     reset. The lazy reset is correct but only fires when a user *starts a
     session*; a dormant account never resets. This cron resets
     `free_session_count = 0` and bumps `free_period_started_at` for any user whose
     period is ≥ 30 days old. Service-role admin client. Idempotent (set-to-0).
   - `hard-delete-sweep` — executes ADR-035's erasure queue. Finds users whose
     `erasure_requested_at` is past the 7-day grace window, deletes each
     `auth.users` row via the admin client (cascading `public.users` + all
     user-scoped tables via the existing FK `on delete cascade`), then re-selects
     to **verify absence** and logs a count. Service-role admin client. Bounded
     batch; `delete-if-present`, safe to re-run.
   - `stripe-reconcile` — a **no-op stub**. Returns `200` with a "not yet
     implemented — Sprint 23 owns this" marker. It reserves the cron surface so the
     wiring exists, but ships **no Stripe SDK and no logic**. PLAN §2.8's
     reconciliation cron stays with billing (Sprint 23); this ADR is explicit that
     only the seam is scaffolded here.
   - **Auth:** one shared `web/lib/cron/auth.ts` → `assertCronSecret(request)`:
     a constant-time compare against `process.env.CRON_SECRET`, `401` otherwise.
     Every cron route calls it first; nothing but Vercel Cron (carrying the secret)
     can invoke any of them. The service-role admin client is used *only* in cron
     routes, and only behind this gate.

2. **Page identifiers are hashed with a server-only salt; plaintext domains stop
   being written.** A new server-only `web/lib/privacy/url-hash.ts` exposes
   `hashPageDomain(domain)` = `HMAC-SHA256(domain, process.env.URL_HASH_SALT)` →
   hex, returning `null` for a null/empty domain. The salt (`URL_HASH_SALT`, env)
   is **never** sent to any client or included in any bundle — server-side hashing
   with a secret salt is what prevents the rainbow-table reversal an unsalted
   client-side hash would allow (PLAN §2.7). `/api/session/start` computes
   `page_url_hash = hashPageDomain(pageDomain)` and **stops writing plaintext
   `page_domain`** on new rows (passes `null`); the `page_domain` column stays for
   back-compat but new writes null it. Preferred wiring: add a `p_page_url_hash`
   param to the `start_session` RPC (a small additive 0014 migration) so the hash
   is written inside the atomic gate; if the route can populate the hash without
   touching the RPC, 0014 is skipped and the choice recorded in the commit message.

3. **The loss of plaintext-domain display is a deliberate privacy call, and it
   refines PLAN §2.7.** PLAN §2.7 said we would "additionally store `page_domain`
   (eTLD+1) for coarse analytics." This ADR **supersedes that line**: new rows null
   `page_domain`, and the future dashboard (Sprint 22) groups by `page_url_hash`,
   **not** by domain name. A coarse "which site you studied on" display is a later,
   *explicit* reopening — it would need its own consent reasoning — not a silent
   default we keep the plaintext around to enable. Flagged for Sprint 22.

**Rationale:**
- Standing up the cron surface once, with a single shared secret-gate and a
  consistent "route + `vercel.json` line" shape, means every future job (Sprint
  17's telemetry maintenance, Sprint 23's real Stripe reconcile) is an incremental
  add against a known pattern rather than a fresh design.
- Scaffolding the Stripe reconcile as a wired stub — rather than omitting it —
  keeps the cron manifest complete and honest: the seam is visible and named, so
  Sprint 23 fills a body rather than discovering the wiring is missing.
- Hashing the domain (not just the URL) and dropping the plaintext is the strictly
  more private choice, and it costs almost nothing today because the extension
  already sends only the registrable domain — the only thing we give up is a
  display convenience we haven't built and can reopen deliberately.
- A constant-time compare on `CRON_SECRET` plus per-job idempotence (reset is
  set-to-0, sweep is delete-if-present) makes the jobs safe against both
  unauthorized invocation and double-execution.

**Consequences:**
- Enables: the first scheduled-job infrastructure (reset safety net + erasure sweep
  live, Stripe reconcile stubbed); page identifiers hashed at rest with no raw
  domain on new rows.
- Requires: `/vercel.json`; the three cron routes + `web/lib/cron/auth.ts`;
  `web/lib/privacy/url-hash.ts`; the `session/start` write-path change (+ the 0014
  RPC-signature migration only if the hash can't be written without it);
  `CRON_SECRET` and `URL_HASH_SALT` env vars on the deployment.
- Forecloses (this sprint): any real Stripe logic (Sprint 23); a plaintext-domain
  analytics view (deliberately — Sprint 22 groups by hash); backfilling
  `page_url_hash` for existing rows (this is a new-writes-only change; the column
  was always null, so there is no historical plaintext URL to migrate).
- **Load-bearing for future sprints:** adding a scheduled job = a route + a
  `vercel.json` line + the `assertCronSecret` gate; any new logged identifier
  inherits the hashing discipline (no raw URL, no plaintext page identifier); the
  RLS sweep in Sprint 18's audit must confirm `cost_ledger` (deny-all) and that the
  crons' service-role use is `CRON_SECRET`-gated only.

See ADR-041 (cost guardrail) and ADR-035 (export + erasure) for the other two
halves of Sprint 16's pre-beta gate. This ADR's `hard-delete-sweep` executes
ADR-035's Phase-2 erasure.
