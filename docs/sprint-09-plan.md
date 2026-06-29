# Sprint 09 — Learning-model package (FSRS + curriculum)

## Goal
Replace Sprint 08's **minimal** learning math with the **real engine**, extracted into the
shared packages PLAN §2.4/§2.10 always called for. By the end, the live knowledge graph is
updated by a full **FSRS-flavoured** model living in **`/packages/learning-model`** (pure,
unit-tested in isolation), concept keys come from a real **`/packages/curriculum`** graph
instead of the inline `KNOWN_CONCEPT_KEYS` stopgap, and misconceptions collapse across phrasings
via **`pg_trgm` fuzzy matching** with a **3-correct resolution streak**. This fulfils the
deferral ADR-014 booked for "the learning-model sprint":

```
session end → enriched summariser (outcome + reasoning_quality + self_confidence per concept)
           → updateKnowledgeNode (FSRS: decay → grade → guards → mastery/stability/difficulty)
           → knowledge_nodes (stability/difficulty now persisted)
read       → loadProfile applies read-time decay (retrievability) → STUDENT PROFILE slot
```

This sprint takes the **whole §2.4 algorithm** but holds two lines ADR-014 fixed as later
sprints: the **reinforcement scheduler** (`reinforcement_schedule`, query 2, "let's revisit…")
and **per-turn `session_interactions` persistence**. The consequence is deliberate and recorded
in **ADR-016**: FSRS runs at **session-end granularity** off the enriched `SessionSummary`, not
per-interaction — `time_since_last` is derived from the stored `last_practiced_at`, the
`reasoning_quality`/`self_confidence` guards are emitted by the summariser, and the one signal we
cannot reconstruct without per-turn capture (`response_latency_ms`) **degrades gracefully** (that
single lucky-guess sub-condition is skipped, the others still fire). `/api/ai/turn` **still
writes nothing** (ADR-013 holds); the **only** new write is still the session-end summary, now
richer.

## Context
Sprint 08 shipped the read/write loop (ADR-014/ADR-015): `knowledge_nodes` + `misconceptions`
(migration 0004, RLS in-migration), a live `loadProfile` replacing `HARDCODED_PROFILE`, and an
end-of-session summariser → a minimal Elo nudge (`/web/lib/learning/update.ts`) +
exact-category/2-instance misconception promotion (`/web/lib/learning/apply.ts`). It deliberately
left four things to **this** sprint, in its own words ("what the next sprint needs to know"):
- replace `update.ts` with the **full FSRS** model (decay/stability/difficulty, lucky-guess
  discounting) extracted to **`/packages/learning-model`**;
- replace `KNOWN_CONCEPT_KEYS` with **`/packages/curriculum`**;
- add **fuzzy/`pgvector` matching + the 3-correct resolution streak** (the `embedding` column +
  `pg_trgm` GIN land then).

The columns the model needs (`stability`, `difficulty`, `consecutive_correct`) already exist —
0004 created the full §2.3 column set ahead of need precisely so this sprint needs **no table
reshape**, only an additive `embedding`/extension migration. `system-prompt.ts` remains the
ADR-009 seam: it renders any `LearningProfile`, so it is **untouched again** this sprint — all
the new math lands behind `profile-read.ts` (read-time decay) and `apply.ts` (write), exactly as
ADR-009 forecast.

Locked decisions from `/CLAUDE.md` and `/docs/CLAUDE.md` that drive it:
- **RLS before data.** The new `embedding` column is additive to a table that **already** has the
  canonical owner policy (0004); no new table, no RLS window.
- **All API keys server-side.** The enriched summariser is the same single server-side Anthropic
  call site (`/web/lib/ai/summarise.ts`, ADR-008) — no key reaches the extension. No embedding
  provider is wired this sprint (see §"pgvector lands as infra, not yet a query").
- **Audio never persisted.** Unchanged — the summariser reads the **text** transcript only.
- **Monorepo tooling (ADR-005).** The first real `/packages/*` workspaces are created here;
  Turborepo + npm workspaces already declare `packages/*`, so this is wiring, not re-tooling.

### Reconciliation with `/docs/PLAN.md` (read before Task 1) — what ships vs what defers
PLAN §2.4 specifies the full learning system: the FSRS two-variable update, lucky-guess/slip
guards, the misconception lifecycle (2-instance promotion + fuzzy matching + 3-correct
resolution), the **reinforcement scheduler**, and **cold-start onboarding**. This sprint ships the
**model and the matching**, and **defers** the scheduler and onboarding:

**(a) Full FSRS update now — at session-end granularity.** `updateKnowledgeNode` (PLAN §2.4) is
built whole: power-decay retrievability `R = (1 + t/(9·S))^-1`, grade mapping, lucky-guess
discount + sound-but-wrong slip softening, confidence-weighted shrinking `K`, stability growth
on success / collapse on failure, slow difficulty drift, and the band/state derivation including
`forgotten` (projected one-week retrievability < 0.30). The **only** divergence from §2.4's
per-interaction framing: it runs **once per concept at session end** off the enriched summary,
not per turn — because `session_interactions` is still deferred (ADR-016). `response_latency_ms`
is therefore unavailable and its lucky-guess sub-guard is **skipped** (the reasoning-quality and
self-confidence sub-guards still fire); `time_since_last` comes from `last_practiced_at`.

