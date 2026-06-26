-- Sprint 04 / Task 2: finish the `sessions` columns deferred from 0002,
-- normalise the freemium columns on `users` (Sprint 03 left them nullable
-- and behaviour-free), and add the two RPCs that make the free-tier gate
-- atomic. Additive only — 0001 and 0002 are not touched, and this migration
-- must re-run cleanly on a fresh `supabase db reset` (0001 -> 0002 -> 0003).

-- ---------------------------------------------------------------------------
-- 1) Finish the `sessions` table (PLAN.md §2.3).
-- ---------------------------------------------------------------------------

alter table public.sessions
  add column page_url_hash text null,
  add column detected_topic text null,
  add column interaction_count int not null default 0,
  add column counts_against_free boolean not null default true;

create index idx_sessions_user_started on public.sessions (user_id, started_at desc);
create index idx_sessions_domain on public.sessions (page_domain);

-- RLS on `sessions` was enabled in 0002 (sessions_select_own / sessions_modify_own,
-- both keyed on user_id = auth.uid()). New columns inherit those row-level
-- policies automatically — no policy change is needed or made here.

-- ---------------------------------------------------------------------------
-- 2) Normalise the freemium columns on `users` (Sprint 03 left them nullable,
--    behaviour-free placeholders) so the atomic gate has sane, non-null state.
-- ---------------------------------------------------------------------------

update public.users set free_session_count = 0 where free_session_count is null;

alter table public.users
  alter column free_session_count set default 0,
  alter column free_session_count set not null;

update public.users set free_period_started_at = now() where free_period_started_at is null;

alter table public.users
  alter column free_period_started_at set default now(),
  alter column free_period_started_at set not null;

create unique index users_stripe_customer_id_key on public.users (stripe_customer_id)
  where stripe_customer_id is not null;

create index idx_users_tier on public.users (subscription_tier);

-- ---------------------------------------------------------------------------
-- 3) start_session — atomic free-tier gate + session creation.
--    SECURITY INVOKER: auth.uid() is the caller, RLS applies to both the
--    `users` UPDATE and the `sessions` INSERT below (no service-role bypass).
-- ---------------------------------------------------------------------------

create or replace function public.start_session(
  p_page_domain text,
  p_mode text,
  p_free_limit int
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

  -- `users.id` must be qualified: RETURNS TABLE(id uuid, ...) makes `id` an
  -- implicit out-parameter in scope for this whole function body, which
  -- collides with the bare column name and raises "ambiguous column
  -- reference" otherwise.
  select subscription_tier, free_period_started_at
    into v_tier, v_period_started
    from public.users
   where users.id = v_uid
     and deleted_at is null;

  if v_tier is null then
    raise exception 'start_session: user % not found', v_uid;
  end if;

  -- Lazy 30-day rolling reset, applied before the quota check. The daily
  -- reconciliation cron (PLAN.md §2.8) is deferred to the billing sprint;
  -- this lazy check is correct on its own.
  if v_period_started < now() - interval '30 days' then
    update public.users
       set free_session_count = 0,
           free_period_started_at = now()
     where users.id = v_uid;
  end if;

  -- Atomic gate (PLAN.md §2.3 query 3): increment-and-check in one statement
  -- so concurrent starts cannot both slip under the limit. The `tier = 'free'`
  -- predicate makes this a no-op for pro users -- treated below as
  -- "not degraded, unlimited".
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
    -- v_count is null when the gate above did not match (over limit);
    -- greatest(null - n, 0) collapses to 0, which is correct: over limit
    -- means zero sessions remain in the period.
    v_remaining := greatest(p_free_limit - v_count, 0);
  else
    v_remaining := null;
  end if;

  insert into public.sessions (user_id, page_domain, mode, counts_against_free)
  values (v_uid, p_page_domain, p_mode, v_counts_against_free)
  returning sessions.id, sessions.started_at, sessions.mode
    into v_session_id, v_started_at, v_mode;

  return query
    select v_session_id, v_started_at, v_mode, v_counts_against_free, v_degraded, v_remaining;
end;
$$;

grant execute on function public.start_session(text, text, int) to authenticated;

-- ---------------------------------------------------------------------------
-- 4) end_session — ends only the caller's own open session.
--    SECURITY INVOKER + the user_id = auth.uid() predicate both guarantee a
--    caller can only end their own in-progress session; a non-match returns
--    zero rows (the route maps that to 404/409).
-- ---------------------------------------------------------------------------

create or replace function public.end_session(p_session_id uuid)
returns setof public.sessions
language plpgsql
security invoker
as $$
begin
  return query
    update public.sessions
       set ended_at = now()
     where id = p_session_id
       and user_id = auth.uid()
       and ended_at is null
       and deleted_at is null
    returning *;
end;
$$;

grant execute on function public.end_session(uuid) to authenticated;
