-- Sprint 16 / Task 7 (ADR-036): start_session gains p_page_url_hash so the
-- server-salted hash is written inside the SAME atomic statement that
-- creates the session row — no separate follow-up update, no window where a
-- session momentarily has neither identifier. The one caller
-- (web/lib/tier/session-gate.ts's startSession()) now always passes
-- p_page_domain = null, so plaintext page_domain stops being written on new
-- rows (ADR-036 decision 2); the column and parameter both stay (existing
-- rows, and a cheap revert path) rather than being dropped.
--
-- A changed parameter list is a NEW overload in Postgres (functions are
-- identified by name + arg types) — `create or replace` alone would leave
-- the old 3-arg start_session callable and stale. Drop it explicitly first.
-- Additive in effect (0001-0013 untouched); re-runs clean on
-- `supabase db reset` (0001 -> ... -> 0013 -> 0014).

drop function if exists public.start_session(text, text, int);

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

  v_counts_against_free := (v_tier = 'free' and v_count is not null);
  v_degraded := (v_tier = 'free' and v_count is null);

  if v_tier = 'free' then
    v_remaining := greatest(p_free_limit - v_count, 0);
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
