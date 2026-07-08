# Sprint 16 — Cost control + compliance hardening (the beta legal + budget gate)

## Goal
Make Calyxa **safe to put in front of real users, including minors, without an
open-ended API bill.** This is the first of the four pre-beta gate sprints, and
it owns the two things that are non-negotiable before a stranger installs the
extension: **a hard ceiling on what a free public beta can spend**, and the
**GDPR/COPPA obligations** the age gate started but never finished. By the end:

1. **A global cost guardrail** caps aggregate spend across the three paid
   providers (Claude, Whisper, ElevenLabs) per rolling day. When the **soft cap**
   trips, voice degrades to text-only + the browser `SpeechSynthesis` voice (the
   §2.8 degradation path, reused); when the **hard cap** trips, new AI turns are
   refused with a friendly "Calyxa is resting for today" rather than a 500. The
   per-user free-tier gate (ADR-007) is untouched — this is a *second, aggregate*
   ceiling above it.
2. **`FREE_SESSION_LIMIT` is retuned** for problem-sized sessions — the number
   ADR-027 flagged as owed once real per-turn cost data existed (Sprint 15
   measured it). The same number syncs into the now-live marketing `Pricing.tsx`
   so the page can't advertise a stale limit.
3. **GDPR data export** (`GET`-triggered JSON of everything we hold about a user)
   and **account deletion with a real cascade** (every user-scoped row gone, not
   just a soft-deleted `users` row) both ship, wired into the existing account
   page.
4. **Vercel Crons exist** for the first time: a **free-tier reset** safety net
   (the lazy 30-day reset in `start_session` is correct but never fires for a
   dormant account), and a **hard-delete sweep** that executes queued erasures.
5. **Page identifiers are hashed at rest.** `sessions.page_url_hash` (a column
   that has existed since migration 0003 but is always `NULL`) gets populated
   with a server-salted hash; raw plaintext page domains stop being written.

```
paid route (ai/turn, voice/stt, voice/tts)
   └─ cost_guard RPC (atomic add-and-check against the daily global ledger)
        ├─ under soft cap ──▶ call provider normally
        ├─ over soft cap  ──▶ voice legs degrade to text + browser TTS
        └─ over hard cap  ──▶ refuse new turns ("resting for today"), never 500

account page
   ├─ "Export my data"   ──▶ GET /api/account/export   → JSON of all user rows
   └─ "Delete my account"──▶ POST /api/account/delete  → queue erasure
                                                          └─ cron hard-delete sweep

Vercel Cron (daily)
   ├─ /api/cron/reset-free-tier    (safety net over the lazy RPC reset)
   └─ /api/cron/hard-delete-sweep  (executes queued erasures, cascade-verified)
```

