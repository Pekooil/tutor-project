-- Sprint 19 / Task 4 (ADR-045): the waitlist gains invite state so the
-- Sprint 20 capture-only table can drive the beta invite pipeline.
--
-- Renumbered from the plan's provisional 0018 to 0019: 0018 was taken by
-- 0018_rate_limit.sql (the Sprint 18 public-endpoint rate-limiting follow-up)
-- before this landed. Additive only (0001 → … → 0018 → 0019); re-runs cleanly
-- on `supabase db reset` (every statement is IF [NOT] EXISTS / idempotent).
--
-- SHAPE UNCHANGED — this is the load-bearing invariant (ADR-045):
--   * waitlist stays Shape 3 (deny-all / service-role-only, see 0012 +
--     /supabase/policies/README.md). This migration adds NO policy and does
--     NOT re-touch RLS, so no client key (anon or authenticated) can read or
--     write these columns any more than the existing ones — only the
--     service-role admin path (POST /api/admin/invite, Task 5) writes them,
--     and the signup allowlist check reads them via the service-role client.
--   * NO foreign key to users. A waitlist row is an ANONYMOUS pre-signup email,
--     not a user — so the Sprint 16 rule ("every new USER-SCOPED table
--     FK-cascades to users + joins the export route") deliberately does NOT
--     apply here. These columns carry no user identity and stay off the
--     export/erasure paths by design (re-affirmed in ADR-045/046).
--
-- Columns:
--   invited_at  — when this email's cohort was invited (null = not yet invited)
--   invite_code — the single-use code handed out with the store link; unique
--                 where present, so a code maps to at most one waitlist row
--   cohort      — a free-text batch label for cohort selection/reporting

alter table public.waitlist
  add column if not exists invited_at timestamptz null,
  add column if not exists invite_code text null,
  add column if not exists cohort text null;

-- Uniqueness only where a code is actually set (a partial unique index):
-- every un-invited row has invite_code = null, and null is excluded, so the
-- many nulls never collide — while any two real codes must differ. This is
-- what lets the claim path resolve a code to exactly one row.
create unique index if not exists waitlist_invite_code_key
  on public.waitlist (invite_code)
  where invite_code is not null;

-- (No `enable row level security` here — waitlist already enabled it in 0012
-- and this migration does not change that. RLS stays deny-all with zero
-- policies; the new columns inherit that posture automatically.)
