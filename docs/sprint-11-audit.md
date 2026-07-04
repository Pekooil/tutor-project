# Sprint 11 audit — plan vs. committed changes, architecture review, Sprint 12 readiness

Audited 2026-07-03 against `docs/sprint-11-plan.md` and commits `846ab63..c4986e7`
(Task 1 planning → Task 9 acceptance fixes). Full pipeline re-verified during the audit:
`turbo run typecheck lint build test` green across workspaces (the one red run was a stale
`next dev` on port 3000 blocking the test-spawned dev servers — environmental, not code).

## Verdict

Sprint 11 delivered everything the plan promised, at the plan's own quality bar, with a
commit per task. All nine tasks landed; the loop closes per turn (envelope → per-turn write
→ per-interaction FSRS with all three lucky-guess guards → scheduler → topic/due-biased
read). Two architectural gaps were found in the audit and fixed in-tree (below); the rest
of the findings are recorded here for Sprint 12 planning rather than churned now.

## Plan deviations found (all justified, all already documented in-code)

1. **Migrations 0009–0011 beyond the planned 0007/0008.** All three are fix-forwards for
   real gaps in PLAN §2.3's original schema, each with the rationale in the migration
   header: `reasoning_quality` (0009 — without it, per-interaction apply would have
   *regressed* the Sprint 09 reasoning guard, not just left the latency guard off),
   `misconception_description` (0010 — without it pg_trgm fuzzy matching could never fire
   per-turn), `claimed_at` (0011 — the after()-vs-reconcile double-apply race; a single
   boolean cannot distinguish "started" from "landed"). Correct calls, correctly recorded.
2. **`packages/learning-model` touched despite being listed out of scope.** The plan
   contradicted itself: it required the third lucky-guess sub-guard restored (a stated
   sprint goal, ADR-019) while listing the package that owns that guard as untouched.
   The implementation resolved the contradiction the only coherent way — `responseLatencyMs`
   added as an *optional* observation field, guard fires only when supplied, all other
   behaviour byte-identical. The §2.4 math is otherwise unchanged.
3. **`extension/src/content/pageExtractor.ts` touched (out of scope list).** A Task 9
   acceptance find: KaTeX `html`-only output (Khan Academy) yielded an empty PageContext on
   pages with real math. The `extractKatexTextFallback` adapter is generic, additive, and
   documented as a weaker-signal fallback. Justified fix-forward.
4. **The `claimed_at` lease is an improvement over the plan.** The plan's single
   `applied_to_profile` flag was insufficient (double-apply race confirmed during Task 5
   verification); the lease/heartbeat pattern that shipped is the right shape.

## Audit fixes applied (uncommitted, in working tree)

1. **Turn-route critical-path latency** (`web/app/api/ai/turn/route.ts`): the ownership
   check → turn-index count → insert chain ran as three *sequential* DB round-trips awaited
   before the voice reply returned, where the plan budgeted "a single indexed insert" of
   synchronous work. The two reads are independent and now run in parallel (`Promise.all`)
   — one round-trip of wall-clock saved on every gradable voice turn, no behaviour change.
