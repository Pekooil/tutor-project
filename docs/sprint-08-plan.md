# Sprint 08 — Live learning profile

## Goal
Make Calyxa **remember the student between sessions**. By the end, a signed-in student's
mastery state lives in the database, is **read into the AI prompt** in place of the
hardcoded dummy, and is **written back when a session ends** — so the **second session on
the same topic reflects what happened in the first**. This finally fills the seam ADR-009
left open since Sprint 05:

```
session 1 ends → transcript summarised → knowledge_nodes / misconceptions written
session 2 turn → /api/ai/turn loads the LIVE profile (query 1) → system prompt
              STUDENT PROFILE slot → Claude calibrates to session 1's history
```

The profile lands the only way ADR-009 promised: a `LearningProfile` is now produced by a
**live query** instead of the `HARDCODED_PROFILE` constant, and **prompt assembly does not
change** — `system-prompt.ts` already renders any `LearningProfile`, so it is **untouched
this sprint** (the seam swap is a data-source swap, exactly as ADR-009 forecast). The write
side is a **single end-of-session summariser call** over the conversation transcript that
emits a structured `SessionSummary`, which a minimal mastery update applies to
`knowledge_nodes` (and a minimal detector applies to `misconceptions`).

This sprint ships the **read/write loop only** — persisted mastery + live read + write-on-end
— and **deliberately defers the full learning model**: the FSRS decay/stability dynamics,
fuzzy/`pgvector` misconception matching, the 3-correct resolution streak, the reinforcement
scheduler, per-turn `session_interactions` persistence, the §2.5 JSON output envelope,
cold-start onboarding, topic detection, and the `/packages/learning-model` extraction are
each their own later deliverable (PLAN §2.4/§2.10). That split is recorded in **ADR-014**.

**`/api/ai/turn` still writes nothing** (ADR-013 holds): the live profile is a **read** on
the turn path; the **only new DB write** is the session-end summary. Per-turn structured
assessment (the §2.5 JSON envelope, deferred — ADR-008) is **not** revived; instead the
session-end summariser reads the plain-text transcript and produces the structured signal in
**one** call. That mechanism is recorded in **ADR-015**.

## Context
Sprint 05 delivered the text AI tier, Sprint 06 the voice tier, and Sprint 07 the live page
context — all routed overlay → content → background → backend. The §2.5 system prompt is
assembled in `/web/lib/ai/system-prompt.ts` (`buildSystemPrompt(profile, pageContext?)`),
called by `runTutorTurn` in `/web/lib/ai/claude.ts`, behind `/api/ai/turn`. Through Sprint 07
the `STUDENT PROFILE` block has rendered the **hardcoded** `HARDCODED_PROFILE`
(`/web/lib/ai/profile.ts`) — ADR-009 defined that as a typed seam to be swapped for a live
query result of the **same** `LearningProfile` type, "with no change to prompt-assembly or
the route." This sprint performs that swap and adds the write side.

The data layer is partly ready. `/supabase/migrations/0001_init_users.sql` →
`0003_sessions_freemium.sql` ship `users` and a full `sessions` table with the canonical
RLS shape (`USING (auth.uid() = user_id AND deleted_at IS NULL)`, mirrored `WITH CHECK`) and
the `set_updated_at()` trigger; the freemium gate runs through `SECURITY INVOKER` RPCs
(`start_session` / `end_session`). The learning tables PLAN §2.3 describes
(`knowledge_nodes`, `misconceptions`, `session_interactions`, `reinforcement_schedule`) **do
not exist yet** (ADR-009). This sprint adds the **first two** — the live mastery state and
its misconception layer — and leaves the latter two to later sprints.

Locked decisions from `/CLAUDE.md` and `/docs/CLAUDE.md` that drive it:
- **RLS policy: every Supabase table must have RLS before receiving data.** The two new
  tables enable RLS in the **same migration** that creates them, using the canonical
  `user_id = auth.uid()` policy shape (see `/supabase/policies/README.md`), before any row is
  written.
- **All API keys server-side.** The summariser call uses the server-side Anthropic SDK from
  `/web/lib/ai` only; no key reaches the extension.
- **Free tier limits enforced server-side.** Untouched — the profile read/write does not
  gate; the freemium RPCs are reused unchanged.
- **Audio is never persisted.** Unchanged — the summariser reads the **text** transcript
  only (STT output), never audio (ADR-011).

### Reconciliation with `/docs/PLAN.md` (read before Task 1) — what ships vs what defers
PLAN §2.4 + §2.10 (Sprint 4 "learning model built & unit-tested in isolation" → Sprint 5
"connect profile ↔ AI + cold start") describe a **full** learning system: an FSRS-flavoured
two-variable model (`mastery` + `stability` + `difficulty`, power-decay), misconception
detection with `pg_trgm`/`pgvector` fuzzy matching and a 2-instance promotion + 3-correct
resolution lifecycle, an FSRS reinforcement scheduler, per-turn model `assessment` persisted
to `session_interactions`, and cold-start onboarding that seeds the graph — all as **pure
functions in `/packages/learning-model`** over a `/packages/curriculum` concept graph.

This sprint takes the **crisp acceptance slice** — *persist mastery, read it into the prompt,
write it back on session end, so session 2 reflects session 1* — and **defers** the rest:

**(a) Minimal mastery update now; full FSRS later.** This sprint applies a small, documented
Elo-style nudge per observed concept (grade from outcome → bounded mastery delta → state
label → `observation_count++`, `last_practiced_at = now()`), enough for session 2 to reflect
session 1. The full FSRS **decay/stability/difficulty dynamics**, lucky-guess discounting,
and tuning constants land with the **learning-model package** (PLAN §2.4; §2.10 Sprint 4).
The `knowledge_nodes` columns (`stability`, `difficulty`, etc.) are **created now** so that
sprint needs no migration, mirroring how `0001` added `users` columns ahead of need.

**(b) Session-end summariser, not per-turn assessment.** PLAN §2.5 has the model emit a
per-turn `assessment` (the JSON output envelope) persisted to `session_interactions`. That
envelope is **deferred** (ADR-008), and `/api/ai/turn` writes nothing (ADR-013). So instead
of reviving per-turn structured output, the **end-of-session** path makes **one** summariser
call over the transcript → a structured `SessionSummary` → the writes. `session_interactions`
persistence stays deferred. ADR-015 records this.

