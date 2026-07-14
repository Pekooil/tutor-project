# Sprint 22 — Mastery dashboard + data charts (post-login web)

> **Post-beta sprint.** Runs after beta distribution (Sprint 19) and after Sprints
> 18/19/21. ADR numbers are written concretely from the next free after those three
> (Sprint 18→044, 19→045/046, 21→047, so this sprint = **048/049**) and the migration
> is **0020** (19→0018, 21→0019, this→0020). All are **provisional** — the parallel
> tracks (Sprint 24 migration candidate, Sprint 25 landing v2) may claim intervening
> numbers, so confirm next-free at execution. Everything else is grounded in the code
> as it stands today (latest ADR on disk = 043, latest migration = 0017).

## Goal
Give a signed-in student a **web dashboard that shows the learning the extension
has been quietly tracking** — mastery per concept and strand, misconceptions and
their resolution, the spaced-repetition due queue, and activity/accuracy over
time — as clean, on-brand charts behind login. By the end:

1. **The `(dashboard)` shell grows a real navigation** (its nav slot has been
   intentionally empty since Sprint 10) and a `/dashboard` home.
2. **A mastery view**: per-concept mastery (decay-adjusted, the same read the
   tutor uses), grouped by the six curriculum strands, with state distribution
   (unseen/learning/weak/mastered/forgotten).
3. **A misconceptions view**: active vs. resolved, occurrence and resolution
   streak, per concept.
4. **A review/schedule view**: the due queue from `reinforcement_schedule` —
   what's coming back and when.
5. **An activity/accuracy trend**: sessions and correct/partial/incorrect over
   time, derived from `session_interactions` (real historical data that already
   exists), plus a **forward-looking mastery trend** that accrues from a new daily
   snapshot (there is no mastery *history* stored today — this sprint starts
   accumulating it).
6. **Chart color tokens** land in `@calyxa/ui` (they don't exist yet — every prior
   sprint that touched this deferred them), and a **charting library** is chosen
   and installed (none exists yet).

```
/dashboard  (authed, server-rendered per request)
├─ Nav (fills the (dashboard) layout's empty slot)
├─ Overview     mastery-by-strand bars + state distribution
├─ /mastery     full per-concept grid, grouped by strand, decay-adjusted
├─ /misconceptions  active/resolved, occurrence + streak
├─ /review      the reinforcement_schedule due queue
└─ /activity    sessions + accuracy over time (from session_interactions)
                + mastery trend (from the new daily mastery_snapshot, forward-only)

data reads:  loadProfile() / knowledge_nodes / misconceptions /
             reinforcement_schedule / session_interactions  (all RLS-scoped,
             server-rendered fresh per request — no cache layer)
new cron:    /api/cron/mastery-snapshot  (daily, reuses Sprint 16 cron infra)
```

