-- Sprint 22 / Task 5 (ADR-047, ADR-048): the forward-only mastery trend
-- source. `knowledge_nodes` holds current mastery state only (decay applied at
-- read) -- there is NO mastery history stored anywhere -- so a genuine
-- "mastery over time" line cannot be drawn from existing data. This table +
-- the daily /api/cron/mastery-snapshot cron begin accruing one compact row per
-- (user, concept, day) from launch forward; the Activity view's trend chart
-- reads it and is honestly sparse at launch, filling in daily. Backfill is
-- impossible and is refused (ADR-047) -- the row is written the day it is true.
--
-- Additive only (0001 -> ... -> 0019 -> 0020); re-runs cleanly on a fresh
-- `supabase db reset`. No earlier migration is touched.
--
-- Shape 2 (user_id-keyed), MINUS the `deleted_at is null` clause -- like
-- `feedback`/`telemetry_event` (0017) this table has no soft-delete column
-- (a snapshot is an immutable historical fact; it is never revised except the
-- same-day idempotent re-upsert, and never soft-deleted -- erasure removes it
-- via the FK cascade below). SELECT-own ONLY: unlike the canonical Shape 2,
-- there is deliberately NO client modify policy. Snapshots are SYSTEM-written
-- by the cron through the service-role client (which bypasses RLS); a user may
-- read their own trend but must never be able to write or forge a snapshot.
--
-- `on delete cascade` to `public.users` (declared inline): the Sprint 16
-- erasure path (hard-delete-sweep -> auth.admin.deleteUser -> the FK cascade,
-- 0015) reaches this table with no further wiring, and the GDPR export route
-- adds `mastery_snapshot` to its RLS-scoped read set. Every new user-scoped
-- table carries this invariant (Sprint 16 rule).
--
-- `concept_key` has no hard FK -- it references the static curriculum graph
-- shipped in code (`/packages/curriculum`), the same logical-join convention
-- `knowledge_nodes`/`misconceptions`/`reinforcement_schedule` already use.

create table public.mastery_snapshot (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  concept_key text not null,
  -- UTC calendar day the snapshot is FOR (the cron writes today's date). The
  -- unique key below makes the daily upsert idempotent on re-run.
  day date not null,
  -- Decay-adjusted mastery at snapshot time (mastery * retrievability), in
  -- [0,1] -- the same read-time value the dashboard/tutor see, frozen for the
  -- day so the trend reflects what was true then, not a re-decayed past.
  mastery real not null,
  state text not null
    check (state in ('unseen', 'learning', 'weak', 'mastered', 'forgotten')),
  created_at timestamptz not null default now()
);

-- One row per (user, concept, day): the idempotency key the cron upserts on,
-- so re-running the snapshot the same day overwrites rather than duplicates.
-- Its `user_id` prefix also serves the parent-delete cascade scan.
create unique index mastery_snapshot_user_concept_day
  on public.mastery_snapshot (user_id, concept_key, day);
-- The trend read shape: a user's snapshots over a day range, ordered by day.
create index idx_ms_user_day on public.mastery_snapshot (user_id, day);

-- RLS -- enabled in this same migration, immediately after the table.
alter table public.mastery_snapshot enable row level security;

-- Canonical Shape 2 SELECT-own, minus the `deleted_at is null` clause (no such
-- column). No modify policy: writes are service-role (cron) only.
create policy mastery_snapshot_select_own on public.mastery_snapshot
  for select using (auth.uid() = user_id);
