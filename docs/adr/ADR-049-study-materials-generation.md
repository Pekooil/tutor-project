## ADR-049: A session becomes a study kit through a new forced-tool Claude call — grounded in the recap read, persisted, cost-guarded, and available to every beta user

**Status:** Decided

**Context:** The marketing landing page (Sprint 20) and the extension recap card
both reserve a **"Generated for you"** seat — per-session **notes**, **practice
problems**, and **flashcards** distilled from a completed tutoring session. ADR-031
§4 originally marketed that "study loop" as live and recorded a fuse ("ship
generation or add a qualifier before invites"); **that fuse has already resolved on
the qualifier branch** — ADR-040 (Sprint 25, 2026-07-09) reframed the section to "on
the way" / "Every session *will* leave a study kit behind," and the extension's
`RecapCard.tsx` now renders **two dashed placeholder tiles**. So this is **not a
pre-beta obligation** anymore — it is a genuine post-beta feature filling a reserved,
honestly-labelled seat. This ADR makes the "on the way" true.

Nothing for it is built, and the pieces it needs all exist and were verified against
the code, not recalled:

1. **The marketing spec is a concrete union.** `web/components/marketing/demo/scene.ts`
   exports `ArtifactKind = 'notes' | 'problems' | 'flashcards'`, and
   `StudyLoopSection.tsx` renders exactly those three cards — including a
   tap-to-flip `Flashcard` (`{front, back}`). That union is the visual contract the
   real feature must match so the marketing card and the shipped feature read as one
   thing.
2. **The per-session read already exists.** `buildSessionRecap(supabase, userId,
   sessionId)` (`web/lib/learning/recap.ts:190`) reads exactly the material a
   generator needs — `session_interactions` for the session (transcript + outcome +
   concept per turn), plus `knowledge_nodes` / `misconceptions`, with curriculum
   titles resolved. There is no need for a second, divergent read of the same
   session.
3. **The structured-output contract is forced-tool, not freeform JSON.** `claude.ts`
   never parses freeform JSON — it forces a tool call with a strict `input_schema`
   and re-validates. `runSessionStartTool` (`claude.ts:539`) is the worked precedent:
   `messages.create({ tools: [SESSION_START_TOOL], tool_choice: { type: 'tool', name }
   })`, pull the `tool_use` block, validate, fall back deterministically on a bad
   response. `nullableEnum(CONCEPT_KEYS)` is the established way to constrain a concept
   key in a schema.
4. **A new paid Claude call has one gate to respect.** The Sprint 16 cost guardrail
   (ADR-041) requires every paid provider call to pass through `costGuard(estimate)`
   *before* touching the provider, with a per-kind estimate from
   `web/lib/tier/cost-model.ts` (`CostKind = 'claude_turn' | 'whisper_stt' |
   'elevenlabs_tts'`, `estimateCost(kind, size)`). The guard fails open; a real
   over-cap refuses gracefully.
5. **There is no entitlements resolver yet.** Pro-gating (Sprint 23) does not exist.
   This sprint does not invent a gating primitive.

**Decision:** A completed session gains a **study kit** — persisted notes, practice
problems, and flashcards — produced by a **new forced-tool Claude call, a sibling of
the tutoring turn, grounded in the recap read, cost-guarded, on-demand, and stored in
a new RLS-scoped `study_artifact` table**. Five decisions fix the shape:

1. **Artifact shapes match the marketing union exactly — with one deliberate
   superset.** The contract is `StudyLoopSection`'s `ArtifactKind = 'notes' |
   'problems' | 'flashcards'`: **notes** = ordered step strings; **flashcards** =
   `{ front, back }` pairs; **problems** = new problem statements **plus worked
   solutions**. The marketing card shows statements only, but a usable feature needs
   answers — so problems carrying solutions is **the one deliberate departure** from
   the visual spec, a superset not a divergence. Reusing the union keeps the marketing
   card and the real feature visually one thing.

2. **Generation is a new forced-tool Claude call, not the tutoring turn.** It mirrors
   `runSessionStartTool` / `ENVELOPE_TOOL` discipline: its own tool schema
   (`STUDY_KIT_TOOL`, `strict: true`, `additionalProperties: false`, every length
   capped, any concept key constrained to `CONCEPT_KEYS` via the `nullableEnum` form),
   forced via `tool_choice`, pulled from the `tool_use` block, validated by a new
   `parseStudyKit`, with a **deterministic empty/minimal-kit fallback** on any bad
   response — never a throw, never a half-parsed kit persisted. **No pedagogy or
   envelope change**; `runTutorTurn` and the tutoring loop are untouched. The generator
   builds its prompt from `loadSessionSource` — which reuses `buildSessionRecap`'s read
   (or a small factor-out of it) — so the kit is grounded in the **same** session data
   the recap shows, from that session's worked problem(s) and concepts practiced:
   notes that capture the method, 2–3 *new* practice problems on the same concepts
   (with solutions), 3–5 flashcards on the key facts/steps.

3. **Artifacts persist; the recap does not.** Unlike `buildSessionRecap` (ephemeral,
   rides one response), a study kit is something the student returns to — so it is
   stored in a new **`study_artifact`** table: Shape 2 RLS (`user_id`-keyed,
   select/modify own), **FK `on delete cascade` to `users`** (Sprint 16 erasure), a
   nullable `session_id` **`on delete set null`** so a deleted session never orphans a
   kept kit, and **on the Sprint 16 export list**. One row per artifact *kind* (notes /
   problems / flashcards) for independent rendering. It is the **first *generated*
   content the product persists** — a new privacy-surface entry (see Consequences).

4. **Generation is on-demand and cost-guarded, not automatic per session.** A kit is a
   several-hundred-token completion; auto-generating one per session would multiply the
   per-user bill. So generation is **triggered** — a "make me a study kit" action after
   a session, or a dashboard button — and the route calls `costGuard(estimateCost(
   'study_kit'))` **before** the Claude call. A new `'study_kit'` `CostKind` and a
   `STUDY_KIT_CENTS` estimate are the **one** cost-model change. On `hardExceeded` the
   route refuses gracefully with **no Claude call**, exactly like every other paid
   route; the guard failing open never blocks generation, but a real over-cap does
   refuse.

5. **Available to all beta users; Pro-gating is Sprint 23's call.** The entitlements
   resolver does not exist yet. Study kits are available to **everyone in beta**. The
   generation route is written so a future entitlement check is a **one-line add**
   (an `isPro` / flag gate on volume or access), not a refactor — but this sprint
   invents no gating primitive.

**Rationale:**
- **Reusing the marketing union is what keeps the two surfaces one product.** The
  landing page draws these three cards; the shipped feature renders the same three from
  real data. A different shape here would make the recreation a lie.
- **A separate forced-tool call is the safe isolation.** Folding generation into the
  tutoring turn would couple a paid, several-hundred-token, offline-shaped completion to
  the latency-sensitive real-time loop. A sibling call (its own model const, its own
  `max_tokens`, its own schema) leaves `runTutorTurn` byte-for-byte unchanged and lets
  generation fail deterministically to an empty kit without ever touching a live tutoring
  session.
- **Grounding in the recap read is the anti-hallucination guarantee.** The single worst
  outcome is a kit whose practice problems or flashcard answers are *wrong* or unrelated
  to what the student did. Reusing `buildSessionRecap`'s read (not a fresh, divergent
  one) means the kit is built from the same worked problem + concepts the recap shows —
  grounded, not free invention — and the schema constrains structure. If quality is
  weak, the fix is prompt-side (one file), and the deterministic fallback ensures a bad
  response never persists a broken kit.
- **On-demand + cost-guarded matches the cost risk.** Auto-per-session would multiply
  the beta bill for kits many students never open; triggering generation and gating it on
  the existing guard bounds the spend with machinery already proven (ADR-041).
- **No gating primitive now, one-line seam for later.** Inventing entitlements here would
  pre-empt Sprint 23 and couple this feature to a resolver that does not exist. All-users-
  in-beta with a documented one-line insertion point is the honest minimum.

**Consequences:**
- **Enables:** the "Generated for you" seat becomes real — the extension `RecapCard`
  placeholder (two dashed tiles) is replaced by rendered notes (ordered list), practice
  problems (statement + revealable solution), and flip flashcards (mirroring the marketing
  `Flashcard` flip), and a future dashboard "Study kits" list reads the same persisted
  rows.
- **Requires:** a new `study_artifact` migration (Shape 2 RLS, FK-cascade to `users`,
  `session_id on delete set null`); `web/lib/study/` (`source.ts` = the shared read,
  `tool.ts` = `STUDY_KIT_TOOL` + `parseStudyKit`, `generate.ts` = `generateStudyKit` +
  `runStudyKitTool`); an additive export in `claude.ts` (the forced-tool shape reused, no
  `runTutorTurn` change); the `'study_kit'` `CostKind` + `STUDY_KIT_CENTS` (the one
  cost-model change); `POST /api/study/generate` (cost-guard → read → generate → persist)
  and `GET /api/study/list`; the extension `RecapCard` + transport; and `study_artifact`
  on the export route + erasure test. `buildSessionRecap` / `apply` / `scheduler` /
  `profile-read` / the envelope / billing are **reused or untouched, not modified**.
- **Forecloses (this sprint):** **auto-per-session generation** (on-demand is the
  decision); **a second, divergent session read** (`loadSessionSource` reuses the recap
  read); **making kits a Pro feature or capping kit volume beyond the global cost guard**
  (Sprint 23's entitlements resolver owns that; a one-line seam is left); **spaced-
  repetition scheduling of the generated flashcards** (the FSRS scheduler is for the
  knowledge graph, not flashcards — a deliberate later feature); and **editing /
  regenerating / sharing kits, export-to-Anki/PDF** (V1 is generate + view + the Sprint 16
  JSON export).
- **Marketing-debt status (resolved, not outstanding):** ADR-031 §4's fuse resolved on
  the qualifier branch (ADR-040) — the study-loop section is already reframed as "on the
  way." This ADR makes the roadmap promise true; **no marketing-copy change is needed
  here**. Sprint 25's landing copy *can* later drop the "on the way" qualifier once this
  ships — flagged for that track to own, not done here.
- **Privacy disclosure (a new standing coupling):** `study_artifact` is the first
  *generated content* the product persists, and a new stored data type. It is RLS-scoped,
  FK-cascades on erasure, and joins the export — the same discipline every user-scoped
  table follows — but the **Sprint 19 data-safety disclosure + `/privacy`** (ADR-046) must
  now list **"generated study materials"** as a persisted data type before this reaches
  the beta cohort. Flagged in the handoff.
- **Disclosure:** the generator is now a **standing consumer of `buildSessionRecap`'s
  read** — if a factor-out is taken, the recap's behavior must stay identical (its
  existing tests stay green); the default is `source.ts` *calls* `buildSessionRecap`
  unchanged.

> **Numbering + ordering note:** this ADR is **049**, not the plan's provisional **047**.
> The Sprint 21 plan wrote 047 provisionally (latest ADR at authoring time was 043) and
> explicitly said to "confirm next-free at execution." At execution the latest ADRs on
> disk are **047 (mastery-dashboard reads)** and **048 (chart tokens + library)**, both
> claimed by **Sprint 22, which was started ahead of the plan's intended 18→19→21→22 order
> at Darcy's direction**. So the plan's 047 reservation is **void**, and **049 is the true
> next-free** per this repo's "next free number at execution, no renumber" convention
> (ADR-039 / 044 / 045 all set this precedent). Likewise **Task 2's migration will NOT be
> the plan's `0019_study_artifact.sql`** — `0019_waitlist_invite.sql` (Sprint 19) already
> exists; the next-free number is **`0020`**, but **Sprint 22's Task 5 also wants `0020`
> (`mastery_snapshot`)** — whichever of the two lands first takes 0020 and the other takes
> the next free number. Resolve at Task 2 execution, do not pre-number here. See ADR-031 +
> ADR-040 (the resolved marketing fuse), ADR-041 (the cost guard this call respects),
> ADR-035 (export + erasure — the `study_artifact` cascade), ADR-046 (the data-safety
> disclosure this now amends), ADR-019 / ADR-024 (the envelope + recap this reuses but does
> not touch), and ADR-006 (the extension single-egress rule the new transport follows).