**(b) Misconception matching + resolution now; embeddings as infra only.** Exact-category match,
then **`pg_trgm` trigram similarity > 0.6** on `description` (PLAN §2.4), then the **3 consecutive
sound-correct → resolved** streak using the existing `consecutive_correct` column. The `embedding
vector(1024)` column + `pgvector` extension **land** (so no later migration), but **cosine
matching is not queried** this sprint — no embedding provider is wired, and §2.4 marks pgvector
"optional" behind trigram. (See §"pgvector lands as infra, not yet a query".)

**(c) Scheduler deferred (unchanged from ADR-014).** `updateKnowledgeNode` does **not** call
`scheduleReinforcement`; `reinforcement_schedule`, query 2, and "let's revisit…" prompts remain
the **scheduler sprint**. Stability/difficulty are now **persisted**, so that sprint reads them
and builds the queue with no model change.

**(d) Cold-start onboarding deferred (unchanged).** The curriculum graph ships its prerequisite
edges (data), but **no** onboarding assessment UI and **no** prior-propagation seeding runs this
sprint — a new user still reads "calibrating" (ADR-014). The edges exist for the onboarding sprint
to consume.

Recorded in **ADR-016** (learning-model + curriculum packages; full FSRS at session-end
granularity; latency-guard degradation; scheduler/onboarding still deferred) and **ADR-017**
(`pg_trgm` fuzzy matching + 3-correct resolution; `pgvector`/`embedding` as deferred infra). Both
**revisit ADR-014** as it asked.

### Package-extraction model (read before Tasks 2–4)
`/packages/learning-model` and `/packages/curriculum` are the **first** real shared workspaces
(`/packages/*` does not exist yet, though the root `workspaces` glob and `turbo` already expect
it). They are **pure** — no `server-only`, no Supabase, no Anthropic, no I/O — so they unit-test in
isolation (PLAN §2.10 "learning model built & unit-tested in isolation") and could later back the
extension too. `/web` takes them as workspace dependencies; the **only** I/O stays in
`/web/lib/learning/apply.ts` + `profile-read.ts`, which call the pure functions. Types shared
across the seam (`MasteryState`, `ConfidenceBand`) move to / are re-exported by the package so
`/web/lib/ai/profile.ts` and the package agree on one source of truth.

### Session-end-granularity model (read before Tasks 4, 6)
FSRS in §2.4 is written per interaction. With `session_interactions` still deferred (ADR-013/
ADR-015), this sprint runs it **per concept, once, at session end**, off the enriched
`SessionSummary`. Each `ConceptObservation` carries the signals the model needs — `outcome`,
`reasoningQuality` (`sound|shallow|none`), `selfConfidence` (`low|med|high|unknown`) — produced by
the **same** summariser call (one call, richer schema). `time_since_last` is `now() −
last_practiced_at` (already stored). The single missing signal, `response_latency_ms`, is **not
reconstructable** without per-turn timing, so its lucky-guess sub-guard is documented as **off
until the per-turn-persistence sprint** — the other two guards keep guessing in check. This keeps
ADR-013's "turn writes nothing" intact: no per-turn capture is added.

### pgvector lands as infra, not yet a query (read before Tasks 5, 6)
ADR-014 promised "the `embedding` column + `pg_trgm` GIN land then." Both land: migration 0005
enables `pg_trgm` (used now — trigram matching) **and** `pgvector` + adds the nullable `embedding
vector(1024)` column (so the embedding sprint needs no migration). What is **not** built: embedding
generation (needs an embedding provider — none wired this sprint) and the cosine query; the
**ivfflat** index is deferred too (an ivfflat over an all-null column is pointless and needs a
populated-data `lists` tuning pass). Fuzzy matching this sprint is **exact-category → trigram**,
exactly as §2.4 allows ("pg_trgm … OR optional pgvector"). This mirrors Sprint 08's
"columns/infra ahead of need" discipline.

## Execution model
A **single code session** owns this sprint end to end, worked **strictly in order (1 → 8)**. The
chain is real: the ADRs fix scope (Task 1); the package scaffolding + monorepo wiring must exist
before any package code (Task 2); the curriculum graph (Task 3) supplies the keys the model and
summariser bind to; the FSRS model (Task 4) is pure and replaces `update.ts`; the migration
(Task 5) must add `embedding`/extensions before the fuzzy matcher uses `pg_trgm`; the wiring
(Task 6) connects the enriched summariser + decay-on-read + fuzzy matching; tests (Task 7) gate
the manual acceptance (Task 8). One session — no handoff.

This sprint **does** touch `/web/lib/learning/{update.ts → removed, apply.ts, profile-read.ts,
types.ts}`, `/web/lib/ai/summarise.ts` (richer schema, same single call), and the monorepo wiring
(`/package.json` is already correct; new `/packages/*`, root `tsconfig`/`turbo` as needed, `/web`
deps + path aliases). It **does not** touch `/web/lib/ai/system-prompt.ts` (the ADR-009 seam —
acceptance point), `/web/lib/ai/claude.ts`, `/web/app/api/ai/turn/route.ts` (still reads, never
writes), `/web/app/api/session/end/route.ts` (still calls `summariseSession` +
`applySessionSummary` — their **internals** change, not the route), the freemium RPCs, auth,
voice, the extension, or the overlay/popup/content script.

## Files in scope

