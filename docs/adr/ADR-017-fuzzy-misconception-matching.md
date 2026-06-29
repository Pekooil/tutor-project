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

**Amendment (Sprint 09 Task 8, manual acceptance):** The 0.6 threshold was
chosen without real same-error data and turned out too strict in practice.
A live student account repeatedly made the same conceptual mistake
(guessing a factor pair without checking it) across four separate
sessions; the real summariser — narrating each instance independently,
with different specific numbers and framing every time — produced
descriptions that measured only ~0.41 similarity at best against each
other via this project's `pg_trgm`, never clearing 0.6. Genuinely
different errors in the same data measured ~0.18–0.27. `TRIGRAM_THRESHOLD`
in `apply.ts` is revised down to **0.35**, sitting between the two
observed clusters, so organically-narrated same-error recurrences actually
collapse instead of silently accumulating as separate `pending` rows that
never promote. The RPC's own SQL-side default (migration 0006) is left at
0.6 — `apply.ts` always passes the threshold explicitly, so that default
is unreachable, not a second place requiring a migration. This is a
tuning revision, not a reversal: trigram-only matching (vs. the deferred
embedding/cosine path) is unchanged; the risk this trades against is a
higher chance of merging two genuinely different errors, which the
embedding sprint's semantic matching is the real fix for, not a lower
trigram number.