**(c) Minimal misconception layer; fuzzy matching + resolution deferred.** The summariser may
flag a misconception (`concept_key` + `category` + `description`); the apply step does an
**exact-category** match and the **2-instance pending→active** promotion only (PLAN §2.4).
The **fuzzy/`pgvector` matching**, the **3-correct resolution streak**, and the `embedding`
column / `pg_trgm` GIN are **deferred** (no `pgvector`/`pg_trgm` dependency added this sprint).

**(d) Global weakest-first read; topic detection deferred.** PLAN query 1 takes page-context
concept candidates (`$2`) to bias the profile toward the page's topic. This sprint reads the
**weakest/recent** nodes for the user (LIMIT ≈12) without the page-relevance join — the
weak node from session 1 surfaces in session 2's profile regardless of page, which satisfies
the acceptance. `detected_topic`, `page_url_hash`, and the page-relevant join are **deferred**
(page context stays ephemeral — ADR-013; URL hashing is the privacy sprint, PLAN §2.7).

Recorded in **ADR-014** (graph + read + minimal update) and **ADR-015** (write mechanism).

### Concept-key stability model (read before Tasks 4, 7)
For session 2 to reflect session 1, both sessions must write/read the **same** `concept_key`.
With no `/packages/curriculum` graph yet (deferred), the summariser would otherwise emit
free-form keys that drift between runs (`algebra.factoring` vs `quadratics.factoring`) and
never match. Mitigation: a small **inline `KNOWN_CONCEPT_KEYS`** allow-list (a documented
stopgap for the curriculum package) is given to the summariser as the **only** keys it may
use, and the read maps over the same list. This keeps keys stable across sessions — the exact
risk that would silently break the acceptance — until `/packages/curriculum` replaces it.

