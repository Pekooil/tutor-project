## ADR-054: A per-concept Personal Notebook, revised (not regenerated) after every session by a new forced-tool call, grounded in the session read, persisted in an upsert-keyed RLS table

**Status:** Proposed

**Context:** The dashboard IA redesign (2026-07-20, [[dashboard-ia-redesign]]) turns the
post-login web app from an analytics dashboard into a "second brain": the nav becomes
**Dashboard / Concepts / Sessions / Library**, and **every concept becomes its own
workspace**. The product brief names a **Personal Notebook** as the heart of that
workspace — *"automatically generated and updated after every tutoring session,"*
containing *"summaries, important reminders, tutor explanations."* Steps 1–5 and 7 of
the brief shipped in that pass (nav, Continue-Learning dashboard, concept detail,
feature absorption, adaptive review queue, the guided review flow that now writes FSRS
mastery + reschedules). **Step 6 — the notebook — was deliberately deferred** because
nothing backs it: no table, no generation, no UI. This ADR is Step 6.

The pieces it needs all exist and were verified against the code, not recalled:

1. **The closest analog is `study_artifact` (ADR-049), and the notebook is
   deliberately NOT it.** `study_artifact` (migration `0021`) is **per-session,
   write-once, one row per artifact kind**, triggered on new-misconception sessions.
   The notebook is **per-concept, cumulative, revised after every session** — a living
   document. That single difference (per-concept + mutable-upsert vs. per-session +
   append-only) is the whole design. The two are siblings, not the same table.

2. **The per-session read already exists and is already re-used.**
   `loadSessionSource(supabase, userId, sessionId)` (`web/lib/study/source.ts`) calls
   `buildSessionRecap` and adds the ordered per-turn transcript
   (`student_transcript` / `tutor_response` / `concept_key` / `outcome`). Its
   `SessionSourceTurn[]` already carries `conceptKey` per turn — so slicing the source
   to one concept is a filter, not a second read. The notebook grounds in the **same**
   session data the recap and the study kit already show; a divergent third read would
   let the notebook disagree with what the student was told.

