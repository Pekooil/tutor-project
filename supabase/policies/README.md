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

## Shape 3 — anonymous-write, deny-all tables

Used for tables written by unauthenticated visitors (no `auth.uid()` to scope
a policy to) that no client key should ever be able to read or write at all —
only a service-role server route may touch them.

```sql
alter table public.<table> enable row level security;
-- No policies: RLS enabled with zero policies denies all client access
-- (anon and authenticated alike). Only the service-role client, which
-- bypasses RLS entirely, may read or write.
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
| `session_interactions` | 2 (`user_id`) | `0007_session_interactions.sql` |
| `reinforcement_schedule` | 2 (`user_id`) | `0008_reinforcement_schedule.sql` |
| `waitlist` | 3 (deny-all) | `0012_waitlist.sql` |
| `cost_ledger` | 3 (deny-all) | `0013_cost_ledger_and_erasure.sql` |
| `feedback` | 2 (`user_id`)* | `0017_feedback_and_telemetry.sql` |
| `telemetry_event` | 2 (`user_id`), insert-only** | `0017_feedback_and_telemetry.sql` |

\* `feedback` follows Shape 2 but has **no `deleted_at` column**, so its
policies omit the `deleted_at is null` clause — it is write-once capture with
no soft-delete concept (ADR-039). Erasure is the `user_id` FK cascade, not a
soft-delete flag.

\** `telemetry_event` is Shape 2 keyed on `user_id` but **insert-only from the
owner** (ADR-043): a single `for insert with check (auth.uid() = user_id)`
policy and **no select/update/delete policy**, so clients write their own
events but can never read them back. Analysis reads are service-role only.
The insert `with check` also structurally enforces "`user_id` from the
session, never from the body" — a client can only ever write a row attributed
to itself.

## Additive columns (no policy change)

- `misconceptions.embedding` (`0005_misconception_embeddings.sql`, ADR-017)
  — a nullable `vector(1024)` column added to an existing Shape 2 table.
  Additive columns inherit the table's existing policies above; no new
  policy is needed.
- `session_interactions.reasoning_quality` (`0009_session_interactions_reasoning_quality.sql`,
  ADR-019) — a `not null default 'none'` text column added to fill a gap in
  the original `0007` table (PLAN §2.3's schema predates ADR-016's FSRS
  lucky-guess guards). Additive; inherits the table's existing policies.
- `session_interactions.misconception_description` (`0010_session_interactions_misconception_description.sql`,
  ADR-019) — a nullable text column added to fill a second gap in `0007`
  (PLAN §2.3's/§2.5's schemas predate ADR-017's pg_trgm fuzzy matching,
  which needs a description to match against). Additive; inherits the
  table's existing policies.
- `session_interactions.claimed_at` (`0011_session_interactions_claimed_at.sql`,
  ADR-019) — a nullable timestamptz marking when the off-critical-path
  apply started, kept separate from `applied_to_profile` (which now means
  "actually finished") so the reconcile sweep can tell "in progress" apart
  from "never started / crashed mid-work." Additive; inherits the table's
  existing policies.
- `users.erasure_requested_at` (`0013_cost_ledger_and_erasure.sql`, ADR-035)
  — a nullable timestamptz marking the caller's own deletion request (Phase
  1 of the two-phase erasure flow), kept separate from `deleted_at` (which
  stays the immediate soft-delete/logical-erasure flag). The hard-delete
  sweep (Sprint 16 Task 6) queries it directly with the service-role client;
  the existing Shape 1 `users_update_own` policy already lets a caller set
  their own value (self-update, column-agnostic). Additive; no new policy.
