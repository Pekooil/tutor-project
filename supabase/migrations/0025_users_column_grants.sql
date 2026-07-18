-- users column-level UPDATE grants (security hardening, follow-up to ADR-053's
-- live-find). The Shape 1 `users_update_own` policy (0001) is column-agnostic
-- and Supabase's default privileges grant table-wide UPDATE to `authenticated`
-- — so any signed-in user could PATCH their own row via PostgREST and set
-- privileged columns directly: `subscription_tier` (self-upgrade to Pro),
-- `free_session_count` (reset their monthly quota), `subscription_status`,
-- `stripe_*` (billing bookkeeping the webhook + reconcile cron key on), and
-- the 0024 referral columns (`referral_bonus_sessions` = self-granted free
-- sessions). RLS answers "whose rows"; it never answers "which columns" —
-- that is what column-level grants are for.
--
-- The fix: revoke table-wide UPDATE from the client roles, then grant back
-- ONLY the columns legitimate client-side flows actually write (audited
-- across web/ 2026-07-18):
--   - birth_year, age_verified, gdpr_consent_at, gdpr_consent_version —
--     the signup finalization (web/app/api/auth/signup/route.ts), which
--     deliberately runs on the caller's RLS client, never the service role.
--   - onboarding_completed_at — the onboarding seed's completion stamp
--     (web/lib/onboarding/seed.ts, still live server-side).
-- `updated_at` needs NO grant: the set_updated_at trigger assigns it inside
-- the same statement; column privileges apply only to a statement's own
-- target list, not to trigger assignments.
-- `stripe_customer_id` is deliberately NOT granted — ensureStripeCustomer's
-- write moves to the service-role client in the same change
-- (web/lib/billing/stripe.ts): the webhook and reconcile cron key on that
-- column, so it must be server-managed like every other billing column.
--
-- `start_session` must flip to SECURITY DEFINER in the same migration: it is
-- the ONE function that updates public.users while running as the caller
-- (SECURITY INVOKER since 0003 — free_session_count / free_period_started_at
-- and, since 0024, referral_bonus_sessions), so the revoke above would break
-- every session start. The body is byte-identical to 0024's; every statement
-- in it is already scoped `users.id = v_uid` / inserts `v_uid`, so definer
-- (which bypasses RLS) changes nothing about whose rows it can touch. It
-- gains the standard definer hygiene: `set search_path = public` +
-- execute revoked from public/anon BY NAME (the 0013 caveat: a PUBLIC-only
-- revoke leaves anon's own default grant standing) + granted to
-- authenticated. `end_session` stays INVOKER (it only updates sessions);
-- `queue_own_erasure` (0016), `record_referral` (0024), `cost_guard` (0013),
-- and `voice_credit_guard` (0023) are already DEFINER or service-role-only
-- and unaffected. The service-role client bypasses grants and RLS entirely —
-- every admin-client write path is untouched.
--
-- Additive in effect (0001-0024 untouched); re-runs clean on
-- `supabase db reset` (0001 -> ... -> 0024 -> 0025).

-- 1. Column-level UPDATE for client roles ------------------------------------

revoke update on table public.users from public;
revoke update on table public.users from anon;
revoke update on table public.users from authenticated;

-- anon gets nothing back: users_update_own already requires auth.uid() = id,
-- so an anon UPDATE was always RLS-blocked; now it is privilege-blocked too.
grant update (birth_year, age_verified, gdpr_consent_at, gdpr_consent_version, onboarding_completed_at)
  on public.users to authenticated;

-- 2. start_session -> SECURITY DEFINER (body identical to 0024) --------------

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
security definer
set search_path = public
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
  -- (ADR-053) before falling to degraded.
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

-- Definer hygiene (the 0013 caveat: revoke anon BY NAME, not just PUBLIC).
revoke all on function public.start_session(text, text, int, text) from public;
revoke execute on function public.start_session(text, text, int, text) from anon;
grant execute on function public.start_session(text, text, int, text) to authenticated;
