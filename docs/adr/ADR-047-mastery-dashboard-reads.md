## ADR-047: The mastery dashboard reads the full per-user graph server-side, per-request-fresh, with no cache — and charts what exists rather than faking a history that isn't stored

**Status:** Decided

**Context:** The `(dashboard)` shell has carried an intentionally empty
`<nav aria-label="Account navigation" />` slot since Sprint 10, and the Sprint 11
audit's readiness table named the analytics views as a future sprint's spec. The
adaptive engine (Sprints 09–17) has been quietly recording per-student learning that
the student has never been shown on the web: `knowledge_nodes` (mastery / stability /
difficulty / state / confidence band / observation count / last-practiced),
`misconceptions` (status / category / occurrence / consecutive-correct / timestamps),
`reinforcement_schedule` (due_at / interval / priority / lapses),
`session_interactions` (concept_key / outcome / self-confidence / latency / timestamps),
and `sessions`. All of it is RLS-guarded. Two reusable reads already exist and are the
anchor for this sprint: **`loadProfile`** (`web/lib/learning/profile-read.ts`) — the
decay-adjusted read the tutor prompt and the overlay overview both use — and
`GET /api/profile/overview` (Sprint 13), which is **overlay-sized** (top-K weakest
nodes), not the whole graph.

Three facts about the data shape this decision, and were verified against the code, not
recalled:

1. **The dashboard read is eventually consistent with the last turn's off-critical-path
   apply.** The Sprint 11 audit settled this: `/api/ai/turn` writes
   `session_interactions` and applies FSRS to `knowledge_nodes` in an `after()` hook
   (seconds behind the response), so any read is consistent-within-seconds of the last
   turn. A cache layer would only *mask* that reconcile window, never fix it.
2. **`/api/profile/overview` is deliberately overlay-sized.** It returns top-K weakest
   nodes for the in-panel overview, not the full per-user graph the dashboard grid needs.
3. **There is no mastery-history table.** `knowledge_nodes` holds *current* state only
   (decay applied at read time via `retrievability()`). A true "mastery over time" line
   cannot be drawn from stored data — none exists — while **activity/accuracy over time
   *can*** be, because `session_interactions` already has per-turn `created_at` +
   `outcome`. This asymmetry is the crux of the dashboard's honesty: current state and
   real activity history are chartable today; a mastery trend is not, and must not be
   faked.

**Decision:** The dashboard's data layer is a new **`loadDashboard(supabase)`** in
`web/lib/learning/dashboard-read.ts`, and every dashboard page is a **server component,
rendered per request against the RLS-scoped cookie client, with no cache**.

1. **RLS-scoped, server-rendered, per-request-fresh — no cache layer.** Each
   `(dashboard)` page reuses the `createClient()` cookie pattern from
   `(dashboard)/account/page.tsx` and is `force-dynamic`. RLS — not a `where user_id`
   clause — is the isolation guarantee: a second user's rows are unreachable through the
   authenticated client. Because reads are consistent-within-seconds of the last turn's
   apply, per-request freshness is *correct*, and a new tutoring turn shows on refresh
   within seconds. No cache, no revalidation window, no reconcile-masking.

2. **A dashboard-sized read, not the overlay endpoint.** `loadDashboard` reads the
   **full** per-user set server-side — *all* `knowledge_nodes`, *all* `misconceptions`,
   the `reinforcement_schedule` queue (priority DESC, due_at ASC — PLAN §2.3 query 2),
   and `session_interactions` aggregated by outcome by day — and returns it **grouped by
   the six curriculum strands** (`getConcept().strand` / `strandLabel`) with concept
   `title`s resolved (never raw keys). It **reuses `loadProfile`'s `retrievability()`
   decay math** — it does not reimplement it — so a shared node's decay-adjusted mastery
   on the dashboard is *identical* to what the tutor and overlay show. `loadDashboard`
   **never throws**: it degrades to empty sections exactly like `loadProfile`, so an
   empty-profile user gets empty states, not a crash. It is **server-only**;
   `/api/profile/overview` is left untouched and overlay-sized (not overloaded).