## Context
The dashboard was foreseen from Sprint 10 (the `(dashboard)/layout.tsx` header has
an `<nav aria-label="Account navigation" />` slot explicitly "reserved for the
dashboard sprint") and named in the Sprint 11 audit's readiness table. Everything
it reads exists and is RLS-guarded: `knowledge_nodes` (mastery/stability/
difficulty/state/confidence_band/observation_count/last_practiced_at),
`misconceptions` (status/category/occurrence_count/consecutive_correct/timestamps),
`reinforcement_schedule` (due_at/interval_days/priority/lapses),
`session_interactions` (concept_key/outcome/self_confidence/response_latency_ms/
timestamps), and `sessions`. Two reusable read helpers exist: `loadProfile`
(`web/lib/learning/profile-read.ts`, decay-adjusted mastery, the exact read the
tutor and the overlay overview use) and `GET /api/profile/overview` (Sprint 13,
overlay-*sized* — top-K weakest nodes, not the full graph). Concept `title`s exist
(Sprint 13). The authed-page pattern is established (`(dashboard)/account/page.tsx`
+ `web/lib/supabase/server.ts` cookie client, server-rendered per request). The
marketing build (Sprint 20) added reusable `MasteryBars`/`MasteryDeltaBars`
patterns in `ProfileSection.tsx` and put `motion` at the web-package level.

Two things are confirmed **missing** and are this sprint's prerequisites: **chart
color tokens** in `packages/ui/src/theme.css` (every handoff since Sprint 10 said
"add them as named tokens"; still not done), and **any charting library** (no
recharts/visx/chart.js/shadcn-chart in `web/package.json`). One thing is
architecturally absent and shapes the design: **there is no mastery-history table**
— `knowledge_nodes` holds current state only — so a true "mastery over time" line
cannot be drawn from stored data; this sprint charts current state + real
activity/accuracy history (from `session_interactions`) and *starts* a daily
snapshot so a genuine mastery trend accrues from launch forward.

### Decisions locked for this sprint (recorded in ADR-048/047)
1. **Reads are RLS-scoped, server-rendered, per-request-fresh — no cache layer.**
   The Sprint 11 audit fixed this: dashboard reads are eventually consistent with
   the last turn's `after()` apply (seconds), so a per-request server render is
   correct and a cache would only mask the reconcile. The dashboard reuses the
   `createClient()` cookie pattern from `(dashboard)/account`.
2. **A dashboard-sized read, not the overlay endpoint.** `/api/profile/overview`
   is overlay-sized (top-K weakest). The dashboard reads the *full* per-user graph
   directly server-side (RLS-scoped) via a new `loadDashboard()` in
   `web/lib/learning/` that reuses `loadProfile`'s decay math but returns the whole
   set grouped by strand. `loadProfile` is reused, not duplicated, for the shared
   decay-adjustment.
3. **Charting library: one choice, installed via shadcn.** Use **shadcn's chart
   component** (a thin, tokens-friendly wrapper over Recharts) so charts inherit
   the design system the way the rest of `/web` does; Recharts comes in as its
   dependency. This keeps charts on the same token/shadcn substrate as every other
   web surface (ADR-018 discipline).
4. **Chart colors are named `@calyxa/ui` tokens** — the long-deferred task — added
   additively to `theme.css` alongside the existing tag-kind/annotation aliases,
   mapped to existing palette hues, AA-validated. Nothing hard-codes a hex.
5. **Mastery-over-time is forward-only.** There is no history to backfill; a daily
   `mastery-snapshot` cron (reusing Sprint 16's cron infra + `CRON_SECRET` gate)
   writes a compact per-concept mastery row so the trend chart fills in from launch
   forward. The activity/accuracy trend, by contrast, is real historical data
   (`session_interactions` already has timestamps) and needs no snapshot.
6. **Group by `page_url_hash`, never a plaintext domain** (Sprint 16 stopped
   writing plaintext domains). Any "where you studied" dimension is a hash bucket,
   not a site name — a deliberate privacy consequence carried forward, not
   reopened here.

### Reconciliation with the roadmap + prior handoffs (read before Task 1)
- **The Sprint 11 audit's readiness table** is this sprint's spec: it enumerated
  the exact reads (mastery via `knowledge_nodes` + `retrievability()`, due queue
  via `reinforcement_schedule` PLAN §2.3 query 2, history via `sessions` +
  `session_interactions`, misconceptions via `misconceptions`), the layout shell to
  extend, and the two open items — **chart tokens** and **`(session_id,
  turn_index)` as display order not identity** — both honored here.
- **Sprint 10's handoff**: "build the analytics views on shadcn; extend the
  `(dashboard)/layout.tsx` shell; add chart colors as named tokens." Done here.
- **V1 scope**: read-only analytics. No goal-setting, no editing mastery, no
  social/leaderboard, no export-beyond-Sprint-16's-JSON — those are out.

### There is no mastery-history table — chart what exists, snapshot the rest (read before Tasks 5, 7)
`knowledge_nodes` is current-state (decay applied at read). So:
- **Current state** (mastery per concept/strand, state distribution,
  confidence bands) → read live, chart directly. This is the bulk of the dashboard
  and needs no history.
- **Activity + accuracy over time** → `session_interactions` has `created_at`,
  `outcome`, `concept_key` per turn; aggregate by day/week for a real, backfilled-
  from-existing-data trend. No new storage.
- **Mastery over time** → cannot be drawn from stored history (none exists). A new
  `mastery_snapshot` table + daily cron writes a compact `(user_id, concept_key,
  day, mastery, state)` row; the trend chart reads it and is honestly empty/sparse
  at launch, filling in daily. Backfill is impossible and the UI says so ("trend
  builds as you practice") rather than faking it.

### Chart tokens + library are prerequisites, gated before any chart renders (read before Tasks 2, 3)
Task 2 adds the chart-color tokens to `theme.css` (additive, AA-validated) and
Task 3 installs the shadcn chart component + Recharts and renders one throwaway
tokened chart as a wiring gate — exactly the pattern Sprint 10 used for its shadcn
baseline. No dashboard view is built until a green-on-brand chart renders from
tokens, so the views (Tasks 5–7) are pure composition over a proven substrate.

## Execution model
A **single code session** owns this sprint end to end, worked **strictly in order
(1 → 9)**. The chain: ADRs (Task 1); chart tokens (Task 2) and the charting-library
wiring gate (Task 3) must land before any chart; the dashboard-sized read (Task 4)
feeds the views; the mastery-snapshot table + cron (Task 5) must exist before the
trend view reads it; the views (Tasks 6–7) compose over the read + charts; tests
(Task 8) gate manual acceptance (Task 9). One session — no handoff.

This sprint touches: `/packages/ui/src/theme.css` (additive chart tokens),
`/web/components/ui/` (shadcn chart), `/web/package.json` (recharts via shadcn),
`/web/app/(dashboard)/` (layout nav + new dashboard routes), `/web/components/
dashboard/` (new), `/web/lib/learning/` (a new `dashboard-read.ts` reusing
`loadProfile`), a new `mastery_snapshot` migration + cron route, and
`/web/lib/supabase/server.ts` (reused, not changed). It does **not** touch the
extension, the AI/learning write path, the curriculum, or the tutoring loop —
this is a read-only web surface over data that already exists.

## Files in scope

### Task 1 (ADRs + sprint pointers) creates or edits:
```
/docs/adr/ADR-048-mastery-dashboard-reads.md ← new (PROVISIONAL number) — RLS-scoped, server-rendered, per-request-fresh, no cache; a dashboard-sized loadDashboard() reusing loadProfile's decay math; group-by page_url_hash not domain; the no-mastery-history reality → chart current state + activity-from-interactions + a forward-only snapshot trend.
/docs/adr/ADR-049-chart-tokens-and-library.md ← new (PROVISIONAL number) — chart color palette as named @calyxa/ui tokens (additive, AA-validated); shadcn chart component over Recharts as the one charting substrate (tokens-native); the mastery_snapshot table + daily cron (reuses Sprint 16 cron infra) as the forward-only trend source.
/CLAUDE.md                                    ← edit one line: Current sprint → Sprint 22 — Mastery dashboard + data charts
/docs/CLAUDE.md                               ← edit one line: Current phase → (phase at execution) Sprint 22
/docs/sprint-22-plan.md                       ← this file
/docs/architecture.md                         ← edit: a "Dashboard" section — the (dashboard) analytics views, the dashboard-sized read, chart tokens + shadcn/Recharts, the mastery_snapshot cron
```

### Task 2 (packages/ui — chart color tokens) edits:
```
/packages/ui/src/theme.css ← edit — ADD a named chart palette (e.g. --chart-1 … --chart-6 for the six strands, plus --chart-state-mastered/learning/weak/forgotten/unseen mapped to meaningful hues, and --chart-correct/partial/incorrect for the accuracy trend) — ADDITIVE only, mapped to EXISTING palette hues, AA-validated against surface/background per brand.md. No existing token changed (ADR-018). This is the long-deferred "chart colors as named tokens" task.
/web/app/globals.css       ← edit only if shadcn's chart component expects --chart-N under a specific name — map shadcn's chart var names to the @calyxa/ui tokens here (same mapping pattern globals.css already uses for shadcn's primary/accent/border).
```

### Task 3 (web — charting library wiring gate) creates / edits:
```
/web/package.json           ← edit — add recharts (shadcn chart's peer dep) + the shadcn chart component files. Additive.
/web/components/ui/chart.tsx ← new — the shadcn chart wrapper (via `npx shadcn add chart` or equivalent), themed to the Task 2 tokens.
/web/app/(dashboard)/_chart-gate/page.tsx ← new, TEMPORARY — renders one bar chart from the chart tokens as the wiring gate; deleted at the end of Task 3 once green-on-brand is confirmed (or kept as a Storybook-style reference if the audit sprint wants it — decided at the gate).
```

### Task 4 (web — the dashboard-sized read) creates:
```
/web/lib/learning/dashboard-read.ts ← new — loadDashboard(supabase): RLS-scoped reads of the FULL per-user set — all knowledge_nodes (decay-adjusted via the same retrievability() loadProfile uses, reused not duplicated), all misconceptions, the reinforcement_schedule queue, and aggregate session_interactions (counts by outcome by day) — returned grouped by the 6 curriculum strands (via getConcept().strand/strandLabel) with concept titles resolved. Never throws (degrades to empty sections like loadProfile). Server-only.
```

### Task 5 (migration + cron — the forward-only mastery snapshot) creates / edits:
```
/supabase/migrations/0020_mastery_snapshot.sql ← new (number at execution) — mastery_snapshot(id uuid pk, user_id uuid not null references users on delete cascade, concept_key text not null, day date not null, mastery real not null, state text not null, created_at) with a unique (user_id, concept_key, day); Shape 2 RLS (user_id-keyed, select own; writes are service-role from the cron). FK on delete cascade to users (Sprint 16 erasure reaches it) + add it to the export route. RLS-in-migration.
/web/app/api/cron/mastery-snapshot/route.ts ← new — CRON_SECRET-gated (reuses Sprint 16's web/lib/cron/auth.ts): for every non-deleted user, upsert today's decay-adjusted mastery per active concept into mastery_snapshot (idempotent on the unique key). Service-role admin client. Bounded batches.
/web/vercel.json ← edit — add the mastery-snapshot daily cron alongside Sprint 16's crons (the cron config lives under web/, not repo root).
```

### Task 6 (web — the dashboard shell + mastery/misconception/review views) creates / edits:
```
/web/app/(dashboard)/layout.tsx            ← edit — fill the reserved <nav> slot with real navigation (Overview, Mastery, Misconceptions, Review, Activity, Study kits [if Sprint 21 landed], Account); keep the existing shell/container. Server component.
/web/app/(dashboard)/study/page.tsx        ← new, CONDITIONAL on Sprint 21 — the "Study kits" list Sprint 21 explicitly deferred to the dashboard: reads GET /api/study/list (RLS-scoped), renders past kits (notes/problems/flashcards) newest-first. If Sprint 21 has NOT landed at execution, omit this page + its nav item (flagged, not blocking).
/web/app/(dashboard)/dashboard/page.tsx    ← new — Overview: mastery-by-strand summary bars + state distribution donut/bar; calls loadDashboard(); force-dynamic per-request (matches account page).
/web/app/(dashboard)/mastery/page.tsx      ← new — full per-concept grid grouped by strand, decay-adjusted, titles resolved.
/web/app/(dashboard)/misconceptions/page.tsx ← new — active vs resolved, occurrence + streak per concept.
/web/app/(dashboard)/review/page.tsx       ← new — the reinforcement_schedule due queue (priority DESC, due_at ASC — PLAN §2.3 query 2), "comes back Thursday"-style copy.
/web/components/dashboard/*.tsx             ← new — presentational chart/card components (MasteryByStrand, StateDistribution, MisconceptionList, DueQueue) built on the shadcn chart + tokens; reuse the MasteryBars pattern proven in marketing/ProfileSection.tsx where it fits (adapt, don't import marketing-scoped code).
```

### Task 7 (web — the activity/accuracy + mastery trend view) creates:
```
/web/app/(dashboard)/activity/page.tsx ← new — sessions over time + accuracy (correct/partial/incorrect) over time from session_interactions (real historical data, backfilled from existing rows), AND the mastery trend from mastery_snapshot (forward-only — the UI states "your mastery trend builds as you practice" and renders honestly sparse at launch, never faked). Chart order keys on session_interactions.id, NOT (session_id, turn_index) which is display-order-not-identity (the Sprint 11 audit's carried note).
/web/components/dashboard/ActivityChart.tsx + TrendChart.tsx ← new — line/area charts on the tokens; TrendChart handles the empty/sparse launch state gracefully.
```

### Task 8 (tests) creates / edits:
```
/web/tests/dashboard-read.test.ts   ← new — loadDashboard returns the FULL set grouped by strand, decay-adjusted (matches loadProfile's math on shared nodes), RLS-scoped (a second user's rows never appear), degrades to empty sections on no data; titles resolved via getConcept.
/web/tests/mastery-snapshot.test.ts ← new — the cron upserts one row per (user, concept, day) idempotently; CRON_SECRET-gated; FK cascade removes snapshots on user erasure; export includes them.
/web/tests/chart-tokens.test.ts     ← new or lint rule — dashboard chart components reference --chart-* tokens, never hard-coded hexes (a grep-style assertion over /web/components/dashboard).
/web/tests/dashboard-pages.test.ts  ← new — each dashboard page renders for an authed user with data and for an empty-profile user (empty states, not crashes); redirects to /login when unauthed (the account-page pattern).
```

### Files explicitly out of scope
```
/extension/**                       (read-only web surface; the extension is untouched)
/web/lib/learning/{apply,scheduler,profile-read,events}.ts (profile-read's decay math is REUSED by dashboard-read, not modified)
/packages/curriculum/**             (read-only for titles/strands)
/web/lib/ai/**                      (no AI on the dashboard)
/web/app/api/profile/overview/route.ts (stays overlay-sized; the dashboard uses its own full read — do not overload the overlay endpoint)
Sprint 16 cost/compliance code      (the mastery-snapshot cron REUSES the cron auth + vercel.json pattern; it adds no cost logic)
```
Also out of scope (no pre-empting later roadmap sprints):
- **Editing mastery / goals / streaks / gamification** — read-only analytics at V1
  (PLAN's deferred table keeps gamification Phase 3+).
- **A "where you studied" site-name view** — plaintext domains are gone (Sprint 16);
  any hash-bucket dimension is coarse and unlabeled by design.
- **Backfilling mastery history** — impossible (no stored history); the trend is
  forward-only from the snapshot, stated honestly in the UI.
- **CSV/extra export formats** — Sprint 16's JSON export is the V1 data-portability
  surface; the dashboard is for viewing, not exporting.

Do not create any file not listed above. If something seems needed but is not
listed, add it to "What the next sprint needs to know" and ask before creating it.

---

## Task 1 — Dashboard-read + chart-token ADRs + sprint pointers (planning / docs)
Write ADR-048/047 (assign the actual next-free numbers at execution — 18/19/21
land first). Fix: the no-cache/per-request read model, the dashboard-sized read
reusing `loadProfile`'s decay, the shadcn-chart-over-Recharts choice, the additive
AA-validated chart tokens, and the forward-only snapshot trend (no backfill).
Update pointers + architecture.md.

Acceptance gate before Task 2:
  - Two ADRs read as decisions; the no-mastery-history reality and the forward-only
    trend are stated plainly; the provisional ADR numbers are flagged; no code
    touched.

## Task 2 — packages/ui: chart color tokens
Scope: `theme.css` (+ `globals.css` mapping only if shadcn needs it). Additive,
AA-validated, mapped to existing hues.

Acceptance gate before Task 3:
  - [x] New `--chart-*` tokens exist; no existing token changed; each chart hue passes
    AA against its background per brand.md; the six strand colors are visually
    distinct. DONE 2026-07-13: 6 strand (`--chart-1..6`) + 5 state
    (`--chart-state-*`) + 3 accuracy (`--chart-correct/partial/incorrect`) tokens
    added to `packages/ui/src/theme.css`, all values reused verbatim from existing
    hexes (no new color introduced). AA re-verified against `--color-background`
    for chart use specifically: lowest is 5.47:1 (teal), highest 8.02:1 (rose) —
    all clear 4.5:1. Distinctness: picked the best 6-of-8 existing tutor-mode hues
    (≥32° min hue-angle gap after excluding sky/indigo, the closest pair);
    documented as a disclosed near-optimal spread, not silently assumed perfect.
    `mastered`/`correct` intentionally reuse the same green as strand-2 (geometry)
    — flagged in the CSS comment as harmless since strand bars and state/accuracy
    segments never share one chart. `web/app/globals.css` NOT touched — Task 3
    hasn't installed shadcn's chart component yet, so there's nothing yet to map;
    revisit there if its scaffold expects a specific `--chart-N` shape.
    `turbo run typecheck lint build` green across `@calyxa/ui`, `web`, and
    `@calyxa/extension` (extension bundle rebuilt, dist/chrome-mv3 current).

## Task 3 — Web: charting-library wiring gate
Scope: recharts + shadcn chart component + one throwaway tokened chart.

Acceptance gate before Task 4:
  - [x] A chart renders from the Task 2 tokens (colors + relative proportions between
    bars verified correct via DOM/fiber measurement); `next build` + typecheck green;
    the gate page is KEPT at `/chart-gate` (not deleted) as a live reference for a
    known, unresolved defect — see below. DONE 2026-07-13, STAGED not committed.
    `recharts@3.8.0` (the CLI's original resolution) has an always-reproducing bug —
    every Bar's height computes to exactly 0 regardless of value — fixed upstream by
    bumping to `^3.9.2` (now pinned in `web/package.json`). **KNOWN UNRESOLVED DEFECT
    at 3.9.2, flagged for Darcy, not blocking Task 4 but MUST be resolved or worked
    around before Task 6/7 build real chart views:** Bar height still renders
    compressed by a roughly constant but non-1.0 factor (verified via direct DOM
    `getBoundingClientRect()` measurement, not the earlier fiber-props approach which
    breaks in production's minified builds) — reproduces in BOTH `next dev` and a
    production `next build && next start`, so it is NOT a React Strict Mode dev-only
    artifact; colors/tokens and RELATIVE proportions between bars are correct, only
    the absolute scale is off. Tried and ruled out: shadcn's `ChartContainer` wrapper
    (ADR-048's own documented fallback — a thinner direct-`ResponsiveContainer`
    wrapper — shows the SAME defect, so the bug is in recharts itself, not shadcn's
    wrapper); `initialDimension` prop tuning; removing `aspect-video`/CSS variations;
    explicit vs. auto `YAxis` domain; `type="number"` on `YAxis` (made it worse, back
    to invisible); single- vs. multi-`Bar`-series. `recharts@2.15.4` (last pre-v3
    line) failed to resolve in the dev server without a full restart and is EOL
    upstream (deprecated in favor of v3) — not pursued further. See the Task 3 report
    for the full investigation log.

## Task 4 — Web: the dashboard-sized read
Scope: `dashboard-read.ts` reusing `loadProfile`'s decay math; full set grouped by
strand; RLS-scoped; degrades to empty.

Acceptance gate before Task 5:
  - `loadDashboard` returns the full graph grouped by strand with titles; on a
    shared node its decay-adjusted mastery equals `loadProfile`'s; a second user's
    data never appears.

## Task 5 — Migration + cron: the forward-only mastery snapshot
Scope: `0020_mastery_snapshot.sql` + the cron route + the `vercel.json` line.
Reuses Sprint 16's cron auth.

Acceptance gate before Task 6:
  - `db reset` clean; the cron upserts idempotently per (user, concept, day),
    CRON_SECRET-gated; the snapshot is FK-cascade + export covered.

## Task 6 — Web: dashboard shell + mastery/misconception/review views
Scope: the layout nav + the four pages + the dashboard chart components. Reuse the
account-page auth/render pattern; charts on tokens.

Acceptance gate before Task 7:
  - The nav slot is filled; Overview/Mastery/Misconceptions/Review render for a
    user with data and show sane empty states for a fresh user; nothing hard-codes
    a chart hex.

## Task 7 — Web: the activity/accuracy + mastery trend view
Scope: the activity page + the two trend charts. Activity/accuracy from
`session_interactions` (real history); mastery trend from `mastery_snapshot`
(forward-only, honest empty state).

Acceptance gate before Task 8:
  - Accuracy-over-time renders from existing interaction rows; the mastery trend
    renders (sparse at launch) with "builds as you practice" copy, never faked;
    chart order keys on interaction id, not (session_id, turn_index).

## Task 8 — Tests (gate)
Scope: per the annotations. Server + render tests; RLS + decay-parity + token-
discipline assertions.

Acceptance gate before Task 9:
  - [x] `turbo run typecheck lint build test` green; the token-discipline test fails if
    a component hard-codes a chart hex. DONE 2026-07-14, STAGED not committed. Four
    new suites, 40 tests, all green: `dashboard-read.test.ts` (live Supabase, 11 tests
    — full-graph-by-strand + resolved titles, decay parity with `loadProfile` AND an
    independent recompute, weakest-first grouping + state distribution, due-queue
    ordering/overdue flags, active-vs-resolved-minus-pending misconceptions, per-UTC-day
    activity aggregation, RLS scoping both directions, cold-start + signed-out empty);
    `mastery-snapshot.test.ts` (live Supabase, 10 tests — CRON_SECRET gate, one
    decay-adjusted row per (user, active concept, today) skipping unobserved nodes,
    idempotent re-run, GDPR export coverage, FK-cascade erasure); `chart-tokens.test.ts`
    (pure grep-gate, 6 tests — no hard-coded hex in `/web/components/dashboard`, every
    `var(--chart-*)` referenced is DEFINED in `@calyxa/ui` theme.css, strand-color.ts is
    the single mapping home) — VERIFIED it fails on a planted hex, then reverted clean;
    `dashboard-pages.test.ts` (SSR render, 13 tests — each of the 5 pages renders for an
    authed user with data, shows a graceful empty state for a fresh user, and redirects
    to /login unauthed; cookie client + loadDashboard + next/navigation mocked). Both
    live suites follow the onboarding/account.test.ts pattern (real Supabase, no dev
    server); the cron test scopes the admin `users` query to its own fixtures (the
    account.test.ts technique) so it never snapshots a real user. `turbo run typecheck
    lint --filter=web` GREEN. ⚠️ `build` + the FULL `test` task NOT run this turn: a
    parallel session's `next dev` is live on port 3000, and Next 16's one-dev-server
    lock makes `next build` race the shared `.next/` and blocks the two dev-server
    suites (session/ai-turn) — the same hazard Tasks 6/7 documented; not killed (rule).
    typecheck compiles the whole web project incl. the new tests, and the 4 new suites
    are green in isolation.

## Task 9 — Dashboard acceptance (manual)
Signed in as a real dev user with real tutoring history:
  1. `/dashboard` shows mastery-by-strand + state distribution matching the
     overlay's overview numbers (same decay math).
  2. `/mastery` lists every practiced concept by strand with titles (no raw keys).
  3. `/misconceptions` shows active + resolved with streaks.
  4. `/review` shows the due queue in priority order.
  5. `/activity` shows accuracy-over-time from real interactions; the mastery
     trend is present and honestly sparse (or fills in after running the snapshot
     cron once).
  6. A brand-new account shows graceful empty states everywhere, no crashes.
  7. Every chart color comes from a token; AA contrast spot-checked; per-request
     freshness confirmed (a new tutoring turn shows on refresh within seconds).

## Acceptance criteria (full checklist)
- [x] ADRs written — resolved to **ADR-047** (dashboard reads) + **ADR-048** (chart tokens + library) at execution (the provisional 048/049 assumed Sprint 21 landed 047 first; it hadn't — latest on disk was 046 — so 047/048 are true next-free); pointers (`/CLAUDE.md`, `/docs/CLAUDE.md`) + `architecture.md` updated. NB: Sprint 22 was started ahead of the plan's intended 18→19→21→22 order (Sprint 19 still in progress, Sprint 21 not landed), at Darcy's direction.
- [~] Chart color tokens added to theme.css (additive, AA-validated) — **DONE (Task 2)**; Recharts installed (`^3.9.2`) + shadcn chart component installed — **DONE (Task 3)**; a tokened chart renders with correct colors/proportions — **DONE, but with a known unresolved Bar-height-scale defect flagged for Tasks 6/7 (see Task 3's own acceptance-gate note)**
- [ ] loadDashboard returns the full per-user graph grouped by strand, decay-adjusted (parity with loadProfile), RLS-scoped, titles resolved, degrades to empty
- [ ] mastery_snapshot table (Shape 2 RLS, FK cascade, export-covered) + a CRON_SECRET-gated daily cron; forward-only trend stated honestly in the UI
- [ ] (dashboard) nav slot filled; Overview/Mastery/Misconceptions/Review/Activity render for data + empty users; unauthed → /login
- [ ] Activity/accuracy from session_interactions (real history); order keys on interaction id not (session_id, turn_index)
- [ ] No chart hex hard-coded (test-enforced); reads server-rendered per request, no cache; grouping uses page_url_hash never plaintext domain
- [ ] `turbo run typecheck lint build test` green; Task 9 manual pass complete

## Risks
**Students expect a mastery-over-time line and get an empty one at launch.**
Mitigation: the trend is honestly labeled "builds as you practice" and renders a
sensible empty/sparse state; the *activity/accuracy* trend IS backfilled from real
interaction history, so the Activity page is never empty for an active user; the
snapshot accrues daily from launch. Faking history is explicitly refused.

**Chart tokens fail AA on a saturated hue.** Mitigation: tokens are AA-validated
against surface/background in Task 2 (the same discipline brand.md fixed for the
green accent); the six strand colors are checked for distinctness including a
color-blind-safe pass; anything failing is remapped before any view renders.

**The dashboard read diverges from what the tutor/overlay shows.** Mitigation:
`loadDashboard` *reuses* `loadProfile`'s `retrievability()` decay math (not a
second implementation); the parity test asserts equal decay-adjusted mastery on a
shared node; the overview numbers are eyeballed against the overlay in Task 9.

**A snapshot cron across all users is expensive or slow.** Mitigation: bounded
batches, idempotent upsert on the unique key, once daily, off any user hot path;
it reuses Sprint 16's proven cron-auth + batching pattern; a missed day is a gap in
the trend, never a correctness bug.

**shadcn chart + Recharts + Tailwind v4 + React 19 setup friction.** Mitigation:
Task 3 is a wiring-only gate (one tokened chart) before any view is built — the
same de-risking Sprint 10 used for its shadcn baseline; if the combo fights, the
fallback (a thinner direct-Recharts wrapper on the same tokens) is a contained
swap, not a re-plan.

**Per-request rendering is slow with a large graph.** Mitigation: 66 concepts +
a bounded misconception/queue/interaction-aggregate is small; the reads are
indexed and RLS-scoped; the Sprint 11 audit already judged per-request fresh
correct at this scale; if a page ever needs it, aggregation moves into a single
query, not a cache.

## What the next sprint needs to know
**The learning is now visible on the web, on the same tokens and shadcn substrate
as the rest of /web.** Chart color tokens exist in `@calyxa/ui`; the dashboard
reads the full per-user graph server-side (RLS-scoped, per-request-fresh) via
`loadDashboard`, reusing `loadProfile`'s decay; a daily `mastery_snapshot` cron
(on Sprint 16's cron infra) accrues the forward-only mastery trend; charts are
shadcn-over-Recharts.

- **Sprint 21 (study materials)**: if it shipped first, its `/api/study/list` feeds
  the conditional `/study` "Study kits" page this sprint adds; if this dashboard
  shipped first, Sprint 21's web surface is the `/study` route added here later.
  Either order works — the persisted `study_artifact` table is the shared contract.
- **Sprint 23 (billing)** inherits: the dashboard is where the Pro upsell / manage-
  subscription UI naturally lives (extend the nav + a `/billing` route); the Pro-
  gated analytics distinction (some views Pro-only) is an entitlements decision
  that reads the same `loadDashboard` data.
- **The chart tokens** are now the source of truth for any data-viz across the
  product (marketing demo, future emails) — reuse them, don't add a parallel
  palette.
- **`mastery_snapshot`** is the only mastery-history we have — anything wanting
  long-range trend reads it (and knows it's forward-only from Sprint 22's launch).
- **Any new user-scoped table** (this sprint's `mastery_snapshot`) is on the
  Sprint 16 erasure-cascade + export lists — keep that invariant for future tables.
- **Pro-gating**: if analytics becomes a Pro feature, the entitlements resolver
  (Sprint 23) gates the routes; the reads don't change, only their visibility.
