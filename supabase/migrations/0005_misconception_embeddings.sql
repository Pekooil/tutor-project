-- Sprint 09 / Task 5: lands the fuzzy-misconception-matching infra
-- (ADR-017) on the existing `misconceptions` table (0004). Additive only --
-- 0001/0002/0003/0004 are untouched, and this migration must re-run cleanly
-- on a fresh `supabase db reset` (0001 -> 0002 -> 0003 -> 0004 -> 0005).
--
-- `pg_trgm` is enabled and used immediately: the trigram GIN index below
-- backs the exact-category -> trigram-similarity misconception matcher
-- (`apply.ts`, Task 6). `pgvector` + the nullable `embedding` column land
-- as infra only -- no embedding provider is wired this sprint, so no value
-- is ever written to `embedding`, no cosine query is built, and no
-- `ivfflat` index is created (an ivfflat index over an all-null column is
-- pointless and needs a populated-data `lists` tuning pass once real
-- embeddings exist). Both the cosine query and the ivfflat index are
-- deferred to the embedding sprint (ADR-017).
--
-- RLS is already enabled on `misconceptions` (0004, canonical `user_id`
-- policy) -- an additive nullable column inherits the table's existing
-- policies; no policy change.

create extension if not exists pg_trgm;
create extension if not exists vector;

alter table public.misconceptions
  add column embedding vector(1024) null;

create index idx_misc_desc_trgm on public.misconceptions
  using gin (description gin_trgm_ops);
