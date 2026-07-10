-- Sprint 17 / Task 2 (ADR-039 in-app feedback, ADR-043 telemetry + error
-- privacy): the two new user-scoped tables the beta-observability streams
-- write into. Additive only -- 0001 through 0016 are not touched, and this
-- migration must re-run cleanly on a fresh `supabase db reset`
-- (0001 -> ... -> 0016 -> 0017).
--
-- Numbering note: the sprint-17-plan.md Task 2 annotation calls this
-- `0015_feedback_and_telemetry.sql`, but 0015/0016 were already taken by the
-- parallel Sprint-16 track (`0015_cascade_deletes.sql`,
-- `0016_queue_own_erasure_rpc.sql`) -- same "plan number is stale" pattern as
-- this sprint's ADRs. This is the next free number, 0017; the content is
-- exactly the plan's Task 2 spec.
--
-- Both tables carry `on delete cascade` to `public.users` (declared inline
-- here, so unlike 0015_cascade_deletes.sql's retrofit of the pre-existing
-- tables, no drop/re-add is needed -- a new table gets the right FK from the
-- start). That cascade is what lets the Sprint 16 hard-delete sweep
-- (`/api/cron/hard-delete-sweep`, ADR-035 Phase 2) reach them for free: it
-- deletes the `auth.users` root and the cascade removes every child, these
-- two included -- no sweep code change is required. Per the project rule
-- (ADR-005), RLS is enabled in THIS migration, immediately after each
-- CREATE TABLE -- there is never a window in which either table exists
-- without RLS.

-- ---------------------------------------------------------------------------
-- 1) feedback -- one row per in-overlay "report / rate" submission (ADR-039).
--    Shape 2 (`user_id`-keyed) -- the caller reads and writes only their own
--    rows. This is CAPTURE, not a ticketing system: no status/workflow/reply
--    columns, and `message` is the ONE deliberate user-authored free-text
--    field this sprint (telemetry, below, has none by construction -- ADR-043).
--
--    Deviation from the canonical Shape 2 in /supabase/policies/README.md:
--    no `deleted_at` column, so the policies omit the `deleted_at is null`
--    clause. Feedback is write-once capture with no soft-delete concept (a
--    user's own row is theirs to see; erasure is the FK cascade below, not a
--    soft-delete flag), so there is nothing for a `deleted_at` predicate to
--    gate. The plan's column list is honored exactly -- no extra column added.
-- ---------------------------------------------------------------------------

create table public.feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  -- Optional link to the session that was active when the feedback was given.
  -- `on delete set null` (not cascade): feedback is user-owned capture that
  -- should survive a session's removal with the link simply dropped. It never
  -- orphans a user's data past erasure -- the user_id cascade above deletes
  -- the row when the user goes, regardless of this link.
  session_id uuid null references public.sessions (id) on delete set null,
  kind text not null check (kind in ('bug', 'rating', 'idea')),
  rating smallint null,
  message text null,
  created_at timestamptz not null default now()
);

-- Supports the caller's own-feedback reads (and the GDPR export, once wired --
-- see the follow-up note in sprint-17-plan.md Task 2) and speeds the
-- `on delete cascade` from users (Postgres scans the referencing column on a
-- parent delete). Same reasoning as 0007's idx_si_user_applied.
create index idx_feedback_user_created on public.feedback (user_id, created_at);

alter table public.feedback enable row level security;

-- Canonical Shape 2, minus the `deleted_at is null` clause (no such column --
-- see the table comment above).
create policy feedback_select_own on public.feedback
  for select using (auth.uid() = user_id);

create policy feedback_modify_own on public.feedback
  for all using (auth.uid() = user_id)
            with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- 2) telemetry_event -- typed, content-free product telemetry (ADR-043).
--    Shape 2 keyed on `user_id`, BUT insert-only from the owner: the client
--    may write its own events and NEVER read them back. There is no select/
--    update/delete policy, so RLS denies every client read of this table
--    (anon and authenticated alike); analysis reads are service-role only
--    (the service role bypasses RLS entirely), which is also what the
--    hard-delete cascade runs as.
--
--    `payload` is a jsonb bag of the discriminated-union event's typed fields
--    (validated content-free at /api/telemetry against the TelemetryEvent
--    union -- ADR-043's structural no-free-text guarantee lives in the route +
--    types, not here). `user_id` is nullable per the plan (a future
--    service-role-written anonymous event could carry none), but the client
--    insert policy below requires `auth.uid() = user_id` -- so a client can
--    only ever write a row attributed to ITSELF, never a forged user_id and
--    never a null-user row. That enforces "user_id from the session, never
--    from the body" (ADR-043) structurally, at the DB layer, on top of the
--    route.
-- ---------------------------------------------------------------------------

create table public.telemetry_event (
  id uuid primary key default gen_random_uuid(),
  user_id uuid null references public.users (id) on delete cascade,
  kind text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- Analysis is service-role, by event kind over time (funnel/rate queries);
-- this index serves that shape. (No user_id index is added: client reads are
-- denied entirely, and the parent-delete cascade for telemetry is bounded --
-- a deleted user's event count is small relative to the global stream -- so
-- the analysis index is the only one worth its write cost here.)
create index idx_telemetry_event_kind_created on public.telemetry_event (kind, created_at);

alter table public.telemetry_event enable row level security;

-- Insert-only, owner-scoped. No `to authenticated` role clause is needed (nor
-- used elsewhere in this codebase): `auth.uid()` is null for the anon role,
-- so `auth.uid() = user_id` can only ever hold for a signed-in caller writing
-- its own id. There is deliberately NO select/update/delete policy -- see the
-- table comment: clients write, only the service role reads.
create policy telemetry_event_insert_own on public.telemetry_event
  for insert with check (auth.uid() = user_id);
