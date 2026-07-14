-- Sprint 21 / Task 2 (ADR-049): the one new table the study-materials
-- generator writes into. A completed session's notes/practice-problems/
-- flashcards are the first *generated* content this product persists (the
-- recap, by contrast, is ephemeral and rides one response -- ADR-049).
--
-- Numbering note: the sprint-21-plan.md Task 2 annotation calls this
-- `0019_study_artifact.sql`, but 0019 was already taken by the parallel
-- Sprint-19 track (`0019_waitlist_invite.sql`), and the next-free number,
-- 0020, was taken moments before this migration was written by the parallel
-- Sprint-22 track (`0020_mastery_snapshot.sql`, committed cf1f49f) -- same
-- "plan number is stale, confirm next-free at execution" pattern as
-- ADR-039/044/045/049. This is the true next-free number, 0021; the content
-- is exactly the plan's Task 2 spec (one row per artifact KIND, per ADR-049
-- decision 3, for independent rendering).
--
-- Additive only -- 0001 through 0020 are not touched, and this migration
-- re-runs cleanly on a fresh `supabase db reset` (0001 -> ... -> 0020 -> 0021).
-- Per the project rule (ADR-005), RLS is enabled in THIS migration,
-- immediately after CREATE TABLE -- there is never a window in which the
-- table exists without RLS.
--
-- Shape 2 (`user_id`-keyed), select/modify own (ADR-049 decision 3) -- unlike
-- `mastery_snapshot` (0020, system-written-only) or `telemetry_event`
-- (0017, insert-only), a study kit IS written by the caller's own
-- authenticated request (`POST /api/study/generate`, Task 4, mirrors
-- `/api/feedback`'s `auth.supabase.from(...).insert(...)` pattern -- the
-- RLS-scoped client, not service-role), so the client needs its own
-- select+modify policy, not a service-role-only one.
--
-- Deviation from the canonical Shape 2 in /supabase/policies/README.md: no
-- `deleted_at` column, so the policies omit the `deleted_at is null` clause
-- -- same deviation `feedback` already takes (0017) for the same reason: a
-- generated kit is write-once-then-read capture with no soft-delete concept;
-- erasure is the `user_id` FK cascade below, not a soft-delete flag.
--
-- `on delete cascade` to `public.users`: the Sprint 16 hard-delete sweep
-- (`/api/cron/hard-delete-sweep`, ADR-035 Phase 2) reaches this table for
-- free -- deleting the `auth.users` root cascades here with no further
-- wiring -- and Task 6 adds `study_artifact` to the GDPR export route's
-- RLS-scoped read set. Every new user-scoped table carries this invariant
-- (Sprint 16 rule).
--
-- `session_id` is nullable + `on delete set null` (not cascade), mirroring
-- `feedback.session_id` (0017): a study kit is the user's own generated
-- content and should survive the source session's removal with the link
-- simply dropped, never orphaning past the user_id cascade above -- a kept
-- kit is never silently deleted just because its session was.
--
-- `kind` has a DB-level CHECK constraint (unlike `concept_key`'s
-- logical-only join to the code-shipped curriculum graph elsewhere in this
-- schema) because the three-way artifact-kind union is a small, fixed,
-- code-independent enum -- exactly ADR-049 decision 1's marketing
-- `ArtifactKind = 'notes' | 'problems' | 'flashcards'` contract, enforced at
-- the schema boundary so a malformed kind can never be persisted regardless
-- of which layer inserts it.
--
-- `payload` holds the kind-specific shape validated by `parseStudyKit`
-- (Task 4) before insert: an array of ordered step strings for `notes`, an
-- array of `{statement, solution}` for `problems`, an array of `{front,
-- back}` for `flashcards`. `concept_keys` is a nullable array of the
-- `CONCEPT_KEYS` this kit's artifact touches (no hard FK -- same
-- logical-join convention `knowledge_nodes`/`misconceptions`/
-- `reinforcement_schedule`/`mastery_snapshot` already use for concept keys
-- referencing the static curriculum graph shipped in code).

create table public.study_artifact (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  session_id uuid null references public.sessions (id) on delete set null,
  kind text not null check (kind in ('notes', 'problems', 'flashcards')),
  payload jsonb not null,
  concept_keys text[] null,
  created_at timestamptz not null default now()
);

-- Serves both the caller's own-kits list (`GET /api/study/list`, Task 4,
-- newest first) and the `on delete cascade` from users (Postgres scans the
-- referencing column on a parent delete) -- same reasoning as
-- `idx_feedback_user_created` (0017).
create index idx_study_artifact_user_created on public.study_artifact (user_id, created_at);

-- Serves the extension recap card's "fetch the kit for the just-ended
-- session" read (Task 5): a caller's kits filtered to one session, without
-- a sequential scan of their full history.
create index idx_study_artifact_user_session on public.study_artifact (user_id, session_id);

-- RLS -- enabled in this same migration, immediately after the table.
alter table public.study_artifact enable row level security;

-- Canonical Shape 2, minus the `deleted_at is null` clause (no such column
-- -- see the table comment above; same deviation as `feedback`, 0017).
create policy study_artifact_select_own on public.study_artifact
  for select using (auth.uid() = user_id);

create policy study_artifact_modify_own on public.study_artifact
  for all using (auth.uid() = user_id)
            with check (auth.uid() = user_id);
