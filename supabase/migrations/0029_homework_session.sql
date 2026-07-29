-- v4 homework sessions (ADR-056 → ADR-057): the server half of the "homework
-- referee". Slice 1 shipped this feature local-first (chrome.storage.local is
-- the source of truth and always will be, for the working portion of a set --
-- a tap must never wait on the network). This table is the SYNCED COPY the
-- Studio v4 dashboard reads: the resume card, the latest-set summary with its
-- per-problem timeline, and the History view's homework rows all need data
-- that outlives one browser profile.
--
-- Additive only -- 0001 through 0028 are untouched, and this re-runs cleanly on
-- a fresh `supabase db reset` (0001 -> ... -> 0028 -> 0029). Per the project
-- rule (ADR-005), RLS is enabled in THIS migration immediately after CREATE
-- TABLE -- there is never a window in which the table exists without RLS.
--
-- Shape 2 (`user_id`-keyed), select/modify own. Like `study_artifact` (0021)
-- and `feedback` (0017), rows are written by the caller's OWN authenticated
-- request (`POST /api/homework/sync`, through the RLS-scoped client), so the
-- client needs its own select+modify policy rather than a service-role-only
-- one. Same deviation from the canonical Shape 2 as those two: no `deleted_at`
-- column, so the policies omit the `deleted_at is null` clause -- erasure is
-- the `user_id` FK cascade below, not a soft-delete flag.
--
-- `on delete cascade` to `public.users`: the Sprint 16 hard-delete sweep
-- (`/api/cron/hard-delete-sweep`, ADR-035 Phase 2) reaches this table for free,
-- and this table is added to the GDPR export route's RLS-scoped read set in the
-- same change. Every new user-scoped table carries BOTH halves of that
-- invariant (Sprint 16 rule, asserted in web/tests/account.test.ts).
--
-- ---- Two deliberate shape decisions ----
--
-- 1. `id` is CLIENT-GENERATED and is the primary key. The extension mints a
--    uuid when the set starts (overlay/homework/session.ts's createSession) and
--    that id is what makes the sync idempotent: a set syncs on completion and
--    again on every pause, and it must upsert rather than pile up duplicate
--    rows. A client-chosen PK is safe here because RLS scopes every write to
--    the caller -- the worst a malicious client can do is collide with its OWN
--    prior row, which is exactly the intended upsert.
--
-- 2. `problems` is jsonb, not a child table. The per-problem array is written
--    once, read whole (the dashboard's timeline and the summary detail's
--    "Where the time went" both want all of it), never queried across rows, and
--    must stay atomic with the session it belongs to -- a timeline that is
--    half-written because a second table's insert failed would be worse than no
--    timeline. Same reasoning as `study_artifact.payload` (0021). Shape,
--    validated by parseHomeworkSync before insert:
--      [{ index:int, label:text, outcome:'ok'|'shaky'|'tutored',
--         seconds:int, pageGrade?:'correct'|'incorrect' }]
--
-- ---- Privacy ----
--
-- `location_hash`, never a plaintext URL: the same discipline
-- `sessions.page_url_hash` established (0014) and ADR-047 restated for the
-- dashboard ("group-by page_url_hash, never plaintext domain"). It exists only
-- so resume can tell "the page you were on" from "a different page".
--
-- `title` IS stored in the clear, and that is a considered exception: the
-- resume card and the History rows read "Stoichiometry worksheet — paused at 5
-- of 8", which is unbuildable from a hash. It is the same class of data as
-- `sessions.detected_topic`, which this schema already stores plainly. No
-- problem TEXT is persisted here -- the extension holds snippets locally for
-- the tutoring handoff and they never cross this boundary.

create table public.homework_session (
  -- Client-minted (see note 1 above); NOT defaulted, so a sync that omits it
  -- fails loudly rather than silently creating a duplicate every push.
  id uuid primary key,
  user_id uuid not null references public.users (id) on delete cascade,
  -- The tutoring session a detour opened, when one did. Nullable +
  -- `on delete set null` (not cascade), mirroring `study_artifact.session_id`
  -- (0021) and `feedback.session_id` (0017): a homework set is the student's
  -- own record and must survive the tutoring session's removal with the link
  -- simply dropped.
  tutoring_session_id uuid null references public.sessions (id) on delete set null,
  location_hash text not null,
  title text null,
  concept text null,
  denominator int not null check (denominator > 0),
  graded boolean not null default false,
  status text not null check (status in ('active', 'paused', 'complete')),
  problems jsonb not null default '[]'::jsonb,
  total_seconds int not null default 0 check (total_seconds >= 0),
  longest_unaided_run int not null default 0 check (longest_unaided_run >= 0),
  started_at timestamptz not null,
  ended_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger set_homework_session_updated_at
  before update on public.homework_session
  for each row
  execute function public.set_updated_at();

-- Serves the dashboard's two hot reads -- "my latest completed set" and "my
-- paused set, if any" -- and the `on delete cascade` from users (Postgres scans
-- the referencing column on a parent delete). Same reasoning as
-- `idx_study_artifact_user_created` (0021).
create index idx_homework_session_user_started on public.homework_session (user_id, started_at desc);

-- Serves the resume lookup: the caller's unfinished set on THIS page, without a
-- sequential scan of their full homework history.
create index idx_homework_session_user_status on public.homework_session (user_id, status);

-- RLS -- enabled in this same migration, immediately after the table.
alter table public.homework_session enable row level security;

-- Canonical Shape 2, minus the `deleted_at is null` clause (no such column --
-- see the table comment above; same deviation as feedback/study_artifact).
create policy homework_session_select_own on public.homework_session
  for select using (auth.uid() = user_id);

create policy homework_session_modify_own on public.homework_session
  for all using (auth.uid() = user_id)
            with check (auth.uid() = user_id);
