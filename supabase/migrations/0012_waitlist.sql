-- Sprint 20 / Task 2 (ADR-031): the marketing landing page's waitlist.
--
-- Unlike every table so far (Shape 1/2, keyed on a signed-in auth.uid()),
-- waitlist rows come from anonymous visitors with no Supabase session at
-- all -- there is no auth.uid() to scope a policy to, and no legitimate
-- reason for ANY client key (anon or authenticated) to ever read this table.
-- So RLS is enabled with ZERO policies (Shape 3, see
-- /supabase/policies/README.md): a deny-all posture rather than a scoped
-- one. Only POST /api/waitlist, using the service-role client, can write.
-- Per the project rule (ADR-005), RLS is enabled in the SAME migration that
-- creates the table -- there is no window where it exists unprotected.

create table public.waitlist (
  id uuid primary key default gen_random_uuid(),
  email citext not null,
  source text null,
  created_at timestamptz not null default now()
);

-- Case-insensitive uniqueness comes from the citext column type itself
-- (citext already enabled by 0001_init_users.sql); this index is what
-- makes a repeat signup an idempotent no-op (ON CONFLICT DO NOTHING in the
-- route) rather than a duplicate row.
create unique index waitlist_email_key on public.waitlist (email);

alter table public.waitlist enable row level security;
-- No policies -- see Shape 3 in /supabase/policies/README.md. Deny-all to
-- anon/authenticated; the service-role client bypasses RLS entirely.