2. **Stranded interactions from abandoned sessions** (`web/lib/learning/apply.ts`,
   `web/app/api/session/start/route.ts`): `reconcileSession` only runs when
   `/api/session/end` is *reached*. A crashed browser / closed tab / lost network strands
   that session's `applied_to_profile=false` rows forever — persisted but never folded into
   `knowledge_nodes` or the reinforcement queue, silently invisible to the tutor and the
   coming dashboard. Added `reconcileUnappliedForUser` (bounded sweep, ordered by
   `created_at`, served by the existing `idx_si_user_applied` index) called from
   `/api/session/start` off the critical path (`after()`). Safe by construction: the new
   session's rows don't exist yet, and the `claimed_at` lease already arbitrates against
   any in-flight apply. Integration-tested in `session.test.ts` ("abandoned session's
   stranded rows are swept at the next session START").

## Findings recorded, deliberately NOT changed now

- **`turn_index` has no uniqueness guarantee** (count+1 then insert). Two concurrent turns
  in one session — or a client retry — can duplicate an index. Today the extension's
  background worker serialises turns, so this is theoretical; but Sprint 12's session
  timeline UX should treat `(session_id, turn_index)` as *display order*, not identity —
  key React lists on `id`. If a stronger guarantee is ever needed, it's a unique index +
  insert-retry, one migration.
- **`assessment.confidence` (tutor's own grading confidence) and `mode` are parsed but not
  persisted.** PLAN §2.3's row shape never included them, so no column exists. If Sprint 12's
  session-review UX wants "how sure was the tutor" or "socratic vs direct" per turn, that is
  one additive migration + two insert fields — decide in Sprint 12 planning, not silently here.
- **Soft-deleted `reinforcement_schedule` rows block re-scheduling** (upsert hits the unique
  key; the RLS `USING deleted_at is null` clause blocks the update). Only reachable after a
  §2.7 erasure sweep, i.e. an account that no longer practices. Harmless today; note it if
  erasure semantics ever change to "wipe but keep the account."
- **`persistInteraction`'s skip-diagnostics log the first 120 chars of `say`** to server
  logs. The tutor's reply is already persisted in `session_interactions`, so this leaks no
  *new* class of data, but a privacy-sprint pass over server-side logging should include it.
- **Topic alias table (`topic.ts`) covers all 8 current curriculum concepts** but is a
  hand-maintained parallel structure — adding a concept to `@calyxa/curriculum` without an
  alias entry silently exempts it from topic bias (the drift guard only prevents *unknown*
  keys leaking out, not missing coverage). Consider a curriculum-owned `aliases` field when
  the concept graph next grows.
- **Sprint-11 plan checklist boxes remain unticked** while the status line says Tasks 1–9
  landed; the extension-in-browser half of Task 9 (overlay UX / voice loop on a real page)
  still awaits the human pass, per the status line. Tick the boxes when that pass completes.

## Sprint 12 readiness (frontend UX for the adaptive data)

Everything Sprint 12 needs to *read* exists, is RLS-guarded, and has a proven query shape:

| Sprint 12 need | Where it already is |
| --- | --- |
| Mastery per concept (decay-adjusted) | `knowledge_nodes` + `retrievability()` from `@calyxa/learning-model` — the exact read is modelled in `web/lib/learning/profile-read.ts` |
| Due/review queue | `reinforcement_schedule`, PLAN §2.3 query 2 (`priority DESC, due_at ASC`) — modelled in `loadProfile`'s due leg |
| Session history / per-turn timeline | `sessions` + `session_interactions` (text-only transcript, outcome, latency per turn) |
| Misconceptions view | `misconceptions` (status/occurrence/streak already maintained per turn) |
| Auth'd server-side reads from `(dashboard)` pages | `web/lib/supabase/server.ts` cookie client — already used by `(dashboard)/account` |
| Layout shell to extend | `web/app/(dashboard)/layout.tsx` — the nav slot is intentionally empty for this sprint |
| Envelope for the (later) annotation layer | `annotations` already validated + carried on every turn |

Gaps Sprint 12's plan should own (not pre-empted here):
1. **Concept display names.** `Concept` in `@calyxa/curriculum` has `key`, `strand`,
   `prerequisites`, `difficultyPrior` — no human-readable `title`. The dashboard cannot show
   `algebra.quadratics.factoring` raw. Add `title` (and probably a strand label) in the
   curriculum package as Sprint 12's first task — data-only, additive.
2. **Chart colors as named `@calyxa/ui` tokens** (already flagged by Sprint 11's plan).
3. **Decide whether the timeline UX wants `mode`/`confidence` persisted** (see above) —
   if yes, the migration belongs in Sprint 12's schema task.
4. **Freshness semantics**: dashboard reads are eventually consistent with the last turn's
   `after()` apply (seconds). Server-render fresh per request; no cache layer needed at
   this scale — but don't add one that would mask the reconcile sweep either.
