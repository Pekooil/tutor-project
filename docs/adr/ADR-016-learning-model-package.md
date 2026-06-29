## ADR-016: The full FSRS model and concept graph are extracted to pure packages, run at session-end granularity

**Status:** Decided

**Context:** ADR-014 shipped a minimal Elo-style mastery nudge and an
inline `KNOWN_CONCEPT_KEYS` stopgap, explicitly deferring the full PLAN
§2.4 FSRS model, the `/packages/learning-model` extraction, and the
`/packages/curriculum` graph to "the learning-model sprint." §2.4 frames
FSRS as a per-interaction update (decay → grade → guards → mastery on
every turn), but `session_interactions` is still deferred (ADR-013/
ADR-015) — there is no per-turn row to drive a per-interaction model. A
decision was needed: revive per-turn persistence so FSRS can run on its
native per-interaction cadence (rejected — it reverses ADR-013 and
re-opens the per-turn `assessment` envelope ADR-008 deferred), or run the
full model at coarser, session-end granularity off the same enriched
summary ADR-015 already produces.

**Decision:** Extract the full §2.4 `updateKnowledgeNode` to a pure
`/packages/learning-model` (no `server-only`, no Supabase, no Anthropic —
unit-testable in isolation per §2.10) and the concept graph to a pure
`/packages/curriculum` (concept keys + strand + prerequisites,
superseding the inline `KNOWN_CONCEPT_KEYS`). Run the model **once per
concept at session end**, off an enriched `SessionSummary` that now
carries `outcome`, `reasoningQuality`, and `selfConfidence` per concept.
`time_since_last` is derived from the already-stored
`last_practiced_at` rather than a per-turn timestamp; `stability` and
`difficulty` are persisted (Sprint 08 computed but dropped them); read-time
applies decay via the package's `retrievability()`. `response_latency_ms`
has no per-turn source at this granularity, so the lucky-guess sub-guard
that depends on it is **omitted, with a comment**, until a later sprint
restores per-turn capture. The reinforcement scheduler and cold-start
onboarding remain deferred, unchanged from ADR-014. `system-prompt.ts` is
untouched — it renders any `LearningProfile`, exactly as ADR-009 forecast.

**Rationale:**
- The typed seam still holds: all the new math lands behind
  `profile-read.ts` (read) and `apply.ts` (write); `system-prompt.ts`
  never changes.
- Session-end granularity keeps ADR-013 intact — no per-turn write is
  added to make FSRS's native cadence work.
- Two of the three lucky-guess sub-guards (reasoning quality, self
  confidence) still fire, so guess-discounting is weakened, not absent.
- Persisting `stability`/`difficulty` now means the scheduler sprint reads
  them directly and needs no model change.
- Pure packages with no I/O unit-test in isolation (§2.10) and can later
  back the extension as well as `/web`.

**Consequences:**
- Enables: a tutor calibrated by real forgetting curves (decay-adjusted
  mastery) and guess-discounted updates, backed by packages the
  extension/dashboard sprints can reuse without rewriting.
- Requires: the summariser (ADR-015's call site) to emit
  `reasoningQuality`/`selfConfidence` per concept; `apply.ts` to persist
  `stability`/`difficulty` it previously dropped; this ADR to be revisited
  when per-turn persistence lands and the latency guard can be restored.
- Forecloses: nothing it does not already defer — the reinforcement
  scheduler, cold-start onboarding, and per-turn `session_interactions`
  remain later sprints' work.
