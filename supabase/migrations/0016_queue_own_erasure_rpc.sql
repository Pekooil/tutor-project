-- Sprint 16 / Task 8 (ADR-035): fixes POST /api/account/delete, which as
-- shipped in Task 5 could never actually queue an erasure for a real user.
-- `users_select_own`'s policy is `auth.uid() = id and deleted_at is null`;
-- Postgres additionally requires an UPDATE's new row to still satisfy the
-- table's SELECT policy unless the UPDATE policy's own WITH CHECK is
-- written to explicitly cover that transition. `users_update_own`'s WITH
-- CHECK is only `auth.uid() = id`, so the moment a client-side `.update()`
-- sets `deleted_at` non-null, the new row fails the implicit SELECT check
-- and Postgres raises `42501: new row violates row-level security policy`
-- -- reproduced directly via raw SQL with the JWT role impersonated, not a
-- PostgREST or supabase-js artifact.
--
-- This is the same class of problem `start_session` (0003) and `cost_guard`
-- (0013) already solve the same way: a client-facing write that RLS
-- structurally cannot complete gets a narrowly-scoped RPC instead of a raw
-- table write. `queue_own_erasure` is SECURITY DEFINER (it must bypass the
-- SELECT-policy interaction above), but scoped hard to `auth.uid()` --
-- there is no `p_user_id` parameter, so it can only ever act on the
-- caller's own row, the same guarantee the RLS policy was providing before
-- it got in its own way.

-- No RETURNS TABLE: the route only checks for an error, never reads a
-- value back, and naming OUT parameters after the columns being touched
-- (erasure_requested_at/deleted_at) makes every reference inside the
-- function body ambiguous between the OUT parameter and the column
-- (PL/pgSQL error 42702) -- returning void sidesteps that entirely rather
-- than qualifying every reference to work around it.
create or replace function public.queue_own_erasure()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'queue_own_erasure: no authenticated user';
  end if;

  -- Idempotent by construction: `deleted_at is null` means a second call
  -- matches zero rows (no error) rather than re-stamping already-set
  -- timestamps.
  update public.users
     set erasure_requested_at = now(),
         deleted_at = now()
   where users.id = v_uid
     and users.deleted_at is null;
end;
$$;

-- SECURITY DEFINER functions default to a PUBLIC execute grant (see 0013's
-- cost_guard comment for why this matters); revoke from anon explicitly --
-- Supabase's `alter default privileges` grants `anon` independently of the
-- PUBLIC pseudo-role, so revoking from PUBLIC alone is not sufficient.
revoke all on function public.queue_own_erasure() from public;
revoke execute on function public.queue_own_erasure() from anon;
grant execute on function public.queue_own_erasure() to authenticated;
