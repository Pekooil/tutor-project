-- Sprint 11 / Task 5 fix-forward: session_interactions is missing a
-- misconception_description column. PLAN.md §2.3's/§2.5's original
-- schemas (session_interactions table + the JSON envelope) predate
-- Sprint 09's pg_trgm fuzzy misconception matching (ADR-017), which needs
-- a free-text DESCRIPTION to match against -- category alone only ever
-- exact-matches. Without this column (and the matching envelope field,
-- ADR-019), moving misconception writes to per-turn granularity would have
-- silently killed fuzzy matching, a real Sprint 09 feature. Caught before
-- Task 5's tests exercised the fuzzy-match path.
--
-- Additive only -- 0001..0009 are not touched, and this migration must
-- re-run cleanly on a fresh `supabase db reset` (0001 -> ... -> 0010). RLS
-- is already enabled on session_interactions (0007); an additive column
-- inherits the table's existing policies, no policy change.

alter table public.session_interactions
  add column misconception_description text null;