## Context
Everything the tutoring loop needs works and is now curriculum-complete and
voice-fast (Sprints 11–15). What does **not** exist is any defense against the
two failure modes a public beta introduces: an unbounded bill, and a compliance
gap in front of 13-to-17-year-olds. The audit of the current code is unambiguous
(all confirmed this sprint's planning): **no cost/spend tracking of any kind**,
**no cron infrastructure** (no `vercel.json`, no `/api/cron/*`), **no data export
or deletion path**, and **`page_url_hash` present-but-never-populated** while the
plaintext `page_domain` is written raw. The freemium gate, age gate (`MIN_AGE =
13`, `web/lib/consent.ts`), and consent capture at signup all work and are
**untouched** by this sprint — it builds the missing halves around them.

### Decisions locked for this sprint (recorded in ADR-034/035/036)
1. **The cost guardrail is a global aggregate ceiling, not per-user billing.**
   Its job is to protect the beta budget, not to meter individuals — the
   per-user free-tier gate already does that. It is an atomic add-and-check RPC
   (`SECURITY DEFINER`, mirroring `start_session`'s atomic pattern) against a
   single daily-keyed ledger row, called by each paid route *before* the provider
   call, with estimated per-call costs as named constants (budget-accurate, not
   invoice-accurate).
2. **Two caps, two behaviors.** Soft cap → disable the expensive optional legs
   (voice) and fall back to text + browser TTS (the exact §2.8 over-quota
   degradation already built). Hard cap → refuse new AI turns gracefully. A
   hard-capped day is a bug-or-viral-spike backstop, set well above expected beta
   volume; the soft cap is the normal ceiling.
3. **Deletion is a two-phase erasure, not an in-request cascade.** The account
   route *queues* the deletion (marks the `users` row and records intent); a cron
   sweep does the actual cascade delete. This keeps the request fast, makes the
   cascade retryable, and matches PLAN §2.8's "hard-delete cron" language.
4. **Page identifiers are hashed with a server-only salt; plaintext domains stop
   being written.** The extension already only ever sends a *domain* (never a full
   URL — `deriveTabDomain` in the background), so "raw URL at rest" is already
   nearly true; this sprint makes it fully true and hashes even the domain.
5. **`FREE_SESSION_LIMIT` is retuned now, with data.** Sprint 15 produced the
   per-turn voice cost numbers ADR-027 said were the missing input. The retuned
   number lives in the same `session-gate.ts` constant and is mirrored (by hand,
   one constant) into `Pricing.tsx`.

### Reconciliation with `/docs/PLAN.md` (read before Task 1) — what this implements
- **§2.8's deferred halves.** PLAN §2.8 always named the daily reset cron, the
  reconciliation cron, and the hard-delete cron as owed; the `start_session` RPC
  comment itself says "the daily reconciliation cron is deferred to the billing
  sprint." This sprint ships the **reset** and **hard-delete** crons; the
  **Stripe reconciliation** cron stays with billing (Sprint 23) — a no-op stub
  route is scaffolded here so the cron wiring exists, but no Stripe logic lands.
- **§2.7 privacy/compliance.** Export (JSON) + deletion cascade + server-salted
  URL hashing are §2.7's named deliverables; this sprint implements them. The age
  gate and consent capture (§2.7, already shipped) are untouched.
- **§2.8 freemium.** The atomic gate, lazy reset, and `SECURITY INVOKER`
  discipline are unchanged; only the *limit's value* is retuned and a *global*
  ceiling is added above the per-user one.

### The cost guardrail is an atomic RPC, mirroring the free-tier gate (read before Tasks 3, 4)
`start_session` is the model: an atomic increment-and-check in a single statement
so concurrent calls can't both slip under a limit. The cost guard is the same
shape one level up — a `cost_guard(p_estimated_cents int)` RPC (`SECURITY
DEFINER`, since the ledger is global and not user-RLS-scoped) that adds the
estimate to today's ledger row and returns `{ soft_exceeded, hard_exceeded,
spent_cents }` in one atomic statement. Each paid route calls it *before* the
provider call with a per-provider estimate constant; on `hard_exceeded` it
returns the friendly refusal without calling the provider, on `soft_exceeded` the
voice routes signal degradation. Estimates are static constants
(`web/lib/tier/cost-model.ts`, new) — the point is a ceiling, not an invoice.

### Deletion cascade: FK `on delete cascade` already exists; the sweep just deletes the root (read before Tasks 5, 6)
The domain tables (`sessions`, `knowledge_nodes`, `misconceptions`,
`session_interactions`, `reinforcement_schedule`) are all `user_id`-keyed with FK
`on delete cascade` to `users` (migrations 0002/0004/0007/0008). So a real
hard-delete is a single `delete from users where id = ...` under the service-role
client — the cascade is already declared. The sweep's job is to (a) find rows
flagged for erasure past their grace window, (b) delete the `auth.users` row via
the admin client (which cascades `public.users` and everything under it), and
(c) verify absence. The two-phase design (queue in-request, execute in cron)
exists so the request is fast and the destructive step is retryable and auditable
— not because the cascade is complicated.

### Export is a read, deletion is a write; both go through the service-role admin client (read before Tasks 5, 6)
Export reads every user-scoped table for the caller and serializes to JSON — but
it reads as the *authenticated user* (the bearer/cookie client, RLS-scoped), so
it can only ever export the caller's own rows; RLS is the guarantee, not a
`where` clause we could forget. Deletion queuing writes the caller's own `users`
row (RLS-scoped update). The **cron sweep** is the only path that uses the
service-role admin client (`web/lib/supabase/admin.ts`), because it must delete
`auth.users` rows and must run without a user session; it is gated by a
`CRON_SECRET` header check so nothing but Vercel Cron can invoke it.

### URL hashing: the extension already sends only a domain; hash it, drop the plaintext (read before Task 7)
`page_url_hash` has existed as a nullable column since 0003 and is never
populated; `page_domain` is written raw. The extension's `deriveTabDomain` only
ever sends the registrable domain (never a full path/query), so the sensitive
"raw URL" was never stored — but a bare hash is still the compliant target. This
sprint hashes the domain with a server-only `URL_HASH_SALT` (env, never in any
bundle) into `page_url_hash`, and **stops writing plaintext `page_domain`** on
new rows (the column stays for back-compat but new writes null it). The dashboard
(Sprint 22) will group by hash, not display the domain name — a deliberate
privacy call recorded in ADR-036 (a coarse "which site" display is a later,
explicit reopening, not a silent default).

## Execution model
A **single code session** owns this sprint end to end, worked **strictly in order
(1 → 9)**. The chain: the ADRs fix the caps/erasure/hashing decisions (Task 1);
the cost ledger migration + RPC (Task 2) must exist before the routes call it
(Task 3); the `FREE_SESSION_LIMIT` retune (Task 4) is independent web-only; export
+ deletion routes (Task 5) precede the crons that consume the deletion queue
(Task 6); URL hashing (Task 7) is an independent write-path change; tests (Task 8)
gate manual acceptance (Task 9). One session — no handoff.

This sprint touches: `/supabase/migrations` (0013 cost ledger + erasure queue,
0014 url-hash backfill-none), `/web/lib/tier/*`, the paid routes under
`/web/app/api/{ai,voice}/`, new `/web/app/api/account/*` and `/web/app/api/cron/*`
routes, `/web/app/(dashboard)/account/page.tsx`, `/web/components/marketing/
Pricing.tsx`, `/vercel.json` (new), and `/web/lib/supabase/admin.ts`. It does
**not** touch the extension (the degradation path and quota display already exist
client-side), the learning read/write path, the AI prompt/envelope, or any Stripe
code (billing is Sprint 23).

## Files in scope

### Task 1 (ADRs + sprint pointers) creates or edits:
```
/docs/adr/ADR-034-global-cost-guardrail.md ← new — the aggregate daily ceiling: atomic cost_guard RPC (SECURITY DEFINER, daily-keyed ledger), soft cap → voice degrades to text+browser-TTS (reuses §2.8), hard cap → graceful refusal; per-provider estimate constants (budget- not invoice-accurate); RETUNES FREE_SESSION_LIMIT with Sprint 15's cost data and the Pricing.tsx sync obligation.
/docs/adr/ADR-035-data-export-and-erasure.md ← new — export = RLS-scoped read → JSON; deletion = two-phase (queue in-request, cron sweep executes the FK-cascade via service-role admin client + verifies absence); grace window; CRON_SECRET-gated cron routes.
/docs/adr/ADR-036-cron-and-url-hashing.md    ← new — first Vercel Cron infra (vercel.json), reset-free-tier safety net + hard-delete sweep + a no-op Stripe-reconcile stub (billing owns it); page_url_hash populated with a server-salted hash, plaintext page_domain no longer written (dashboard groups by hash — the coarse-domain display is a later explicit call).
/CLAUDE.md                                    ← edit one line: Current sprint → Sprint 16 — Cost control + compliance hardening
/docs/CLAUDE.md                               ← edit one line: Current phase → Phase 2, Sprint 16
/docs/sprint-16-plan.md                       ← this file
/docs/architecture.md                         ← edit: global cost ledger + guard; account export/delete; Vercel Cron infra; page identifiers hashed at rest
```

### Task 2 (migrations — cost ledger + erasure queue) creates / edits:
```
/supabase/migrations/0013_cost_ledger_and_erasure.sql ← new — (a) cost_ledger(day date primary key, spent_cents int not null default 0): a single row per UTC day, no user_id — RLS enabled with ZERO policies (Shape 3, service-role/RPC only, deny-all to clients). (b) cost_guard(p_estimated_cents int) RETURNS (soft_exceeded bool, hard_exceeded bool, spent_cents int) LANGUAGE plpgsql SECURITY DEFINER — atomic upsert-add-and-check against today's row using named soft/hard cap constants (or GUC/config table read); the ONLY writer of cost_ledger. (c) users gains erasure_requested_at timestamptz null (the deletion queue marker; the existing deleted_at stays the soft-delete flag). Follows the RLS-in-migration rule (ADR-005); re-runs clean on db reset.
```

### Task 3 (web — the cost guard on the paid routes) creates / edits:
```
/web/lib/tier/cost-model.ts    ← new — per-provider estimate constants (CLAUDE_TURN_CENTS, WHISPER_PER_SEC_CENTS, ELEVENLABS_PER_CHAR_CENTS) + SOFT_CAP_CENTS / HARD_CAP_CENTS; a estimateCost(kind, size) helper. Single source of truth, server-only.
/web/lib/tier/cost-guard.ts    ← new — costGuard(supabase, estimatedCents) wraps the RPC; returns { softExceeded, hardExceeded }. Mirrors session-gate.ts's shape.
/web/app/api/ai/turn/route.ts  ← edit — before the Claude call: costGuard(estimate). hardExceeded → 200 { reply: "Calyxa is resting for today — the tutor is back tomorrow.", degraded: true } (never a 500, never a provider call). softExceeded threads a degraded flag to the client (voice already degrades UX-side). Auth/entitlement/persist logic otherwise unchanged.
/web/app/api/ai/stream/route.ts + /web/app/api/ai/turn/stream/route.ts ← edit — same guard at the top of each streaming path; hard cap ends the stream immediately with the resting message.
/web/app/api/voice/stt/route.ts ← edit — costGuard(estimate from audio bytes/duration); softExceeded OR hardExceeded → 200 { degraded: true } so the client falls back to text (no Whisper call). Size cap unchanged.
/web/app/api/voice/tts/route.ts ← edit — costGuard(estimate from text length); degraded → 200 { degraded: true } so the client uses browser SpeechSynthesis (the §2.8 fallback). Size cap unchanged.
```

### Task 4 (web — FREE_SESSION_LIMIT retune + Pricing sync) edits:
```
/web/lib/tier/session-gate.ts        ← edit — FREE_SESSION_LIMIT retuned to the value ADR-034 fixes from Sprint 15's per-turn cost data (problem-sized sessions). One constant; the RPC contract is unchanged.
/web/components/marketing/Pricing.tsx ← edit — the "N tutoring sessions a month" free-tier number reads the retuned limit (imported constant if a shared import is clean, else a mirrored constant with a comment pointing at session-gate.ts as the source of truth). Sprint 20 flagged this exact sync in its handoff.
```

### Task 5 (web — account export + deletion) creates / edits:
```
/web/app/api/account/export/route.ts ← new — GET, bearer/cookie-authed: reads the caller's rows from users, sessions, knowledge_nodes, misconceptions, session_interactions, reinforcement_schedule (RLS-scoped — can only ever return the caller's own data), returns application/json with a Content-Disposition attachment. No service-role client (RLS is the guarantee). Excludes nothing the user is entitled to; includes a schema/version stamp.
/web/app/api/account/delete/route.ts ← new — POST, bearer/cookie-authed: sets erasure_requested_at = now() and deleted_at = now() on the caller's users row (RLS-scoped update); signs the user out; returns 200. Does NOT delete in-request — the cron sweep executes the cascade. Idempotent (a second call is a no-op).
/web/app/(dashboard)/account/page.tsx ← edit — add an "Export my data" (links to the export route) and a "Delete my account" control (confirm dialog → POST the delete route → redirect to a goodbye state). Reuses the existing Card/Alert/Button primitives; no new component system.
```

### Task 6 (web — Vercel Crons) creates / edits:
```
/vercel.json                              ← new — crons: reset-free-tier (daily), hard-delete-sweep (daily), stripe-reconcile (daily, stub). (If the repo standardizes on vercel.ts later that's a mechanical move; vercel.json is the minimal correct form now.)
/web/app/api/cron/reset-free-tier/route.ts   ← new — CRON_SECRET-gated: resets free_session_count = 0 + bumps free_period_started_at for any user whose period is ≥ 30 days old (the safety net over the lazy RPC reset, for dormant accounts). Service-role admin client. Idempotent.
/web/app/api/cron/hard-delete-sweep/route.ts ← new — CRON_SECRET-gated: finds users with erasure_requested_at past the grace window, deletes each auth.users row via the admin client (cascading public.users and all user-scoped tables via the existing FK on delete cascade), then re-selects to VERIFY absence; logs a count. Service-role admin client. Bounded batch; safe to re-run.
/web/app/api/cron/stripe-reconcile/route.ts  ← new — CRON_SECRET-gated STUB: returns 200 with a "not yet implemented — Sprint 23 owns this" note. Wired so the cron surface exists; no Stripe SDK, no logic.
/web/lib/cron/auth.ts                     ← new — assertCronSecret(request): constant-time compare against process.env.CRON_SECRET; 401 otherwise. Shared by all three cron routes.
```

### Task 7 (web — URL hashing at rest) creates / edits:
```
/web/lib/privacy/url-hash.ts   ← new — hashPageDomain(domain): HMAC-SHA256(domain, process.env.URL_HASH_SALT) → hex. Server-only; the salt is never sent to any client. Returns null for a null/empty domain.
/web/app/api/session/start/route.ts ← edit — compute page_url_hash = hashPageDomain(pageDomain) and pass it to the session write; STOP writing plaintext page_domain on new rows (pass null). The start_session RPC gains a p_page_url_hash param (0013 or a small 0014 migration alters the RPC signature) OR the route writes the hash via a follow-up update — whichever keeps the atomic gate intact (prefer the RPC param).
/supabase/migrations/0014_start_session_url_hash.sql ← new (only if the RPC signature must change) — alter start_session to accept p_page_url_hash and write it to sessions.page_url_hash instead of p_page_domain; additive, re-runs clean. If the route can populate the hash without touching the RPC, this migration is skipped and the decision recorded in the commit message.
```

### Task 8 (tests) creates / edits:
```
/web/tests/cost-guard.test.ts   ← new — the RPC/guard: under soft cap → provider proceeds; over soft cap → voice routes signal degraded (no provider call); over hard cap → turn route returns the resting message (no provider call, no 500); concurrent guard calls can't both slip under the cap (atomicity, mirroring session-gate's concurrency test).
/web/tests/account.test.ts      ← new — export returns ONLY the caller's rows across all six tables (a second fixture user's rows never appear — RLS proven); delete queues (sets erasure_requested_at + deleted_at, does not delete in-request); export is complete (every seeded row present); the cron sweep deletes a queued user and a re-select finds nothing across all tables (cascade verified); a NON-queued user is untouched by the sweep.
/web/tests/cron-auth.test.ts    ← new — every cron route rejects a missing/wrong CRON_SECRET (401) and accepts the correct one; the stripe-reconcile stub returns its not-implemented marker.
/web/tests/url-hash.test.ts     ← new — hashPageDomain is deterministic for a given salt, differs across salts, returns null for null/empty; session/start writes the hash and nulls plaintext domain (asserted at the route boundary).
/web/tests/pricing.test.ts      ← new or edit — Pricing.tsx renders the SAME number as FREE_SESSION_LIMIT (fails the build if they drift).
```

### Files explicitly out of scope
```
/extension/**                         (the §2.8 degradation UX + quota display already exist client-side; the degraded flags this sprint sends are consumed by paths built in Sprint 14/06 — no extension change)
/web/lib/learning/**                  (learning read/write untouched)
/web/lib/ai/{envelope,system-prompt,claude}.ts (no prompt/model change — the guard sits in the route, before the provider call)
/web/app/api/auth/**                  (age gate + consent capture already shipped; signup unchanged)
Stripe / billing anything            (Sprint 23; only the no-op reconcile stub is scaffolded)
/web/lib/consent.ts                   (MIN_AGE + meetsMinAge unchanged)
```
Also out of scope (no pre-empting later roadmap sprints):
- **Stripe checkout, webhooks, entitlements resolver, the reconciliation cron's
  real body** — Sprint 23 (billing/GA). The stub route only reserves the seam.
- **Per-user cost attribution / usage analytics** — the guard is a global ceiling,
  not a metering product; per-user telemetry is Sprint 17's privacy-scoped work.
- **A self-serve consent dashboard beyond export + delete** — PLAN's deferred
  table keeps this Phase 3+; the two required GDPR flows are enough at V1.

Do not create any file not listed above. If something seems needed but is not
listed, add it to "What the next sprint needs to know" and ask before creating it.

---

## Task 1 — Cost/compliance ADRs + sprint pointers (planning / docs)
Write ADR-034/035/036 in the project format (match ADR-001…ADR-033). Fix the cap
constants' *shape* (named, in `cost-model.ts`) even if their values tune later;
spell out the two-phase erasure and the grace-window duration; record the
hash-don't-store-plaintext-domain decision and the deliberate loss of domain
display. Update pointers + architecture.md.

Acceptance gate before Task 2:
  - Three ADRs read as decisions (context → decision → consequences); the
    Stripe-reconcile deferral to Sprint 23 is explicit; no code touched.

## Task 2 — Migrations: cost ledger + erasure queue (supabase)
Scope: `0013_cost_ledger_and_erasure.sql` per the Files-in-scope annotation.
Additive, RLS-in-migration, re-runs clean on `supabase db reset`.

Acceptance gate before Task 3:
  - `supabase db reset` runs 0001→0013 clean; `cost_ledger` is deny-all to
    clients; `cost_guard` is `SECURITY DEFINER` and atomic; `users.erasure_
    requested_at` exists; `cd web && npm run typecheck` passes with regenerated
    types.

## Task 3 — Web: the cost guard on the paid routes
Scope: `cost-model.ts`, `cost-guard.ts`, the five paid routes. The guard is
*before* the provider call, always; a degraded result never 500s.

Acceptance gate before Task 4:
  - A forced soft cap degrades voice to text + browser TTS live; a forced hard
    cap returns the resting message with no provider call; under the cap,
    everything behaves exactly as Sprint 15.

## Task 4 — Web: FREE_SESSION_LIMIT retune + Pricing sync
Scope: `session-gate.ts` constant + `Pricing.tsx`. One number, two synced sites.

Acceptance gate before Task 5:
  - `pricing.test.ts` proves the marketing number equals the enforced limit; the
    RPC contract is unchanged (the limit is still passed as `p_free_limit`).

## Task 5 — Web: account export + deletion
Scope: the two `/api/account/*` routes + the account page controls.

Acceptance gate before Task 6:
  - Export returns a complete JSON of the caller's data and nothing else (RLS
    proven against a second fixture user); delete queues erasure + signs out,
    without deleting in-request.

## Task 6 — Web: Vercel Crons
Scope: `vercel.json` + the three cron routes + `cron/auth.ts`.

Acceptance gate before Task 7:
  - Each cron route 401s without the secret; the reset cron normalizes a dormant
    account; the hard-delete sweep erases a queued user and a re-select finds
    nothing across all six tables; the stripe stub returns its marker.

## Task 7 — Web: URL hashing at rest
Scope: `url-hash.ts` + `session/start` (+ the RPC-signature migration only if
needed). Plaintext domain stops being written; the hash is populated.

Acceptance gate before Task 8:
  - A new session row has a non-null `page_url_hash` and a null `page_domain`; the
    hash is stable per salt; no raw domain or URL is written anywhere (asserted).

## Task 8 — Tests (gate)
Scope: per the Files-in-scope annotations. All server-side; the cost-guard and
account tests exercise the atomic RPC and the cascade against a real (test)
Supabase.

Acceptance gate before Task 9:
  - `turbo run typecheck lint build test` green across workspaces; each new spec
    fails meaningfully when its guarded behavior is reverted.

## Task 9 — Cost + compliance acceptance (manual)
Signed in as a real dev user:
  1. Drive the daily ledger to the soft cap (temporarily low cap): a voice turn
     degrades to text + browser voice; text turns still work.
  2. Drive to the hard cap: a new turn returns "Calyxa is resting for today," no
     500, no provider call (verified in provider dashboards / logs showing no
     request).
  3. Export: download the JSON, confirm it contains this user's sessions, mastery,
     misconceptions, interactions, due items — and manually confirm a second
     account's data is absent.
  4. Delete: request deletion → signed out → `erasure_requested_at` set; run the
     hard-delete cron (with the secret) → re-query as service role → every row
     for that user is gone across all tables.
  5. Reset cron: age a dormant fixture's `free_period_started_at` past 30 days →
     run the cron → count normalized to 0.
  6. URL hashing: start a session → the row's `page_url_hash` is populated,
     `page_domain` is null.
  7. Pricing: the marketing page shows the retuned free-tier number.

## Acceptance criteria (full checklist)
- [ ] ADR-034/035/036 written; pointers + architecture.md updated; Stripe-reconcile deferral to Sprint 23 explicit
- [ ] cost_ledger (deny-all) + cost_guard (SECURITY DEFINER, atomic) + users.erasure_requested_at land in 0013; db reset clean
- [ ] Every paid route calls costGuard before the provider; soft cap → voice degrades to text + browser TTS; hard cap → graceful refusal, never a 500 or a provider call
- [ ] FREE_SESSION_LIMIT retuned from Sprint 15 cost data; Pricing.tsx shows the same number (test-enforced)
- [ ] GET /api/account/export returns a complete, RLS-scoped JSON of the caller's data only
- [ ] POST /api/account/delete queues erasure (erasure_requested_at + deleted_at) + signs out; does not delete in-request
- [ ] vercel.json + three CRON_SECRET-gated cron routes exist; reset-free-tier safety net works; hard-delete sweep cascades + verifies absence; stripe-reconcile is a wired stub
- [ ] page_url_hash populated with a server-salted HMAC; plaintext page_domain no longer written; no raw URL anywhere (asserted)
- [ ] `turbo run typecheck lint build test` green; Task 9 manual pass complete

## Risks
**The cost estimates are wrong, so the cap trips too early or too late.**
Mitigation: estimates are named constants in one file, tuned in minutes from real
provider-dashboard numbers during Task 9; the cap is a ceiling, not billing, so
"approximately right" is the bar; the soft/hard split means a mis-estimate
degrades UX before it ever hard-blocks.

**A hard cap during the beta locks everyone out and reads as an outage.**
Mitigation: the hard cap is set well above expected beta volume (a spike/abuse
backstop, not the normal ceiling); the message is friendly and time-bounded
("back tomorrow"); the soft cap absorbs normal overage by degrading, not
blocking; both constants are one-line tunes.

**The deletion cascade misses a table, leaving orphaned personal data.**
Mitigation: the cascade is declared FK `on delete cascade` (not hand-written), so
deleting the root deletes the tree; the sweep *verifies* absence by re-selecting
every table and the test asserts it; any table added in a future sprint must
carry the same FK (called out in "What the next sprint needs to know").

**A cron runs without protection or double-executes.** Mitigation: every cron
route is `CRON_SECRET`-gated with a constant-time compare (401 otherwise); each
job is idempotent (reset is set-to-0, sweep is delete-if-present, both safe to
re-run); the sweep is bounded per batch.

**Losing plaintext domains breaks the future dashboard's "where you studied"
view.** Mitigation: this is the deliberate privacy call (ADR-036) — the dashboard
groups by hash; if a coarse domain display is ever wanted, it's an explicit
reopening with its own consent reasoning, not a silent default. Flagged for
Sprint 22.

**Retuning the free limit strands the marketing claim or surprises early users.**
Mitigation: `pricing.test.ts` binds the two numbers so they cannot drift; the
degradation path (not a hard lockout) softens the boundary; the number is chosen
from real cost data, not guessed.

## What the next sprint needs to know
**Spend is bounded and the compliance floor is met.** A global daily cost ceiling
degrades voice then refuses gracefully; export + deletion + a real erasure cascade
exist; Vercel Cron infrastructure exists (reset + hard-delete live, Stripe-
reconcile stubbed); page identifiers are hashed at rest.

- **Sprint 17 (onboarding + instrumentation)** inherits: the cron infra pattern
  (add a job = a route + a `vercel.json` line + the `CRON_SECRET` gate); the
  `erasure_requested_at`/`deleted_at` semantics (telemetry must never resurrect a
  deleted user's data); the privacy posture (its telemetry carries no content and
  no raw URL — the hashing discipline extends to any new identifier it logs).
- **Sprint 18 (hardening/audit)** inherits: the cost guard, cron auth, and export/
  delete as new attack surface to review; the RLS sweep must include `cost_ledger`
  (deny-all) and confirm the crons' service-role use is `CRON_SECRET`-gated only.
- **Sprint 22 (dashboard)** inherits: **group by `page_url_hash`, not domain**
  (plaintext is gone by design); reads stay RLS-scoped and per-request-fresh.
- **Sprint 23 (billing)** inherits: the wired-but-empty `stripe-reconcile` cron
  route (fill its body), the Stripe columns still unused, and the retuned free
  limit as the Pro upsell's baseline.
- **Any new user-scoped table** from here on MUST carry FK `on delete cascade` to
  `users` (or the erasure sweep will orphan it) and appear in the export route —
  both are now load-bearing, not optional.
