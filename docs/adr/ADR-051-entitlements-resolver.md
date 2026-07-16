## ADR-051: An entitlements resolver — computed server-side from tier + status, relayed on the session for display, and re-checked on every Pro path (the cached client value is a hint, never an authorization)

**Status:** Decided

**Context:** ADR-050 makes payment real: a webhook flips `users.subscription_tier` to
`'pro'` and maintains `subscription_status`. But *being Pro* and *receiving Pro features*
are two different things, and the second does not exist yet. Confirmed against the code:
`web/lib/entitlements/` is **reserved-but-empty**; nothing computes a feature-flag set;
the only `subscription_tier` reads are the `start_session` RPC gate and the account page's
read-only display. So the session cap unlocks the moment `tier = 'pro'` (via the RPC's
existing tier exemption — ADR-050 §4), but every *other* Pro-gated capability the product
has designed around (PLAN §2.8's feature-flag system — dashboard depth, history length,
misconception graph, premium voice, image capture) has **no resolver and no gate**.

Two invariants must hold for this to be safe rather than merely present:

1. **The client must never be trusted to authorize.** The locked discipline "free-tier
   limits are enforced server-side; the client is a display hint only" (CLAUDE.md, the
   `start_session` gate) must extend to entitlements. A cached flag in the extension's
   `ActiveSession` is fine for *showing* the right UI, but a forged one must not *grant*
   anything.
2. **There must be exactly one source of truth for what "Pro" means.** If the resolver, the
   session-start route, and each Pro endpoint each re-derive the flag set differently, they
   will drift. PLAN §2.8 names a specific flag set; it should be computed in one pure
   function and consumed everywhere.

**Decision:** A pure, server-only **entitlements resolver** computes the PLAN §2.8 flag set
from `tier + status`; it **rides the `/api/session/start` response for display**; and it is
**re-derived server-side on every Pro-only path** via a small `assertEntitlement` helper —
the cached client value is a hint, never an authorization. Four decisions fix the shape:

1. **`resolveEntitlements(tier, status)` is a pure function and the single source of
   truth.** `web/lib/entitlements/resolve.ts` exports `resolveEntitlements(tier, status)`
   returning the PLAN §2.8 flag set — `{ voice_premium, misconception_graph,
   spaced_reinforcement, full_dashboard, unlimited_history, image_capture }` — computed
   **purely** from `subscription_tier` + `subscription_status`, with **no I/O**, so it is
   trivially unit-testable as a truth table. The exported `Entitlements` type is the one
   definition every consumer imports; no endpoint re-invents the mapping.

2. **`past_due` keeps Pro flags during grace; only free (or terminal) is downgraded.**
   Consistent with ADR-050 §5's grace window, a `past_due` user resolves to the **Pro** flag
   set (they are mid-dunning, not lapsed); only `tier = 'free'` — the state a terminal
   `subscription.deleted` or grace-expiry reconcile produces — resolves to the free flag
   set. So the resolver never contradicts the billing state machine: the same grace that
   retains `tier = 'pro'` in the `users` row retains the flags the resolver computes from it.

3. **Entitlements are resolved server-side, relayed for display, and re-checked per path.**
   `/api/session/start` attaches `resolveEntitlements(user.subscription_tier,
   user.subscription_status)` to its response alongside `{ sessionId, mode, degraded,
   remaining }`; the extension caches it in `ActiveSession` **for UX only**. Every Pro-only
   endpoint calls a new `assertEntitlement(supabase, flag)` (`web/lib/tier/require-pro.ts`)
   that **re-derives entitlements from the user's `users` row** (never from any client-sent
   value) and 401/403s a request that lacks the flag. The cached client entitlement is a
   display hint; the row is the authorization. This is the locked "client is a display hint
   only" rule, extended from the free-tier gate to entitlements.

4. **`image_capture` is a staged flag (`'off' | 'beta' | 'on'`), not a boolean.** Unlike the
   other flags, `image_capture` supports a staged rollout — its resolved value is one of
   `'off'`, `'beta'`, `'on'`, honoring a per-user override if one is present — so a future
   capability can be dark-launched, beta-cohorted, then GA'd without another resolver
   change. The other flags are booleans keyed on the Pro/free split.

