-- Sprint 11 / Task 2: reinforcement_schedule (PLAN.md §2.3/§2.4, ADR-020) --
-- one row per (user, concept) due item, upserted by scheduleReinforcement
-- at each per-interaction FSRS apply. Additive only -- 0001..0007 are not
-- touched, and this migration must re-run cleanly on a fresh
-- `supabase db reset` (0001 -> ... -> 0008).
--
-- `due_at`/`interval_days`/`priority` are written by inverting the same
-- FSRS retrievability curve `@calyxa/learning-model` already uses for
-- decay (ADR-020) -- this table has no independent memory model of its
-- own, it is a scheduling projection of `knowledge_nodes`. `concept_key`
-- has no hard FK (PLAN.md §2.3 "Relationships") -- it references the
-- static curriculum graph shipped in code (`/packages/curriculum`), the
-- same logical-join convention `knowledge_nodes`/`misconceptions` already
-- use.
--
-- RLS is enabled in THIS migration, immediately after CREATE TABLE, with
-- the canonical Shape 2 (`user_id`) policy from
-- /supabase/policies/README.md -- there is never a window in which this
-- table exists without RLS.

create table public.reinforcement_schedule (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id),
  concept_key text not null,
  due_at timestamptz not null,
  interval_days real not null default 1.0,
  last_review_at timestamptz null,
  lapses int not null default 0,
  priority real not null default 0.5,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz null
);

create unique index reinforcement_schedule_user_concept_key
  on public.reinforcement_schedule (user_id, concept_key);
create index idx_rs_user_due on public.reinforcement_schedule (user_id, due_at);

create trigger set_reinforcement_schedule_updated_at
  before update on public.reinforcement_schedule
  for each row
  execute function public.set_updated_at();

-- RLS -- enabled in this same migration, immediately after the table.
alter table public.reinforcement_schedule enable row level security;

-- canonical user_id-keyed policy shape (see /supabase/policies/README.md)
create policy reinforcement_schedule_select_own on public.reinforcement_schedule
  for select using (auth.uid() = user_id and deleted_at is null);

create policy reinforcement_schedule_modify_own on public.reinforcement_schedule
  for all using (auth.uid() = user_id and deleted_at is null)
            with check (auth.uid() = user_id);
