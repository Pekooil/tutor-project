## ADR-020: Reinforcement scheduler — `reinforcement_schedule`, FSRS-inverted `due_at`, and query 2

**Status:** Decided

**Context:** `/docs/PLAN.md` §2.4 specifies a spaced-reinforcement scheduler built directly on the
FSRS state already maintained by `updateKnowledgeNode`: invert the retrievability curve for a
target desired retention to compute `due_at`, with urgency overrides for weak/forgotten concepts
and active misconceptions. §2.3 defines the supporting table (`reinforcement_schedule`) and query 2
(the due-item fetch that drives "let's revisit…" prompts and, later, a dashboard queue). ADR-014
deferred all of this — no scheduler, no table, no due-item query — and Sprint 09's ADR-016
persisted `stability` and `difficulty` specifically so that "the scheduler sprint reads them and
builds the queue with no model change." That precondition is now met: both columns have been
written by real sessions since Sprint 09, and this sprint's ADR-019 moves FSRS to per-interaction
granularity, giving the scheduler a natural call site (immediately after each per-interaction
apply) rather than only at session end.

**Decision:** Add `reinforcement_schedule` (PLAN §2.3 shape — `user_id`, `concept_key`, `due_at`,
`interval_days`, `last_review_at`, `lapses`, `priority`; `unique(user_id, concept_key)`;
`idx_rs_user_due`; owner RLS enabled in the same migration). Implement `scheduleReinforcement` per
PLAN §2.4: invert the FSRS power-decay retrievability curve at a desired retention `R_d = 0.90` —
`interval_days = clamp(9 · S · (1/R_d − 1), MIN_INT, MAX_INT)` — apply a ×0.5 urgency multiplier
when the node's state is `weak` or `forgotten`, and compute
`priority = 0.5 + 0.3·hasActiveMisconception + 0.2·(weak|forgotten)`; upsert on the
`(user_id, concept_key)` key, incrementing `lapses` on a failed last outcome and stamping
`last_review_at`. Call this once per per-interaction FSRS apply (ADR-019's call site), immediately
after `updateKnowledgeNode`. Implement PLAN §2.3 query 2 (due items ordered `priority DESC, due_at
ASC`, `due_at <= now`, `LIMIT 10`) and surface its result into `LearningProfile` as `dueForReview`,
rendered into the STUDENT PROFILE prompt block as a natural "let's revisit…" opening.

**Rationale:**
- FSRS is already the memory model driving mastery, so inverting its own retrievability curve for
  scheduling is a direct read of state that already exists — not a second, parallel memory system
  that could drift from the first.
- Weak/forgotten urgency and misconception-priority weighting match the pedagogy already encoded
  elsewhere (mastery calibration, misconception probing) rather than introducing a new tuning
  surface with its own logic.
- One row per `(user, concept)` via upsert keeps the queue bounded and idempotent — repeated
  practice on the same concept updates its one row rather than accumulating history the scheduler
  does not need.
- Calling the scheduler at the per-interaction apply site (rather than session end) means the due
  queue reflects state as of the most recent turn, not the most recent session — consistent with
  ADR-019's move to per-interaction granularity.

**Consequences:**
- Enables: spaced reinforcement surfaced naturally inside a live tutoring turn ("let's revisit…"),
  and a due-item query the later dashboard sprint can read directly with no new backend work.
- Requires: `reinforcement_schedule` to exist (this sprint's migration, RLS before data);
  ADR-019's per-interaction apply site to call `scheduleReinforcement` on every gradable turn;
  `LearningProfile`'s shape to gain an additive `dueForReview` field without breaking existing
  consumers of `masteryNodes`/`activeMisconceptions`.
- Forecloses: nothing — Pro-gating spaced reinforcement, a dedicated review-queue UI, and dashboard
  surfacing of `reinforcement_schedule` all remain later sprints that consume this table and this
  query rather than needing to build either.
