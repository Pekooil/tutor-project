# RLS policy reference

Canonical RLS policy SQL for every Calyxa table. Per ADR-005, Supabase
migrations own both schema and RLS: every `CREATE TABLE` enables RLS and
creates its policies **in the same migration**, never as a follow-up. There
is never a window in which a table exists without RLS. Copy the matching
shape below verbatim into the migration that creates each new table.

## Shape 1 — `users` (keyed on `id`)

Used only by `users` itself, since its primary key already equals
`auth.uid()` — there is no separate `user_id` column on this table.

```sql
alter table public.<table> enable row level security;

create policy <table>_select_own on public.<table>
  for select using (auth.uid() = id and deleted_at is null);

create policy <table>_update_own on public.<table>
  for update using (auth.uid() = id and deleted_at is null)
             with check (auth.uid() = id);
```

No client insert policy: the row is created only by the `handle_new_user()`
trigger (`SECURITY DEFINER`). No client delete policy: erasure is a later
service-role path.

## Shape 2 — every other user-scoped table (keyed on `user_id`)

The canonical shape for `sessions` and every later domain table
(`knowledge_nodes`, `misconceptions`, `reinforcement_schedule`,
`session_interactions`, ...).

```sql
alter table public.<table> enable row level security;

create policy <table>_select_own on public.<table>
  for select using (auth.uid() = user_id and deleted_at is null);

create policy <table>_modify_own on public.<table>
  for all using (auth.uid() = user_id and deleted_at is null)
            with check (auth.uid() = user_id);
```

## Rules

- RLS is enabled and every policy above is created inside the same migration
  that runs `CREATE TABLE` — never added later.
- Soft-deleted rows (`deleted_at is not null`) are invisible through these
  policies to ordinary clients; only a service-role/admin path may read them.
- No table gets a client-facing `insert` or `delete` policy unless a sprint
  explicitly designs one. Default posture is read/update-your-own-row only.
- RLS assertions in `/supabase/tests/rls.test.ts` (or `/web/tests/rls.test.ts`)
  must use the request-scoped (anon/JWT) client, never the service role — the
  service role bypasses RLS and would invalidate the test.

## Tables covered so far

| Table | Shape | Migration |
|---|---|---|
| `users` | 1 (`id`) | `0001_init_users.sql` |
| `sessions` | 2 (`user_id`) | `0002_sessions.sql` |
| `knowledge_nodes` | 2 (`user_id`) | `0004_knowledge_graph.sql` |
| `misconceptions` | 2 (`user_id`) | `0004_knowledge_graph.sql` |

## Additive columns (no policy change)

- `misconceptions.embedding` (`0005_misconception_embeddings.sql`, ADR-017)
  — a nullable `vector(1024)` column added to an existing Shape 2 table.
  Additive columns inherit the table's existing policies above; no new
  policy is needed.
