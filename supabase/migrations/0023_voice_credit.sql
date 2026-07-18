-- Public-launch voice credit (2026-07-18): a PER-USER monthly voice budget for
-- the free tier, under the existing GLOBAL daily ledger (cost_ledger, 0013).
-- Launch requirement: a free user's premium-voice spend (Whisper STT +
-- ElevenLabs TTS) is capped at 50 cents per month; past the cap the voice legs
-- degrade to text + browser SpeechSynthesis exactly like the global soft cap
-- (ADR-041 Decision 2) — tutoring itself is never blocked by this guard, and
-- any non-'free' tier is unmetered (mirrors start_session's tier exemption,
-- 0003). The cap VALUE is a caller parameter (web/lib/tier/cost-model.ts's
-- VOICE_CREDIT_CAP_CENTS), same pattern as cost_guard's p_soft/hard_cap_cents:
-- a retune is a one-line web diff, never a migration.
--
-- Additive only — 0001 through 0022 untouched; re-runs cleanly on
-- `supabase db reset` (0001 -> ... -> 0022 -> 0023).

-- ---------------------------------------------------------------------------
-- 1) voice_spend — one row per (user, UTC calendar month). Unlike cost_ledger
--    (global, no user_id, deny-all Shape 3), this IS user-keyed personal data,
--    so it follows the Sprint 16 invariant for user-scoped tables (ADR-035):
--    an owner SELECT policy (joins the /api/account/export RLS-scoped set) and
--    FK-cascade to users (erasure sweep covers it for free). No client
--    INSERT/UPDATE/DELETE policy exists — voice_credit_guard below (SECURITY
--    DEFINER) is the only writer, so a tampered client cannot reset or inflate
--    its own ledger.
--
--    The month key is the first day of the UTC calendar month — deliberately
--    calendar-month, not the free-session gate's rolling 30-day window
--    (users.free_period_started_at): the voice budget is a spend ceiling, not
--    a quota UX, and a fixed UTC boundary keeps the ledger key derivable
--    inside the RPC with no per-user state read. Documented asymmetry, not an
--    oversight.
-- ---------------------------------------------------------------------------

create table public.voice_spend (
  user_id uuid not null references public.users (id) on delete cascade,
  month date not null,
  cents int not null default 0,
  primary key (user_id, month)
);

alter table public.voice_spend enable row level security;

-- Owner SELECT only (export + a future "voice credit remaining" display);
-- writes go exclusively through the SECURITY DEFINER guard below.
create policy voice_spend_select_own
  on public.voice_spend
  for select
  to authenticated
  using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- 2) voice_credit_guard — atomic add-and-check against the caller's own
--    month row, cost_guard's exact shape (0013): SECURITY DEFINER because the
--    table has no client write path; search_path pinned; add-then-check so
--    concurrent calls cannot both slip under the cap (the row lock serializes
--    them). Budget-accurate, not invoice-accurate, same bar as cost_guard:
--    the crossing call's estimate is recorded even though the route then
--    degrades it, and a call the GLOBAL guard degrades still records here —
--    bounded overcount in the refuse direction, never an undercount that
--    leaks spend.
--
--    Non-'free' tiers return (false, 0) WITHOUT touching the ledger: Pro
--    voice is unmetered per-user (the global cost_ledger still sees it via
--    the routes' existing cost_guard call).
-- ---------------------------------------------------------------------------

create or replace function public.voice_credit_guard(
  p_estimated_cents int,
  p_cap_cents int
)
returns table (
  exceeded boolean,
  spent_cents int
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid;
  v_tier text;
  v_month date;
  v_spent int;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'voice_credit_guard: no authenticated user';
  end if;

  select subscription_tier
    into v_tier
    from public.users
   where users.id = v_uid
     and deleted_at is null;

  if v_tier is null then
    raise exception 'voice_credit_guard: user % not found', v_uid;
  end if;

  if v_tier <> 'free' then
    return query select false, 0;
    return;
  end if;

  -- Explicit UTC so the month boundary never drifts with the DB session's
  -- timezone (cost_guard's day-key discipline).
  v_month := date_trunc('month', now() at time zone 'utc')::date;

  insert into public.voice_spend (user_id, month, cents)
  values (v_uid, v_month, p_estimated_cents)
  on conflict (user_id, month) do update
    set cents = voice_spend.cents + excluded.cents
  returning voice_spend.cents into v_spent;

  return query
    select (v_spent >= p_cap_cents), v_spent;
end;
$$;

-- SECURITY DEFINER hygiene (cost_guard's hard-learned lesson, 0013): the
-- default PUBLIC execute grant AND Supabase's default-privileges grant to
-- `anon` must both be revoked by name, or an unauthenticated caller could
-- drive a ledger write path. auth.uid() is null for anon so the function
-- would raise anyway — the revoke makes the boundary structural, not
-- incidental. Revoke-then-grant so the final state is authenticated-only
-- regardless of statement order.
revoke execute on function public.voice_credit_guard(int, int) from public;
revoke execute on function public.voice_credit_guard(int, int) from anon;
grant execute on function public.voice_credit_guard(int, int) to authenticated;