### Profile-read budget + cold-start model (read before Tasks 3, 7)
The live read mirrors the §2.5 budget already encoded in `system-prompt.ts`
(`MAX_MASTERY_NODES = 12`, `MAX_ACTIVE_MISCONCEPTIONS = 8`): query 1 is **LIMIT-bounded**
(weakest first, `mastery ASC`) so the profile never blows the token budget, and
`renderProfileSummary` re-applies the caps (server-authoritative, same discipline as
Sprint 07's `renderPageContext`). A **brand-new user has zero nodes**: the read returns an
**empty** `LearningProfile` with `confidenceNote: "Calibrating — early estimate."`, which the
existing prompt renders as `(no mastery data yet)` / `(none active)` — the cold-start
behaviour, with the full onboarding assessment UI deferred (PLAN §2.10).

### No-persistence-on-the-turn model (read before Tasks 3, 5)
ADR-013's "`/api/ai/turn` writes nothing" is preserved. The turn path now **reads** the live
profile (query 1) — a read, not a write — and still persists nothing per turn. The **only**
DB write this sprint is at **session end**, and it is **idempotent by construction**:
`end_session` only matches an **open** session (the open→ended transition), so a repeat end
returns 404 and the summary write runs **at most once** per session. The transcript reaches
the end path **without** any new per-turn write: the background worker already relays the
full running transcript on every `AI_TURN`, so it caches the latest in `chrome.storage.session`
(in-memory, cleared on end) and forwards it on `END_SESSION` — no new message type, no DB
write on the turn. ADR-015 records this.

## Execution model
A **single code session** owns this sprint end to end, worked **strictly in order
(1 → 8)**. The dependency chain is real: the tables + RLS (Task 2) must exist before anything
reads or writes them; the live read (Task 3) swaps the profile source the prompt already
renders; the summariser + apply (Task 4) must exist before the session-end route calls them
(Task 5); the backend write must work before the extension forwards the transcript (Task 6);
tests (Task 7) gate the manual two-session acceptance (Task 8). Respect the per-task **scope**
lines as a focus discipline, but it is one session — no handoff.

This sprint **does** touch `/web/lib/ai/claude.ts` (profile becomes a parameter — the ADR-009
swap) and `/web/lib/ai/profile.ts` (the hardcoded instance retires). It **does not** touch
`/web/lib/ai/system-prompt.ts` — prompt assembly is unchanged, which is the ADR-009 promise
and an acceptance point. It adds a new `/web/lib/learning/*` and a `/web/lib/ai/summarise.ts`
(the second sanctioned Anthropic call site, confined to `lib/ai` — ADR-008). It edits
`/api/ai/turn` (read the profile) and `/api/session/end` (write the summary), one new
migration, and the extension's worker/api/storage to carry the transcript to the end call.
The **popup, overlay, content script, voice routes/lib, page extractor, freemium RPCs, and
auth** are **reused unchanged**.

## Files in scope

### Task 1 (planning / docs) creates or edits:
```
/docs/adr/ADR-014-live-knowledge-graph.md   ← new — knowledge_nodes/misconceptions persisted; live profile read replaces HARDCODED_PROFILE (ADR-009 swap); minimal mastery update; FSRS/fuzzy-matching/scheduler/curriculum-package deferred
/docs/adr/ADR-015-session-summary-write.md  ← new — one end-of-session summariser call (not per-turn JSON envelope); /api/ai/turn still writes nothing (ADR-013 holds); transcript rides the existing AI_TURN relay; idempotent via the open→ended transition
/CLAUDE.md                                   ← edit one line: Current sprint → Sprint 08 — Live learning profile
/docs/CLAUDE.md                              ← edit one line: Current phase → Phase 1, Sprint 8
/docs/sprint-08-plan.md                      ← this file
```

### Supabase — knowledge graph tables + RLS (Task 2) creates / edits:
```
/supabase/migrations/0004_knowledge_graph.sql ← new — knowledge_nodes + misconceptions (full §2.3 columns minus pgvector/pg_trgm); RLS enabled in-migration with the canonical user_id policy; indexes; additive, re-runs clean on db reset
/supabase/policies/README.md                  ← edit — list the two new tables under the canonical owner-policy shape (doc only)
/supabase/seed/seed.sql                       ← edit — optional: seed a couple of knowledge_nodes for the existing test user so the read path has data without a full session (clearly marked dev-only seed)
```

### Web — live profile read (Task 3) creates / edits:
```
/web/lib/learning/profile-read.ts ← new — loadProfile(supabase): runs query 1 (weakest/recent nodes + active misconceptions, LIMIT-bounded), maps rows → LearningProfile, returns the calibrating empty profile for a new user
/web/lib/ai/claude.ts             ← edit — runTutorTurn({ messages, pageContext, profile }) takes the profile as a param; drop the HARDCODED_PROFILE import (the ADR-009 data-source swap)
/web/lib/ai/profile.ts            ← edit — keep the LearningProfile/Mastery/Misconception types; retire HARDCODED_PROFILE (remove or demote to a test-only fixture)
/web/app/api/ai/turn/route.ts     ← edit — load the live profile via loadProfile(auth.supabase) and pass it to runTutorTurn; STILL no DB write (ADR-013); header updated to "reads the live profile, writes nothing"
```
`/web/lib/ai/system-prompt.ts` is **NOT** edited — it already renders any `LearningProfile`.

### Web — session summariser + apply (Task 4) creates:
```
/web/lib/learning/types.ts     ← new — SessionSummary + ConceptObservation (+ misconception candidate) types; KNOWN_CONCEPT_KEYS allow-list (curriculum-package stopgap)
/web/lib/ai/summarise.ts       ← new — summariseSession({ transcript }): the SECOND sanctioned Anthropic SDK call site (ADR-008, lib/ai-confined); returns a SessionSummary constrained to KNOWN_CONCEPT_KEYS
/web/lib/learning/update.ts    ← new — pure updateMasteryNode(prev, observation): minimal Elo-style mastery nudge + state label (future /packages/learning-model seed; no I/O)
/web/lib/learning/apply.ts     ← new — applySessionSummary(supabase, summary): upsert knowledge_nodes via update.ts; minimal misconception upsert (exact-category, 2-instance pending→active)
```

### Web — session-end route writes the summary (Task 5) edits:
```
/web/app/api/session/end/route.ts ← edit — accept an OPTIONAL transcript; after endSession closes the open session, run summariseSession + applySessionSummary best-effort (a summariser failure never fails the end); no transcript ⇒ exactly the Sprint 04 behaviour
```
`/web/lib/tier/session-gate.ts` is **reused unchanged** (`endSession` still owns the lifecycle).

### Tests (Task 7) edit:
```
/web/tests/session.test.ts ← edit — end-with-transcript writes knowledge_nodes; a subsequent loadProfile reflects it; end-without-transcript unchanged (no write); summariser failure degrades (session still ends); no live Anthropic call (reuse the fake backend)
/web/tests/ai-turn.test.ts ← edit — the prompt now reflects the LIVE profile (seeded node appears); empty graph → calibrating fallback; back-compat otherwise
/web/tests/rls.test.ts     ← edit — knowledge_nodes + misconceptions are owner-only (cross-user read/write blocked; canonical policy)
```

### Extension — carry the transcript to session end (Task 6) edits:
```
/extension/src/background/index.ts ← edit — cache the latest running transcript from handleAiTurn into chrome.storage.session; handleEndSession forwards it to api.endSession; clear it on end
/extension/src/lib/api.ts          ← edit — endSession(sessionId, transcript?) includes the transcript in the request body
/extension/src/lib/storage.ts      ← edit — get/set/clear helpers for the cached running transcript (session storage, in-memory, ephemeral)
```
No new `MessageType`, and the **popup/overlay/content script are unchanged** — the transcript
already flows through the existing `AI_TURN` relay (ADR-008 history model).

## Files explicitly out of scope
```
/web/lib/ai/system-prompt.ts        (prompt assembly unchanged — the ADR-009 seam promise)
/web/lib/ai/page-context.ts         (Sprint 07 page-context model unchanged)
/extension/src/content/pageExtractor.ts, /extension/src/overlay/*, /extension/src/popup/*
                                    (extraction + overlay + popup unchanged — no new message type)
/web/app/api/ai/turn/route.ts write path (route now READS the profile; it still writes nothing — ADR-013)
/web/lib/tier/session-gate.ts       (start_session/end_session RPCs reused unchanged)
/web/app/api/session/start/route.ts (session start unchanged)
/web/app/api/voice/*, /web/lib/voice/* (voice tier unchanged — Sprint 06)
/web/app/api/auth/*, /web/lib/auth/bearer.ts (auth unchanged — Sprint 04)
/supabase/migrations/0001..0003     (additive only — 0004 does not touch them)
```

Also out of scope this sprint (no pre-empting later work):
- **The full FSRS learning model.** `stability`/`difficulty` decay dynamics, the power-decay
  retrievability, lucky-guess/false-mastery discounting, and tuning constants — the
  **learning-model package sprint** (PLAN §2.4; §2.10 Sprint 4). This sprint applies only a
  minimal mastery nudge; the columns exist so that sprint needs no migration.
- **`/packages/learning-model` + `/packages/curriculum` extraction.** Scoring stays pure but
  lives in `/web/lib/learning` for now (ADR-009 deferral); concept keys come from the inline
  `KNOWN_CONCEPT_KEYS` stopgap, not a curriculum graph.
- **Fuzzy / `pgvector` misconception matching, the 3-correct resolution streak**, the
  `embedding` column, and the `pg_trgm` GIN — deferred (only exact-category + 2-instance
  promotion ships; no `pgvector`/`pg_trgm` dependency added).
- **The reinforcement scheduler + spaced repetition** (`reinforcement_schedule` table, query
  2, "let's revisit…" prompts) — the scheduler sprint (PLAN §2.4).
- **`session_interactions` persistence + per-turn `assessment` + the §2.5 JSON output
  envelope** — still no consumer; the session-end summariser replaces them this sprint
  (ADR-008/ADR-015). Replies stay plain text; `/api/ai/turn` still writes nothing.
- **Topic detection / `detected_topic` / page-relevant profile bias / `page_url_hash`** —
  page context stays ephemeral (ADR-013); URL hashing is the privacy sprint (PLAN §2.7). The
  read is global-weakest-first, not page-biased.
- **Cold-start onboarding assessment UI + initial graph seeding** — deferred (PLAN §2.10); a
  new user simply reads as "calibrating."
- **The mastery dashboard, model routing/escalation, and Pro-gating** — later sprints.

Do not create any file not listed above. If something seems needed but is not listed, add it
to "What the next sprint needs to know" and ask before creating it.

---

## Task 1 — Knowledge-graph + session-summary ADRs + sprint pointers (planning / docs)

Write two ADRs using the project's ADR format (match ADR-001…ADR-013 exactly):

```
## ADR-0NN: [Title]
**Status:** Decided
**Context:** [why this needed a decision]
**Decision:** [what was chosen]
**Rationale:** [bullets — why]
**Consequences:** [Enables / Requires / Forecloses]
```

ADR-014 — The learning profile becomes a live knowledge graph (read + minimal write); full
FSRS / fuzzy matching / scheduler / curriculum package deferred:
- Context: ADR-009 defined `LearningProfile` as a typed seam with a single `HARDCODED_PROFILE`
  instance, promising the live system would swap the **data source** behind the same type
  "with no change to prompt-assembly or the route." The learning tables (PLAN §2.3) do not
  exist yet. PLAN §2.4/§2.10 describe a full FSRS model + fuzzy misconception matching +
  scheduler + curriculum package across two sprints. A shape decision was needed: build the
  full learning model now (rejected — it is two PLAN sprints of pure-function + package work
  unrelated to the read/write loop), or **persist mastery + read it live + write a minimal
  update on session end** now and defer the model's sophistication.
- Decision: add `knowledge_nodes` and `misconceptions` tables (RLS in-migration, canonical
  `user_id` policy); replace `HARDCODED_PROFILE` with a **live `loadProfile(supabase)`** (query
  1, weakest-first, LIMIT-bounded) producing the **same** `LearningProfile` type, so
  `system-prompt.ts` is **untouched**; apply a **minimal** Elo-style mastery update + exact-
  category/2-instance misconception promotion on session end. Defer the **full FSRS dynamics**,
  **fuzzy/`pgvector` matching + 3-correct resolution**, the **reinforcement scheduler**, and
  the **`/packages/learning-model` + `/packages/curriculum`** extraction (concept keys come
  from an inline `KNOWN_CONCEPT_KEYS` stopgap). Record the global-weakest-first vs page-biased
  read simplification and the brief-vs-PLAN minimal-vs-full-model split here.
- Rationale (bullets): the typed seam makes hardcoded→live a data-source swap, not a rewrite
  (ADR-009) — proven by `system-prompt.ts` not changing; persisting mastery is the minimum that
  lets session 2 reflect session 1 (the acceptance); a minimal update keeps the slice crisp and
  leaves the FSRS package a focused pure-function problem; creating the full §2.3 columns now
  means the model sprint needs no migration; the inline key allow-list mitigates concept-key
  drift that would silently break the acceptance.
- Consequences: Enables — a tutor that calibrates to real per-student history, and a graph the
  FSRS/scheduler/dashboard sprints extend without reshaping. Requires — RLS on both tables
  before any write; the live read to stay LIMIT-bounded (token budget); `claude.ts` to take the
  profile as a parameter; this ADR revisited when the learning-model package lands (it replaces
  the minimal update + inline keys). Forecloses — nothing it does not explicitly defer; the
  full model, fuzzy matching, scheduler, and curriculum package remain later sprints.

ADR-015 — Session state is written by one end-of-session summariser call; the turn path still
persists nothing:
- Context: the live graph needs a **write** signal, but the §2.5 per-turn `assessment` (JSON
  output envelope) is deferred (ADR-008) and `/api/ai/turn` writes nothing (ADR-013). We had to
  decide how the per-session learning signal is produced and how the transcript reaches the
  write without reversing ADR-013 or reviving the envelope.
- Decision: at **session end**, run **one** Anthropic summariser call (a second SDK call site
  confined to `/web/lib/ai`, ADR-008) over the conversation **transcript** → a structured
  `SessionSummary` (concepts + outcomes + optional misconception, constrained to
  `KNOWN_CONCEPT_KEYS`) → a minimal apply writes `knowledge_nodes`/`misconceptions`.
  `/api/ai/turn` **still writes nothing** and per-turn `session_interactions` are **not**
  persisted. The transcript reaches `/api/session/end` by riding the **existing `AI_TURN`
  relay**: the background worker already receives the full running transcript every turn, so it
  caches the latest in `chrome.storage.session` (in-memory, cleared on end) and forwards it on
  `END_SESSION` — **no new message type, no per-turn DB write**. The write is **idempotent**
  via `end_session`'s open→ended transition (a repeat end is a 404 no-op). A summariser failure
  **degrades** — the session still ends.
- Rationale (bullets): one end-of-session call avoids reviving the deferred per-turn envelope
  and keeps replies plain text (ADR-008); reading the transcript (already held client-side and
  relayed each turn) needs no new transport; the open→ended guard gives idempotency without an
  `applied_to_profile` ledger; best-effort apply keeps a flaky summariser from blocking session
  end; the audio-never-persisted discipline is intact (text transcript only — ADR-011).
- Consequences: Enables — durable cross-session learning with no per-turn write and no new
  route/message. Requires — the worker to cache the running transcript ephemerally (cleared on
  end, never to disk/DB); the summariser to be the only new write trigger; `/api/ai/turn` to
  keep writing nothing (Task 7 asserts). Forecloses — per-turn `session_interactions` and the
  §2.5 JSON envelope this sprint (still deferred, ADR-008); any audio persistence.

Then make two one-line edits:
- /CLAUDE.md: change the "Current sprint" line to
    Sprint 08 — Live learning profile
- /docs/CLAUDE.md: change "Current phase" from "Phase 1, Sprint 7" to
    "Phase 1, Sprint 8"

Do not change any other line in either CLAUDE.md.

Acceptance gate before Task 2:
  - ADR-014 and ADR-015 exist and follow the ADR format exactly; ADR-014 records the live-graph
    swap + minimal-vs-full-model deferral; ADR-015 records the one-summariser-call write,
    transcript-rides-AI_TURN, idempotent-via-open→ended, turn-path-writes-nothing.
  - Both CLAUDE.md sprint-pointer lines are updated and nothing else changed.

---

## Task 2 — Knowledge-graph tables + RLS (supabase)

Scope: /supabase/migrations/0004_knowledge_graph.sql (new) + doc/seed edits. Additive only —
0001…0003 are not touched, and 0004 must re-run cleanly on a fresh `supabase db reset`.

/supabase/migrations/0004_knowledge_graph.sql (new):
  - `create table public.knowledge_nodes` with the PLAN §2.3 columns: `id uuid pk default
    gen_random_uuid()`, `user_id uuid not null references public.users (id)`, `concept_key
    text not null`, `mastery real not null default 0.0`, `stability real not null default 1.0`,
    `difficulty real not null default 0.3`, `confidence_band text not null default 'low' check
    (... in ('low','medium','high'))`, `observation_count int not null default 0`,
    `last_practiced_at timestamptz null`, `state text not null default 'unseen' check (... in
    ('unseen','learning','weak','mastered','forgotten'))`, the standard
    `created_at`/`updated_at`/`deleted_at`. `unique (user_id, concept_key)`;
    `idx_kn_user_state (user_id, state)`; `idx_kn_user_lastpracticed (user_id,
    last_practiced_at)`. (No `embedding` / `pgvector` — deferred.)
  - `create table public.misconceptions` with the PLAN §2.3 columns **minus** `embedding`:
    `id`, `user_id` (FK→users), `concept_key text not null`, `category text not null`,
    `description text null`, `status text not null default 'pending' check (... in
    ('pending','active','resolved'))`, `occurrence_count int not null default 1`,
    `consecutive_correct int not null default 0`, `first_seen_at`/`last_seen_at timestamptz not
    null default now()`, `resolved_at timestamptz null`, standard
    `created_at`/`updated_at`/`deleted_at`. `idx_misc_user_concept_cat (user_id, concept_key,
    category)`; `idx_misc_user_status (user_id, status)`. (No `pg_trgm` GIN, no ivfflat —
    deferred.)
  - `set_updated_at` trigger on **both** tables (reuse the function from 0001).
  - Enable RLS on **both** tables in this migration and add the canonical owner policies
    (`select` + `for all`) keyed on `auth.uid() = user_id and deleted_at is null` with the
    matching `with check`, exactly like `sessions` in 0002. No client insert restriction beyond
    the owner check (the bearer/RLS client writes its own rows; the summary apply runs as the
    user).
  - A header comment stating: additive, RLS-before-data, columns ahead of need for the
    learning-model sprint, `pgvector`/`pg_trgm`/`reinforcement_schedule`/`session_interactions`
    deferred (ADR-014).

/supabase/policies/README.md (edit): add `knowledge_nodes` and `misconceptions` to the list of
tables on the canonical `user_id = auth.uid()` policy shape (doc only).

/supabase/seed/seed.sql (edit, optional): seed 1–2 `knowledge_nodes` (and optionally one active
`misconception`) for the existing dev test user so the read path has data before any real
session, clearly fenced as dev-only seed.

When done, paste 0004 and confirm RLS is enabled in the same migration for both tables.

Acceptance gate before Task 3:
  - `supabase db reset` runs 0001→0002→0003→0004 cleanly; `knowledge_nodes` and
    `misconceptions` exist with RLS enabled and the canonical owner policies.
  - `cd web && npm run typecheck` still passes (regenerated DB types, if generated, compile).

---

## Task 3 — Live profile read replaces the hardcoded dummy (web)

Scope: /web/lib/learning/profile-read.ts (new), /web/lib/ai/{claude.ts,profile.ts},
/web/app/api/ai/turn/route.ts. **`system-prompt.ts` is NOT touched.**

/web/lib/learning/profile-read.ts (new):
  - `export async function loadProfile(supabase: SupabaseClient): Promise<LearningProfile>` —
    run query 1 (simplified): select the user's weakest/recent `knowledge_nodes`
    (`deleted_at is null`, `order by mastery asc`, `limit ≈ 12`) plus their `active`
    misconceptions (`status = 'active'`, `deleted_at is null`), via the RLS client (so
    `auth.uid()` scopes the rows — no explicit `user_id` filter needed, but include it for
    clarity). Map rows → `LearningProfile` (`masteryNodes`, `activeMisconceptions`,
    `confidenceNote`). For a user with **zero nodes**, return
    `{ masteryNodes: [], activeMisconceptions: [], confidenceNote: 'Calibrating — early estimate.' }`
    (the cold-start profile the prompt already renders as "no mastery data yet").
  - Keep the read bounded (LIMIT) — mirror the §2.5 budget comment style in
    `system-prompt.ts`. No page-relevance join this sprint (topic detection deferred — ADR-014).

/web/lib/ai/claude.ts (edit):
  - `runTutorTurn({ messages, pageContext, profile }: { messages: TurnMessage[]; pageContext?:
    PageContext; profile: LearningProfile })` — pass `profile` straight into
    `buildSystemPrompt(profile, pageContext)`. **Remove** the `HARDCODED_PROFILE` import; the
    caller now supplies the profile (the ADR-009 data-source swap). Model/`MAX_TOKENS`/single-
    call shape unchanged.

/web/lib/ai/profile.ts (edit):
  - Keep `LearningProfile`, `MasteryNode`, `ActiveMisconception`, and the band/state types — the
    source of truth for the shape. **Retire `HARDCODED_PROFILE`** (delete it, or move it under
    a clearly-named test fixture if a test still needs it). Update the file comment: the live
    source is now `/web/lib/learning/profile-read.ts`.

/web/app/api/ai/turn/route.ts (edit):
  - After `clientFromBearer`, `const profile = await loadProfile(auth.supabase)`; pass it into
    `runTutorTurn({ messages, pageContext, profile })`. Keep `parseMessages` / `parsePageContext`
    and the 401/400/502 paths unchanged. The route now **reads** the live profile but **still
    writes nothing** — update the header comment accordingly (ADR-013 holds; the read is not a
    write).

When done, list files created/edited and paste `loadProfile`, the changed `runTutorTurn`, and
the changed route. Confirm `system-prompt.ts` is unchanged (the ADR-009 promise).

Acceptance gate before Task 4:
  - `cd web && npm run typecheck && npm run lint` pass; `next build` exits 0.
  - With a seeded node, `POST /api/ai/turn` produces a `system` prompt whose STUDENT PROFILE
    block reflects the **DB** node (not the old dummy); a user with no nodes gets the calibrating
    fallback.
  - A turn still 401s without a bearer, 400s on bad messages, and writes nothing to the DB.

---

## Task 4 — Session summariser + minimal apply (web)

Scope: /web/lib/learning/{types.ts,update.ts,apply.ts}, /web/lib/ai/summarise.ts. No route
change yet.

/web/lib/learning/types.ts (new):
  - `export type ConceptObservation = { conceptKey: string; outcome: 'correct' | 'partial' |
    'incorrect' | 'none'; misconception?: { category: string; description?: string } }`.
  - `export type SessionSummary = { observations: ConceptObservation[] }`.
  - `export const KNOWN_CONCEPT_KEYS: readonly string[]` — a small inline allow-list (the
    `/packages/curriculum` stopgap) the summariser is constrained to and the read maps over.
    Comment it as the documented stand-in for the curriculum graph (ADR-014).

/web/lib/ai/summarise.ts (new) — the **second** sanctioned Anthropic SDK call site (ADR-008,
confined to `lib/ai`):
  - `export async function summariseSession({ transcript }: { transcript: TurnMessage[] }):
    Promise<SessionSummary>` — one model call asking for a JSON summary of which
    `KNOWN_CONCEPT_KEYS` concepts the student exercised and the outcome each, plus an optional
    misconception category. Parse defensively; on parse failure or empty transcript return
    `{ observations: [] }` (never throw to the caller — the session-end path degrades, ADR-015).
    Reuse the same client-construction pattern as `claude.ts`.

/web/lib/learning/update.ts (new) — pure, no I/O (future `/packages/learning-model` seed):
  - `export function updateMasteryNode(prev, observation): { mastery; state; observationCount;
    confidenceBand }` — minimal Elo-style nudge: `grade = {correct:1, partial:0.5, incorrect:0,
    none:skip}`, `mastery' = clamp(prev.mastery + K*(grade - prev.mastery), 0, 1)` with a small
    fixed `K`; derive `state` (`mastered ≥0.85 & band≠low`, `weak <0.5`, else `learning`),
    `confidenceBand` from `observationCount` (`<3 low`, `<8 medium`, else `high`). NO decay /
    stability / difficulty / lucky-guess logic — those are the FSRS package (ADR-014). Document
    the omissions.

/web/lib/learning/apply.ts (new):
  - `export async function applySessionSummary(supabase, summary): Promise<void>` — for each
    observation with a known `conceptKey`: read the current `knowledge_nodes` row (or defaults
    for unseen), compute the next state via `updateMasteryNode`, and **upsert** (on
    `user_id, concept_key`) with `observation_count++`, `last_practiced_at = now()`. For an
    observation carrying a misconception: **exact-category** match on
    `(user_id, concept_key, category)`; insert `pending` if none, else bump
    `occurrence_count`/`last_seen_at` and promote `pending → active` at `occurrence_count ≥ 2`.
    No fuzzy matching, no resolution streak (ADR-014). All writes go through the RLS client
    (rows are owner-scoped). Tolerate partial failure per observation (one bad row never aborts
    the rest).

When done, paste `summariseSession`, `updateMasteryNode`, and `applySessionSummary`.

Acceptance gate before Task 5:
  - typecheck + lint pass.
  - `updateMasteryNode` is pure and bounded (mastery stays in [0,1]; correct raises, incorrect
    lowers); `summariseSession` never throws (returns empty on bad/empty input); `applySessionSummary`
    upserts nodes and promotes a misconception on the 2nd matching instance.

---

## Task 5 — Session-end route writes the summary (web)

Scope: /web/app/api/session/end/route.ts only. `/web/lib/tier/session-gate.ts` is reused
unchanged.

/web/app/api/session/end/route.ts (edit):
  - Keep `clientFromBearer` + the `sessionId` validation + `endSession` + the 404 "no such open
    session" path exactly as today. Add an **optional** `transcript` (a `TurnMessage[]`,
    validated/capped like `parseMessages` in the AI route — untrusted client input).
  - **After** `endSession` returns the just-ended row (the open→ended transition — the
    idempotency guard), if a transcript is present: `const summary = await
    summariseSession({ transcript }); await applySessionSummary(auth.supabase, summary)` —
    **best-effort**: wrap in try/catch so a summariser/apply failure is logged but **does not
    fail** the end response (the session is already ended; ADR-015). If `endSession` matched no
    open session (404), do **not** run the summary.
  - No transcript ⇒ byte-for-byte the Sprint 04 end behaviour. State in the header that this is
    now the **only** DB write of learning state (ADR-015) and that `/api/ai/turn` still writes
    nothing.

