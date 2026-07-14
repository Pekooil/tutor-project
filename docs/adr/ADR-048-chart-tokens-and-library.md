## ADR-048: Chart colors are named `@calyxa/ui` tokens and charts are shadcn-over-Recharts — one tokens-native charting substrate — with the mastery trend fed by a new forward-only daily snapshot

**Status:** Decided

**Context:** The dashboard (ADR-047) needs to render charts, and two prerequisites are
confirmed **missing** in the code as it stands:

1. **Chart color tokens.** Every handoff since Sprint 10 said "add the chart colors as
   named tokens," and it is still not done — `packages/ui/src/theme.css` has the
   tag-kind and annotation color aliases (Sprint 14) but **no `--chart-*` palette**. The
   dashboard will chart six curriculum strands, five mastery states, and a three-way
   accuracy split, and none of those has a named color today.
2. **Any charting library.** There is **no recharts / visx / chart.js / shadcn-chart** in
   `web/package.json`. The rest of `/web` is built on shadcn/ui with its CSS variables
   mapped to `@calyxa/ui` tokens (ADR-018); a charting choice must not fork that
   substrate.

A third fact from ADR-047 shapes this ADR: **there is no mastery-history table**, so the
mastery-over-time chart has no data source until one is created. The activity/accuracy
trend reads real history from `session_interactions`; the mastery trend needs a new,
forward-only source.

**Decision:** Chart colors become **named `@calyxa/ui` tokens**, charts are **shadcn's
chart component over Recharts** as the single substrate, and the mastery trend is fed by a
new **daily `mastery_snapshot`** written by a cron on Sprint 16's infra.

1. **Chart colors are named tokens in `theme.css` — additive, AA-validated, mapped to
   existing hues.** A `--chart-*` palette is added to `packages/ui/src/theme.css`
   alongside the existing tag-kind/annotation aliases: `--chart-1 … --chart-6` for the six
   strands, `--chart-state-{mastered,learning,weak,forgotten,unseen}` mapped to meaningful
   hues, and `--chart-{correct,partial,incorrect}` for the accuracy trend. **No existing
   token is changed** (ADR-018 discipline); every new hue is **mapped to an existing
   palette value** and **AA-validated** against its surface/background per `/docs/brand.md`
   — the same discipline that fixed the green accent — including a **color-blind-safe
   distinctness pass** across the six strand colors. **Nothing hard-codes a hex**; a
   token-discipline test (Task 8) fails the build if a dashboard chart component references
   a raw hex. If shadcn's chart component expects `--chart-N` under specific names,
   `web/app/globals.css` maps shadcn's chart var names onto these tokens — the same mapping
   pattern `globals.css` already uses for shadcn's primary/accent/border.

2. **One charting library: shadcn's chart component over Recharts.** The dashboard uses
   **shadcn's chart component** (`web/components/ui/chart.tsx`, installed via
   `npx shadcn add chart` or equivalent) — a thin, tokens-friendly wrapper over
   **Recharts**, which comes in as its peer dependency (added to `web/package.json`,
   additive). This keeps charts on the **same token + shadcn substrate** as every other
   web surface (ADR-018), rather than forking in a second styling system. A **wiring gate**
   (Task 3) renders one throwaway tokened bar chart and confirms green-on-brand + `next
   build`/typecheck green **before any dashboard view is built** — the same de-risking
   Sprint 10 used for its shadcn baseline. If the shadcn-chart + Recharts + Tailwind v4 +
   React 19 combination fights, the recorded fallback is a **thinner direct-Recharts
   wrapper on the same tokens** — a contained swap, not a re-plan.