**Rationale:**
- **A pure resolver is the one-source-of-truth that prevents drift.** Making the mapping a
  single I/O-free function means the session route and every gate compute identical flags,
  and the whole contract is covered by a table test rather than scattered conditionals.
- **Server-resolve + display-cache + re-check is the only shape that is both fast and
  safe.** Relaying the flags on session-start lets the client render the right UI without a
  round-trip per surface; re-deriving from the row at each Pro endpoint means a forged cache
  grants nothing. Doing only the first would be forgeable; doing only the second would make
  the UI chatty and stale. Both, with an explicit "cache is a hint" contract, is the
  discipline the free-tier gate already proved.
- **Grace-aware resolution keeps billing and entitlements from contradicting each other.**
  If `past_due` retained `tier = 'pro'` (ADR-050) but the resolver downgraded its flags, a
  mid-dunning user would keep unlimited sessions (RPC exemption) yet lose the dashboard —
  an incoherent half-downgrade. Resolving `past_due` to Pro keeps the two aligned.
- **Staging `image_capture` now avoids a later resolver churn.** Image capture is the one
  flag with an obvious phased rollout; encoding it as a tri-state from day one means the
  rollout is a data/override change, not a code change to the resolver's shape.
- **This ADR invents the gate, not the gated features.** Which features are Pro — Sprint
  21's unlimited study kits, Sprint 22's `full_dashboard` / `unlimited_history`, staged
  `image_capture` — is each feature's own product call and its own one-line
  `assertEntitlement` insertion (the seam those sprints' plans reserved). Building them here
  would over-reach this sprint.

**Consequences:**
- **Enables:** every Pro-only capability across the product now has a uniform gate — an
  endpoint adds one `assertEntitlement(supabase, flag)` line and is correctly Pro-gated,
  re-checked server-side, forge-proof. The session response carries the flags so the UI
  (dashboard, popup upsell) can show the right state immediately.
- **Requires:** `web/lib/entitlements/resolve.ts` (the pure resolver + the `Entitlements`
  type); the `/api/session/start` attach (display hint only); and `web/lib/tier/
  require-pro.ts` (`assertEntitlement`, re-derives from the row). It **reuses** the ADR-050
  billing columns and **does not touch** the free-tier `session-gate.ts` / `start_session`
  RPC (the session cap is already lifted by the tier exemption — ADR-050 §4) or the cost
  guard.
- **Forecloses (this sprint):** deciding *which* features are Pro (a per-feature product
  call, one `assertEntitlement` line each — not a re-plumb); any **client-side entitlement
  enforcement** (the cached flag only ever *displays* — the row is the authority); and a
  per-user usage-metering / analytics product (entitlement is a boolean/tri-state gate, not
  a meter — orthogonal to ADR-041's global cost ceiling).
- **Security posture:** the risk is a user forging a Pro entitlement client-side; the
  mitigation is structural — `assertEntitlement` re-derives from the `users` row on every
  Pro path and the test asserts a **free user claiming Pro client-side is rejected**. This
  is the "client is a display hint only" invariant made testable for entitlements.

> **Numbering note:** this ADR is **051**, paired with ADR-050 (Stripe billing) as the true
> next-free pair at execution (latest ADR on disk is **049**; ADR-050 takes 050). See
> ADR-050 (the billing columns + tier flip this resolves over), ADR-007 / ADR-027 (the
> free-tier gate + the `start_session` tier exemption that already lifts the session cap for
> Pro — no RPC change here), ADR-041 (the global cost guard, orthogonal to per-user
> entitlement), ADR-049 (Sprint 21's study kits, whose "Pro-gating is a one-line future
> add" this resolver + `assertEntitlement` now provide), and ADR-047 (Sprint 22's dashboard
> depth / history length, which plug into `full_dashboard` / `unlimited_history` the same
> way).
