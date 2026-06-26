-- citext is used for case-insensitive email comparisons/uniqueness.
create extension if not exists citext;

-- Trigger function: maintain updated_at on every UPDATE. Shared by every
-- table that carries an updated_at column.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- Trigger function: mirror every new auth.users row into public.users.
-- SECURITY DEFINER because the inserting role (the Auth service) has no
-- insert grant on public.users — this is the only sanctioned privileged
-- insert into users; clients never insert directly.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.users (id, email, subscription_tier, age_verified, gdpr_consent_at)
  values (new.id, new.email, 'free', false, null);
  return new;
end;
$$;

create table public.users (
  id uuid primary key references auth.users (id),
  email citext not null,
  subscription_tier text not null default 'free' check (subscription_tier in ('free', 'pro')),
  -- Stripe / free-tier / onboarding columns (PLAN.md §2.3), added now as
  -- nullable so the billing and freemium sprints need no migration to start
  -- using them. No behavior is built on these columns this sprint.
  stripe_customer_id text null,
  stripe_subscription_id text null,
  subscription_status text null,
  subscription_renews_at timestamptz null,
  free_session_count int null,
  free_period_started_at timestamptz null,
  onboarding_completed_at timestamptz null,
  age_verified boolean not null default false,
  birth_year smallint null,
  gdpr_consent_at timestamptz null,
  gdpr_consent_version text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz null
);

create unique index users_email_key on public.users (email);

create trigger set_users_updated_at
  before update on public.users
  for each row
  execute function public.set_updated_at();

create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute function public.handle_new_user();

-- RLS — enabled in this same migration, immediately after the table.
alter table public.users enable row level security;

-- self read/update only; keyed on id (not user_id) because users.id = auth.uid()
create policy users_select_own on public.users
  for select using (auth.uid() = id and deleted_at is null);

create policy users_update_own on public.users
  for update using (auth.uid() = id and deleted_at is null)
             with check (auth.uid() = id);

-- No client insert policy: rows are created only by handle_new_user() (SECURITY DEFINER).
-- No client delete policy: erasure is a later service-role path.
