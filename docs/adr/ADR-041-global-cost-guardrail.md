## ADR-041: Global cost guardrail — an aggregate daily spend ceiling above the per-user gate

**Status:** Decided

**Context:** Sprints 11–15 made the tutoring loop curriculum-complete and
voice-fast, and the per-user freemium gate (ADR-007, `start_session`) meters how
many sessions an individual free user gets. What still does not exist — confirmed
by this sprint's audit — is **any tracking of aggregate spend**: no cost ledger,
no per-call estimate, no ceiling on what the whole beta can bill across the three
paid providers (Claude, Whisper, ElevenLabs). A public beta put in front of
strangers (including 13-to-17-year-olds) introduces a failure mode the per-user
gate does not cover: a bug, an abuse pattern, or a viral spike driving an
open-ended API bill. The per-user gate limits *each* user; it says nothing about
*everyone at once*. Separately, ADR-027 deliberately deferred retuning
`FREE_SESSION_LIMIT` to "the sprint that has real per-turn cost data"; Sprint 15
produced that data (problem-sized sessions, measured per-turn voice + text cost).

**Decision:**

1. **A global aggregate ceiling, not per-user billing.** The guardrail's job is to
   protect the beta budget, not to meter individuals — the per-user free-tier gate
   already does that, and stays untouched. This is a *second, aggregate* ceiling
   layered above it. It is an atomic add-and-check RPC, `cost_guard(p_estimated_
   cents int)`, `SECURITY DEFINER` (the ledger is global, not user-RLS-scoped),
   mirroring `start_session`'s proven atomic increment-and-check so concurrent
   calls can't both slip under a cap. It adds the estimate to today's ledger row
   and returns `{ soft_exceeded, hard_exceeded, spent_cents }` in one statement.
   It writes a single daily-keyed row (`cost_ledger(day date primary key,
   spent_cents int)`), RLS-enabled with **zero policies** — deny-all to clients,
   the RPC is its only writer.

2. **Two caps, two behaviors.**
   - **Soft cap** → disable the expensive optional legs. Voice degrades to
     text-only + the browser `SpeechSynthesis` voice — the exact §2.8 over-quota
     degradation path already built for the per-user boundary, reused verbatim.
     The student keeps tutoring; only premium STT/TTS drop.
   - **Hard cap** → refuse new AI turns gracefully. The turn route returns
     `200 { reply: "Calyxa is resting for today — the tutor is back tomorrow.",
     degraded: true }` — **never a 500, never a provider call**. A hard-capped day
     is a bug-or-viral-spike backstop set well above expected beta volume; the
     soft cap is the normal ceiling, and it degrades UX before anything ever
     hard-blocks.

3. **The guard runs *before* the provider call, always.** Each paid route
   (`ai/turn`, `ai/stream`, `ai/turn/stream`, `voice/stt`, `voice/tts`) calls
   `costGuard(estimate)` at the top, with a per-provider estimate, before touching
   the provider. On `hardExceeded` it returns the resting message without calling
   the provider; on `softExceeded` the voice routes signal degradation
   (`{ degraded: true }`) so the client falls back to text + browser TTS. Auth,
   entitlement, and persistence logic are otherwise unchanged from Sprint 15.

4. **Estimates are named constants, budget-accurate not invoice-accurate.** They
   live in one server-only file (`web/lib/tier/cost-model.ts`):
   `CLAUDE_TURN_CENTS`, `WHISPER_PER_SEC_CENTS`, `ELEVENLABS_PER_CHAR_CENTS`, plus
   `SOFT_CAP_CENTS` / `HARD_CAP_CENTS`, and an `estimateCost(kind, size)` helper.
   The *shape* is fixed now (named, single source of truth); the *values* tune in
   minutes from real provider-dashboard numbers during Task 9. The point is a
   ceiling, not an invoice — "approximately right" is the bar, and the soft/hard
   split means a mis-estimate degrades UX before it ever hard-blocks.

5. **`FREE_SESSION_LIMIT` is retuned now, with Sprint 15's data.** The retuned
   value (sized for problem-sized sessions from the measured per-turn cost) lives
   in the same `web/lib/tier/session-gate.ts` constant — the `start_session` RPC
   contract is unchanged; only the number passed as `p_free_limit` moves. The same
   number is mirrored into the now-live marketing `web/components/marketing/
   Pricing.tsx` (shared import if clean, else a mirrored constant with a comment
   naming `session-gate.ts` as the source of truth), and a test binds the two so
   the page can never advertise a stale limit. Sprint 20's handoff flagged exactly
   this sync.

**Rationale:**
- The per-user gate and the aggregate ceiling answer different questions ("how
  much does *this* user get" vs "how much can *everyone* cost") and must be
  independent controls; collapsing them would either throttle honest users to
  protect the budget or protect no budget at all.
- Reusing `start_session`'s atomic pattern one level up means the concurrency
  correctness is already proven — the same statement-level add-and-check that made
  the free gate race-proof makes the cost ledger race-proof.
- Reusing the §2.8 degradation path for the soft cap means the client already
  knows how to render "text + browser voice"; no new client behavior ships, and
  the soft cap is UX we've already validated.
- Estimates-as-constants keeps the tuning surface to one file, matching the risk
  profile: a ceiling that's a little off is fine and fixable in a one-line edit; a
  ceiling that requires per-call invoicing to work would be a metering product we
  explicitly are not building.

**Consequences:**
- Enables: a bounded worst-case daily bill for the beta, with graceful behavior at
  both thresholds — degrade first, refuse last, never crash.
- Requires: migration 0013's `cost_ledger` (deny-all) + `cost_guard` (`SECURITY
  DEFINER`, atomic); `cost-model.ts` + `cost-guard.ts`; the guard call at the top
  of all five paid routes; the `FREE_SESSION_LIMIT` retune + `Pricing.tsx` sync
  (test-enforced).
- Forecloses (this sprint): per-user cost attribution / usage analytics (the guard
  is a global ceiling, not a metering product — per-user telemetry is Sprint 17's
  privacy-scoped work); invoice-accurate accounting (Stripe/billing is Sprint 23);
  any client-side cost enforcement (the client already only ever *displays* — the
  ledger and guard are server-only).
- A missed or mis-estimated guard fails safe: an under-estimate delays the cap
  slightly (a ceiling, not a meter); the hard cap's friendly, time-bounded message
  ("back tomorrow") is the worst thing a student sees, and only above a backstop
  threshold set well over expected volume.

See ADR-035 (export + erasure) and ADR-036 (cron infra + URL hashing) for the
other two halves of Sprint 16's pre-beta gate.
