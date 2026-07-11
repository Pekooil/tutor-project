-- Follow-up to the Sprint 18 security review (docs/security-review-sprint18.md
-- finding §7.1): request-rate limiting for the two intentionally-public,
-- unauthenticated endpoints (POST /api/errors, POST /api/waitlist). Backed by
-- Postgres (the store already in the stack), mirroring the cost_guard atomic-
-- counter pattern (migration 0013, ADR-041) rather than adding an external
-- Redis/Upstash dependency.
--
-- Additive only (0001 → … → 0017 → 0018); re-runs cleanly on `supabase db
-- reset`. Per ADR-005, RLS is enabled in THIS migration, immediately after the
-- CREATE TABLE — the table never exists without it.

-- ---------------------------------------------------------------------------
-- rate_limit — a fixed-window request counter. Shape 3 (deny-all): only the
-- service-role server routes touch it (via check_rate_limit below). One row
-- per (bucket, window); the RPC prunes a bucket's older windows on each call.
-- ---------------------------------------------------------------------------
create table public.rate_limit (
  bucket text not null,
  window_start timestamptz not null,
  count int not null default 0,
  primary key (bucket, window_start)
);

-- Serves the RPC's per-bucket prune (delete older windows for this bucket) and
-- a future periodic sweep of stale rows (see the security-review follow-up).
create index idx_rate_limit_window on public.rate_limit (window_start);

alter table public.rate_limit enable row level security;
-- No policies — Shape 3 (deny-all), /supabase/policies/README.md. Only the
-- service role (which bypasses RLS) reads or writes it, via the RPC below.

-- ---------------------------------------------------------------------------
-- check_rate_limit — atomically increment the caller's current-window counter
-- and return the new count. The route allows the request when count <= limit.
--
-- SECURITY INVOKER (unlike cost_guard's DEFINER): the ONLY caller is the
-- service-role server client, which bypasses RLS on its own — so no privilege
-- escalation is needed to write the deny-all table, and there is no
-- DEFINER-escalation surface to guard. search_path is still pinned. Execute is
-- revoked from every client role (anon/authenticated) so it can only be driven
-- server-side; even if a client reached it, INVOKER means it would run as that
-- client and RLS would deny the write anyway.
-- ---------------------------------------------------------------------------
create or replace function public.check_rate_limit(
  p_bucket text,
  p_window_seconds int
)
returns int
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_window_start timestamptz;
  v_count int;
begin
  -- Floor now() to the window boundary so every request in the same window
  -- shares one row (fixed-window counter).
  v_window_start := to_timestamp(
    floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds
  );

  insert into public.rate_limit (bucket, window_start, count)
  values (p_bucket, v_window_start, 1)
  on conflict (bucket, window_start) do update
    set count = rate_limit.count + 1
  returning rate_limit.count into v_count;

  -- Keep this bucket bounded: an active bucket stays at exactly one row.
  delete from public.rate_limit
  where bucket = p_bucket and window_start < v_window_start;

  return v_count;
end;
$$;

-- Server-only. Revoke from PUBLIC and (explicitly, per the cost_guard note in
-- 0013 — Supabase's default privileges grant anon/authenticated independently
-- of PUBLIC) from anon + authenticated. service_role keeps its default grant.
revoke all on function public.check_rate_limit(text, int) from public;
revoke execute on function public.check_rate_limit(text, int) from anon;
revoke execute on function public.check_rate_limit(text, int) from authenticated;
