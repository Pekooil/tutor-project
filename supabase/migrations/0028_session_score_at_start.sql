-- 0028 — session score snapshot, for the end-of-session "what changed" summary.
--
-- The /data progress score is a composite: mastery 50, accuracy 30,
-- consistency 20. Telling a student what THIS session moved needs a reading
-- from before it, and none existed:
--   · mastery comes from the daily `mastery_snapshot` cron, so it does not move
--     within a day, and `knowledge_nodes` holds current state only — there is no
--     historical row to diff against;
--   · accuracy and consistency are derived over a rolling window of activity
--     days, so once this session's interactions land, the "before" is gone.
--
-- So the score is snapshotted when the session OPENS and diffed when it ends.
-- One jsonb column rather than four numeric ones: the shape is the analytics
-- module's own ProgressScore summary ({score, mastery, accuracy, consistency},
-- any of which may be null before a student has enough history), it is written
-- and read as a unit, and nothing queries the parts individually.
--
-- Nullable by design and never backfilled. Sessions that started before this
-- migration, and sessions where the snapshot write lost its race or failed,
-- simply produce no summary — the recap degrades to what it showed before.
-- A missing summary must never block a session from ending.
--
-- Not personal data beyond what `sessions` already holds (it is derived from
-- this user's own graph), so it needs no new export/erasure entry: the row is
-- already covered by the sessions coverage in ADR-035's lists, and it cascades
-- with the session on account deletion.
alter table public.sessions
  add column if not exists score_at_start jsonb;

comment on column public.sessions.score_at_start is
  'ProgressScore summary ({score,mastery,accuracy,consistency}) captured when the session opened, so /api/session/end can report what this session changed. Nullable; never backfilled.';
