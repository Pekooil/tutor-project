-- Referral system + signup IP cap (ADR-053). Three pieces, one migration,
-- because start_session's bonus-consumption logic is meaningless without the
-- columns it reads and vice versa:
--
--   1. `users` gains referral columns: a unique shareable `referral_code`,
--      `referred_by` attribution, `referral_rewards_granted` (how many
--      3-referral rewards have been paid out), and `referral_bonus_sessions`
--      (the spendable balance: +10 per reward, decremented by start_session
--      once the monthly free allowance is exhausted).
--   2. `referral` (Shape 2, select-own for the REFERRER) — one row per
--      referred signup, written only by the service role from the signup
--      route. `referred_user_id` is UNIQUE: an account can be referred at
--      most once, ever. FK-cascade on BOTH user columns covers erasure
--      (ADR-035); on the export list via the referrer's select-own policy.
--   3. `signup_ip` (Shape 3, deny-all) — one row per created account holding
--      an HMAC-salted hash of the signup IP (web/lib/referral/ip-hash.ts;
--      the raw IP is NEVER stored, same irreversibility argument as
--      sessions.page_url_hash, ADR-036). The signup route counts rows per
--      ip_hash and refuses the 3rd account from one network. FK-cascade to
--      users covers erasure — deleting an account frees its network slot,
--      deliberately, so a deleted household account doesn't burn the limit
--      forever. Exported via the service-role path (like telemetry_event:
--      no client SELECT policy, but the row is still the user's data).
--
-- `record_referral` (SECURITY DEFINER, service-role only) is the single
-- write path for referral bookkeeping: insert-once, attribute, count, and
-- grant +10 bonus sessions per 3 referred signups — atomic under a row lock
-- on the referrer so two concurrent qualifying signups can't double-grant.
--
-- start_session is REPLACED (same 4-arg signature as 0014, so the deployed
-- web code keeps working unchanged): after the monthly `free_session_count <
-- p_free_limit` gate fails, it now tries to spend one referral_bonus_session
-- before declaring the session degraded. Bonus sessions never expire and are
-- deliberately consumed AFTER the monthly allowance (a 30-day reset restores
-- the monthly 10 first; the bonus balance carries across periods).
--
-- Additive (0001-0023 untouched); re-runs clean on `supabase db reset`
-- (0001 -> ... -> 0023 -> 0024).

-- 1. users columns ----------------------------------------------------------

alter table public.users
  add column if not exists referral_code text unique,
  add column if not exists referred_by uuid references public.users (id) on delete set null,
  add column if not exists referral_rewards_granted int not null default 0,
  add column if not exists referral_bonus_sessions int not null default 0;

-- 2. referral ---------------------------------------------------------------

create table if not exists public.referral (
  id uuid primary key default gen_random_uuid(),
  referrer_id uuid not null references public.users (id) on delete cascade,
  referred_user_id uuid not null unique references public.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

create index if not exists idx_referral_referrer on public.referral (referrer_id);

alter table public.referral enable row level security;

-- Shape 2, select-own keyed on referrer_id (the referred user's copy of this
-- fact is their own users.referred_by column). No modify policies: writes go
-- through record_referral under the service role only.
drop policy if exists referral_select_own on public.referral;
create policy referral_select_own on public.referral
  for select using (auth.uid() = referrer_id);

-- 3. signup_ip --------------------------------------------------------------

create table if not exists public.signup_ip (
  id uuid primary key default gen_random_uuid(),
  ip_hash text not null,
  user_id uuid not null unique references public.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

create index if not exists idx_signup_ip_hash on public.signup_ip (ip_hash);

-- Shape 3: RLS enabled, ZERO policies — deny-all to anon/authenticated; only
-- the service-role client (signup route) reads or writes it. See
-- /supabase/policies/README.md.
alter table public.signup_ip enable row level security;

-- 4. record_referral --------------------------------------------------------

create or replace function public.record_referral(
  p_referrer uuid,
  p_referred uuid
)
returns table (
  referral_count int,
  rewards_granted int,
  reward_just_granted boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prev int;
  v_count int;
  v_new int;
begin
  if p_referrer is null or p_referred is null or p_referrer = p_referred then
    return query select 0, 0, false;
    return;
  end if;

  -- Row-lock the referrer: two concurrent qualifying signups serialize here,
  -- so the count-and-grant below can't pay the same reward twice.
  select users.referral_rewards_granted
    into v_prev
    from public.users
   where users.id = p_referrer
     and users.deleted_at is null
     for update;

  if v_prev is null then
    return query select 0, 0, false;
    return;
  end if;

  insert into public.referral (referrer_id, referred_user_id)
  values (p_referrer, p_referred)
  on conflict (referred_user_id) do nothing;

  update public.users
     set referred_by = p_referrer
   where users.id = p_referred
     and users.referred_by is null;

  select count(*)::int into v_count
    from public.referral
   where referral.referrer_id = p_referrer;

  -- Every 3 referred signups -> one +10-session reward, paid at most once
  -- per tranche (v_prev remembers how many tranches were already paid).
  v_new := v_count / 3;

  if v_new > v_prev then
    update public.users
       set referral_rewards_granted = v_new,
           referral_bonus_sessions = referral_bonus_sessions + 10 * (v_new - v_prev)
     where users.id = p_referrer;
  end if;

  return query select v_count, greatest(v_new, v_prev), (v_new > v_prev);
end;
$$;

-- Service-role only: the signup route is the sole caller. Same revoke set as
-- check_rate_limit (0018).
revoke execute on function public.record_referral(uuid, uuid) from public, anon, authenticated;

-- 5. start_session v3 -------------------------------------------------------

-- Same signature as 0014 -> `create or replace` swaps the body in place; no
-- overload is left behind and the deployed startSession() caller needs no
-- change.
create or replace function public.start_session(
  p_page_domain text,
  p_mode text,
  p_free_limit int,
  p_page_url_hash text
)
returns table (
  id uuid,
  started_at timestamptz,
  mode text,
  counts_against_free boolean,
  degraded boolean,
  remaining int
)
language plpgsql
security invoker
as $$
declare
  v_uid uuid;
  v_tier text;
  v_period_started timestamptz;
  v_count int;
  v_bonus_after int;
  v_bonus_used boolean;
  v_fsc int;
  v_bonus int;
  v_counts_against_free boolean;
  v_degraded boolean;
  v_remaining int;
  v_session_id uuid;
  v_started_at timestamptz;
  v_mode text;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'start_session: no authenticated user';
  end if;

  select subscription_tier, free_period_started_at
    into v_tier, v_period_started
    from public.users
   where users.id = v_uid
     and deleted_at is null;

  if v_tier is null then
    raise exception 'start_session: user % not found', v_uid;
  end if;

  -- Lazy 30-day rolling reset, applied before the quota check. The daily
  -- reset-free-tier cron (Sprint 16 / Task 6, ADR-036) is the safety net
  -- over this for dormant accounts that never call start_session.
  if v_period_started < now() - interval '30 days' then
    update public.users
       set free_session_count = 0,
           free_period_started_at = now()
     where users.id = v_uid;
  end if;

  update public.users
     set free_session_count = free_session_count + 1
   where users.id = v_uid
     and subscription_tier = 'free'
     and free_session_count < p_free_limit
     and deleted_at is null
  returning free_session_count into v_count;

  -- Monthly allowance exhausted: try to spend one referral bonus session
  -- (ADR-053) before falling to degraded. Same atomic guarded-update shape
  -- as the monthly gate above — the WHERE fails when the balance is zero.
  v_bonus_used := false;
  if v_tier = 'free' and v_count is null then
    update public.users
       set referral_bonus_sessions = referral_bonus_sessions - 1
     where users.id = v_uid
       and subscription_tier = 'free'
       and referral_bonus_sessions > 0
       and deleted_at is null
    returning referral_bonus_sessions into v_bonus_after;

    v_bonus_used := (v_bonus_after is not null);
  end if;

  v_counts_against_free := (v_tier = 'free' and (v_count is not null or v_bonus_used));
  v_degraded := (v_tier = 'free' and v_count is null and not v_bonus_used);

  if v_tier = 'free' then
    -- Re-read after the increments: remaining = what's left of the monthly
    -- allowance plus the whole bonus balance, so the popup's "N session(s)
    -- left" counter reflects earned referral sessions too.
    select free_session_count, referral_bonus_sessions
      into v_fsc, v_bonus
      from public.users
     where users.id = v_uid;

    v_remaining := greatest(p_free_limit - v_fsc, 0) + coalesce(v_bonus, 0);
  else
    v_remaining := null;
  end if;

  insert into public.sessions (user_id, page_domain, page_url_hash, mode, counts_against_free)
  values (v_uid, p_page_domain, p_page_url_hash, p_mode, v_counts_against_free)
  returning sessions.id, sessions.started_at, sessions.mode
    into v_session_id, v_started_at, v_mode;

  return query
    select v_session_id, v_started_at, v_mode, v_counts_against_free, v_degraded, v_remaining;
end;
$$;

grant execute on function public.start_session(text, text, int, text) to authenticated;
