# Sprint 11 — Adaptive-engine deepening + structured AI output envelope

## Goal
Turn the tutor from a stateless responder into a **closed-loop adaptive engine**. Sprint 09 built
the real FSRS model but ran it **once per concept at session end**, off a *second* summariser call,
because two things were deferred: **per-turn `session_interactions` persistence** and the
**reinforcement scheduler** (ADR-016/ADR-014, both explicitly "the next sprint's job"). This sprint
lands both, and the piece that makes them possible — a **structured JSON output envelope** on the
turn itself. By the end:
- **every tutor turn returns a validated JSON envelope** — `say` / `annotations` / `assessment`
  (+ `mode`) — restoring the PLAN §2.5 output contract that ADR-008 deferred to plain text. The
  `assessment` is the tutor's read of the student's **last** answer, keyed to a **taggable
  curriculum concept key**. This is the shared foundation for **both** the per-turn learning write
  **and** the (later) annotation layer;
- **`/api/ai/turn` now persists** — one `session_interactions` row per turn (text only, no audio),
  carrying the envelope's `assessment` + a real **`response_latency_ms`** — reversing ADR-013's
  "the turn writes nothing" as a **deliberate, ADR-recorded** decision;
- **FSRS runs at per-interaction granularity**, not session-end. The real per-turn latency
  **restores the third lucky-guess sub-guard** that ADR-016 documented *off*, and the redundant
  end-of-session summariser Anthropic call is **retired** (the tutor already assessed each turn
  inline — we stop paying for a second model call to re-derive it);
- the **reinforcement scheduler** ships — `reinforcement_schedule` (migration + RLS),
  `scheduleReinforcement` (invert FSRS for `due_at`, PLAN §2.4), **query 2** (due-item fetch), and
  **"let's revisit…"** surfaced into the turn so faded/overdue concepts resurface naturally;
- **topic detection + read-time retrievability are surfaced into the turn** — the page-relevant
  bias that ADR-014 deferred (query 1's `page-relevant first` ordering) plus the decay/due signal,
  rendered into the STUDENT PROFILE block so the tutor calibrates to *what's on screen and fading*;
- **prompt work** makes Claude **consistently** reference the live profile with **taggable concept
  keys**, so the `assessment.concept_key` it emits is always a real curriculum key the write path
  can bind to.

```
turn  → runTutorTurn → ENVELOPE { say, annotations?, assessment, mode }
      → /api/ai/turn persists session_interactions (assessment + response_latency_ms)   [ADR-013 reversed]
      → per-interaction FSRS apply → knowledge_nodes (stability/difficulty)              [ADR-016 revisit]
      → scheduleReinforcement → reinforcement_schedule (due_at, priority)                [ADR-014 scheduler]
read  → loadProfile: weakest + PAGE-RELEVANT (topic bias) + DUE ("let's revisit…") + read-time decay
      → STUDENT PROFILE slot → tutor calibrates to what's on screen and what's fading
```

The adaptive machinery is now a **loop that closes within a single session**: a turn writes, the
next turn reads the updated profile. This sprint deliberately does **not** build the annotation
rendering layer, the mastery dashboard, cold-start onboarding, or the embedding/cosine match — each
is a later roadmap sprint that **consumes** the envelope and the per-turn record this sprint lands.

## Context
Through Sprint 10 the product **works and has a brand**: the shadow-DOM overlay, read-only page/LaTeX
extraction, the STT→AI→TTS voice pipeline, the Claude proxy, Supabase auth + RLS, the freemium gate,
the full FSRS learning-model + curriculum packages, and the design system. But the learning loop is
still **half-open**, exactly where Sprint 09 left it (its own "what the next sprint needs to know"):

- **`/api/ai/turn` writes nothing** (ADR-013). Learning state only updates at **session end**, via a
  **separate** summariser Anthropic call (`/web/lib/ai/summarise.ts`) that re-reads the whole
  transcript to reconstruct per-concept observations the tutor *already knew* while it was talking.
- Because there is no per-turn record, **FSRS runs at session-end granularity** (ADR-016) and
  `response_latency_ms` — the one signal it needs for the third lucky-guess sub-guard — **does not
  exist**, so that guard is documented **off**.
- The tutor's output is **plain text** (ADR-008 overrode the §2.5 JSON envelope), so there is no
  structured `assessment` and no place to hang annotations — the §2.5 envelope was always the
  intended contract; it was just deferred until voice + learning were proven.
- The **reinforcement scheduler** does not exist: `stability`/`difficulty` are persisted (Sprint 09)
  and *ready to read*, but nothing schedules review, so there is no "let's revisit…" and no due
  queue.
- `loadProfile` returns the **weakest** nodes only — the **page-relevant bias** (query 1's `$2`
  page-relevant concept keys) that would tie the profile to *what the student is looking at* was
  deferred (ADR-014).

This is the natural sprint to close all of it at once because they are **one mechanism**: the
envelope's `assessment` is what a `session_interactions` row stores; the stored row (with real
latency) is what lets FSRS run per-interaction with all three guards; the per-interaction FSRS update
is what `scheduleReinforcement` reads; and the scheduler's due items + topic bias are what
`loadProfile` surfaces back into the next turn. Build them separately and each half-solves the
others; build them together and the loop closes.

### Reconciliation with `/docs/PLAN.md` (read before Task 1) — what this restores, reverses, revisits
This sprint **implements** several things earlier sprints staged and **reverses one locked
deferral**:

