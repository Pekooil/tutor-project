-- Sprint 09 / Task 6: the Postgres-side half of fuzzy misconception
-- matching (ADR-017) -- a SECURITY INVOKER RPC (matching the
-- start_session/end_session pattern, 0003_sessions_freemium.sql) that runs
-- pg_trgm's similarity() server-side, owner-scoped via auth.uid(), so
-- apply.ts can call it through supabase-js's .rpc() (PostgREST does not
-- expose pg_trgm's similarity() as a filterable operator). Backs the
-- idx_misc_desc_trgm GIN index added in 0005_misconception_embeddings.sql.
--
-- Mirrors the existing exact-category match's lack of a `status` filter
-- (Sprint 08 `applyMisconception`): a resolved row can still be matched
-- (and its occurrence_count bumped) -- reactivating a resolved
-- misconception on a fuzzy-matched recurrence is unspecified/deferred,
-- same as it already is for an exact-category recurrence.

create or replace function public.match_misconception_trigram(
  p_concept_key text,
  p_description text,
  p_threshold real default 0.6
)
returns table (id uuid, status text, occurrence_count int)
language sql
security invoker
stable
as $$
  select id, status, occurrence_count
  from public.misconceptions
  where user_id = auth.uid()
    and concept_key = p_concept_key
    and deleted_at is null
    and description is not null
    and similarity(description, p_description) > p_threshold
  order by similarity(description, p_description) desc
  limit 1;
$$;

grant execute on function public.match_misconception_trigram(text, text, real) to authenticated;