### Task 1 (planning / docs) creates or edits:
```
/docs/adr/ADR-016-learning-model-package.md   ← new — FSRS model + curriculum package extracted to /packages; full §2.4 update at SESSION-END granularity; response_latency_ms guard degraded (per-turn persistence still deferred); scheduler + onboarding still deferred; revisits ADR-014
/docs/adr/ADR-017-fuzzy-misconception-matching.md ← new — exact-category → pg_trgm trigram (>0.6) matching + 3-correct resolution streak; pgvector + embedding column land as deferred infra (no cosine query / ivfflat yet); revisits ADR-014
/CLAUDE.md                                      ← edit one line: Current sprint → Sprint 09 — Learning-model package
/docs/CLAUDE.md                                 ← edit one line: Current phase → Phase 1, Sprint 9
/docs/sprint-09-plan.md                         ← this file
/docs/architecture.md                           ← edit: /packages/* is now real (learning-model, curriculum) — update the (currently stub) layout note to reflect the first extracted packages
```

### Task 2 (monorepo wiring / package scaffolding) creates / edits:
```
/packages/learning-model/package.json   ← new — name @calyxa/learning-model, type module, build/typecheck/lint/test scripts
/packages/learning-model/tsconfig.json  ← new — extends tsconfig.base.json
/packages/learning-model/src/index.ts   ← new — public surface (skeleton this task)
/packages/curriculum/package.json       ← new — name @calyxa/curriculum, same script shape
/packages/curriculum/tsconfig.json      ← new
/packages/curriculum/src/index.ts       ← new — public surface (skeleton this task)
/web/package.json                       ← edit — add @calyxa/learning-model + @calyxa/curriculum as workspace deps
/web/tsconfig.json                      ← edit — path aliases so @calyxa/* resolve in dev/build
/turbo.json                             ← edit only if needed — ensure typecheck/lint/test/build fan out to the new packages
```
The root `/package.json` already declares `workspaces: ["extension","web","packages/*"]` — no edit.

### Task 3 (curriculum graph) creates / edits:
```
/packages/curriculum/src/concepts.ts ← new — the static concept graph: each concept_key + strand + prerequisites (+ a difficulty prior); export CONCEPT_KEYS and graph accessors (getConcept, prerequisitesOf)
/packages/curriculum/src/index.ts    ← edit — re-export the graph + CONCEPT_KEYS
/web/lib/learning/types.ts           ← edit — drop the inline KNOWN_CONCEPT_KEYS; re-export CONCEPT_KEYS from @calyxa/curriculum so existing importers keep working
/web/lib/ai/summarise.ts             ← edit — constrain the summariser to @calyxa/curriculum keys (replace the KNOWN_CONCEPT_KEYS import)
```
`KNOWN_CONCEPT_KEYS` consumers (`summarise.ts`, `apply.ts`, `profile-read.ts` indirectly) now read the package.

### Task 4 (FSRS learning-model) creates / edits:
```
/packages/learning-model/src/fsrs.ts   ← new — pure updateKnowledgeNode(node, observation) per §2.4: retrievability decay, grade map, lucky-guess discount (latency sub-guard documented OFF) + slip softening, confidence-weighted shrinking K, stability growth/collapse, difficulty drift, band + state (incl. forgotten). Plus a pure retrievability(stability, days) for read-time decay.
/packages/learning-model/src/constants.ts ← new — named tuning constants (BASE_K, STAB_GROWTH, STAB_PENALTY, MIN_STABILITY, DIFF_LR, FAST_GUESS_MS placeholder, R_DESIRED) with citations to §2.4
/packages/learning-model/src/index.ts  ← edit — export updateKnowledgeNode, retrievability, types, constants
/web/lib/learning/update.ts            ← REMOVED — its consumer (apply.ts) now calls @calyxa/learning-model (or leave a one-line re-export if a test still imports the old path)
/web/lib/ai/profile.ts                 ← edit — MasteryState/ConfidenceBand become re-exports of the package types (one source of truth); LearningProfile shape unchanged
```

### Task 5 (migration — embedding column + extensions) creates / edits:
```
/supabase/migrations/0005_misconception_embeddings.sql ← new — enable pg_trgm (used) + pgvector (infra); add nullable embedding vector(1024) to misconceptions; pg_trgm GIN on description; additive, re-runs clean on db reset; RLS already present (additive column). Header notes: cosine query + ivfflat deferred until an embedding provider is wired (ADR-017).
/supabase/policies/README.md                            ← edit — note the additive embedding column (no policy change)
```

### Task 6 (wire the model into read + write) edits:
```
/web/lib/ai/summarise.ts        ← edit — ConceptObservation gains reasoningQuality + selfConfidence; prompt asks the model to grade reasoning quality + confidence per concept; parse defensively (defaults: reasoningQuality 'none', selfConfidence 'unknown'); still ONE call, still degrades to empty
/web/lib/learning/types.ts      ← edit — ConceptObservation/SessionSummary carry the new fields
/web/lib/learning/apply.ts      ← edit — call updateKnowledgeNode (full FSRS); compute time_since_last from last_practiced_at; PERSIST stability + difficulty (currently dropped); fuzzy misconception matching (exact-category → pg_trgm) + 3-correct resolution streak via consecutive_correct
/web/lib/learning/profile-read.ts ← edit — apply read-time decay: select stability + last_practiced_at, decay mastery via retrievability() before mapping → LearningProfile (§2.3 "decay-adjusted on read"). LearningProfile shape + system-prompt.ts UNCHANGED.
```