When done, paste the changed route and state explicitly: (a) end with no transcript is
unchanged Sprint 04 behaviour; (b) the summary write runs at most once (open→ended guard); (c)
a summariser failure still ends the session.

Acceptance gate before Task 6:
  - typecheck + lint pass; `next build` exits 0.
  - With a valid bearer + transcript: ending a session writes `knowledge_nodes`, and a
    subsequent `loadProfile` reflects it. Ending again → 404, no second write. Ending with no
    transcript → unchanged. A forced summariser error still returns the ended session.

---

## Task 6 — Carry the transcript to session end (extension)

Scope: /extension/src/background/index.ts, /extension/src/lib/api.ts,
/extension/src/lib/storage.ts. **No new MessageType; popup/overlay/content unchanged.**

/extension/src/lib/storage.ts (edit):
  - Add `getRunningTranscript` / `setRunningTranscript` / `clearRunningTranscript` over
    `chrome.storage.session` (in-memory, ephemeral — mirrors how `activeSession` is cached).
    The transcript is **never** written to `chrome.storage.local`/disk (ADR-011/ADR-015).

/extension/src/background/index.ts (edit):
  - In `handleAiTurn`, after a successful relay, cache the `messages` it just forwarded via
    `setRunningTranscript` (the worker already receives the full running transcript every turn —
    no new traffic). Document this as the bounded, ephemeral exception to "the worker holds no
    conversation memory" — it is cleared on end and only forwarded for the session summary.
  - In `handleEndSession`, read the cached transcript and pass it to `api.endSession(active.sessionId,
    transcript)`, then `clearRunningTranscript()` (and clear it on sign-out too).