3. **The structured-output contract is forced-tool, not freeform JSON.** `STUDY_KIT_TOOL`
   (`web/lib/study/tool.ts`) is the worked precedent: `strict: true`,
   `additionalProperties: false` on every node, array-length caps enforced prompt-side
   **and** by a hard slice in `parseStudyKit` (strict-mode can't express array length),
   a deterministic `EMPTY_STUDY_KIT` fallback on a missing/unusable tool call (never a
   throw, never a half-parsed artifact persisted), and a dual-provider runner
   (`generateStudyKit`) that honors ADR-052: GPT-4o-mini default,
   `STUDY_KIT_PROVIDER=anthropic` selects the Haiku backup.

4. **Every paid model call has one gate to respect.** ADR-041 requires
   `costGuard(estimateCost(kind))` **before** the provider call, with a per-kind estimate
   in `web/lib/tier/cost-model.ts` (`CostKind = 'claude_turn' | 'whisper_stt' |
   'elevenlabs_tts' | 'study_kit'`, each a flat-cents const). The guard fails open; a
   real over-cap refuses with no model call.

5. **The session-end hook is the established best-effort seat.** `app/api/session/end/route.ts`
   already builds the recap and, guarded four ways (kill switch
   `CALYXA_DISABLE_AUTO_STUDY_KIT=1`, only-when-new-misconception, skip-if-kit-exists,
   cost-guarded), calls `generateAndPersistStudyKit` in a try/catch that **never** alters
   the already-successful end response. The notebook update is a parallel block in the
   same seat.

6. **Every new user-scoped table carries the Sprint 16 invariant.** RLS enabled in the
   same migration as `CREATE TABLE`; `on delete cascade` to `users` for erasure; added to
   the `RLS_SCOPED_TABLES` export list in `app/api/account/export/route.ts`; both asserted
   in `web/test/account.test.ts`. `study_artifact` and `feedback` also drop the
   canonical `deleted_at is null` clause (write-then-read capture, erasure via cascade,
   no soft-delete concept).

**Decision:** Each concept gains a **Personal Notebook** — a persisted `{ summary,
reminders[], explanations[] }` document — **revised after every session that practiced
the concept**, by a **new forced-tool call, a sibling of the study-kit generator,
grounded in that concept's slice of the session read, cost-guarded, and stored in a new
upsert-keyed RLS table `concept_notebook`**. Six decisions fix the shape:

1. **Grain is per-concept, keyed for upsert.** One row per `(user_id, concept_key)`, a
   `unique (user_id, concept_key)` constraint, updated in place with
   `upsert(..., { onConflict: 'user_id,concept_key' })`. `concept_key` is a **logical
   join** to the code-shipped curriculum graph (no FK — the convention
   `knowledge_nodes` / `misconceptions` / `reinforcement_schedule` / `mastery_snapshot`
   already use). A `source_session_id uuid on delete set null` records the last
   contributing session (a deleted session never orphans the notebook), and a
   `session_count integer` tracks how many sessions have fed it (for the "updated after
   N sessions" line, and a future rebuild heuristic).

2. **`content` is the brief's three sections, validated before write.** A `jsonb`
   `{ summary: string, reminders: string[], explanations: {title, body}[] }` — mapping
   the brief's *summaries / important reminders / tutor explanations* one-to-one.
   Validated by a new `parseNotebook` (with `MAX_REMINDERS` / `MAX_EXPLANATIONS` caps
   enforced prompt-side and by a hard slice) before insert, exactly as `parseStudyKit`
   gates `study_artifact.payload`.

3. **Generation REVISES the existing notebook; it does not regenerate from full
   history.** The model is fed **the current notebook (or empty) plus only this
   concept's slice of the session** — this concept's turns, its outcome stats, and any
   misconception on it — and asked to produce the **updated** notebook: keep what is
   still true, refine explanations with today's work, add reminders for a new
   misconception. Bounded input (old notebook + one session), coherent output, and it
   mirrors how a student actually keeps running notes. Regeneration-from-scratch is
   foreclosed for v1 (see Rationale + Consequences); a future "rebuild notebook" action
   is the escape hatch for accumulated drift.

4. **A new forced-tool call, a sibling of the study-kit generator, not the tutoring
   turn.** New `web/lib/notebook/` mirroring `web/lib/study/`: `tool.ts`
   (`NOTEBOOK_TOOL` = `submit_concept_notebook`, `strict: true`,
   `additionalProperties: false` everywhere, caps + `parseNotebook` + `EMPTY_NOTEBOOK`),
   `source.ts` (a `conceptSlice(source, conceptKey)` filter over the **already-loaded**
   `SessionSource` — no new read), `generate.ts` (`generateConceptNotebook`, dual-provider
   per ADR-052 with a **separate** `NOTEBOOK_PROVIDER=anthropic` backup flag so the tutor
   turn, kit, and notebook flip independently), and `update.ts` (the
   `generate-and-persist` analog: cost-guard → read existing → generate → `EMPTY` skip →
   upsert; never throws). `runTutorTurn`, the envelope, and the pedagogy are **untouched**.

5. **Generation is automatic on session end, but bounded — every session, capped
   concepts, cost-guarded per call.** Unlike a study kit (on-demand, one call per
   session), the brief says the notebook updates after **every** session — so the hook
   fires whenever the recap has concepts with a gradable turn. The cost risk is real: a
   notebook update is **one model call per concept**, so a 4-concept session is 4× a
   kit's spend. It is bounded three ways: **(a)** only concepts with a gradable turn this
   session; **(b)** a **hard cap of the 3 most-practiced concepts per session**, with the
   drop **logged** (never silently truncated); **(c)** `costGuard(estimateCost('notebook'))`
   before each call, `hardExceeded` → silent no-op. A new `'notebook'` `CostKind` +
   `NOTEBOOK_CENTS` (~2¢, smaller output than a kit) is the **one** cost-model change. A
   kill switch `CALYXA_DISABLE_NOTEBOOK=1` is the prod valve and the integration-test
   opt-out (the `COST_*_OVERRIDE` / `CALYXA_DISABLE_AUTO_STUDY_KIT` convention).

6. **Available to all users; no gating primitive invented here.** Like study kits at
   Sprint 21, notebooks are available to everyone. The hook and any future read are
   written so an entitlement check (ADR-051's `assertEntitlement`) is a one-line add, not
   a refactor — but this change invents no gating.

**Rationale:**
- **Per-concept + upsert is what makes it a "second brain," not another kit list.** The
  brief's whole thesis is that learning *accumulates* on the concept. A per-session table
  (append-only) would scatter one concept's knowledge across N rows the student has to
  reassemble; one revised row per concept is the durable artifact the workspace reads.
- **Revise-not-regenerate is the cost-and-coherence choice.** Regenerating from full
  history means re-reading and re-paying for every past session on every update —
  unbounded and ever-growing. Feeding the prior notebook + one session is bounded, cheap,
  and matches the mental model of updating notes. Its one risk — slow semantic drift over
  many revisions — is mitigated by always re-grounding in the latest transcript
  ("keep only what today's session still supports") and by leaving a rebuild action for
  later. Regeneration-from-scratch would trade a bounded, real cost for an unbounded one
  to avoid a drift that grounding already contains.
- **A sibling forced-tool call is the safe isolation, proven twice.** The study-kit
  generator already established that an offline, several-hundred-token completion belongs
  in its own call with its own model const, `max_tokens`, and schema — never folded into
  the latency-sensitive tutoring turn. The notebook is the same shape; copying the pattern
  keeps `runTutorTurn` byte-for-byte unchanged and lets a bad response degrade to
  `EMPTY_NOTEBOOK` (persist nothing) without touching a live session.
- **Reusing `loadSessionSource` is the anti-divergence guarantee.** The recap, the study
  kit, and now the notebook all read the same assembled session material. A notebook that
  disagreed with the recap the student just saw would be worse than no notebook; sharing
  the read (and slicing, not re-querying) forecloses that.
- **Bounded-automatic matches the cost risk honestly.** The brief demands "after every
  session," which forbids the kit's on-demand dodge — so the honest answer is automatic
  **with** a per-concept cap, a per-call guard, and a logged drop, not silent per-concept
  fan-out that multiplies the beta bill.

**Consequences:**
- **Enables:** the concept workspace's **Personal Notebook** card (the brief's §2, first
  content section after the mastery summary) — `summary` paragraph, `reminders` checklist,
  `explanations` as titled blocks, an "updated after N sessions" line — reading one
  RLS-scoped row. It also **closes gap #4** ("update concept notebook") in the brief's
  "after every session" pipeline, which is otherwise unimplemented.
- **Requires:** a new `0026_concept_notebook.sql` migration (Shape 2 RLS,
  `unique (user_id, concept_key)`, FK-cascade to `users`, `source_session_id on delete
  set null`, `updated_at` trigger, no `deleted_at`); `web/lib/notebook/`
  (`tool.ts` / `source.ts` / `generate.ts` / `update.ts`); the `'notebook'` `CostKind` +
  `NOTEBOOK_CENTS` (the one cost-model change); a parallel best-effort block in
  `app/api/session/end/route.ts`; a `loadConceptNotebook` read added to `detail-read.ts`'s
  `Promise.all` and rendered in `ConceptDetailScreen.tsx`; and `concept_notebook` added to
  the export route + `account.test.ts`. `buildSessionRecap` / `loadSessionSource` /
  `apply` / `scheduler` / the study-kit pipeline / the envelope are **reused or untouched,
  not modified** (the source slice is a new pure filter over `SessionSource`, not an edit
  to `source.ts`'s read).
- **Forecloses (this change):** **regeneration from full history** (revise-in-place is the
  decision; a rebuild action is a later feature); **a per-session notebook table** (per-
  concept upsert is the grain); **uncapped per-concept fan-out** (3-concept cap + per-call
  guard); **a third divergent session read** (`conceptSlice` reuses `loadSessionSource`);
  **editing / sharing / export-to-Anki-PDF** (v1 is generate + view + the Sprint 16 JSON
  export); and **making the notebook Pro-gated or volume-capped beyond the cost guard** (a
  one-line ADR-051 seam is left).
- **Privacy disclosure (a new standing coupling):** `concept_notebook` is a new stored,
  AI-generated, per-user data type — the second generated-content surface after
  `study_artifact`. It is RLS-scoped, FK-cascades on erasure, and joins the export — the
  same discipline every user-scoped table follows — but the `/privacy` + Chrome
  data-safety disclosure (ADR-046) **must add "personal concept notebooks (AI-generated
  study notes)" as a persisted data type** before this reaches users, exactly as study
  kits required. Flagged in the handoff.
- **Disclosure — a cost multiplier to watch:** this is the first feature that makes a
  **paid model call per concept per session** rather than per session. The 3-concept cap
  and the per-call guard bound it, but the beta cost line should be watched after this
  lands; the batching optimization (one call revising all touched notebooks at once —
  cheaper at scale, heavier schema, worse failure isolation) is the deliberate next lever
  if per-concept spend is measured as a problem, not built now.

> **Numbering note:** this ADR is **054** — the latest on disk is **053 (referral system)**,
> so 054 is the true next-free per this repo's "next free number at execution, no renumber"
> convention (ADR-039 / 044 / 045 / 049 precedent). The migration is **`0026_concept_notebook.sql`**
> — `0025_users_column_grants.sql` is the latest applied, so `0026` is next-free. **Confirm
> both at execution:** the dashboard IA work is uncommitted and parallel tracks may claim a
> number first. See ADR-049 (the study-kit sibling this mirrors — read, tool, cost-guard,
> persist, export/erasure), ADR-052 (the provider-default rule the dual-provider runner
> follows), ADR-041 (the cost guard this call respects), ADR-035 (export + erasure — the
> `concept_notebook` cascade), ADR-046 (the data-safety disclosure this now amends), ADR-051
> (the entitlements seam left for later), and ADR-019 / ADR-025 (the envelope + recap this
> reuses but does not touch).
