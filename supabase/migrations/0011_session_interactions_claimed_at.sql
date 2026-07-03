-- Sprint 11 / Task 5 fix-forward: session_interactions needs a second
-- marker, separate from applied_to_profile, to make the off-critical-path
-- apply race-safe.
--
-- The turn route's after() hook and a session-end reconcile sweep can both
-- reach the SAME unapplied row. Claiming by flipping applied_to_profile
-- straight to true (before doing the actual FSRS/misconception/scheduler
-- writes) stops a second caller from double-applying -- but it also means
-- applied_to_profile no longer reliably means "the write has landed," only
-- "someone has started it," which is exactly what a crash-recovery sweep
-- needs to tell apart. claimed_at is that separate marker: set the moment
-- work starts, independent of whether it finishes; applied_to_profile is
-- set only once the work actually completes. reconcileSession then treats
-- a row as needing a (re)attempt when it was never claimed OR was claimed
-- long enough ago that the claimer likely crashed mid-work (a standard
-- lease/heartbeat pattern), rather than skipping every claimed-but-
-- not-yet-applied row outright.
--
-- Additive only -- 0001..0010 are not touched, and this migration must
-- re-run cleanly on a fresh `supabase db reset` (0001 -> ... -> 0011). RLS
-- is already enabled on session_interactions (0007); an additive column
-- inherits the table's existing policies, no policy change.

alter table public.session_interactions
  add column claimed_at timestamptz null;
