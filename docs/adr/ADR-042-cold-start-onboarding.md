## ADR-042: Cold-start onboarding — a short assessment that seeds the graph through the existing FSRS apply

**Status:** Decided

**Context:** A brand-new user starts with **zero `knowledge_nodes`**, and the
tutor currently handles that by *calibrating live on turn one against an empty
profile* — the `CALIBRATING_PROFILE` branch in `web/lib/learning/profile-read.ts`,
the "still getting to know you" line in `InsightStrip.tsx`, and the `KickoffCard`
prediction omission are the entire cold-start story today. That means the first
several turns are spent inferring what the student already knows before any
adaptivity can help them, which is the worst possible first impression for a
tutoring product. PLAN §2.4/§2.10 named the fix — an **8–12 item adaptive
assessment on first use** that seeds an initial knowledge graph — and Sprint 15
finally supplied the input it needs: a real curriculum (66 concepts across 6
strands with prerequisite edges, `difficultyPrior`s, and `title`s), with the
plumbing (`getConcept`, `prerequisitesOf`, `CONCEPT_KEYS`) already in place;
`concepts/index.ts` even notes the edges are "consumed by the onboarding sprint's
prior propagation." The `users.onboarding_completed_at` column has existed,
unused, since migration 0001. What does **not** exist (confirmed this sprint): any
onboarding or assessment flow at all.

**Decision:** First-run onboarding is a **short assessment that seeds the
knowledge graph, not a product tour**. Concretely:

1. **8–12 items, selected across the 6 strands by `difficultyPrior`.** An item
   bank (`web/lib/onboarding/item-bank.ts`) is a **pure data structure over
   `@calyxa/curriculum`**, not a migration: `selectAssessmentItems()` picks 8–12
   concepts spanning all six strands — an easy anchor per strand plus a few
   reaches — each item carrying `{ conceptKey, prompt, kind: 'choice'|'free', … }`.
   8–12 is the **cap, not a floor**; prerequisite propagation (below) is what lets
   so few items cover so many nodes.

2. **Adaptive only in the light sense.** The assessment is not an IRT engine. Its
   one adaptive move is **prerequisite inference**: a *confident-correct* on a
   harder concept C lets `prerequisitesOf(C)` be seeded at a modest prior rather
   than each prerequisite being asked. There is no per-response item re-selection
   loop, no ability estimate, no item calibration — those need response data we
   won't have at launch (PLAN defers them), and the `difficultyPrior` ladder +
   prerequisite propagation is exactly what PLAN §2.4 specifies for V1.

3. **It writes through the *existing* FSRS apply, not a parallel seeder.**
   `web/lib/learning/apply.ts` already turns a graded observation into a
   `knowledge_nodes` upsert (mastery / stability / difficulty / state via the FSRS
   model). Onboarding produces the **same kind of observation per assessed item**
   and feeds it through that path (`web/lib/onboarding/seed.ts`'s
   `seedFromAssessment`), so a seeded node is **byte-identical in shape** to one
   written by a real tutoring turn. `loadProfile` reads it with zero
   special-casing, and the `CALIBRATING_PROFILE` fallback simply stops firing
   because the graph is no longer empty. There is no second seeding math to keep in
   sync with the FSRS model.

4. **Prerequisite propagation is seed-if-absent, never overwrite.** Propagated
   priors are written only where no node exists yet; a real node (from a prior
   turn or a directly-assessed item) is never clobbered by an inferred prior. The
   propagated prior is **modest** — a starting belief the tutor will overwrite with
   evidence — never "mastered."

5. **It writes `users.onboarding_completed_at`** on completion (the column that
   has been dormant since 0001), which is the signal that gates the UI (below) and
   feeds the Sprint 17 telemetry funnel.

6. **It is skippable, and skipping preserves today's behavior exactly.** A user
   can skip; skipping leaves the profile empty and the tutor calibrates live
   exactly as it does today — the `CALIBRATING_PROFILE` fallback is **preserved,
   not removed**. Onboarding is a strictly-additive improvement on the cold-start
   path, never a new hard dependency.

7. **The UI is a new overlay surface, gated on an empty profile.** The overlay is
   cleanly decomposed (Sprint 14), so onboarding is a new `Onboarding.tsx`
   component mounted by `Overlay.tsx` when `overview.calibrating` is true **and**
   `onboarding_completed_at` is null — the same signal `InsightStrip` already uses.
   It runs once, writes the graph, and is never shown again. It reuses the
   Composer's input affordances for free-response items and adds simple choice
   items; it **does not touch the tutoring loop's state machine** — it is a
   pre-panel gate, not a turn.

**Rationale:**
- Seeding through the existing apply path means there is exactly one place that
  knows how to turn an observation into a `knowledge_node`; onboarding borrows it
  rather than forking it, so seeded and tutored state can never drift.
- Prerequisite propagation is what makes a *short* assessment worthwhile: 8–12
  items seed far more than 8–12 nodes, keeping first-run friction low while still
  giving the tutor a non-empty profile to reason over.
- Modest, seed-if-absent priors keep a miscalibrated seed cheap: the same FSRS
  path that reads the seed also corrects it with the first real evidence, so a
  wrong prior is transient, never sticky.
- Keeping the fallback intact means onboarding can never make first-run *worse*
  than today — the floor is "exactly today's live calibration," and everything
  above it is upside.

**Consequences:**
- **Enables:** a guided, non-cold first run — the tutor opens against a seeded
  profile instead of an empty one — and finally writes `onboarding_completed_at`,
  which the telemetry funnel (ADR-043) uses as its first funnel stage.
- **Requires:** `web/lib/onboarding/` (item bank + `seedFromAssessment`), a
  `POST /api/onboarding` route (validates results, seeds, returns `seededCount`)
  plus an "onboarding needed?" read (`calibrating && onboarding_completed_at is
  null`, on `/api/onboarding` GET or a field on `/api/profile/overview`), and the
  `Onboarding.tsx` overlay surface (Task 7).
- **Consumes, does not change:** `apply.ts` (called by seeding, unchanged),
  `profile-read.ts`'s `CALIBRATING_PROFILE` fallback (preserved), and
  `@calyxa/curriculum` (read-only as the item pool — no concept/alias/title
  change; Sprint 15 owns it).
- **Forecloses (this sprint):** IRT / item-response calibration / an adaptive
  item-selection engine (PLAN defers it — needs launch response data we don't
  have); the item bank is a **data structure over the curriculum**, so adding a
  concept in a future curriculum sprint is a data edit (add it to a strand's
  assessment anchors if it should be assessed), not an engine change.

> **Numbering note:** this ADR is the plan's **ADR-037**, renumbered to **042**
> because 037 was already taken by the prompt-caching track (and 040/041 by
> landing-demo-v2 + the cost guardrail). Sprint 17's three ADRs are **042**
> (this, cold-start onboarding), **043** (telemetry + error privacy), and **039**
> (in-app feedback — the one plan number that was still free). See ADR-043 and
> ADR-039 for the other two halves of Sprint 17's usability + observability gate.