3. **The mastery trend is fed by a new forward-only `mastery_snapshot` + daily cron.**
   Because no mastery history is stored (ADR-047), a new table
   `mastery_snapshot(id, user_id → users on delete cascade, concept_key, day, mastery,
   state, created_at)` with a unique `(user_id, concept_key, day)` is created (migration
   `0020_mastery_snapshot.sql` at execution; **Shape 2 RLS** — user-id-keyed, select-own,
   writes are service-role from the cron). A daily **`/api/cron/mastery-snapshot`** route,
   **`CRON_SECRET`-gated via Sprint 16's `web/lib/cron/auth.ts`**, upserts today's
   decay-adjusted mastery per active concept for every non-deleted user, **idempotently on
   the unique key**, in **bounded batches**, off any user hot path. It **reuses Sprint 16's
   proven cron-auth + `vercel.json` batching pattern** and adds **no cost logic**. The FK
   `on delete cascade` puts snapshots on Sprint 16's erasure path (ADR-035), and the table
   **joins the export route** — the standing "every new user-scoped table cascades +
   exports" invariant. The trend chart reads it and is **honestly empty/sparse at launch**,
   filling in daily; **backfill is impossible and the UI says so**, never faked.

**Rationale:**
- **Named tokens are the long-deferred correct answer, and they compound.** Once the
  chart palette lives in `@calyxa/ui`, it is the single source of truth for *any* data-viz
  across the product (dashboard, marketing demo, future emails) — the same reason ADR-018
  centralized the design tokens. AA-validating them up front avoids the saturated-hue
  contrast failure the brand work already learned to catch.
- **shadcn-over-Recharts keeps charts on the house substrate.** A parallel charting style
  system would drift from the tokens every other surface honors. A thin shadcn wrapper
  inherits the design system by construction; Recharts is a well-trodden peer dep. The
  wiring gate de-risks the version-combo friction before any view depends on it.
- **A daily snapshot is the only honest way to get a mastery trend.** History wasn't
  stored, can't be reconstructed, and shouldn't be invented. A compact daily row, idempotent
  on `(user, concept, day)`, off the hot path, gives a *genuine* trend from launch forward;
  a missed cron day is a visible gap in the trend, never a correctness bug.
- **Reusing Sprint 16's cron infra keeps this contained.** The auth gate, service-role
  admin client, batching, and `vercel.json` pattern all exist and are proven; the snapshot
  cron adds a route and a migration, not a new subsystem.

**Consequences:**
- **Enables:** every dashboard chart (ADR-047's views) to render from tokens on one
  substrate, and a real forward-only mastery trend.
- **Requires (this sprint):** the `--chart-*` tokens in `theme.css` (+ the `globals.css`
  mapping only if shadcn needs it) — Task 2; `recharts` + `web/components/ui/chart.tsx` +
  the throwaway gate page — Task 3; `0020_mastery_snapshot.sql` + `/api/cron/mastery-
  snapshot` + the `vercel.json` cron line — Task 5; and the token-discipline test — Task 8.
- **Forecloses (this sprint):** hard-coded chart hexes (test-enforced); a **second charting
  library or a parallel color palette** (one substrate, one token set); **backfilling
  mastery history** (forward-only snapshot only); and any **cost logic** in the snapshot
  cron (it reuses the auth/batching pattern, nothing more).
- **Disclosure:** the chart tokens are now the **product-wide data-viz palette** — future
  surfaces reuse them, not a parallel set; and `mastery_snapshot` is the **only
  mastery-history we have**, so any long-range trend reads it and inherits its forward-only
  launch date. It is on the **erasure-cascade + export** lists — the invariant every future
  user-scoped table must keep.

> **Numbering note:** this ADR is **048**, paired with ADR-047 (dashboard reads) as the two
> Sprint 22 planning ADRs. The plan provisionally numbered them **048/049** assuming Sprint
> 21 would land **047** first; at execution the latest ADR on disk was **046** and Sprint 21
> has not landed, so **047/048** are true next-free (see ADR-047's numbering note). See
> ADR-018 (design tokens — the discipline these chart tokens extend), `/docs/brand.md` (the
> AA pairs the tokens validate against), ADR-036 (Sprint 16 cron infra this cron reuses),
> and ADR-035 (export + erasure — the `mastery_snapshot` cascade/export coverage).