/extension/src/lib/api.ts (edit):
  - `endSession(sessionId: string, transcript?: TurnMessage[])` — include `transcript` in the
    POST body when present; otherwise behave exactly as today. No other change.

When done, list files edited and describe the full flow (overlay AI_TURN carries the running
transcript → worker caches it ephemerally → END_SESSION forwards it to `/api/session/end` →
summariseSession → applySessionSummary → knowledge_nodes/misconceptions → next session's
`loadProfile` → STUDENT PROFILE slot → Claude). Confirm: no new permission, no new message
type, transcript never persisted to disk, and end-without-a-prior-turn still ends cleanly.

Acceptance gate before Task 7:
  - `wxt build` exits 0; typecheck passes.
  - After a few turns, ending the session forwards the transcript; the backend writes mastery;
    re-opening for a new session shows the tutor calibrated to the prior session.
  - The extension adds no new `MessageType` and no new permission; the popup/overlay/content
    script diffs are empty.

---

## Task 7 — Tests: live read, summary write, RLS, back-compat, no-turn-write (gate)

Scope: /web/tests/{session.test.ts, ai-turn.test.ts, rls.test.ts}. Reuse the existing local
fake-Anthropic backend (no live model call, no real `ANTHROPIC_API_KEY`).

ai-turn.test.ts — add/adjust:
1. **Live profile in the prompt:** with a seeded `knowledge_node` for the test user, a turn's
   captured `system` prompt reflects that node (not the retired dummy).
