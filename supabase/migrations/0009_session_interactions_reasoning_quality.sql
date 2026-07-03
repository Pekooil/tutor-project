-- Sprint 11 / Task 4 fix-forward: session_interactions is missing a
-- reasoning_quality column. PLAN.md §2.3's original table definition
-- (copied verbatim into 0007_session_interactions.sql) predates the FSRS
-- lucky-guess sub-guards ADR-016 added in Sprint 09 -- it captures
-- self_confidence but never reasoning_quality, even though ADR-016's
-- updateKnowledgeNode needs BOTH (plus response_latency_ms) to run its
-- three guess-discount guards. Without this column, Task 5's
-- per-interaction apply could not reconstruct the reasoning-quality guard
-- Sprint 09 already relies on -- moving to per-interaction granularity
-- would have silently regressed an existing guard, not just left the
-- latency guard off. Caught before Task 5 reads from this table.
--
-- Additive only -- 0001..0008 are not touched, and this migration must
-- re-run cleanly on a fresh `supabase db reset` (0001 -> ... -> 0009). RLS
-- is already enabled on session_interactions (0007); an additive column
-- inherits the table's existing policies, no policy change.

alter table public.session_interactions
  add column reasoning_quality text not null default 'none'
    check (reasoning_quality in ('sound', 'shallow', 'none'));
