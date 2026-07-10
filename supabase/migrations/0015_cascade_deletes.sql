-- Sprint 16 / Task 8 (ADR-035, ADR-036): adds the `on delete cascade` the
-- hard-delete-sweep cron (Task 6) has always assumed exists. ADR-035/036 and
-- 0013's own comments state the domain tables' FKs already cascade from
-- `users` -- checked directly against the live schema via `pg_constraint`
-- while writing this sprint's test gate, and every one of them is actually
-- `NO ACTION`, including `users.id -> auth.users.id`. As shipped,
-- `hard-delete-sweep`'s `auth.admin.deleteUser()` call would raise a real
-- foreign-key violation against any user with so much as one row in any
-- child table -- i.e. every real user -- making the sweep unable to ever
-- complete a deletion. This migration is the fix: drop and re-add each FK
-- with `on delete cascade`, no other schema change. Additive in effect
-- (0001-0014 untouched); re-runs clean on `supabase db reset`.
--
-- Postgres has no `ALTER ... ON DELETE`; a constraint's delete action can
-- only be changed by dropping and re-adding it under the SAME name (so
-- nothing else -- RLS policies, the app, other migrations -- needs to know
-- the name changed).

alter table public.users
  drop constraint users_id_fkey,
  add constraint users_id_fkey foreign key (id) references auth.users (id) on delete cascade;

alter table public.sessions
  drop constraint sessions_user_id_fkey,
  add constraint sessions_user_id_fkey foreign key (user_id) references public.users (id) on delete cascade;

alter table public.knowledge_nodes
  drop constraint knowledge_nodes_user_id_fkey,
  add constraint knowledge_nodes_user_id_fkey foreign key (user_id) references public.users (id) on delete cascade;

alter table public.misconceptions
  drop constraint misconceptions_user_id_fkey,
  add constraint misconceptions_user_id_fkey foreign key (user_id) references public.users (id) on delete cascade;

alter table public.reinforcement_schedule
  drop constraint reinforcement_schedule_user_id_fkey,
  add constraint reinforcement_schedule_user_id_fkey foreign key (user_id) references public.users (id) on delete cascade;

alter table public.session_interactions
  drop constraint session_interactions_session_id_fkey,
  add constraint session_interactions_session_id_fkey foreign key (session_id) references public.sessions (id) on delete cascade;

alter table public.session_interactions
  drop constraint session_interactions_user_id_fkey,
  add constraint session_interactions_user_id_fkey foreign key (user_id) references public.users (id) on delete cascade;