**(a) The §2.5 JSON output envelope — restored.** PLAN §2.5 always specified a single-JSON-object
response: `say`, `annotations[]`, `mode`, `assessment{concept_key,outcome,reasoning_quality,
misconception_category,confidence}`. ADR-008 overrode it to plain text ("the §2.5 JSON envelope is
deferred to the voice sprint" — see `system-prompt.ts`'s own comment). This sprint adopts the
envelope on `/api/ai/turn`. The tutor's `assessment` is the same judgement Sprint 09's *separate*
summariser re-derived after the fact — now produced **inline, once, per turn**.

**(b) `session_interactions` + per-turn write — reversed from ADR-013.** ADR-013's "the turn writes
nothing" was correct **while there was nothing structured to write and no table to write it to**.
The envelope now produces a structured `assessment`, and this sprint adds the `session_interactions`
table (PLAN §2.3, text-only — **no audio**, upholding ADR-011). The turn writes exactly one row per
turn. This is the single most significant reversal of a prior decision this sprint makes; it is
recorded, with its rationale, in **ADR-019**.

**(c) FSRS per-interaction — the ADR-016 revisit point.** Sprint 09 fixed FSRS at session-end
granularity *only because* per-turn persistence was deferred, and named this the exact condition for
revisiting: "add `session_interactions` + `response_latency_ms` capture; this restores the third
lucky-guess guard and could move FSRS to per-interaction." Both conditions are now met, so FSRS moves
to per-interaction and the latency guard comes back on (**ADR-019**).

**(d) The reinforcement scheduler — the "scheduler sprint."** PLAN §2.4's `scheduleReinforcement`
inverts FSRS retrievability (`interval_days = 9·S·(1/R_d − 1)`, `R_d = 0.90`), with weak/misconception
urgency overrides, upserting `reinforcement_schedule`. PLAN §2.3 query 2 fetches due items. Sprint 09
persisted `stability`/`difficulty` precisely so this reads them with **no model change** (**ADR-020**).

**(e) Topic detection + page-relevant profile bias — the ADR-014 deferral.** PLAN §2.3 query 1 takes
`$2 = page-relevant concept keys` and orders them first. ADR-014 deferred that join ("no page-relevant
join / topic bias — deferred"). This sprint detects the active concept(s) from the **page context +
recent transcript** at turn time and biases the profile read, and surfaces read-time retrievability
(already computed on read since Sprint 09) into the prompt so the tutor acts on what's fading
(**ADR-021**). This is **turn-time topic inference from already-extracted context** — it does **not**
build `page_url_hash` history or any new page-tracking persistence (that stays the privacy sprint).

Recorded in **ADR-019** (JSON output envelope + per-turn `session_interactions` persistence +
per-interaction FSRS; restores §2.5 / ADR-008, reverses ADR-013, revisits ADR-016), **ADR-020**
(reinforcement scheduler; consumes the persisted stability/difficulty; revisits ADR-014/ADR-016), and
**ADR-021** (turn-time topic detection + read-time retrievability surfaced into the profile read;
revisits ADR-014's deferred page-relevant join).

### The envelope lands on `/api/ai/turn`, not the streaming path (read before Tasks 3, 4, 7)
The overlay's live path is **`/api/ai/turn`** (non-streaming): `background/index.ts`'s `AI_STREAM`
port handler calls `api.aiTurn()` and *fakes* word-by-word delivery by splitting the reply
client-side (Sprint 10 built `/api/ai/stream` but left it unwired — a Turbopack dev limitation; see
that sprint's notes). A single JSON envelope **cannot be streamed token-by-token** without leaking raw
JSON to the user, and the live path never streamed for real anyway — so the envelope lands on
`/api/ai/turn`, the route parses it, returns `say` to the client (**back-compat: the client still
receives a `reply` string** and keeps faking word-by-word), and persists the `assessment`.
`buildSystemPrompt` gains an **output-format parameter** (`'envelope' | 'text'`) so the still-unwired
`runTutorTurnStream` / `/api/ai/stream` keeps emitting **plain text** unchanged — this sprint does not
touch its behaviour. Reconciling the envelope with *true* SSE streaming (stream `say` deltas, then a
trailing `assessment` event) is a later concern, noted for the next sprint.

### Per-interaction apply runs off the turn's critical path (read before Tasks 4, 5)
A voice turn is latency-sensitive (§2.5). The turn route therefore does the **cheap** work
synchronously — parse the envelope, insert the one `session_interactions` row (a single indexed
insert), return `say` — and runs the **FSRS apply + `scheduleReinforcement`** *after* the response is
sent (Next/Vercel `waitUntil`, or an awaited-but-post-response tail), guarded by
`session_interactions.applied_to_profile` for idempotency. Because voice turns are seconds apart, the
update lands **before the next turn reads the profile**, so calibration still moves *within* the
session (the acceptance bar) without adding write latency to the spoken response. Session end becomes
a **reconciliation sweep** (apply any `applied_to_profile = false` rows), not a second model call.

### The end-of-session summariser is retired, not extended (read before Tasks 4, 5)
Sprint 09's `/web/lib/ai/summarise.ts` made a **separate** Anthropic call at session end to
reconstruct per-concept observations from the transcript. With the envelope, the tutor emits that
judgement **inline every turn** — re-deriving it afterward is redundant model spend. So the separate
summariser call is **retired**; `applySessionSummary`'s per-observation logic (FSRS update + fuzzy
misconception match + 3-correct resolution, all still correct) is **refactored to apply per
interaction** from the stored `assessment`, and `/api/session/end` stops calling the summariser and
instead reconciles unapplied rows. The misconception matching/promotion/resolution mechanism is
**unchanged** — it just runs per-interaction off `assessment.misconception_category` instead of
per-summary. (This also directly addresses Sprint 09's Task-8 finding that the *summariser's*
"clear, repeated error pattern" instruction under-flagged single slips — per-turn `assessment` logs
every flaggable turn, leaving the 2-instance promotion threshold to do the counting.)

## Execution model
A **single code session** owns this sprint end to end, worked **strictly in order (1 → 9)**. The
chain is real: the ADRs fix scope + the reversals (Task 1); the migrations must create
`session_interactions` + `reinforcement_schedule` before anything writes them (Task 2); the envelope
contract (prompt + `runTutorTurn` parse, Task 3) must exist before the turn route can persist an
`assessment` (Task 4); the per-interaction apply + scheduler (Task 5) consume what Task 4 stores;
the profile read gains topic bias + due items + the surfacing prompt work (Task 6) only after the
scheduler writes the queue; the extension threads `sessionId` + latency (Task 7) so the turn actually
persists against a real session; tests (Task 8) gate manual acceptance (Task 9). One session — no
handoff.

This sprint **does** touch the AI turn path (`/web/lib/ai/{system-prompt,claude,summarise}.ts`,
`/web/app/api/ai/turn/route.ts`), the learning write/read (`/web/lib/learning/*` + a new
`scheduler.ts`), `/web/app/api/session/end/route.ts` (retire summariser call → reconcile), two new
Supabase migrations + policies, and a **minimal** extension change to thread `sessionId` + a turn
timestamp. It **does not** touch the design system, the overlay/popup **presentation**, auth, the
freemium RPCs, the voice pipeline internals, page extraction, `runTutorTurnStream`/`/api/ai/stream`
behaviour, or the FSRS math in `/packages/learning-model` (the model is reused as-is; only its call
*granularity* changes).

## Files in scope

### Task 1 (ADRs + sprint pointers) creates or edits:
```
/docs/adr/ADR-019-output-envelope-per-turn-write.md ← new — §2.5 JSON envelope (say/annotations/assessment/mode) on /api/ai/turn; per-turn session_interactions persistence; per-interaction FSRS (latency guard restored); retires the separate end-of-session summariser call. Restores §2.5, overrides ADR-008's plain-text; REVERSES ADR-013; REVISITS ADR-016.
/docs/adr/ADR-020-reinforcement-scheduler.md        ← new — reinforcement_schedule table + scheduleReinforcement (invert FSRS, R_d=0.90) + query 2 due-fetch + "let's revisit…" surfacing. Consumes the persisted stability/difficulty; REVISITS ADR-014/ADR-016.
/docs/adr/ADR-021-topic-bias-read-time-surfacing.md ← new — turn-time topic detection from page context + recent transcript → page-relevant profile bias (query 1 $2 ordering) + read-time retrievability/due surfaced into the STUDENT PROFILE slot. No page_url_hash / page-history persistence (privacy sprint holds). REVISITS ADR-014's deferred page-relevant join.
/CLAUDE.md                                           ← edit one line: Current sprint → Sprint 11 — Adaptive-engine deepening + structured AI output envelope
/docs/CLAUDE.md                                      ← edit one line: Current phase → Phase 2, Sprint 11
/docs/sprint-11-plan.md                              ← this file
/docs/architecture.md                               ← edit: note session_interactions + reinforcement_schedule as live tables; the turn now writes (envelope + per-turn record); scheduler + topic-bias in the read path
```

### Task 2 (migrations — session_interactions + reinforcement_schedule) creates / edits:
```
/supabase/migrations/0007_session_interactions.sql   ← new — create session_interactions per PLAN §2.3 (turn_index, concept_key, student_transcript, tutor_response, outcome enum, self_confidence enum, response_latency_ms, misconception_category, applied_to_profile bool, user_id denormalised); RLS owner policy IN-migration; indexes idx_si_session_turn, idx_si_user_applied; FK→sessions ON DELETE CASCADE, FK→users; text only (NO audio — ADR-011). Re-runs clean on db reset.
/supabase/migrations/0008_reinforcement_schedule.sql ← new — create reinforcement_schedule per PLAN §2.3 (concept_key, due_at, interval_days, last_review_at, lapses, priority, user_id); RLS owner policy IN-migration; unique(user_id, concept_key), idx_rs_user_due; FK→users. Re-runs clean.
/supabase/policies/README.md                          ← edit — record the two new tables under the canonical owner-policy shape
/web/lib/db/types.ts (or generated types location)    ← edit only if the repo commits generated Supabase types — regenerate so the new tables typecheck
```

### Task 3 (output envelope contract — prompt + parse) creates / edits:
```
/web/lib/ai/envelope.ts        ← new — the TurnEnvelope type (say, annotations?, assessment?, mode) + a defensive parseEnvelope(raw) that mirrors summarise.ts's discipline (strip code fence, validate shape, degrade to { say: <raw text> } on any malformed/non-JSON output so a bad envelope NEVER blanks the tutor). assessment.concept_key constrained to CONCEPT_KEYS; annotations validated structurally (schema per §2.5) but not required.
/web/lib/ai/system-prompt.ts   ← edit — buildSystemPrompt(profile, pageContext, opts?: { format: 'envelope' | 'text' }); restore the §2.5 OUTPUT FORMAT (single JSON object) for 'envelope'; keep the current plain-text block for 'text' (default preserves stream-path behaviour). Add the taggable concept-key allow-list for assessment.concept_key + PROMPT WORK: instruct the tutor to reference the injected profile/misconceptions/due items and to always tag assessment with a real concept key.
/web/lib/ai/claude.ts          ← edit — runTutorTurn returns the parsed TurnEnvelope (not just { reply }); it builds the prompt with format:'envelope' and parses via envelope.ts. runTutorTurnStream stays format:'text' (unchanged behaviour). MODEL/token budgets unchanged.
```

### Task 4 (turn route — persist the interaction) edits:
```
/web/app/api/ai/turn/route.ts  ← edit — accept + USE sessionId (validate ownership); parse the envelope via runTutorTurn; return { reply: envelope.say } (client back-compat); on a gradable assessment, INSERT one session_interactions row (turn_index, concept_key, student_transcript = last user msg, tutor_response = say, outcome, self_confidence, response_latency_ms, misconception_category, applied_to_profile=false); kick the per-interaction apply OFF the critical path (waitUntil). Never let a persistence failure fail the turn (degrade like pageContext does). This is the ADR-013 reversal site.
```

### Task 5 (per-interaction apply + reinforcement scheduler) creates / edits:
```
/web/lib/learning/scheduler.ts ← new — scheduleReinforcement(node, hasActiveMisconception, lastOutcomeFailed): invert FSRS (interval_days = 9·S·(1/0.90−1), clamp [0.5,365]), weak/forgotten ×0.5 urgency, priority = 0.5 + 0.3(misconception) + 0.2(weak/forgotten); upsert reinforcement_schedule (due_at, interval_days, priority, lapses+=fail, last_review_at). Pure-ish DB writer (mirrors apply.ts's I/O boundary).
/web/lib/learning/apply.ts     ← edit — expose applyInteraction(supabase, userId, sessionId, interactionRow): run the existing per-observation FSRS update + fuzzy misconception match/resolution ON A SINGLE interaction (real timeSinceLast from the prior interaction/last_practiced_at, real response_latency_ms → third lucky-guess sub-guard back ON), call scheduleReinforcement, then set applied_to_profile=true (idempotent). Keep applySessionSummary reachable only as the reconciliation sweep helper (or fold into a reconcile fn).
/web/lib/ai/summarise.ts       ← edit/REMOVE — the separate end-of-session summariser Anthropic CALL is retired; keep only whatever pure parsing/types the reconcile path still needs, else delete and update importers.
/web/app/api/session/end/route.ts ← edit — stop calling summariseSession; instead RECONCILE (apply any applied_to_profile=false interactions for the session) then end. Route contract (request/response) unchanged; internals change.
/web/lib/learning/types.ts     ← edit only if needed — an InteractionRecord/assessment type shared by the route + apply.
```

### Task 6 (topic bias + due items + read-time surfaced into the read) edits:
```
/web/lib/learning/topic.ts     ← new — detectTopicKeys(pageContext, recentMessages): map extracted page text/LaTeX + recent transcript to CONCEPT_KEYS (lightweight keyword/curriculum match; NO model call, NO new persistence). Returns the page-relevant key set for the profile bias.
/web/lib/learning/profile-read.ts ← edit — loadProfile(supabase, { topicKeys? }): order topicKeys first (§2.3 query 1 page-relevant bias, ADR-014's deferred join) AND fetch due reinforcement items (§2.3 query 2) so LearningProfile carries a "due for review" set; keep the existing read-time decay. LearningProfile SHAPE extended minimally (dueForReview), not reshaped.
/web/lib/ai/profile.ts         ← edit — LearningProfile gains an optional dueForReview list (concept keys + why) — one source of truth for the type.
/web/lib/ai/system-prompt.ts   ← edit — render the due/page-relevant signal in the STUDENT PROFILE block ("Fading / due for review — a natural 'let's revisit…' opening") + finish the PROMPT WORK so the tutor consistently references the live profile with taggable keys. Block STRUCTURE unchanged; new lines are additive.
/web/app/api/ai/turn/route.ts  ← edit — detect topicKeys (Task 6 helper) from pageContext + messages and pass to loadProfile.
```

### Task 7 (extension — thread sessionId + turn timing) edits:
```
/extension/src/background/index.ts ← edit — include the stored active sessionId (already in storage.ActiveSession) on the AI_STREAM/turn request; stamp turn start time so the route (or the client) supplies response_latency_ms. Transport/UX otherwise unchanged.
/extension/src/lib/api.ts          ← edit — aiTurn() sends sessionId (+ latency signal) in the body. No new endpoint.
/extension/src/types/messages.ts   ← edit only if needed — carry sessionId/latency on the turn message shape.
```
No overlay presentation change (annotations are NOT rendered this sprint — the field rides the
envelope for the later annotation sprint).

### Files explicitly out of scope
```
/web/lib/ai/page-context.ts        (extraction/rendering unchanged — topic.ts consumes its output)
/web/app/api/ai/stream/route.ts    (still unwired; keeps emitting plain text via format:'text')
/web/lib/ai/claude.ts runTutorTurnStream  (behaviour unchanged — text format only)
/packages/learning-model/**        (the FSRS MATH is reused as-is; only its call granularity changes)
/packages/curriculum/**, /packages/ui/**  (untouched)
/web/lib/{tier,auth,voice,consent}/**, /web/app/api/{auth,voice,session/start}/**  (unchanged)
/extension/src/overlay/**, /extension/src/popup/**, /extension/src/content/**  (presentation/extraction unchanged)
/supabase/migrations/0001..0006    (additive only — 0007/0008 do not touch them)
```
Also out of scope (no pre-empting later roadmap sprints):
- **Annotation rendering layer** (the SVG overlay layer, targeting/resolvers, scroll reposition) —
  the envelope carries `annotations`; **drawing** them is the annotation sprint.
- **Mastery/analytics dashboard, study-materials generator, billing/upgrade UI, marketing page** —
  each its own sprint; each consumes this sprint's per-turn record + scheduler queue.
- **Cold-start onboarding** (assessment UI + prior propagation) — a new user still reads
  "calibrating."
- **`page_url_hash` / detected-topic PERSISTENCE / page-history** — topic detection is turn-time,
  in-memory, from already-extracted context; no new page-tracking table (privacy sprint holds).
- **Embedding/cosine misconception match + ivfflat** — still the embedding sprint (ADR-017).
- **True SSE streaming of the envelope** — the envelope is on the non-streaming turn; reconciling
  it with real streaming is later.

Do not create any file not listed above. If something seems needed but is not listed, add it to
"What the next sprint needs to know" and ask before creating it.

---

## Task 1 — Output-envelope + scheduler + topic-bias ADRs + sprint pointers (planning / docs)

Write three ADRs in the project format (match ADR-001…ADR-018 exactly: `## ADR-0NN: [Title]`, then
`**Status:** Decided`, `**Context:**`, `**Decision:**`, `**Rationale:**` bullets, `**Consequences:**`
Enables/Requires/Forecloses).

ADR-019 — Structured JSON output envelope + per-turn `session_interactions` persistence + per-interaction FSRS:
- Context: PLAN §2.5 specified a single-JSON-object response (`say`/`annotations`/`mode`/`assessment`);
  ADR-008 overrode it to plain text "for the voice sprint," and ADR-013 fixed "the turn writes
  nothing." Sprint 09 then ran FSRS at session-end granularity off a *separate* summariser call, with
  `response_latency_ms` unavailable so the third lucky-guess sub-guard was **off** — and named the
  exact revisit condition (per-turn persistence + latency capture). A decision was needed: keep
  re-deriving assessments after the fact at session end, or have the tutor emit a structured
  `assessment` inline and persist it per turn.
- Decision: adopt the §2.5 envelope on `/api/ai/turn`; persist one `session_interactions` row per turn
  (text only — ADR-011 upheld) carrying the `assessment` + real `response_latency_ms`; run FSRS
  **per-interaction** (latency guard back on), off the turn's critical path (`waitUntil`, idempotent
  via `applied_to_profile`); **retire** the separate end-of-session summariser call, reducing
  `/api/session/end` to a reconciliation sweep. The envelope lands on the non-streaming turn (the live
  path); the unwired stream path keeps plain text via a `format` param. Restores §2.5 / overrides
  ADR-008; **reverses ADR-013**; **revisits ADR-016**.
- Rationale (bullets): the tutor already forms this judgement while responding — persisting it inline
  is cheaper and more faithful than a second model call re-reading the transcript; a real per-turn
  latency restores a guard we intentionally shipped off; per-interaction apply closes the learning
  loop within a session (calibration moves turn to turn); off-critical-path apply keeps voice latency
  intact; the envelope is the shared foundation the annotation sprint needs; degrade-to-plain-text
  parsing means a malformed envelope never blanks the tutor.
- Consequences: Enables — a tutor that assesses + records + recalibrates every turn; the structured
  slot annotations later ride. Requires — `session_interactions` (Task 2); the turn to thread a real
  `sessionId` (Task 7); the envelope parser to degrade safely. Forecloses — nothing it does not defer;
  annotation rendering, the dashboard, and true envelope-over-SSE streaming remain later.

ADR-020 — Reinforcement scheduler (`reinforcement_schedule` + `scheduleReinforcement` + query 2):
- Context: Sprint 09 persisted `stability`/`difficulty` explicitly so "the scheduler sprint reads them
  and builds the queue with no model change," and deferred `reinforcement_schedule`, query 2, and
  "let's revisit…" (ADR-014/ADR-016). Nothing schedules review yet.
- Decision: add `reinforcement_schedule` (PLAN §2.3, RLS in-migration); implement PLAN §2.4
  `scheduleReinforcement` — invert FSRS retrievability for `due_at` at `R_d = 0.90`
  (`interval_days = 9·S·(1/R_d − 1)`, clamped), weak/forgotten ×0.5 urgency, `priority = 0.5 +
  0.3·hasActiveMisconception + 0.2·(weak|forgotten)`, `lapses += fail` — called at each per-interaction
  apply; add query 2 (due-item fetch) and surface due items as "let's revisit…" candidates in the
  read. Revisits ADR-014/ADR-016 (a direct read of state they persisted).
- Rationale (bullets): FSRS is already the memory model, so the scheduler is a direct inversion, not a
  parallel system (§2.4); weak/misconception urgency matches the pedagogy; upsert-per-concept keeps
  the queue one row per (user, concept); it consumes only already-persisted columns.
- Consequences: Enables — spaced reinforcement, the "let's revisit…" opening, and the dashboard's due
  queue later. Requires — `reinforcement_schedule` (Task 2); the per-interaction apply site (ADR-019)
  to call it. Forecloses — nothing; the dashboard surfacing + Pro-gating of spaced reinforcement remain
  their sprints.

ADR-021 — Turn-time topic detection + read-time retrievability surfaced into the profile read:
- Context: PLAN §2.3 query 1 takes page-relevant concept keys and orders them first; ADR-014 deferred
  that join. Read-time decay exists (Sprint 09) but is invisible to the tutor. The profile the tutor
  sees is "weakest overall," not "relevant to this screen and fading."
- Decision: detect the active concept keys at **turn time** from the already-extracted page context +
  recent transcript (lightweight curriculum match — no model call, no new persistence); bias
  `loadProfile` to order those first (query 1's page-relevant bias) and fetch due items (query 2);
  render the fading/due signal into the STUDENT PROFILE block so the tutor opens with a natural
  "let's revisit…". No `page_url_hash` / page-history table (privacy sprint holds). Revisits ADR-014's
  deferred page-relevant join.
- Rationale (bullets): the page context is already extracted and read-only (ADR-012/013) — inferring
  topic from it adds no capture and no persistence; biasing the read is a query change, not a model
  change; surfacing decay/due makes the calibration the model already computes actionable.
- Consequences: Enables — a profile tied to what's on screen and fading, driving measurably better
  calibration across a session. Requires — the scheduler queue (ADR-020) for the due signal; the turn
  to pass detected keys to the read. Forecloses — nothing; persistent page/topic history + `page_url_hash`
  remain the privacy sprint.

Then two one-line pointer edits: `/CLAUDE.md` "Current sprint" → `Sprint 11 — Adaptive-engine
deepening + structured AI output envelope`; `/docs/CLAUDE.md` "Current phase" → `Phase 2, Sprint 11`.
Change no other line in either. Update `/docs/architecture.md` to record the two new live tables + the
now-writing turn + the scheduler/topic-bias read path.

Acceptance gate before Task 2:
  - ADR-019/020/021 exist in the exact format and record the decisions above; ADR-019 explicitly
    reverses ADR-013 and revisits ADR-016; ADR-020/021 revisit ADR-014. Both CLAUDE.md pointers +
    architecture.md updated.

---

## Task 2 — Migrations: session_interactions + reinforcement_schedule (supabase)

Scope: `/supabase/migrations/0007_session_interactions.sql`,
`/supabase/migrations/0008_reinforcement_schedule.sql`, `/supabase/policies/README.md`, generated
types if committed. Additive only; 0001–0006 untouched; re-run clean on a fresh `supabase db reset`.
RLS **before data** — enabled in the same migration as each table (the canonical owner-policy shape).

  - `0007`: `session_interactions` per PLAN §2.3 — `id`, `session_id` (FK→sessions, `on delete
    cascade`), `user_id` (FK→users, denormalised for RLS), `turn_index int`, `concept_key text null`,
    `student_transcript text null`, `tutor_response text null`, `outcome` enum-check
    (`correct|incorrect|partial|none`, default `none`), `self_confidence` enum-check
    (`low|med|high|unknown`, default `unknown`), `response_latency_ms int null`,
    `misconception_category text null`, `applied_to_profile bool not null default false`, `created_at`,
    `deleted_at`. Indexes `idx_si_session_turn (session_id, turn_index)`,
    `idx_si_user_applied (user_id, applied_to_profile)`. **Text only — no audio column (ADR-011).**
    Owner RLS policy in-migration.
  - `0008`: `reinforcement_schedule` per PLAN §2.3 — `id`, `user_id` (FK→users), `concept_key text`,
    `due_at timestamptz`, `interval_days real default 1.0`, `last_review_at timestamptz null`,
    `lapses int default 0`, `priority real default 0.5`, `created_at`/`updated_at` (+ the shared
    `set_updated_at` trigger), `deleted_at`. `unique(user_id, concept_key)`,
    `idx_rs_user_due (user_id, due_at)`. Owner RLS policy in-migration.
  - `/supabase/policies/README.md`: record both tables under the canonical `user_id`-keyed shape.
  - Regenerate committed Supabase types (if the repo commits them) so `/web` typechecks the new tables.

Acceptance gate before Task 3:
  - `supabase db reset` runs 0001→0008 cleanly; both tables exist with the columns/indexes above and
    RLS enabled; the owner policy denies cross-user reads; `cd web && npm run typecheck` passes.

---

## Task 3 — The output-envelope contract: prompt + parse (web AI lib)

Scope: `/web/lib/ai/envelope.ts` (new), `/web/lib/ai/system-prompt.ts`, `/web/lib/ai/claude.ts`.

  - `envelope.ts`: `TurnEnvelope { say: string; annotations?: Annotation[]; assessment?: Assessment;
    mode?: 'socratic'|'direct' }`; `Assessment { conceptKey: string|null; outcome; reasoningQuality;
    misconceptionCategory: string|null; confidence }`. `parseEnvelope(raw)` mirrors `summarise.ts`:
    strip code fence, `JSON.parse`, validate each field, **constrain `assessment.conceptKey` to
    `CONCEPT_KEYS`** (null it otherwise), validate `annotations` structurally (§2.5 schema) but treat
    as optional. **Critical:** on any non-JSON / malformed output, degrade to
    `{ say: <the raw text> }` so a bad envelope renders as a normal reply — the tutor is **never**
    blanked.
  - `system-prompt.ts`: `buildSystemPrompt(profile, pageContext, opts?: { format })`. For
    `format:'envelope'`, restore the §2.5 OUTPUT FORMAT (single JSON object, `say`/`annotations`/`mode`/
    `assessment`, "omit assessment on your opening turn," ≤~60 spoken words). For `format:'text'`
    (default), keep the current plain-text block verbatim (stream path unaffected). **Prompt work:**
    add the taggable-concept-key allow-list for `assessment.concept_key`, and instruct the tutor to
    (a) reference the injected mastery/misconceptions/due-review signal and (b) always tag `assessment`
    with a real curriculum key (or `null` if none applies).
  - `claude.ts`: `runTutorTurn` builds with `format:'envelope'`, parses via `parseEnvelope`, returns the
    `TurnEnvelope`. `runTutorTurnStream` keeps `format:'text'` and its plain-delta behaviour. Model +
    token budgets unchanged.

Acceptance gate before Task 4:
  - typecheck + lint pass. `runTutorTurn` returns a valid envelope for well-formed model JSON and
    degrades to `{ say }` for plain text / malformed JSON. `assessment.conceptKey` is always a
    `CONCEPT_KEYS` member or `null`. The stream path's prompt/output is byte-for-byte unchanged.

---

## Task 4 — Turn route persists the interaction (web API)

Scope: `/web/app/api/ai/turn/route.ts`. The **ADR-013 reversal site.**

  - Accept + **use** `sessionId` (currently accepted-and-ignored): validate it belongs to the auth user
    (RLS + an explicit ownership check); a missing/invalid `sessionId` degrades to "no persistence this
    turn" (still returns the reply) rather than 400ing.
  - Call `runTutorTurn` → `TurnEnvelope`; return `{ reply: envelope.say }` (client back-compat —
    unchanged wire shape). Compute `turn_index` from the message count / prior interactions.
  - When `envelope.assessment` has a gradable `outcome`, **insert one `session_interactions` row**
    (`turn_index`, `concept_key`, `student_transcript` = last user message, `tutor_response` = say,
    `outcome`, `self_confidence`, `response_latency_ms` from Task 7's timing, `misconception_category`,
    `applied_to_profile=false`). A persistence failure is logged and swallowed — it **never** fails the
    turn (the pageContext-degradation discipline).
  - **Off the critical path** (`waitUntil`), call `applyInteraction` (Task 5) for the inserted row.
    Return the response before the apply completes.

Acceptance gate before Task 5:
  - typecheck + lint + `next build` pass. A turn with a valid `sessionId` writes exactly one
    `session_interactions` row with the envelope's assessment + a latency value; a turn without a
    `sessionId` (or with an opening-turn/no-assessment envelope) writes none and still replies; the
    client still receives `{ reply }`.

---

## Task 5 — Per-interaction apply + reinforcement scheduler (web learning lib)

Scope: `/web/lib/learning/{scheduler.ts (new), apply.ts, types.ts}`, `/web/lib/ai/summarise.ts`
(retire the call), `/web/app/api/session/end/route.ts`.

  - `scheduler.ts`: `scheduleReinforcement(supabase, userId, node, { hasActiveMisconception,
    lastOutcomeFailed })` per PLAN §2.4 — `interval_days = clamp(9·S·(1/0.90 − 1), 0.5, 365)`,
    ×0.5 for `weak|forgotten`, `priority = 0.5 + 0.3·misconception + 0.2·(weak|forgotten)`; upsert
    `reinforcement_schedule` (`due_at = now + interval_days`, `interval_days`, `priority`,
    `lapses += lastOutcomeFailed`, `last_review_at = now`) on the `(user_id, concept_key)` unique key.
  - `apply.ts`: add `applyInteraction(supabase, userId, sessionId, row)` — run the existing
    per-observation FSRS update + fuzzy misconception match/resolution for the **single** interaction,
    with **real `timeSinceLastDays`** (from the prior interaction / `last_practiced_at`) and **real
    `response_latency_ms`** (third lucky-guess sub-guard back **on**); then `scheduleReinforcement`;
    then set `applied_to_profile=true` (idempotent — a re-run is a no-op). Keep the misconception
    matching/promotion/resolution logic unchanged; it now feeds off `assessment.misconception_category`
    per turn.
  - `summarise.ts`: **retire the end-of-session summariser Anthropic call.** Delete the module (updating
    importers) or keep only pure helpers the reconcile path needs — but the second model call is gone.
  - `session/end/route.ts`: stop calling `summariseSession`; instead **reconcile** — sweep the
    session's `applied_to_profile=false` interactions through `applyInteraction` (a safety net for any
    `waitUntil` that didn't complete), then end the session (Sprint 04 behaviour). Route request/response
    contract unchanged.

Acceptance gate before Task 6:
  - typecheck + lint + `next build` pass. A gradable turn updates `knowledge_nodes` (mastery **and**
    stability/difficulty) **and** upserts a `reinforcement_schedule` row within the session; a guessed
    correct (low latency / shallow reasoning) moves mastery **less** than a reasoned one (latency guard
    demonstrably back on); `applied_to_profile` prevents double-apply; ending a session applies no
    row twice and makes **no** Anthropic call.

---

## Task 6 — Topic bias + due items + read-time surfaced into the read (web)

Scope: `/web/lib/learning/{topic.ts (new), profile-read.ts}`, `/web/lib/ai/{profile.ts,
system-prompt.ts}`, `/web/app/api/ai/turn/route.ts`.

  - `topic.ts`: `detectTopicKeys(pageContext, recentMessages)` → a `CONCEPT_KEYS` subset via a
    lightweight curriculum keyword/alias match over the extracted page text + LaTeX + recent transcript.
    **No model call, no persistence.** Bounded, deterministic, degrades to `[]`.
  - `profile-read.ts`: `loadProfile(supabase, { topicKeys })` — order `topicKeys` first (§2.3 query 1
    page-relevant bias, ADR-014's deferred join) and run **query 2** (due `reinforcement_schedule`
    joined to `knowledge_nodes`, `due_at <= now`, ordered `priority DESC, due_at ASC`, LIMIT 10) to
    populate a `dueForReview` set on the profile. Keep the existing read-time retrievability decay.
    `LearningProfile` is **extended** (`dueForReview`), not reshaped; `masteryNodes`/`activeMisconceptions`
    unchanged.
  - `profile.ts`: add `dueForReview?: { conceptKey: string; reason: string }[]` to `LearningProfile`
    (one source of truth).
  - `system-prompt.ts`: render a **"Fading / due for review"** line in the STUDENT PROFILE block from
    `dueForReview`, phrased as a natural "let's revisit…" opening the tutor may use; complete the prompt
    work so the tutor consistently references the profile with taggable keys. Additive lines only — the
    block structure (and the ADR-009 seam contract) holds.
  - `turn/route.ts`: call `detectTopicKeys` from `pageContext` + `messages` and pass `topicKeys` to
    `loadProfile`.

Acceptance gate before Task 7:
  - typecheck + lint + `next build` pass. With a seeded due item + a page whose context maps to a
    concept, `loadProfile` returns that concept **first** and lists it under `dueForReview`; the rendered
    system prompt contains the "let's revisit…" / fading line; a profile with no due items / no topic
    match reads exactly as before (back-compat).

---

## Task 7 — Extension threads sessionId + turn timing (extension)

Scope: `/extension/src/{background/index.ts, lib/api.ts, types/messages.ts}`. Minimal — transport
only, no presentation/UX change, no overlay edit.

  - `background/index.ts`: attach the stored active `sessionId` (already in `storage.ActiveSession`) to
    the turn request; stamp the turn start time and supply `response_latency_ms` (client-measured
    round-trip / think-time) so the route persists a real latency.
  - `api.ts`: `aiTurn()` sends `sessionId` (+ latency) in the body; no new endpoint, no auth change.
  - `types/messages.ts`: carry `sessionId`/latency on the turn message shape if the types require it.

Acceptance gate before Task 8:
  - `wxt build` exits 0; a real overlay turn posts a `sessionId` + latency, and the backend writes a
    `session_interactions` row tied to the correct session; the overlay UX/streaming feel is unchanged.

---

## Task 8 — Tests (gate)

Scope: `/web/tests/{ai-turn.test.ts, session.test.ts, rls.test.ts}` (+ a new envelope/scheduler unit
spec as needed). Reuse the existing fake-Anthropic backend — **no live model call** (mock the envelope
JSON, as `ai-turn.test.ts` already mocks the SDK).

  1. **Envelope parse:** well-formed envelope JSON parses to `{ say, assessment, mode }`; plain text /
     malformed JSON degrades to `{ say: <raw> }`; `assessment.conceptKey` outside `CONCEPT_KEYS` is
     nulled; `annotations` validated but optional.
  2. **Per-turn persistence:** a gradable turn writes exactly one `session_interactions` row with the
     assessment + latency; an opening/no-assessment turn writes none; both still return `{ reply }`.
  3. **No-turn-write → now-writes reversal is bounded:** a turn **without** a `sessionId` writes nothing
     and still replies (degrade path); a persistence failure never fails the turn.
  4. **Per-interaction FSRS + latency guard:** a gradable interaction updates mastery **and**
     stability/difficulty; a low-latency/shallow "correct" moves mastery **less** than a reasoned one
     (the restored third sub-guard); `applied_to_profile` makes re-apply a no-op.
  5. **Scheduler:** an apply upserts one `reinforcement_schedule` row per (user, concept) with a
     sensible `due_at`/`priority`; a weak/misconception concept gets pulled forward + ranked higher.
  6. **Due resurfacing + topic bias:** query 2 returns due items; `loadProfile` lists them under
     `dueForReview` and orders `topicKeys` first; the system prompt renders the "let's revisit…" line.
  7. **Session-end reconcile, no summariser call:** ending a session applies unapplied interactions and
     makes **no** Anthropic call; nothing is applied twice.
  8. **RLS:** `session_interactions` + `reinforcement_schedule` are owner-only (cross-user read denied).
  9. **Back-compat:** existing `session`/`voice`/`rls` suites stay green under the retired-summariser +
     writing-turn changes.

Acceptance gate before Task 9:
  - the full `/web` suite passes with no live Anthropic call; the envelope, persistence, per-interaction
    FSRS, scheduler, due-resurfacing/topic-bias, reconcile, and RLS cases all pass; `turbo run typecheck
    lint build test` is green across workspaces; `next build` exits 0.

---

## Task 9 — Adaptive-loop acceptance (manual)

With `cd web && next dev` (`ANTHROPIC_API_KEY` set) and the unpacked extension loaded:
  1. **Valid envelope every turn:** each `/api/ai/turn` reply is a valid envelope server-side
     (`say` + a tagged `assessment` with a real concept key); the student still hears/sees only `say`,
     streamed word-by-word as before.
  2. **Per-turn persistence:** each turn writes one `session_interactions` row (text only — **no audio**)
     tied to the active session, with `outcome`/`self_confidence`/`response_latency_ms`.
  3. **Per-interaction calibration within a session:** a concept answered well early in a session reads
     back with **higher** mastery on a **later** turn of the **same** session (the loop closes mid-session,
     not just at end) — inspect `knowledge_nodes` + the injected profile.
  4. **Reinforcement schedules + resurfaces:** after a session, `reinforcement_schedule` has due rows;
     a concept that lapsed/was weak is pulled forward; a later session surfaces it and the tutor opens
     with a natural **"let's revisit…"**.
  5. **Topic bias:** on a page whose math maps to a concept, the injected profile lists that concept
     **first** and the tutor anchors to it.
  6. **Lucky-guess discount live:** a fast, unreasoned "correct" raises mastery **less** than a slower
     reasoned one (the latency guard is back on with real per-turn timing).
  7. **No second model call / audio never persisted:** session end makes **no** summariser Anthropic
     call; no audio is stored anywhere; `session_interactions.student_transcript` holds text only.
  8. **Cold start unchanged:** a new user still reads "calibrating."

---

## Acceptance criteria (full checklist)

**Sprint status: PLANNED — not started.** (Tasks 1–9 below; update this line as tasks land, per the
Sprint 09/10 convention.)

- [ ] `turbo run typecheck lint build test` passes from root; `cd web && next build` and
      `cd extension && wxt build` both exit 0
- [ ] every tutor turn returns a **valid §2.5 envelope** (`say`/`annotations?`/`assessment`/`mode`);
      a malformed/plain response degrades to `{ say }` and **never** blanks the tutor;
      `assessment.concept_key` is always a real `CONCEPT_KEYS` member or `null`
- [ ] `/api/ai/turn` **persists** one `session_interactions` row per gradable turn (text only — no
      audio, ADR-011), carrying the assessment + a real `response_latency_ms` — the **ADR-013 reversal**,
      recorded in ADR-019; a persistence failure never fails the turn
- [ ] **FSRS runs per-interaction**: mastery **and** stability/difficulty update within a session; the
      **third lucky-guess sub-guard is back on** (real latency); `applied_to_profile` prevents
      double-apply; the separate end-of-session summariser Anthropic call is **retired**, `/api/session/end`
      reconciles instead
- [ ] the **reinforcement scheduler** ships: `reinforcement_schedule` (RLS in-migration),
      `scheduleReinforcement` (invert FSRS, `R_d=0.90`, urgency + priority), query 2 due-fetch, and
      **"let's revisit…"** surfaced into the turn; due/weak/misconception concepts resurface
- [ ] **topic detection + read-time retrievability** are surfaced into the read: page-relevant concepts
      order first (ADR-014's deferred query-1 bias) and the fading/due signal renders in the STUDENT
      PROFILE block — **no** `page_url_hash`/page-history persistence added
- [ ] **prompt work**: the tutor consistently references the injected profile and tags every
      `assessment` with a taggable curriculum concept key
- [ ] the FSRS **math** in `/packages/learning-model` is unchanged (only call granularity changed);
      `/packages/{curriculum,ui}`, the design system, auth, freemium, voice internals, page extraction,
      and the overlay/popup **presentation** are untouched; annotations ride the envelope but are **not
      rendered** this sprint
- [ ] the two new migrations run 0001→0008 clean on `supabase db reset` with RLS **before data**; both
      new tables are owner-only
- [ ] the `/web` suite passes (envelope, persistence, per-interaction FSRS + latency guard, scheduler,
      due-resurfacing/topic-bias, reconcile, RLS, back-compat) with **no** live Anthropic call; the full
      turbo pipeline is green
- [ ] manual acceptance (Task 9) observed: valid envelope per turn, per-turn persistence, mid-session
      calibration, reinforcement schedule + "let's revisit…", topic bias, live lucky-guess discount, no
      second model call, audio never persisted, cold start unchanged
- [ ] ADR-019/020/021 exist (ADR-019 reverses ADR-013 + revisits ADR-016; ADR-020/021 revisit ADR-014);
      both CLAUDE.md pointers + architecture.md updated; git log shows a commit per task

---

## Risks

**Reversing "the turn writes nothing" (ADR-013) on the hot path.** The turn is now a write path, and
it's latency-sensitive (voice). Mitigation: only the single indexed `session_interactions` insert is
synchronous; the FSRS apply + scheduler upsert run **off the critical path** (`waitUntil`, idempotent
via `applied_to_profile`); a persistence failure degrades to "no write this turn," never a failed
reply; ADR-019 records the reversal explicitly so it doesn't read as a silent policy break.

**Envelope parsing blanking the tutor.** A model that returns prose, a truncated object, or fenced
JSON must not produce an empty `say`. Mitigation: `parseEnvelope` degrades any non-conforming output to
`{ say: <raw text> }` (the summariser's defensive discipline), so the worst case is a plain reply with
no assessment — the student always gets an answer. Task 8 asserts this.

**Streaming vs a single JSON object.** The envelope can't be streamed token-by-token without leaking
JSON. Mitigation: the envelope is on the **non-streaming** live path (`/api/ai/turn`); the client keeps
its existing client-side word-by-word fake; the unwired stream path stays plain text via the `format`
param. Reconciling envelope-over-real-SSE is explicitly a later sprint.

**Per-interaction apply drifting from the (correct) session-end logic.** Refactoring
`applySessionSummary` to per-interaction could subtly change the FSRS/misconception behaviour Sprint 09
proved. Mitigation: reuse the **same** per-observation functions unchanged — only the *caller* changes
(one interaction vs a summary list); Task 8 re-asserts the Sprint 09 properties (bounds, guess < reason,
slip softening, 2-instance promotion, 3-correct resolution) against the per-interaction path.

**Retiring the summariser removes a safety net.** If per-turn assessments are unreliable, dropping the
end-of-session re-derivation could lose signal. Mitigation: session end **reconciles** (sweeps unapplied
rows) rather than no-oping; the per-turn `assessment` is the tutor's own live read (more faithful than a
post-hoc reconstruction); and this directly fixes Sprint 09's Task-8 under-flagging finding (every
flaggable turn is logged; promotion counting is unchanged). If per-turn flagging proves noisy in Task 9,
tightening is a prompt edit, not a schema change.

**Uncalibrated scheduler constants.** `R_d`, `MIN_INT`/`MAX_INT`, priority weights are §2.4/literature
defaults with no real response data. Mitigation: named + centralised (as Sprint 09 did for FSRS);
bounded intervals; the queue is re-tunable without a schema change; calibration against real usage is
post-V1 (§2.4 note).

**Topic detection false-biasing the profile.** A wrong topic guess could surface the wrong concepts
first. Mitigation: `detectTopicKeys` only **reorders** and **adds** page-relevant nodes — it never drops
the weakest-overall set or active misconceptions; a `[]` result reads exactly as today; it's a
deterministic keyword match with no persistence, so a miss is cheap and self-correcting next turn.

**Two new tables on a hosted project.** 0007/0008 add tables + RLS to the remote Supabase.
Mitigation: additive, `if not exists`-safe, RLS enabled in-migration (RLS **before data**), re-runs
clean on `db reset`; no backfill; FK `on delete cascade` keeps erasure FK-safe.

**Threading `sessionId` from the extension.** If the overlay posts turns without the active session, no
row is written and the loop silently stays open. Mitigation: the active `sessionId` is already stored
(`storage.ActiveSession`); Task 7 attaches it; Task 8/9 verify a real overlay turn writes a row tied to
the correct session; the route degrades (still replies) rather than 400ing when it's missing.

---

## What the next sprint needs to know

**The learning loop now closes per turn.** Every turn emits a §2.5 envelope, persists a
`session_interactions` row (text only), updates FSRS per-interaction (all three lucky-guess guards on),
schedules reinforcement, and reads back a profile biased to what's on screen and fading. The next
roadmap sprints **consume** this — they do not rebuild it:
- **Annotation sprint:** the envelope already carries `annotations` (§2.5 schema). Build the transparent
  SVG overlay layer in the shadow root, the selector/bbox/textMatch resolvers, and scroll/resize
  reposition; render + clear per turn. No prompt/route change needed — the field is already produced.
- **Dashboard sprint:** the mastery views + the **due queue** read `knowledge_nodes` +
  `reinforcement_schedule` (query 2) directly; add chart colors as **named `@calyxa/ui` tokens**; extend
  the `(dashboard)/layout.tsx` shell from Sprint 10.
- **Streaming sprint (if pursued):** reconcile the envelope with true SSE — stream `say` deltas, then a
  trailing `assessment`/`annotations` event — and wire `/api/ai/stream` (still unwired; the client fakes
  word-by-word today via `/api/ai/turn`).
- **Onboarding sprint:** seed `knowledge_nodes` + the reinforcement queue from an 8–12 item assessment
  via the curriculum prereq edges (§2.4 cold start), instead of "calibrating."
- **Embedding sprint:** turn on cosine misconception matching + ivfflat (ADR-017) — column + extension
  already exist.
- **Privacy sprint:** if persistent topic/page history is wanted, add `page_url_hash` + `detected_topic`
  persistence then; this sprint kept topic detection **turn-time + in-memory** deliberately.
- **Still deferred:** Pro-gating of spaced reinforcement, the study-materials generator, billing UI, and
  the marketing page — each its own sprint. Audio + page context stay ephemeral (ADR-011/012/013, upheld:
  `session_interactions` is text-only).
- **Scheduler + envelope + topic constants** are named and centralised; tuning them against real usage
  (retention target, priority weights, topic keyword aliases, per-turn flagging strictness) is a
  post-V1 calibration pass, not a re-architecture.