3. **Chart what exists; snapshot the rest (forward-only).** The dashboard draws three
   kinds of data, each honestly sourced:
   - **Current state** (mastery per concept/strand, state distribution, confidence
     bands) → read live from `knowledge_nodes`, decay-adjusted, charted directly. This is
     the bulk of the dashboard and needs no history.
   - **Activity + accuracy over time** → aggregated from `session_interactions`
     (`created_at` / `outcome` / `concept_key`), a **real, backfilled-from-existing-data
     trend**. No new storage. Chart order keys on `session_interactions.id`, **not**
     `(session_id, turn_index)` — which the Sprint 11 audit flagged as *display order,
     not identity*.
   - **Mastery over time** → **cannot** be backfilled (no stored history). A new
     `mastery_snapshot` table + daily cron (ADR-048) writes a compact
     `(user_id, concept_key, day, mastery, state)` row so the trend accrues **from launch
     forward**. The trend UI renders **honestly sparse** at launch and says so ("your
     mastery trend builds as you practice") — faking history is explicitly refused.

4. **Group by `page_url_hash`, never a plaintext domain.** Sprint 16 (ADR-036) stopped
   writing plaintext `page_domain`; any "where you studied" dimension on the dashboard is
   an opaque hash bucket, never a site name. This is a carried privacy consequence, not
   reopened here.

**Rationale:**
- **A cache would mask the reconcile, not help it.** The one consistency subtlety —
  the seconds-behind `after()` apply — is *fixed* by reading fresh, and *hidden* by
  caching. Per-request server render is both simpler and more correct at this scale
  (66 concepts + a bounded misconception/queue/aggregate is small, indexed, RLS-scoped).
- **Reusing `loadProfile`'s decay is the anti-divergence guarantee.** The single worst
  outcome would be a dashboard that shows a *different* mastery number than the tutor. By
  reusing `retrievability()` rather than writing a second decay implementation, the two
  cannot drift; the parity test (Task 8) asserts equality on a shared node.
- **The overlay endpoint stays overlay-sized on purpose.** Overloading
  `/api/profile/overview` to return the full graph would bloat every panel open. The
  dashboard's needs are different (full grid, grouped, server-only), so it gets its own
  read.
- **The no-history reality is a design input, not a bug to paper over.** Charting current
  state + real activity history today, and *starting* a snapshot so the mastery trend is
  genuine from launch forward, is the only honest option. Backfilling is impossible; the
  UI states the forward-only nature plainly.

**Consequences:**
- **Enables:** the `(dashboard)` analytics surface — Overview / Mastery / Misconceptions
  / Review / Activity — over data that already exists, on the same decay math the tutor
  uses.
- **Requires:** `web/lib/learning/dashboard-read.ts` (`loadDashboard`, Task 4); the
  `(dashboard)` layout nav + pages (Tasks 6–7); and the `mastery_snapshot` table + cron
  (ADR-048 / Task 5) as the trend's only source. `loadProfile` / `apply` / `scheduler` /
  `events` are **reused, not modified**.
- **Forecloses (this sprint):** any **cache layer** on the dashboard reads (per-request
  fresh is the decision); a **backfilled mastery history** (impossible — the trend is
  forward-only); a **"where you studied" site-name view** (hashes only, ADR-036); and
  **editing mastery / goals / streaks / gamification** (read-only analytics at V1; PLAN
  keeps gamification Phase 3+).
- **Disclosure:** the dashboard read is now a **standing consumer of `loadProfile`'s
  decay** — any change to `retrievability()` moves both the tutor and the dashboard
  together, which is the point; the parity test guards it.

> **Numbering + ordering note:** this ADR is **047**, paired with ADR-048 (chart tokens +
> library) as the two Sprint 22 planning ADRs. **The plan provisionally numbered these
> 048/049**, assuming Sprint 21 would land ADR-047 first; at execution the latest ADR on
> disk was **046** and **Sprint 21 has not landed**, so **047/048 are the true next-free**
> numbers per this repo's "next free number at execution, no renumber" convention (ADR-039
> /044/045). Sprint 21's provisional **047** reservation is therefore void — it takes
> next-free whenever it runs. Sprint 22 is also being **started ahead of the plan's
> intended 18→19→21→22 order** (Sprint 18 is complete; Sprint 19 is still in progress and
> Sprint 21 has not landed) — flagged, at Darcy's direction. See ADR-036 (URL hashing —
> the group-by-hash rule), ADR-035 (export + erasure — the `mastery_snapshot` cascade),
> ADR-018 (design system — the token discipline ADR-048 extends), and the Sprint 11 audit
> (the readiness table this sprint implements).
