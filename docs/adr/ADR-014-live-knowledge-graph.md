## ADR-014: The learning profile becomes a live knowledge graph — read + minimal write; full FSRS/fuzzy-matching/scheduler/curriculum package deferred

**Status:** Decided

**Context:** ADR-009 defined `LearningProfile` as a typed seam with a single
`HARDCODED_PROFILE` instance, promising the live system would swap the data
source behind the same type "with no change to prompt-assembly or the
route." The learning tables (PLAN §2.3) do not exist yet. PLAN §2.4/§2.10
describe a full FSRS model + fuzzy misconception matching + scheduler +
curriculum package across two sprints. A shape decision was needed: build
the full learning model now (rejected — it is two PLAN sprints of
pure-function + package work unrelated to the read/write loop), or persist
mastery + read it live + write a minimal update on session end now and
defer the model's sophistication.

**Decision:** Add `knowledge_nodes` and `misconceptions` tables (RLS
in-migration, canonical `user_id` policy); replace `HARDCODED_PROFILE` with
a live `loadProfile(supabase)` (query 1, weakest-first, LIMIT-bounded)
producing the same `LearningProfile` type, so `system-prompt.ts` is
untouched; apply a minimal Elo-style mastery update + exact-category/
2-instance misconception promotion on session end. Defer the full FSRS
dynamics, fuzzy/`pgvector` matching + 3-correct resolution, the
reinforcement scheduler, and the `/packages/learning-model` +
`/packages/curriculum` extraction (concept keys come from an inline
`KNOWN_CONCEPT_KEYS` stopgap). The global-weakest-first vs page-biased read
simplification and the brief-vs-PLAN minimal-vs-full-model split are
recorded here.

**Rationale:**
- The typed seam makes hardcoded→live a data-source swap, not a rewrite
  (ADR-009) — proven by `system-prompt.ts` not changing.
- Persisting mastery is the minimum that lets session 2 reflect session 1
  (the acceptance).
- A minimal update keeps the slice crisp and leaves the FSRS package a
  focused pure-function problem.
- Creating the full §2.3 columns now means the model sprint needs no
  migration.
- The inline key allow-list mitigates concept-key drift that would
  silently break the acceptance.

**Consequences:**
- Enables: a tutor that calibrates to real per-student history, and a
  graph the FSRS/scheduler/dashboard sprints extend without reshaping.
- Requires: RLS on both tables before any write; the live read to stay
  LIMIT-bounded (token budget); `claude.ts` to take the profile as a
  parameter; this ADR revisited when the learning-model package lands (it
  replaces the minimal update + inline keys).
- Forecloses: nothing it does not explicitly defer; the full model, fuzzy
  matching, scheduler, and curriculum package remain later sprints.
