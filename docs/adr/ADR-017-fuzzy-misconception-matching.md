## ADR-017: Misconception matching gains pg_trgm fuzzy matching and a 3-correct resolution streak; pgvector lands as deferred infra

**Status:** Decided

**Context:** ADR-014 shipped exact-category misconception matching with
2-instance promotion, explicitly deferring fuzzy matching and promising
"the `embedding` column + `pg_trgm` GIN land then." Exact-category
matching alone splits two differently-worded descriptions of the same
underlying error into separate rows, which never accumulate enough
instances to promote or ever resolve. A decision was needed on how much
of §2.4's matching and lifecycle to build this sprint: only the
embedding/cosine path (rejected — no embedding provider is wired, and
§2.4 marks pgvector optional behind trigram), or trigram similarity now
with the vector column landed as unused infra for a later sprint.

**Decision:** Matching becomes exact-category → **`pg_trgm` trigram
similarity > 0.6** on `description` when no exact-category row exists.
Add the **3 consecutive sound-correct → resolved** streak using the
existing `consecutive_correct` column: a sound correct answer on a
concept with an active misconception increments the streak; 3 in a row
flips `active` → `resolved`; any recurrence resets it. Migration 0005
enables `pg_trgm` (used immediately) **and** `pgvector` (infra only),
and adds a nullable `embedding vector(1024)` column to `misconceptions`
plus a trigram GIN index on `description`. Embedding generation, the
cosine-similarity query, and the `ivfflat` index are explicitly **not**
built this sprint — there is no embedding provider wired, and an
`ivfflat` index over an all-null column is pointless.

**Rationale:**
- Trigram similarity collapses same-error phrasings into one row with no
  new external dependency or provider.
- Landing the column + extension now (even unused) means the embedding
  sprint needs no migration — the same "infra ahead of need" discipline
  ADR-014 used for the 0004 column set.
- An `ivfflat` index needs a populated-data `lists` tuning pass; building
  it over nulls would be wasted and wrong.
- The resolution streak closes the misconception lifecycle §2.4
  specifies (open → promoted → resolved), which ADR-014 left half-built.

**Consequences:**
- Enables: misconceptions that track one underlying error across
  multiple phrasings, and that resolve once a student demonstrates
  genuine, repeated, soundly-reasoned recovery.
- Requires: `pg_trgm`/`pgvector` enabled via migration 0005; the
  resolution streak to read `reasoningQuality` from ADR-016's enriched
  `SessionSummary`.
- Forecloses: nothing it does not already defer — cosine/embedding
  matching and the `ivfflat` index remain the embedding sprint's work.