2. **Cold start:** a user with no nodes gets the "calibrating" / "no mastery data yet" fallback.
3. **No DB write on the turn:** a turn writes nothing to `knowledge_nodes` (ADR-013 holds).

session.test.ts — add:
4. **Summary write:** ending a session with a transcript that exercises a known concept writes
   the expected `knowledge_nodes` row(s); a subsequent `loadProfile` reflects it (the
   acceptance, at the unit level).
5. **Idempotent / open→ended:** ending the same session again returns 404 and writes nothing
   more.
6. **Back-compat:** ending with no transcript still ends the session and writes no learning
   state.
7. **Degrades:** a forced summariser failure still ends the session (no 500).
8. **Misconception promotion:** two sessions flagging the same exact category promote it
   `pending → active`, and it then appears in `loadProfile`.

rls.test.ts — add:
9. **Owner-only:** user A cannot read or write user B's `knowledge_nodes` / `misconceptions`
   (canonical policy), matching the existing `sessions` RLS assertions.

When done, paste the new/changed cases and the passing output.

Acceptance gate before Task 8:
  - The suite passes: live profile injected; cold-start fallback; summary written on end and
    reflected by the next read; idempotent on re-end; back-compat with no transcript; degrades
    on summariser failure; misconception promotion; RLS owner-only — all with no live Anthropic
    call.