## Files explicitly out of scope
```
/web/lib/ai/system-prompt.ts        (prompt assembly unchanged — the ADR-009 seam promise, again)
/web/lib/ai/claude.ts               (runTutorTurn still takes the profile param — Sprint 08 shape)
/web/app/api/ai/turn/route.ts       (still READS the profile, writes nothing — ADR-013)
/web/app/api/session/end/route.ts   (route unchanged; summariseSession/applySessionSummary internals change, not the route)
/web/lib/tier/*, /web/app/api/{voice,auth,session/start}/*, /web/lib/auth/bearer.ts
/extension/*                        (no extension change — transcript transport is Sprint 08's; popup/overlay/content untouched)
/supabase/migrations/0001..0004     (additive only — 0005 does not touch them)
```
Also out of scope (no pre-empting later work):
- **The reinforcement scheduler + spaced repetition** (`reinforcement_schedule`, query 2,
  "let's revisit…") — the scheduler sprint. `updateKnowledgeNode` does **not** call it; stability/
  difficulty are persisted for it to read.
- **`session_interactions` + per-turn `assessment` + `response_latency_ms` capture** — still
  deferred (ADR-013); FSRS runs at session-end granularity and the latency guard stays off.
- **pgvector cosine matching, embedding generation, the ivfflat index** — the column + extension
  land as infra; the query is the embedding sprint (ADR-017).
- **Cold-start onboarding UI + prior propagation along the curriculum graph** — the onboarding
  sprint; a new user still reads "calibrating."
- **Topic detection / page-relevant profile bias / `page_url_hash`**, the **mastery dashboard**,
  model routing/escalation, Pro-gating — later sprints.

Do not create any file not listed above. If something seems needed but is not listed, add it to
"What the next sprint needs to know" and ask before creating it.

---

## Task 1 — Learning-model + fuzzy-matching ADRs + sprint pointers (planning / docs)

Write two ADRs in the project format (match ADR-001…ADR-015 exactly: `## ADR-0NN: [Title]`,
then `**Status:** Decided`, `**Context:**`, `**Decision:**`, `**Rationale:**` bullets,
`**Consequences:**` Enables/Requires/Forecloses).

ADR-016 — FSRS learning-model + curriculum packages; full §2.4 update at session-end granularity:
- Context: ADR-014 shipped a minimal Elo nudge + inline `KNOWN_CONCEPT_KEYS`, explicitly booking
  the full FSRS model + `/packages/learning-model` + `/packages/curriculum` for "the learning-model
  sprint." §2.4 frames FSRS per interaction, but `session_interactions` is still deferred
  (ADR-013/ADR-015). A decision was needed: revive per-turn persistence to run FSRS per
  interaction (rejected — reverses ADR-013), or run the full model at **session-end granularity**
  off the enriched summary.
- Decision: extract the full §2.4 `updateKnowledgeNode` to pure `/packages/learning-model` and the
  concept graph to `/packages/curriculum`; run the model **once per concept at session end** off an
  enriched `SessionSummary` (outcome + reasoning_quality + self_confidence); derive `time_since_last`
  from `last_practiced_at`; persist `stability`/`difficulty`; apply read-time decay in
  `profile-read.ts`. `response_latency_ms` is unavailable at this granularity, so its lucky-guess
  sub-guard is **off** until per-turn persistence lands. Scheduler + onboarding remain deferred.
  `system-prompt.ts` stays untouched. Revisits/partially-supersedes ADR-014 (minimal update +
  inline keys retired).
- Rationale (bullets): the typed seam still holds (system-prompt.ts unchanged); session-end
  granularity keeps ADR-013 intact (no per-turn write); two of three lucky-guess sub-guards still
  fire, so guessing is still discounted; persisting stability/difficulty means the scheduler sprint
  needs no model change; pure packages unit-test in isolation (§2.10).
- Consequences: Enables — a tutor calibrated by real forgetting curves + guess-discounted mastery;
  packages the extension/dashboard can later share. Requires — the summariser to emit
  reasoning_quality/self_confidence; `apply.ts` to persist stability/difficulty; this ADR revisited
  when per-turn persistence restores the latency guard. Forecloses — nothing it does not defer; the
  scheduler, onboarding, and per-turn assessment remain later sprints.

ADR-017 — Fuzzy misconception matching (`pg_trgm`) + 3-correct resolution; pgvector as deferred
infra:
- Context: ADR-014 deferred fuzzy matching + the resolution streak, promising "the `embedding`
  column + `pg_trgm` GIN land then." Exact-category matching (Sprint 08) splits phrasings of one
  error into separate rows. A decision was needed on how much of §2.4's matching to build now.
- Decision: matching becomes exact-category → **`pg_trgm` trigram similarity > 0.6** on
  `description`; add the **3 consecutive sound-correct → resolved** streak (existing
  `consecutive_correct` column). Land `pgvector` + a nullable `embedding vector(1024)` column +
  the `pg_trgm` GIN now (migration 0005); **defer** embedding generation, the cosine query, and the
  ivfflat index (no embedding provider wired; §2.4 marks pgvector optional behind trigram).
- Rationale (bullets): trigram collapses same-error phrasings with no new provider; the column +
  extension landing now means the embedding sprint needs no migration (the 0004 discipline); ivfflat
  over an all-null column is pointless until data exists; resolution closes the misconception
  lifecycle §2.4 specifies.
