-- Sprint 08 / Task 2: the first two learning-model tables from PLAN.md §2.3
-- (ADR-014) -- knowledge_nodes (live mastery state) and misconceptions
-- (tracked error patterns). Additive only -- 0001/0002/0003 are not touched,
-- and this migration must re-run cleanly on a fresh `supabase db reset`
-- (0001 -> 0002 -> 0003 -> 0004).
--
-- Both tables ship the full §2.3 column set except the `pgvector`
-- `embedding` column on `misconceptions` and its `pg_trgm` GIN index --
-- fuzzy/embedding misconception matching is deferred (ADR-014), so no
-- `pgvector`/`pg_trgm` extension is enabled here. The columns exist now so
-- the learning-model sprint (FSRS decay/stability/difficulty, fuzzy
-- matching, the reinforcement scheduler) needs no further migration to
-- start using them -- this sprint writes only a minimal Elo-style mastery
-- update and exact-category/2-instance misconception promotion.
--
-- RLS is enabled in THIS migration, immediately after each `CREATE TABLE`,
-- with the canonical Shape 2 (`user_id`) policy from
-- /supabase/policies/README.md -- there is never a window in which either
-- table exists without RLS. `reinforcement_schedule` and
-- `session_interactions` (PLAN §2.3) are not created here -- they land with
-- the scheduler / per-turn-persistence sprints.

-- ---------------------------------------------------------------------------
-- 1) knowledge_nodes -- one row per (user, concept); the live mastery state.
-- ---------------------------------------------------------------------------

create table public.knowledge_nodes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id),
  concept_key text not null,
  mastery real not null default 0.0,
  stability real not null default 1.0,
  difficulty real not null default 0.3,
  confidence_band text not null default 'low' check (confidence_band in ('low', 'medium', 'high')),
  observation_count int not null default 0,
  last_practiced_at timestamptz null,
  state text not null default 'unseen'
    check (state in ('unseen', 'learning', 'weak', 'mastered', 'forgotten')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz null
);

create unique index knowledge_nodes_user_concept_key on public.knowledge_nodes (user_id, concept_key);
create index idx_kn_user_state on public.knowledge_nodes (user_id, state);
create index idx_kn_user_lastpracticed on public.knowledge_nodes (user_id, last_practiced_at);

create trigger set_knowledge_nodes_updated_at
  before update on public.knowledge_nodes
  for each row
  execute function public.set_updated_at();

-- RLS -- enabled in this same migration, immediately after the table.
alter table public.knowledge_nodes enable row level security;

-- canonical user_id-keyed policy shape (see /supabase/policies/README.md)
create policy knowledge_nodes_select_own on public.knowledge_nodes
  for select using (auth.uid() = user_id and deleted_at is null);

create policy knowledge_nodes_modify_own on public.knowledge_nodes
  for all using (auth.uid() = user_id and deleted_at is null)
            with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- 2) misconceptions -- tracked, confirmed error patterns per user.
--    No `embedding` column / `pgvector` and no `pg_trgm` GIN this sprint --
--    fuzzy matching is deferred (ADR-014); matching is exact-category only.
-- ---------------------------------------------------------------------------

create table public.misconceptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id),
  concept_key text not null,
  category text not null,
  description text null,
  status text not null default 'pending' check (status in ('pending', 'active', 'resolved')),
  occurrence_count int not null default 1,
  consecutive_correct int not null default 0,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  resolved_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz null
);

create index idx_misc_user_concept_cat on public.misconceptions (user_id, concept_key, category);
create index idx_misc_user_status on public.misconceptions (user_id, status);

create trigger set_misconceptions_updated_at
  before update on public.misconceptions
  for each row
  execute function public.set_updated_at();

-- RLS -- enabled in this same migration, immediately after the table.
alter table public.misconceptions enable row level security;

-- canonical user_id-keyed policy shape (see /supabase/policies/README.md)
create policy misconceptions_select_own on public.misconceptions
  for select using (auth.uid() = user_id and deleted_at is null);

create policy misconceptions_modify_own on public.misconceptions
  for all using (auth.uid() = user_id and deleted_at is null)
            with check (auth.uid() = user_id);
