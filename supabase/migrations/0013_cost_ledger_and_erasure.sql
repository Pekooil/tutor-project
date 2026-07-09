-- Sprint 16 / Task 2 (ADR-041, ADR-035): the global cost ledger + guard RPC,
-- and the erasure queue marker on `users`. Additive only -- 0001 through 0012
-- are not touched, and this migration must re-run cleanly on a fresh
-- `supabase db reset` (0001 -> ... -> 0012 -> 0013).
--
-- Signature note (deviates from the sprint-16-plan.md draft, deliberately):
-- the plan's Task 2 annotation sketches `cost_guard(p_estimated_cents int)`
-- with the soft/hard caps as constants baked into the function body. Instead
-- this migration takes the caps as parameters
-- (`p_soft_cap_cents`/`p_hard_cap_cents`), mirroring `start_session`'s
-- existing `p_free_limit` pattern (0003): the caller (Task 3's
-- `web/lib/tier/cost-guard.ts`, reading `web/lib/tier/cost-model.ts`'s
-- `SOFT_CAP_CENTS`/`HARD_CAP_CENTS`) stays the single tunable source of
-- truth, and a cap retune (explicitly called out in sprint-16-plan.md's Risks
-- section as a "one-line tune", and driven low on purpose for Task 9's manual
-- acceptance pass) never requires a new migration. The RPC itself stays a
-- generic, reusable atomic gate with no opinion on the cap values.

-- ---------------------------------------------------------------------------
-- 1) cost_ledger -- one row per UTC day, no user_id. The global aggregate
--    spend ceiling sits above the per-user free-tier gate (`start_session`,
--    0003); this table is what that aggregate ceiling reads and writes.
--
--    RLS is enabled with ZERO policies (Shape 3, see
--    /supabase/policies/README.md): deny-all to every client key, anon and
--    authenticated alike. `cost_guard` below (SECURITY DEFINER) is the ONLY
--    writer -- there is no client insert/update/delete path, and no reason
--    for any client to read it directly (routes only ever see the RPC's
--    returned `soft_exceeded`/`hard_exceeded`/`spent_cents`, never the raw
--    ledger row).
-- ---------------------------------------------------------------------------

create table public.cost_ledger (
  day date primary key,
  spent_cents int not null default 0
);

alter table public.cost_ledger enable row level security;
-- No policies -- see Shape 3 in /supabase/policies/README.md. Deny-all to
-- anon/authenticated; only `cost_guard` (SECURITY DEFINER) writes this table.

-- ---------------------------------------------------------------------------
-- 2) cost_guard -- atomic add-and-check against today's ledger row.
--    SECURITY DEFINER (not INVOKER, unlike `start_session`): `cost_ledger` is
--    global and deny-all under RLS, so a normal authenticated-role call would
--    be blocked from writing it entirely. This function runs with the
--    owner's elevated privileges to write the deny-all table, while the
--    `grant execute ... to authenticated` below still requires the caller to
--    hold a valid session -- exactly the shape ADR-041 records. `search_path`
--    is pinned (mirroring `handle_new_user`, 0001) so a hijacked search path
--    can't redirect `cost_ledger` to an attacker-controlled table.
--
--    The UTC day key is computed explicitly via `at time zone 'utc'` rather
--    than bare `current_date`, so the ledger's daily boundary does not drift
--    with the database session's configured timezone.
--
--    `insert ... on conflict (day) do update ... returning` is atomic at the
--    row level (Postgres serializes concurrent writers via the primary key's
--    unique index/row lock) -- concurrent calls cannot both slip under a cap,
--    the same guarantee `start_session`'s atomic `update ... returning` gives
--    the per-user gate.
-- ---------------------------------------------------------------------------

create or replace function public.cost_guard(
  p_estimated_cents int,
  p_soft_cap_cents int,
  p_hard_cap_cents int
)
returns table (
  soft_exceeded boolean,
  hard_exceeded boolean,
  spent_cents int
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_day date;
  v_spent int;
begin
  v_day := (now() at time zone 'utc')::date;

  insert into public.cost_ledger (day, spent_cents)
  values (v_day, p_estimated_cents)
  on conflict (day) do update
    set spent_cents = cost_ledger.spent_cents + excluded.spent_cents
  returning cost_ledger.spent_cents into v_spent;

  return query
    select (v_spent >= p_soft_cap_cents), (v_spent >= p_hard_cap_cents), v_spent;
end;
$$;

-- `create function` grants EXECUTE to PUBLIC by default -- since this
-- function is SECURITY DEFINER (it must bypass `cost_ledger`'s deny-all RLS
-- to write it), an un-revoked PUBLIC grant would let an unauthenticated
-- `anon` caller invoke it directly via /rest/v1/rpc/cost_guard and drive the
-- global ledger to the hard cap, DoS-ing every real user without signing in.
-- `start_session` doesn't need this revoke (SECURITY INVOKER, so RLS still
-- gates it); any SECURITY DEFINER function does. Revoke-then-grant, so the
-- final state is authenticated-only regardless of statement order.
--
-- `revoke ... from public` alone is NOT sufficient on Supabase: the project
-- applies `alter default privileges in schema public grant execute on
-- functions to anon, authenticated, service_role` automatically at
-- function-creation time -- a grant to `anon` independent of the PUBLIC
-- pseudo-role, unaffected by revoking from PUBLIC. Confirmed live via
-- `has_function_privilege('anon', ..., 'EXECUTE')` still returning true
-- after a PUBLIC-only revoke. `anon` must be revoked by name explicitly.
revoke all on function public.cost_guard(int, int, int) from public;
revoke execute on function public.cost_guard(int, int, int) from anon;
grant execute on function public.cost_guard(int, int, int) to authenticated;

-- ---------------------------------------------------------------------------
-- 3) users.erasure_requested_at -- the deletion queue marker (ADR-035).
--    Phase 1 (POST /api/account/delete, Task 5) sets this alongside the
--    existing `deleted_at` (which stays the soft-delete/logical-erasure
--    flag, unchanged in meaning). Phase 2 (the hard-delete-sweep cron, Task
--    6) queries this column to find rows past the grace window and execute
--    the real cascade. Nullable, no default -- absent means "no erasure
--    requested", the overwhelmingly common case.
--
--    The partial index supports the sweep's query shape exactly
--    (`where erasure_requested_at is not null and ... < cutoff`) without
--    indexing the (large, irrelevant) common case of untouched accounts --
--    the same reasoning as `waitlist_email_key`'s uniqueness scope and
--    0003's `users_stripe_customer_id_key` partial index.
-- ---------------------------------------------------------------------------

alter table public.users
  add column erasure_requested_at timestamptz null;

create index idx_users_erasure_requested on public.users (erasure_requested_at)
  where erasure_requested_at is not null;

-- users' existing RLS (Shape 1, 0001) already covers this new column --
-- select/update policies are column-agnostic. No client update policy
-- allows a user to set THEIR OWN erasure_requested_at directly today: Task
-- 5's POST /api/account/delete route performs that update, still under the
-- caller's own RLS-scoped session (auth.uid() = id), which the existing
-- users_update_own policy already permits (self-update, no new policy
-- needed).
