-- ADR-055: persist the tutor's per-turn annotations so a completed session can
-- be replayed as a text-based "worked-problem snapshot" (the brief's Session
-- Screenshots, realized without pixels). Today the `annotations` array the
-- model emits every turn (ENVELOPE_TOOL / SESSION_START_TOOL, web/lib/ai/
-- claude.ts) is returned to the extension, drawn live in the overlay's
-- AnnotationLayer, and then DISCARDED. This column keeps it.
--
-- One nullable `jsonb` column, not a new table: annotations have no life
-- independent of the turn that produced them, so they belong on the interaction
-- row. Each element is the validated envelope shape { id, type, target: { kind,
-- text }, style: { color }, label, note?, step? } (parseEnvelope's output);
-- `target.text` is a short problem span the tutor copied verbatim from the page
-- context. NULL on turns with no annotations (the common case), so every
-- existing insert stays byte-identical until turn-complete.ts fills it in.
--
-- Additive only -- 0001..0026 are not touched, and this migration re-runs
-- cleanly on a fresh `supabase db reset` (0001 -> ... -> 0026 -> 0027). RLS is
-- already enabled on session_interactions (0007); an additive column inherits
-- the table's existing select/modify-own policies -- NO policy change. Erasure
-- is the table's existing `user_id` FK cascade (0015); the GDPR export already
-- `select('*')`s session_interactions, so this column is exported automatically
-- -- NO export-list or erasure-sweep change (ADR-055: the column rides every
-- session_interactions invariant for free, the whole reason it is a column and
-- not a new table).

alter table public.session_interactions
  add column annotations jsonb null;
