-- ADR-054: the Personal Notebook — a per-CONCEPT, cumulative study document
-- the tutoring sessions build up over time. It is the deliberate opposite of
-- `study_artifact` (0021), which is per-SESSION, write-once, one row per kind:
-- a notebook is ONE row per (user, concept), REVISED in place after every
-- session that practiced the concept. That single difference (per-concept +
-- mutable upsert vs. per-session + append-only) is the whole point — a concept
-- workspace reads one durable row, not N scattered session rows.
--
-- Numbering note: `0025_users_column_grants.sql` is the latest applied, so
-- this is the true next-free number, 0026 — same "confirm next-free at
-- execution" convention every recent migration follows (0020/0021 contended,
-- 0022 drifted from the plan's 0021). Additive only; re-runs cleanly on a
-- fresh `supabase db reset` (0001 -> ... -> 0025 -> 0026). Per ADR-005, RLS is
-- enabled in THIS migration, immediately after CREATE TABLE — never a window
-- in which the table exists without RLS.
--
-- Shape 2 (`user_id`-keyed), select/modify own (ADR-054): unlike
-- `mastery_snapshot` (system-written-only) or `telemetry_event` (insert-only),
-- a notebook is written by the caller's own authenticated request — the
-- best-effort session-end hook runs as the RLS-scoped client — so it needs its
-- own select+modify policy, not a service-role-only one (same posture as
-- `study_artifact`/`feedback`).
--
-- Deviation from the canonical Shape 2 in /supabase/policies/README.md: no
-- `deleted_at` column, so the policies omit the `deleted_at is null` clause —
-- the same deviation `study_artifact` (0021) and `feedback` (0017) take for
-- the same reason: a notebook is revise-in-place capture with no soft-delete
-- concept; erasure is the `user_id` FK cascade below, not a soft-delete flag.
--
-- `on delete cascade` to `public.users`: the Sprint 16 hard-delete sweep
-- (ADR-035 Phase 2) and the GDPR export/erasure invariant reach this table for
-- free — deleting the `auth.users` root cascades here with no further wiring,
-- and the export route (ADR-054) adds `concept_notebook` to its RLS-scoped
-- read set. Every new user-scoped table carries this invariant (Sprint 16 rule).
--
-- `concept_key` is a logical join to the code-shipped curriculum graph — NO FK,
-- the same convention `knowledge_nodes` / `misconceptions` /
-- `reinforcement_schedule` / `mastery_snapshot` already use for concept keys
-- referencing the static graph shipped in code.
--
-- `unique (user_id, concept_key)` is the UPSERT KEY: the session-end hook writes
-- with `on conflict (user_id, concept_key) do update`, which is exactly the
-- "revise the existing notebook" mechanic — the notebook is updated in place,
-- never duplicated per session.
--
-- `source_session_id` is nullable + `on delete set null` (not cascade),
-- mirroring `study_artifact.session_id` (0021) and `feedback.session_id`
-- (0017): the notebook is the user's own accumulated content and must survive
-- the removal of whichever session last touched it, with the provenance link
-- simply dropped — never deleted just because one contributing session was.
--
-- `session_count` is how many sessions have fed this notebook — surfaced as the
-- workspace's "updated after N sessions" line and available to a future
-- "rebuild from full history" heuristic. Incremented by the hook (read-then-
-- write); the once-per-session `session/end` guard makes a same-session double-
-- count impossible.
--
-- `content` holds the kind-agnostic notebook shape validated by `parseNotebook`
-- (web/lib/notebook/tool.ts) before write: `{ summary: string, reminders:
-- string[], explanations: { title, body }[] }` — the ADR-054 mapping of the
-- brief's "summaries, important reminders, tutor explanations".

create table public.concept_notebook (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  concept_key text not null,
  content jsonb not null,
  source_session_id uuid null references public.sessions (id) on delete set null,
  session_count integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, concept_key)
);

-- Keeps `updated_at` honest on every in-place revision (the same shared trigger
-- function `sessions`/`knowledge_nodes` use).
create trigger set_concept_notebook_updated_at
  before update on public.concept_notebook
  for each row
  execute function public.set_updated_at();

-- Serves the concept-workspace read (one user's notebook for one concept — the
-- `loadConceptNotebook` point read) AND the `on delete cascade` from users
-- (Postgres scans the referencing column on a parent delete). The unique
-- constraint above already indexes (user_id, concept_key), so this is that
-- same access path made explicit — kept for parity with the sibling tables'
-- named indexes (idx_study_artifact_user_*), harmless if redundant.
create index idx_concept_notebook_user_concept on public.concept_notebook (user_id, concept_key);

-- RLS — enabled in this same migration, immediately after the table.
alter table public.concept_notebook enable row level security;

-- Canonical Shape 2, minus the `deleted_at is null` clause (no such column —
-- see the table comment; same deviation as study_artifact/0021, feedback/0017).
create policy concept_notebook_select_own on public.concept_notebook
  for select using (auth.uid() = user_id);

create policy concept_notebook_modify_own on public.concept_notebook
  for all using (auth.uid() = user_id)
            with check (auth.uid() = user_id);
