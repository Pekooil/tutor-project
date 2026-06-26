## ADR-007: Free-tier session gate — atomic, server-authoritative, graceful

**Status:** Decided

**Context:** The free-session limit must be enforced somewhere the client
cannot tamper with it, and concurrent session starts must not both slip
under the limit (a read-then-increment in the API route is a race).  We also
had to decide what happens at the boundary — hard block vs. degrade — and
where the rolling 30-day reset lives.

**Decision:** Enforce the limit at session start via a single atomic
`UPDATE users SET free_session_count = free_session_count + 1 ... WHERE
subscription_tier = 'free' AND free_session_count < $limit RETURNING ...`,
run in the **same transaction** as the `sessions` INSERT, inside a
**`SECURITY INVOKER`** Postgres function (`start_session`) so RLS still
applies to both statements (`auth.uid()` is the caller, not a bypassed
service role). Over-limit behaviour is **graceful degradation**: the session
still starts, but is marked `counts_against_free = false` and the function
returns `degraded = true` — never a hard block. The rolling 30-day reset
(`free_session_count = 0`, `free_period_started_at = now()`) is performed
**lazily inside `start_session`** before the quota check; the daily
reconciliation cron is deferred to the billing sprint.

**Rationale:**
- A single atomic statement closes the race that a two-step
  read-then-increment in the route would leave open.
- `SECURITY INVOKER` keeps the gate inside RLS rather than reaching for a
  service-role bypass — the one legitimate `SECURITY DEFINER` function
  remains Sprint 03's `handle_new_user`.
- Graceful degradation matches the locked product decision to never lock a
  student out mid-study; it also establishes the `{ degraded,
  counts_against_free, remaining }` response shape now so the voice sprint
  can branch on it (text-only + browser `SpeechSynthesis`, upsell prompt)
  without changing the API contract later.
- The lazy reset is correct on its own with no cron — the cron is a latency
  optimisation, not a correctness requirement.

**Consequences:**
- Enables: a tamper-proof free-session counter from day one, and a stable
  response contract the voice sprint depends on.
- Requires: `users.free_session_count` and `users.free_period_started_at` to
  be `NOT NULL` with sane defaults (normalised in migration 0003, since
  Sprint 03 left them nullable and behaviour-free).
- Defers: Stripe/billing, the full entitlements resolver, Pro feature-flag
  gating, and the daily reset/reconciliation cron — all out of scope this
  sprint per the sprint-04 plan.