---

## Task 8 — Two-session cross-topic acceptance (manual)

This is the sprint's headline acceptance: **a second session on the same topic reflects the
first session's history.**

With `cd web && next dev` running (`ANTHROPIC_API_KEY` set in `/web/.env.local`) and the
unpacked extension loaded:
  1. Sign in with a Sprint 03/04 test account whose graph is **empty** (or freshly seeded
     empty). Open the overlay; confirm the tutor treats the student as new ("calibrating" —
     no prior-history references).
  2. **Session 1:** start a session on a known topic (e.g. factoring quadratics). Work a few
     turns where the student makes a **clear, repeated sign error** (the seeded misconception
     category). End the session (popup → end).
  3. **Verify the write:** confirm `knowledge_nodes` has a row for the worked concept with a
     plausible `mastery`/`state`, and (if the error recurred) a `misconceptions` row — `active`
     if it hit the 2-instance threshold. Confirm **no `session_interactions` row** and **no
     audio/URL** stored (still deferred).
  4. **Session 2 (same topic):** start a new session on the same topic and open the overlay.
     Ask a related question → the tutor **references the prior history** (calibrates difficulty,
     gently probes the known misconception) rather than treating the student as new. This is the
     acceptance.
  5. **Different topic:** start a session on an unrelated concept → the weak prior node still
     surfaces in the profile (global weakest-first), but the tutor stays on the new topic. (Page-
     relevant biasing is deferred — ADR-014.)
  6. **Voice turn (if voice keys set):** the same calibration shows on a voice turn (profile
     rides the same `/api/ai/turn` read).
  7. **No turn write:** confirm an AI turn writes nothing to the DB; the only learning write is
     at session end (ADR-013/ADR-015).
  8. **Idempotent end:** ending an already-ended session is a no-op (404), no double write.
  9. **Signed-out:** a turn shows "not signed in"; the route still 401s; no profile read/write
     happens for an anonymous caller.

---

## Acceptance criteria (full checklist)

**Sprint status: PLANNED.**

- [ ] `npm install` and `turbo run typecheck lint build` pass from the repo root with the new
      web + extension files present
- [ ] `cd web && next build` exits 0; `wxt build` exits 0
- [ ] `supabase db reset` runs 0001→0004 cleanly; `knowledge_nodes` and `misconceptions` exist
      with **RLS enabled in the same migration** and the canonical owner policy
- [ ] The live `loadProfile` (query 1, LIMIT-bounded) **replaces `HARDCODED_PROFILE`**; a new
      user reads as "calibrating"; **`system-prompt.ts` is unchanged** (the ADR-009 seam swap)
- [ ] `/api/ai/turn` **reads** the live profile and **still writes nothing** (ADR-013); a turn
      without a bearer 401s, with bad messages 400s, and writes no learning state
- [ ] On session end with a transcript, **one** summariser call produces a `SessionSummary`
      (constrained to `KNOWN_CONCEPT_KEYS`) and a **minimal** apply writes
      `knowledge_nodes`/`misconceptions`; ending with no transcript is unchanged Sprint 04
      behaviour
- [ ] The summary write is **idempotent** (runs at most once, via the open→ended transition) and
      **best-effort** (a summariser failure still ends the session)
- [ ] The transcript reaches `/api/session/end` by riding the **existing `AI_TURN` relay** — the
      worker caches it ephemerally and forwards it on `END_SESSION`; **no new `MessageType`, no
      per-turn DB write, no disk persistence** (ADR-011/ADR-015)
