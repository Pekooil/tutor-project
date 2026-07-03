-- Sprint 11 / Task 2: session_interactions (PLAN.md §2.3, ADR-019) -- one
-- row per gradable turn, the raw material the per-interaction FSRS apply
-- reads. Additive only -- 0001..0006 are not touched, and this migration
-- must re-run cleanly on a fresh `supabase db reset` (0001 -> ... -> 0007).
--
-- This is ADR-019's reversal of ADR-013's "the turn writes nothing": the
-- write is scoped to exactly this table, is TEXT ONLY (student_transcript /
-- tutor_response), and never stores audio -- ADR-011 ("session audio is
-- never persisted") is unaffected, since audio never reaches this route in
-- the first place (it is transcribed client-side before the turn request).
--
-- FK columns reference public.sessions / public.users the same way every
-- prior migration does (0002/0004) -- a plain FK, no ON DELETE CASCADE.
-- Account/session erasure in this codebase is an explicit, ordered
-- service-role sweep (PLAN.md §2.7's session_interactions -> sessions ->
-- reinforcement_schedule -> misconceptions -> knowledge_nodes -> users
-- order), not a DB-level cascade -- this table follows that same
-- soft-delete-first convention, not a new one.
--
-- RLS is enabled in THIS migration, immediately after CREATE TABLE, with
-- the canonical Shape 2 (`user_id`) policy from
-- /supabase/policies/README.md -- there is never a window in which this
-- table exists without RLS.

create table public.session_interactions (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions (id),
  user_id uuid not null references public.users (id),
  turn_index int not null,
  concept_key text null,
  student_transcript text null,
  tutor_response text null,
  outcome text not null default 'none'
    check (outcome in ('correct', 'incorrect', 'partial', 'none')),
  self_confidence text not null default 'unknown'
    check (self_confidence in ('low', 'med', 'high', 'unknown')),
  response_latency_ms int null,
  misconception_category text null,
  applied_to_profile boolean not null default false,
  created_at timestamptz not null default now(),
  deleted_at timestamptz null
);

create index idx_si_session_turn on public.session_interactions (session_id, turn_index);
create index idx_si_user_applied on public.session_interactions (user_id, applied_to_profile);

-- No updated_at column (PLAN.md §2.3) -- a row is written once by the turn
-- route and flipped to applied_to_profile=true by the per-interaction
-- apply / session-end reconcile sweep; it is never otherwise revised.

-- RLS -- enabled in this same migration, immediately after the table.
alter table public.session_interactions enable row level security;

-- canonical user_id-keyed policy shape (see /supabase/policies/README.md)
create policy session_interactions_select_own on public.session_interactions
  for select using (auth.uid() = user_id and deleted_at is null);

create policy session_interactions_modify_own on public.session_interactions
  for all using (auth.uid() = user_id and deleted_at is null)
            with check (auth.uid() = user_id);
