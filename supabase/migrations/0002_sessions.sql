-- Minimal sessions table: only the columns needed to prove the user_id RLS
-- shape. The remaining columns from PLAN.md §2.3 (page_url_hash,
-- detected_topic, interaction_count, counts_against_free) land when the
-- /session endpoint sprint needs them.
create table public.sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id),
  started_at timestamptz not null default now(),
  ended_at timestamptz null,
  page_domain text null,
  mode text not null default 'voice' check (mode in ('voice', 'text')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz null
);

create trigger set_sessions_updated_at
  before update on public.sessions
  for each row
  execute function public.set_updated_at();

-- RLS — enabled in this same migration, immediately after the table.
alter table public.sessions enable row level security;

-- canonical user_id-keyed policy shape (see /supabase/policies/README.md)
create policy sessions_select_own on public.sessions
  for select using (auth.uid() = user_id and deleted_at is null);

create policy sessions_modify_own on public.sessions
  for all using (auth.uid() = user_id and deleted_at is null)
            with check (auth.uid() = user_id);