- Consequences: Enables — misconceptions that track an error across wordings + resolve after
  genuine recovery. Requires — `pg_trgm`/`pgvector` enabled in 0005; the resolution streak to read
  reasoning_quality (from ADR-016's enriched summary). Forecloses — nothing; cosine matching +
  ivfflat remain the embedding sprint.

Then two one-line edits: `/CLAUDE.md` "Current sprint" → `Sprint 09 — Learning-model package`;
`/docs/CLAUDE.md` "Current phase" → `Phase 1, Sprint 9`. Change no other line in either. Also
update the `/docs/architecture.md` `/packages` line to name the now-real `learning-model` +
`curriculum`.

Acceptance gate before Task 2:
  - ADR-016 + ADR-017 exist in the exact format and record the decisions above; both revisit
    ADR-014.
  - Both CLAUDE.md sprint pointers updated; architecture.md `/packages` note reflects reality.

---

## Task 2 — Scaffold the packages + monorepo wiring (packages + root)

Scope: `/packages/learning-model/*`, `/packages/curriculum/*`, `/web/package.json`,
`/web/tsconfig.json`, `/turbo.json` (only if needed). The first real `/packages/*` — keep them
**pure** (no `server-only`, no Supabase/Anthropic).

  - Create both packages with `package.json` (`@calyxa/learning-model`, `@calyxa/curriculum`;
    `"type": "module"`; `build`/`typecheck`/`lint`/`test` scripts matching the repo's existing task
    names so `turbo run typecheck lint build test` fans out to them), `tsconfig.json` extending
    `/tsconfig.base.json`, and a skeleton `src/index.ts`.
  - Add both as workspace dependencies of `/web` (`"@calyxa/learning-model": "*"`, same for
    curriculum) and add path aliases in `/web/tsconfig.json` so they resolve in `next dev`/`next
    build` and `tsc`.
  - Run `npm install` from the root to link the workspaces; confirm `turbo run typecheck` discovers
    the new packages.

Acceptance gate before Task 3:
  - `npm install` links the workspaces; `turbo run typecheck lint build` includes the two packages
    and exits 0; a trivial export imported from `/web` resolves under both `tsc` and `next build`.

---

## Task 3 — The curriculum graph replaces KNOWN_CONCEPT_KEYS (packages + web)

Scope: `/packages/curriculum/src/*`, `/web/lib/learning/types.ts`, `/web/lib/ai/summarise.ts`.

  - `/packages/curriculum/src/concepts.ts`: the static graph — for each concept a `{ key, strand,
    prerequisites: string[], difficultyPrior: number }`. Seed it with **at least** the eight keys
    Sprint 08 used (so the round-trip keeps working) plus their strand/prereq metadata; structure it
    so adding concepts is data-only. Export `CONCEPT_KEYS: readonly string[]`, `getConcept(key)`,
    `prerequisitesOf(key)`. Comment that prereq edges exist for the **onboarding** sprint's prior
    propagation (not used this sprint).
  - `/web/lib/learning/types.ts`: delete the inline `KNOWN_CONCEPT_KEYS`; `export { CONCEPT_KEYS as
    KNOWN_CONCEPT_KEYS } from '@calyxa/curriculum'` (or update importers directly) so
    `summarise.ts`/`apply.ts` keep compiling.
  - `/web/lib/ai/summarise.ts`: constrain the prompt's key allow-list to `CONCEPT_KEYS` from the
    package.

Acceptance gate before Task 4:
  - typecheck + lint pass; the summariser is constrained to the package keys; the eight Sprint 08
    keys still resolve so the existing round-trip is unbroken.

---

## Task 4 — The FSRS learning-model (packages + web types)

Scope: `/packages/learning-model/src/*`, remove `/web/lib/learning/update.ts`,
`/web/lib/ai/profile.ts` (type re-exports). Pure — no I/O.

  - `/packages/learning-model/src/fsrs.ts`: `updateKnowledgeNode(node, observation)` implementing
    §2.4 in full — (1) decay `R = (1 + t/(9·S))^-1`, `effective_mastery = mastery·R`; (2) grade map
    `{correct:1, partial:0.5, incorrect:0}`; (3) lucky-guess discount when a correct has
    `reasoningQuality ∈ {none,shallow}` **or** `selfConfidence == 'low'` (the `response_latency_ms`
    sub-guard is **omitted with a comment** — unavailable at session-end granularity, ADR-016) →
    `grade=0.6`, `K·=0.5`; sound-but-wrong slip → `grade=0.25`; (4) confidence-weighted shrinking
    `K = BASE_K · scale · confidenceWeight(observationCount)`, `mastery' = clamp(effective_mastery +
    K·(grade − effective_mastery), 0, 1)`; (5) stability growth on `grade≥0.6` /
    collapse to `MIN_STABILITY` otherwise; (6) difficulty drift `clamp(diff + DIFF_LR·((1−grade) −
    diff), 0.05, 0.95)`; (7) band from `observationCount`, state incl. `forgotten` when projected
    7-day retrievability < 0.30. Export a pure `retrievability(stability, days)` for read-time
    decay. **No `scheduleReinforcement` call** (scheduler deferred — ADR-016).
  - `/packages/learning-model/src/constants.ts`: named constants with §2.4 citations.
  - Remove `/web/lib/learning/update.ts` (or reduce to a one-line re-export if a test still imports
    it); its consumer `apply.ts` will call the package in Task 6.
  - `/web/lib/ai/profile.ts`: re-export `MasteryState`/`ConfidenceBand` from the package (one source
    of truth); `LearningProfile`/`MasteryNode`/`ActiveMisconception` shapes unchanged.

Acceptance gate before Task 5:
  - typecheck + lint pass. `updateKnowledgeNode` is pure and bounded: mastery/stability/difficulty
    stay in range; a guessed correct moves mastery less than a reasoned correct; a sound slip is
    softened; an old node decays before the grade applies; `forgotten` triggers on low projected
    retrievability. (Verified properly in Task 7.)

---

## Task 5 — Migration: embedding column + extensions (supabase)

Scope: `/supabase/migrations/0005_misconception_embeddings.sql` (new) + README note. Additive
only; 0001–0004 untouched; re-runs cleanly on a fresh `supabase db reset`.

  - `create extension if not exists pg_trgm;` (used now) and `create extension if not exists vector;`
    (infra). `alter table public.misconceptions add column embedding vector(1024) null;`
    `create index idx_misc_desc_trgm on public.misconceptions using gin (description gin_trgm_ops);`
  - **No** ivfflat index, **no** backfill (deferred — ADR-017). RLS already enabled on the table
    (0004); the additive column inherits the canonical owner policy — no policy change.
  - Header comment: additive, `pg_trgm` used for fuzzy matching now, `pgvector`/`embedding` land as
    infra with cosine + ivfflat deferred until an embedding provider is wired (ADR-017).
  - `/supabase/policies/README.md`: note the additive column (no policy change).

Acceptance gate before Task 6:
  - `supabase db reset` runs 0001→0005 cleanly; `pg_trgm` + `vector` enabled; `misconceptions` has
    the `embedding` column + the trigram GIN; `cd web && npm run typecheck` still passes (regenerated
    DB types compile, if generated).

---

## Task 6 — Wire FSRS + fuzzy matching into read & write (web)

Scope: `/web/lib/ai/summarise.ts`, `/web/lib/learning/{types.ts, apply.ts, profile-read.ts}`. The
session-end **route is unchanged** — only the functions it already calls change.

  - `types.ts` + `summarise.ts`: `ConceptObservation` gains `reasoningQuality: 'sound'|'shallow'|
    'none'` and `selfConfidence: 'low'|'med'|'high'|'unknown'`. The summariser prompt asks the model
    to grade reasoning quality + confidence per concept from the transcript; parse defensively
    (defaults `'none'`/`'unknown'`); still **one** call, still returns the empty summary on bad/empty
    input (ADR-015).
  - `apply.ts`: for each observation, read the current node (`mastery, stability, difficulty,
    observation_count, last_practiced_at`), compute `time_since_last` days, call
    `updateKnowledgeNode`, and **upsert all** of `mastery, stability, difficulty, confidence_band,
    state, observation_count, last_practiced_at` (Sprint 08 dropped stability/difficulty — now
    persisted). Misconception path: exact-category match, else `pg_trgm` trigram > 0.6 on
    `description` (a Postgres `similarity()` query, owner-scoped via RLS); promote pending→active at
    2 instances; on a **sound correct** for a concept with active misconceptions, increment
    `consecutive_correct` and flip `active→resolved` at 3 (reset on any recurrence). Tolerate partial
    failure per observation (Sprint 08 discipline).
  - `profile-read.ts`: also select `stability, last_practiced_at`; apply read-time decay
    (`mastery·retrievability(stability, daysSince)`) before mapping rows → `LearningProfile`. The
    `LearningProfile` shape and **`system-prompt.ts` stay unchanged** (the ADR-009 seam).

Acceptance gate before Task 7:
  - typecheck + lint pass; `next build` exits 0. End-to-end at the unit level: ending a session with
    a transcript writes mastery **and** stability/difficulty; a later `loadProfile` shows
    decay-adjusted mastery; two differently-worded instances of one error collapse to a single
    misconception row; three sound-correct sessions resolve it. `/api/ai/turn` still writes nothing.

---

## Task 7 — Tests: FSRS model, curriculum, fuzzy matching, decay-on-read, back-compat (gate)

Scope: new `/packages/learning-model/**/*.test.ts` + `/packages/curriculum/**/*.test.ts` (pure,
fast, offline), and `/web/tests/{session.test.ts, ai-turn.test.ts, rls.test.ts}`. Reuse the
existing fake-Anthropic backend — no live model call.

Package unit tests (the §2.10 "unit-tested in isolation" deliverable):
1. **Decay:** an untouched node loses retrievability over time; `retrievability` is monotonic in
   `t` and in `stability`.
2. **Bounds/monotonicity:** mastery/stability/difficulty stay in range; correct raises, incorrect
   lowers; `K` shrinks as `observationCount` grows.
3. **Lucky-guess + slip:** a correct with `reasoningQuality:'none'` or `selfConfidence:'low'` moves
   mastery **less** than a sound correct; a sound incorrect (slip) is softened.
4. **State labels:** `mastered`/`weak`/`forgotten`/`learning` derive per §2.4 (incl. `forgotten`
   via projected 7-day retrievability).
5. **Curriculum:** `CONCEPT_KEYS` is stable + includes the Sprint 08 eight; `prerequisitesOf` is
   acyclic for shipped concepts.

web tests:
6. **Decay-on-read:** a seeded old, low-stability node reads back with reduced mastery via
   `loadProfile`.
7. **Stability/difficulty persisted:** ending a session writes them (not just mastery).
8. **Fuzzy collapse:** two sessions flagging the same error with **different wording** map to **one**
   misconception row (trigram match), promoted to `active`.
9. **Resolution:** three sound-correct sessions on a concept flip its active misconception to
   `resolved`; it leaves `loadProfile`.
10. **Back-compat + no-turn-write:** end without transcript unchanged; a turn writes nothing
    (ADR-013); cold-start still "calibrating."
11. **RLS:** `misconceptions.embedding`/the new column stays owner-only (additive column under the
    canonical policy).

Acceptance gate before Task 8:
  - Package suites pass in isolation; web suite passes (decay-on-read, stability persisted, fuzzy
    collapse, resolution, back-compat, RLS) with no live Anthropic call.

---

## Task 8 — Multi-session FSRS acceptance (manual)

With `cd web && next dev` (`ANTHROPIC_API_KEY` set) and the unpacked extension loaded:
  1. **Decay over time:** a node practised, then read after simulated elapsed time (or a node seeded
     with old `last_practiced_at` + low `stability`), shows **lower** mastery in the profile than at
     write time — the tutor treats it as needing review.
  2. **Lucky-guess discount:** a session where the student answers correctly **without reasoning**
     raises mastery **less** than a session with sound reasoning (inspect `knowledge_nodes`).
  3. **Fuzzy misconception collapse:** two sessions making the same error in **different words**
     produce **one** `active` misconception, not two; the tutor probes it in session 3.
  4. **Resolution:** three clean, soundly-reasoned sessions on that concept flip the misconception to
     `resolved`; the tutor stops probing it.
  5. **Scheduler still absent / no per-turn write:** confirm **no** `reinforcement_schedule` and
     **no** `session_interactions` rows exist; a turn writes nothing; the only write is at session
     end.
  6. **Cold start unchanged:** a new user still reads "calibrating."

---

## Acceptance criteria (full checklist)

**Sprint status: DONE.** Closed with two documented manual-acceptance gaps (fuzzy collapse and
3-session resolution were never observed live — see Task 8's checklist line and "what the next
sprint needs to know" below); the underlying mechanism for both is proven correct by Task 7's
automated suite. Darcy reviewed and accepted closing on this basis rather than spending further
live sessions chasing a summariser-prompt judgment call.

- [x] `npm install` + `turbo run typecheck lint build test` pass from the root with the new
      `/packages/learning-model` + `/packages/curriculum` workspaces present
- [x] `cd web && next build` exits 0; the extension is untouched (its diff is empty)
- [x] `pg_trgm` + `vector` enabled; `misconceptions` has `embedding vector(1024)` + the trigram GIN;
      **no** ivfflat, **no** backfill (deferred) — verified by querying the live hosted project's
      schema directly. **Caveat:** this sandbox has no Docker/linked Supabase CLI, so this was never
      verified via an actual `supabase db reset` 0001→0006 (0006 was added after this line was
      written — the trigram RPC, not in the original Task 5 file list; see ADR-017).
- [x] The full §2.4 `updateKnowledgeNode` lives in pure `/packages/learning-model` and **replaces**
      `/web/lib/learning/update.ts`; it is unit-tested in isolation (§2.10)
- [x] FSRS runs at **session-end granularity** off the enriched summary; `stability`/`difficulty`
      are **persisted**; mastery is **decay-adjusted on read**; the `response_latency_ms` lucky-guess
      sub-guard is documented **off** (per-turn persistence still deferred — ADR-016). Confirmed both
      by the automated suite and live against a real account in Task 8 (hand-verified FSRS math
      matched the database exactly for a real lucky-guess-discounted session).
- [x] Concept keys come from `/packages/curriculum` (`CONCEPT_KEYS`); the inline
      `KNOWN_CONCEPT_KEYS` is retired; the Sprint 08 round-trip still works
- [x] Misconception matching is exact-category → **`pg_trgm` trigram**, with the **3-correct
      resolution** streak; `pgvector`/`embedding` cosine + ivfflat are **deferred infra** (ADR-017).
      **Threshold revised 0.6 → 0.35 during Task 8** (ADR-017 amendment) — the mechanism is
      mechanically proven (Task 7, scripted inputs) but **promotion-to-`active` was never observed
      live** even after the revision; see the summariser-flagging-variance finding above.
- [x] `system-prompt.ts`, `claude.ts`, `/api/ai/turn`, `/api/session/end` (the route),
      `/web/lib/tier/*`, voice/auth, and the whole extension are **untouched**; `/api/ai/turn` still
      **writes nothing** (ADR-013) — also reconfirmed live in Task 8 (an open, unended session wrote
      nothing at all until ended).
- [x] The reinforcement scheduler, `reinforcement_schedule`, `session_interactions`, cold-start
      onboarding, topic detection, and the mastery dashboard remain **deferred** — also reconfirmed
      live in Task 8 (neither table exists in the live schema).
- [x] The test suite passes (package isolation + web: decay-on-read, stability persisted, fuzzy
      collapse, resolution, back-compat, RLS) with no live Anthropic call — 70/70, including two
      test-infra fixes found and fixed during Task 8 verification (dist/ test-file pollution; a too-
      tight default test timeout under load), unrelated to the model code itself.
- [ ] **Manual (Task 8) — partial.** Decay-on-read, the lucky-guess discount, no-scheduler/no-
      per-turn-write, and cold start were all directly observed against a real account with a real
      `ANTHROPIC_API_KEY` and verified against the live database. **Fuzzy collapse and 3-session
      resolution were not observed live** — five real attempts at reproducing the same error
      produced four differently-flagged one-off misconceptions and one unflagged session; none
      reached the 2-instance `active` promotion needed before resolution can even be attempted. This
      is a documented finding (see "what the next sprint needs to know"), not a code defect — the
      underlying matching/promotion/resolution mechanism is proven correct by Task 7's scripted
      automated tests. Whether this gap is acceptable to close the sprint on is a call for Darcy, not
      this checklist.
- [x] ADR-016 + ADR-017 exist and revisit ADR-014; both CLAUDE.md pointers + architecture.md
      updated; git log shows commits for each task. ADR-017 additionally amended during Task 8.

---

## Risks

**Reviving per-turn persistence by reflex.** §2.4's FSRS is written per interaction; the obvious
way to feed it is `session_interactions` + per-turn writes — which reverses ADR-013. Mitigation:
the model runs **once per concept at session end** off the enriched summary; ADR-016 fixes this and
Task 7 asserts the turn writes nothing.

**The degraded latency guard lets guesses through.** Without `response_latency_ms`, one of three
lucky-guess sub-conditions is off. Mitigation: the reasoning-quality and self-confidence guards
still fire, the confidence-weighted `K` keeps updates slow, and the latency guard returns with the
per-turn-persistence sprint. Documented, not silent.

**FSRS tuning constants are uncalibrated.** We have no real response data yet, so `BASE_K`,
`STAB_GROWTH`, etc. are literature/§2.4 defaults. Mitigation: constants are **named, cited, and
centralised** in `constants.ts`; the model is pure and re-tunable; bounds keep any single update
small. Calibration against real data is post-V1 (§2.4 note).

**Concept-key drift, again.** Moving from the inline list to the package must not change the keys
the Sprint 08 graph already wrote under. Mitigation: `CONCEPT_KEYS` **includes the original eight**;
Task 3/7 assert the round-trip; the package is now the single source.

**First `/packages/*` extraction breaks the build graph.** New workspaces can desync turbo/tsconfig
path resolution between `tsc`, `vitest`, and `next build`. Mitigation: Task 2 is wiring-only with
its own gate (all three resolvers green) before any logic lands.

**pgvector enabled but unused invites half-built cosine matching.** Mitigation: ADR-017 fixes the
line — extension + column + GIN now, cosine/ivfflat/embedding generation explicitly the embedding
sprint; no ivfflat over a null column.

**Migration on a hosted project.** 0005 enables extensions on the remote Supabase. Mitigation:
additive + `if not exists`; re-runs clean on `db reset`; no data backfill; RLS already present.

---

## What the next sprint needs to know

**The real learning engine now lives in `/packages`.** `updateKnowledgeNode` (full §2.4 FSRS) is
pure in `/packages/learning-model`; concept keys + prereq edges are in `/packages/curriculum`;
misconceptions match fuzzily (`pg_trgm`) and resolve after 3 clean performances. The next sprints
**consume** this, they do not rebuild it:
- **Scheduler sprint:** create `reinforcement_schedule`, read the now-persisted
  `stability`/`difficulty`, invert FSRS for `due_at` (§2.4 `scheduleReinforcement`), and add
  query 2 + "let's revisit…". `updateKnowledgeNode` already produces everything it needs — wire the
  scheduler call at the apply site.
- **Per-turn-persistence sprint:** add `session_interactions` (text only) + `response_latency_ms`
  capture; this restores the third lucky-guess guard and could move FSRS to per-interaction (ADR-016
  revisit point).
- **Embedding sprint:** wire an embedding provider, populate `misconceptions.embedding`, add the
  ivfflat index, and turn on the cosine match branch (ADR-017) — the column + extension already
  exist.
- **Onboarding sprint:** use the curriculum prereq edges to propagate priors from an 8–12 item
  assessment (§2.4 cold start); seed `knowledge_nodes` instead of reading "calibrating."
- **Still deferred deliberately:** topic detection / page bias / `page_url_hash` (privacy sprint),
  the mastery dashboard, model routing/escalation, Pro-gating. Audio + page context stay ephemeral
  (ADR-011/ADR-013).
- **`TRIGRAM_THRESHOLD` was revised from 0.6 to 0.35 during Task 8 manual acceptance** (ADR-017
  amendment) — real same-error descriptions, independently narrated by the summariser across
  sessions, measured only ~0.41 similarity at best against this hosted project's `pg_trgm`;
  genuinely different errors measured ~0.18–0.27. 0.35 sits between those two observed clusters.
  Still a small, single-account sample — worth re-checking against more data once real usage
  accumulates.
- **Summariser misconception-flagging is judgment-sensitive to session tone, not just error
  content (Task 8 finding).** The same surface-level mistake (guessing equal factors, e.g.
  `(x+4)(x+4)` or `(x+2)(x+2)`, without checking the product/sum requirement) got flagged as a
  `misconception` in some manual-test sessions and not in others — specifically, sessions where the
  student recovered quickly and confidently (correctly self-expanding both the wrong guess and the
  right answer, no hesitation) did *not* get flagged, while sessions with more visible friction
  (uncertainty, the tutor having to directly explain) did. `summarise.ts`'s prompt asks for a
  "clear, **repeated** error pattern," which plausibly biases the model toward reading a single,
  cleanly-self-corrected slip as normal Socratic problem-solving rather than a tracked
  misconception — even though our backend's promotion design *wants* every single occurrence
  logged as a 1-count `pending` row so repetition can accumulate *across* sessions. Net effect: in
  five real manual-test sessions making variations of the same error, four got flagged as
  *different* one-off misconceptions and one wasn't flagged at all — none reached the 2-instance
  `active` promotion live, even after the threshold fix above. The matching/promotion/resolution
  *mechanism* itself is still mechanically proven correct (Task 7's automated suite, scripted
  inputs); what's unproven live is how reliably real conversations trigger it. Worth a closer look
  at `summarise.ts`'s misconception-flagging instructions (e.g. dropping "repeated" so a single
  flaggable error always gets logged, leaving the *promotion* threshold to do the repetition
  counting it already does) before/alongside whichever sprint next touches the summariser prompt.
</content>
</invoke>