- [ ] Misconceptions use **exact-category + 2-instance promotion** only; fuzzy/`pgvector`
      matching, the resolution streak, the scheduler, `session_interactions`, the §2.5 JSON
      envelope, topic detection, and `/packages` extraction are **deferred** (ADR-014/ADR-015)
- [ ] The mastery update is a documented **minimal** Elo-style nudge (bounded; no FSRS
      decay/stability/difficulty/lucky-guess logic — those are the learning-model sprint)
- [ ] Output stays **plain text** (no JSON envelope on the turn — ADR-008); no audio/URL stored
- [ ] The test suite passes: live profile injected; cold-start fallback; summary written and
      reflected by the next read; idempotent on re-end; back-compat; degrades on failure;
      misconception promotion; RLS owner-only — all with no live Anthropic call
- [ ] **A second session on the same topic reflects the first session's history** across the
      manual walkthrough (Task 8)
- [ ] `/web/lib/ai/system-prompt.ts`, `/web/lib/ai/page-context.ts`, `/web/lib/tier/*`,
      `/web/app/api/{voice,auth,session/start}/*`, `/web/lib/auth/bearer.ts`,
      `/extension/src/{popup,overlay,content}/*`, and the voice/extractor code are untouched
- [ ] ADR-014 and ADR-015 exist; both CLAUDE.md sprint pointers updated
- [ ] git log shows commits for this sprint's tasks

---

## Risks

**Concept-key drift breaks the acceptance silently.** If the summariser emits different keys
across sessions (no curriculum graph yet), session 2 finds no matching node and "reflects
nothing." Mitigation: the inline `KNOWN_CONCEPT_KEYS` allow-list constrains the summariser's
output and the read to the **same** stable keys; Task 7/8 verify the round-trip. The
`/packages/curriculum` graph replaces the stopgap later (ADR-014).

**Writing to the host of locked decisions — RLS before data.** New tables receiving the
student's mastery state must not leak across users. Mitigation: RLS is enabled in the **same
migration** as each table, with the canonical `user_id = auth.uid()` policy (identical to
`sessions`); Task 7 asserts cross-user reads/writes are blocked.

**Reversing ADR-013 by reflex.** The obvious way to feed the graph is per-turn writes, which
would reverse "the turn path writes nothing." Mitigation: the **only** write is the end-of-
session summary; `/api/ai/turn` reads the profile but writes nothing; Task 7 asserts no DB
write on a turn (ADR-013/ADR-015).

**Summariser reliability — mislabelled outcomes corrupt the graph.** A bad summary could push
mastery the wrong way. Mitigation: the minimal update uses a **small `K`** (slow, bounded
nudges, never a jump); the summariser returns **empty** on parse failure rather than guessing;
confidence bands stay `low` until enough observations; the full confidence-gated FSRS update is
the learning-model sprint. Best-effort apply means a failure degrades rather than corrupts.

**Worker-held transcript drifting toward conversation memory.** Caching the transcript in the
worker risks re-introducing the state ADR-008 kept out. Mitigation: it lives only in
`chrome.storage.session` (in-memory), is **cleared on end and sign-out**, is never written to
disk/DB, and is used **only** to forward to the session-end summary — documented as a bounded
exception (ADR-015).

**Latency / cost at session end.** The summariser adds a model call when a session ends.
Mitigation: it runs **after** `endSession` returns the ended row and is **best-effort/async to
the result** — the session is already ended; a slow or failed summary never blocks the user.
One call per session (not per turn) keeps cost bounded.

**Token budget from a large profile or transcript.** A long-lived user or session could push a
big profile/transcript through the prompt. Mitigation: `loadProfile` is **LIMIT-bounded**
(weakest-first) and `renderProfileSummary` re-applies the §2.5 caps; the transcript is
validated/capped like `parseMessages` before the summariser sees it.

**Building the full learning model by reflex.** PLAN §2.4 describes FSRS + fuzzy matching + the
scheduler; the temptation is to build it all. Mitigation: ADR-014 and the out-of-scope list fix
the line at persist + read + minimal write; the FSRS package, fuzzy matching, scheduler, and
curriculum extraction are their own sprints.

---

## What the next sprint needs to know

**Calyxa now remembers students across sessions (minimal model).** A signed-in student's
mastery + misconceptions persist in `knowledge_nodes` / `misconceptions`, are read live into
the §2.5 STUDENT PROFILE slot (replacing the hardcoded dummy — ADR-009 fulfilled), and are
written by one end-of-session summariser call. The next sprints **enrich** this seam, they do
not rebuild it.
- **Read (ADR-014):** `/web/lib/learning/profile-read.ts` (`loadProfile`) is the live source of
  the `LearningProfile`; `system-prompt.ts` is unchanged. The **topic-detection sprint** adds
  the page-relevant bias (PLAN query 1's `$2`) and `detected_topic`; the **dashboard sprint**
  reads the same tables.
- **Write (ADR-015):** `/web/lib/ai/summarise.ts` + `/web/lib/learning/{update,apply}.ts` do a
  minimal Elo nudge + exact-category/2-instance misconceptions. The **learning-model sprint**
  replaces `update.ts` with the full **FSRS** model (decay/stability/difficulty, lucky-guess
  discounting) extracted to **`/packages/learning-model`**, replaces `KNOWN_CONCEPT_KEYS` with
  **`/packages/curriculum`**, and adds **fuzzy/`pgvector` matching + the 3-correct resolution
  streak** (the `embedding` column + `pg_trgm` GIN land then).
- **Deferred tables:** `session_interactions` (per-turn record + `applied_to_profile`
  idempotency ledger + the §2.5 JSON `assessment`) and `reinforcement_schedule` (query 2,
  spaced repetition, "let's revisit…") are **not** created this sprint — the scheduler/spaced-
  repetition sprint adds them.
- **Still deferred deliberately:** cold-start onboarding + initial graph seeding; `page_url_hash`
  / URL hashing (privacy sprint, PLAN §2.7); the mastery dashboard; model routing/escalation;
  Pro-gating. Page context and audio remain ephemeral (ADR-011/ADR-013).
