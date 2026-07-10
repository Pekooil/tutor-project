# Sprint 21 — Study-materials generator (notes · practice problems · flashcards)

> **Post-beta sprint.** Runs after beta distribution (Sprint 19). ADR/migration
> numbers are written concretely from the next free at time of writing (latest ADR =
> 043, latest migration = 0017) but are **provisional** — parallel tracks (Sprint
> 24/25) and the exact execution order may shift them; confirm next-free at execution.

## Goal
Fill the **"Generated for you"** seat that both the marketing landing page and the
extension recap card already reserve: turn a completed tutoring session into
**study notes, practice problems, and flashcards** the student can keep. This is the
feature Sprint 20 depicted and Sprint 25 reframed as "on the way" (ADR-040) — Sprint
21 ships it. By the end:

1. **A generator turns one session into three artifact kinds** — matching the exact
   shapes the marketing `StudyLoopSection` already draws: **notes** (ordered step
   strings), **practice problems** (new problems on the same concepts, *with*
   worked solutions this time), and **flashcards** (`{front, back}` pairs).
2. **Artifacts are persisted** (they aren't ephemeral like the recap) in a new
   RLS-scoped `study_artifact` table, FK-cascade to users + on the export list
   (Sprint 16's invariants).
3. **A "Generated for you" surface renders them** — the extension recap card's
   placeholder becomes real, and (if the dashboard exists by then) a web view lists
   past kits.
4. **Generation is a real, cost-guarded, structured Claude call** — a new sibling of
   the tutoring turn using the forced-tool-call pattern, respecting the Sprint 16
   cost cap, available to all beta users (Pro-gating deferred to Sprint 23).

```
session ends ──▶ buildSessionRecap (exists) ──▶ generateStudyKit (new)
                    │  reads session_interactions (transcript+outcome+concept),
                    │  knowledge_nodes, misconceptions for THIS session
                    └▶ forced-tool Claude call ──▶ { notes[], problems[], flashcards[] }
                            └▶ persist to study_artifact (RLS, FK-cascade, exportable)
                                    └▶ extension RecapCard "Generated for you" (real)
                                       + (post-Sprint-22) dashboard "Study kits" list
```

## Context
The marketing landing page (Sprint 20) presents a "study loop" — notes, practice,
flashcards from a session. ADR-031 Decision 4 originally marketed it as live and set a
fuse ("ship generation or add a qualifier before invites"); **the fuse resolved on the
qualifier branch** — Sprint 25/ADR-040 (2026-07-09) reframed the section to "on the
way" / "Every session *will* leave a study kit behind," and the extension's
`RecapCard.tsx` renders a **"Generated for you" placeholder** (two dashed tiles). So
Sprint 21 is **no longer a pre-beta obligation** — it's a genuine post-beta feature
filling a reserved, honestly-labelled seat. Everything it needs exists: the marketing
`StudyLoopSection` is the visual spec; `session_interactions` holds the full per-turn
transcript + outcome + concept; `buildSessionRecap` (`web/lib/learning/recap.ts`) is
the existing per-session digest; `claude.ts` has the forced-tool structured-output
pattern (`runSessionStartTool` is the worked precedent) and the cost guard
(`costGuard` + `estimateCost`) is the gate a new paid call must respect. **Nothing is
built**: no `study_artifact` table (newest migration is 0017), no generation call, no
real UI (only the two placeholders).

### Decisions locked for this sprint (recorded in ADR-047)
1. **Artifact shapes match the marketing spec exactly.** `StudyLoopSection`'s
   `ArtifactKind = 'notes' | 'problems' | 'flashcards'` is the contract: notes =
   ordered step strings; problems = problem statements **plus** worked solutions (the
   marketing card shows statements only, but a usable feature needs answers — the one
   deliberate superset of the spec); flashcards = `{front, back}`. Reusing the union
   keeps the marketing card and the real feature visually one thing.
2. **Generation is a new forced-tool Claude call, not the tutoring turn.** It mirrors
   `runSessionStartTool`/`runOpeningScanTurn` — its own tool schema
   (`STUDY_KIT_TOOL`, `strict: true`, `additionalProperties: false`, concept keys
   constrained to `CONCEPT_KEYS`), forced via `tool_choice`, validated, with a
   deterministic fallback (an empty/minimal kit) on a bad response. No pedagogy/
   envelope change; the tutoring loop is untouched.
3. **Artifacts persist; the recap does not.** Unlike `buildSessionRecap` (ephemeral,
   rides one response), a study kit is something the student returns to — so it's
   stored in `study_artifact`, RLS-scoped, FK-cascade to users, and on the Sprint 16
   export list. It's the first *generated content* the product persists.
4. **Generation is on-demand + cost-guarded, not automatic per session.** A kit is a
   several-hundred-token completion; auto-generating one per session multiplies cost.
   So generation is **triggered** (a "make me a study kit" action after a session, or
   a dashboard button), guarded by `costGuard` with a new `estimateCost` kind, and
   refuses gracefully under the hard cap like every other paid call.
5. **Available to all beta users; Pro-gating is Sprint 23's call.** The entitlements
   resolver doesn't exist yet (Sprint 23). This sprint does **not** invent a gating
   primitive — study kits are available to everyone in beta. Sprint 23 may later make
   "unlimited kits" a Pro feature; the generation route is written so a future
   entitlement check is a one-line add, not a refactor.

### Reconciliation with `/docs/PLAN.md` + prior handoffs (read before Task 1)
- **PLAN scopes artifact generation post-V1** — this is that post-V1 feature, built
  after the beta ships, exactly as the roadmap sequenced it.
- **ADR-031 + ADR-040**: the marketing framing is already resolved (qualifier added);
  this sprint makes the "on the way" true. No marketing-copy change is needed here (if
  anything, Sprint 25's copy can later drop the "on the way" once this ships — flagged,
  not done here).
- **Sprint 16 invariant**: "any new user-scoped table MUST FK-cascade to users + appear
  in the export route." `study_artifact` complies (Task 2/6).
- **Sprint 16 cost model**: a new paid Claude call adds a `CostKind` and respects the
  hard cap; `costGuard` fails open, so a guard outage never blocks generation, but a
  real over-cap does refuse.

### The generator reuses buildSessionRecap's read, not a new one (read before Tasks 3, 4)
`buildSessionRecap(supabase, userId, sessionId)` already reads exactly the per-session
material a generator needs — `session_interactions` for the session (transcript +
outcome + concept per turn), plus `knowledge_nodes`/`misconceptions`, with curriculum
titles resolved. The generator calls it (or a shared read it factors out) to assemble
the Claude prompt, so the kit is grounded in the *same* session data the recap shows —
no divergent second read. The prompt tells the model: from this session's worked
problem(s) and the concepts practiced, produce notes that capture the method, 2–3
*new* practice problems on the same concepts (with solutions), and 3–5 flashcards on
the key facts/steps — mirroring the marketing example (`x²+5x+6` → factoring notes,
sibling problems, "two numbers multiply to 6 add to 5" flashcard).

### The forced-tool pattern is the structured-output contract (read before Task 4)
`claude.ts` does **not** parse freeform JSON — it forces a tool call with a strict
`input_schema` and re-validates. The `STUDY_KIT_TOOL` schema defines `notes: string[]`,
`problems: {statement, solution}[]`, `flashcards: {front, back}[]`, each capped, with
any `conceptKey` constrained to `CONCEPT_KEYS` via the `nullableEnum` form. The call
site mirrors `runSessionStartTool`: `messages.create({ tools: [STUDY_KIT_TOOL],
tool_choice: {type:'tool', name} })`, pull the `tool_use` block, validate through a new
`parseStudyKit`, fall back to a minimal/empty kit on failure (never a throw, never a
half-parsed kit persisted).

### Where the kit renders: extension first, dashboard when it exists (read before Task 5)
The extension `RecapCard.tsx` already reserves the "Generated for you" seat with
placeholder tiles — this sprint replaces the placeholder with real rendering (fetch the
kit for the just-ended session, render notes/problems/flashcards using the existing
recap card styling + the flashcard flip pattern the marketing `Flashcard` component
demonstrates). A **web dashboard "Study kits" list** is the natural home for *past*
kits — but the dashboard (Sprint 22) may not exist yet at execution. So: the extension
surface is in scope (the seat exists); the dashboard surface is **conditional** — if
Sprint 22 has landed, add a `/study` route; if not, defer that leaf to Sprint 22's
plan (flagged), and the extension + the persisted table are enough to ship the feature.

## Execution model
A **single code session** owns this sprint end to end, worked **strictly in order
(1 → 8)**. The chain: ADR (Task 1); the `study_artifact` migration (Task 2) precedes
the generator that writes it (Task 3–4); the shared read (Task 3) precedes the Claude
call (Task 4); the persistence + route (Task 4) precedes the extension surface (Task
5); export/erasure coverage (Task 6) folds the table into Sprint 16's paths; tests
(Task 7) gate manual acceptance (Task 8). One session — no handoff.

This sprint touches: a new `supabase/migrations/0019_study_artifact.sql`, new
`web/lib/study/` (the generator + tool schema + parse), a new `web/app/api/study/`
route, `web/lib/ai/claude.ts` (a new tool + call, additive), the extension
`RecapCard.tsx` (placeholder → real) + transport, and Sprint 16's export route (add the
table). It does **not** touch the tutoring turn/envelope, the learning FSRS path
(read-only via recap), the cost RPC (only adds a `CostKind`), or billing.

## Files in scope

### Task 1 (ADR + sprint pointers) creates or edits:
```
/docs/adr/ADR-047-study-materials-generation.md ← new (provisional #) — artifact shapes = the marketing ArtifactKind union (notes/problems/flashcards; problems gain solutions — the one superset); generation = a new forced-tool Claude call (STUDY_KIT_TOOL, sibling of runSessionStartTool), grounded via buildSessionRecap's read; on-demand + cost-guarded (new CostKind), not auto-per-session; persisted in study_artifact (RLS, FK-cascade, exportable); available to all in beta, Pro-gating deferred to Sprint 23 (one-line future add).
/CLAUDE.md                                       ← edit one line: Current sprint → Sprint 21 — Study-materials generator
/docs/CLAUDE.md                                  ← edit one line: Current phase → Sprint 21
/docs/sprint-21-plan.md                          ← this file
/docs/architecture.md                            ← edit: the study-materials generator (forced-tool call over the session recap), study_artifact persistence, the extension "Generated for you" surface
```

### Task 2 (migration — study_artifact) creates:
```
/supabase/migrations/0019_study_artifact.sql ← new (number at execution) — study_artifact(id uuid pk, user_id uuid not null references users on delete cascade, session_id uuid null references sessions on delete set null, kind text check in ('notes','problems','flashcards'), payload jsonb not null, concept_keys text[] null, created_at). Shape 2 RLS (user_id-keyed, select/modify own). FK on delete cascade to users (Sprint 16 erasure) — session_id nullable + on delete set null so a deleted session doesn't orphan a kept kit. RLS-in-migration; re-runs clean. (One row per artifact kind, or one row per kit with all three in payload — pick the simpler; the plan assumes one row per kind for independent rendering.)
```

### Task 3 (web — the shared session read) creates / edits:
```
/web/lib/study/source.ts   ← new — loadSessionSource(supabase, userId, sessionId): reuses buildSessionRecap (or the read it factors out) to assemble the per-session material for generation — the worked turn(s) transcript, the concepts practiced, the misconceptions touched — grounded in the SAME data the recap shows. Server-only; RLS-scoped.
/web/lib/learning/recap.ts ← edit ONLY IF a small factor-out is needed so source.ts and buildSessionRecap share the read; otherwise source.ts calls buildSessionRecap and this file is untouched. No behavior change to the recap.
```

### Task 4 (web — the generator + route) creates / edits:
```
/web/lib/study/tool.ts     ← new — STUDY_KIT_TOOL (Anthropic.Tool, strict:true, additionalProperties:false): { notes: string[], problems: {statement, solution}[], flashcards: {front, back}[] }, each length-capped; concept keys via nullableEnum over CONCEPT_KEYS. Mirrors claude.ts's ENVELOPE_TOOL/SESSION_START_TOOL discipline.
/web/lib/study/generate.ts ← new — generateStudyKit(source): builds the prompt from loadSessionSource output, calls the forced tool via a runStudyKitTool (new, in claude.ts or here mirroring runSessionStartTool: own client OR reuse createClient(), a STUDY_KIT_MODEL const, max_tokens sized for the kit), validates via parseStudyKit, deterministic empty/minimal-kit fallback on failure. Server-only.
/web/lib/ai/claude.ts      ← edit — additively export runStudyKitTool (or expose createClient()/the pattern) so generate.ts reuses the established forced-tool + retry shape; NO change to runTutorTurn/envelope. Prompt-cache discipline optional (a kit prefix could cache, but not required).
/web/lib/tier/cost-model.ts ← edit — CostKind gains 'study_kit'; a STUDY_KIT_CENTS estimate constant; estimateCost handles it. (The one cost-model change.)
/web/app/api/study/generate/route.ts ← new — POST { sessionId }: bearer/cookie auth → costGuard(estimateCost('study_kit')) BEFORE the call (hardExceeded → graceful refusal, no Claude call) → loadSessionSource → generateStudyKit → persist rows to study_artifact → return the kit. Ownership: only the caller's own session (RLS on the read).
/web/app/api/study/list/route.ts     ← new — GET: the caller's persisted kits (RLS-scoped), newest first, for the extension recap + a future dashboard.
```

### Task 5 (extension — the "Generated for you" surface) edits:
```
/extension/src/overlay/RecapCard.tsx ← edit — replace the two dashed "study material" placeholder tiles with real rendering: after a session ends, offer/trigger generation (a "Make a study kit" action, or auto-fetch if already generated), then render notes (ordered list), practice problems (statement + reveal solution), and flashcards (flip on tap — mirror the marketing Flashcard flip). Uses existing recap-card styling/tokens; no host-DOM mutation.
/extension/src/types/messages.ts     ← edit — new message types: GENERATE_STUDY_KIT / STUDY_KIT_REPLY (overlay → background → /api/study/generate); mirror payload types by convention.
/extension/src/background/index.ts   ← edit — a handler that POSTs to /api/study/generate (sole egress, ADR-006) and relays the kit; failures degrade to the placeholder + a gentle "couldn't generate right now" (never a crash).
/extension/src/lib/api.ts            ← edit — generateStudyKit(sessionId) + listStudyKits() transport wrappers.
```

### Task 6 (export/erasure coverage) edits:
```
/web/app/api/account/export/route.ts ← edit — add study_artifact to the exported tables (Sprint 16's export must include the new user-scoped table). RLS-scoped read of the caller's kits.
(erasure) ← the FK on delete cascade (Task 2) already routes study_artifact through Sprint 16's hard-delete sweep; add a study_artifact assertion to the erasure test rather than new deletion code.
```

### Task 7 (tests) creates / edits:
```
/web/tests/study-generate.test.ts ← new — parseStudyKit validates the tool output (well-formed kit passes; malformed → deterministic fallback, never a throw, never a half-kit persisted); concept keys constrained to CONCEPT_KEYS; caps enforced; the route calls costGuard BEFORE the Claude call and refuses on hardExceeded without generating; persisted rows are RLS-scoped to the caller.
/web/tests/study-source.test.ts   ← new — loadSessionSource reads the same session data buildSessionRecap does (parity on a shared session); RLS-scoped (a second user's session is unreadable).
/web/tests/account.test.ts        ← edit — export now includes study_artifact; the erasure sweep removes a user's kits (FK cascade).
/extension/tests/recap-kit.test.ts ← new — pure render/transport helpers: the kit → recap-card view mapping (notes/problems/flashcards), the flip-state reducer, and that a generation failure degrades to the placeholder.
```

### Files explicitly out of scope
```
/web/lib/ai/{system-prompt,envelope}.ts + runTutorTurn  (the tutoring turn/envelope is UNCHANGED; the generator is a separate forced-tool call)
/web/lib/learning/{apply,scheduler,profile-read}.ts     (FSRS path read-only via recap; unchanged)
Entitlements / Pro-gating / subscription_tier reads      (Sprint 23; kits are all-users in beta, the future gate is a one-line add)
Dashboard "Study kits" web page                          (CONDITIONAL — only if Sprint 22 has landed; else deferred to Sprint 22)
Marketing copy changes                                   (Sprint 25 owns the landing; dropping "on the way" once this ships is flagged, not done here)
```
Also out of scope (no pre-empting later roadmap sprints):
- **Making study kits a Pro feature / usage caps beyond the global cost guard** —
  Sprint 23's entitlements resolver owns that; the route is written for a one-line add.
- **Spaced-repetition scheduling of the generated flashcards** — the FSRS scheduler is
  for the knowledge graph, not for flashcards; wiring flashcards into review is a
  deliberate later feature, not assumed here.
- **Editing/regenerating/sharing kits, export-to-Anki/PDF** — V1 is generate + view +
  the Sprint 16 JSON export; conveniences follow.

Do not create any file not listed above. If something seems needed but is not listed,
add it to "What the next sprint needs to know" and ask before creating it.

---

## Task 1 — Study-materials ADR + sprint pointers (planning / docs)
Write ADR-047 in the project format. Fix the artifact shapes (= marketing union +
solutions), the forced-tool generation pattern, on-demand + cost-guarded, persisted +
exportable, all-users-in-beta with the deferred Pro gate. Update pointers +
architecture.md.

Acceptance gate before Task 2:
  - ADR reads as a decision; the "resolved-not-outstanding" marketing-debt status
    (ADR-040) is noted; no code touched.

## Task 2 — Migration: study_artifact (supabase)
Scope: `0019_study_artifact.sql`. Shape 2 RLS, FK-cascade to users, session_id on
delete set null. RLS-in-migration.

Acceptance gate before Task 3:
  - `db reset` clean; study_artifact is RLS-scoped; a deleted session doesn't orphan a
    kit; a deleted user's kits cascade; typecheck passes with regenerated types.

## Task 3 — Web: the shared session read
Scope: `web/lib/study/source.ts` (+ a minimal recap factor-out only if needed). Same
data as the recap.

Acceptance gate before Task 4:
  - loadSessionSource returns the session's transcript + concepts + misconceptions,
    parity with buildSessionRecap, RLS-scoped.

## Task 4 — Web: the generator + route
Scope: tool schema + generate + the cost-model kind + the two routes. Forced-tool,
cost-guarded, persisted.

Acceptance gate before Task 5:
  - A real /api/study/generate call on a completed dev session returns a well-formed
    kit and persists it; a forced hard-cap refuses without a Claude call; a malformed
    tool output degrades to the fallback, never persisting a half-kit.

## Task 5 — Extension: the "Generated for you" surface
Scope: RecapCard placeholder → real + transport. Renders notes/problems/flashcards; no
host-DOM mutation.

Acceptance gate before Task 6:
  - After a real session, the recap card generates + renders a kit (notes list,
    problems with reveal, flip flashcards); a generation failure degrades to the
    placeholder gracefully.

## Task 6 — Export/erasure coverage
Scope: add study_artifact to the export route + the erasure test.

Acceptance gate before Task 7:
  - Export includes the caller's kits; the erasure sweep removes them (FK cascade,
    asserted).

## Task 7 — Tests (gate)
Scope: per the annotations. Server + pure extension helpers.

Acceptance gate before Task 8:
  - `turbo run typecheck lint build test` green; parseStudyKit fallback + cost-guard-
    before-call + RLS scoping all asserted.

## Task 8 — Study-materials acceptance (manual)
Signed in as a real dev user with real tutoring history:
  1. Complete a session on a factoring problem (mirroring the marketing example).
  2. Trigger generation from the recap card → a kit appears: notes capturing the
     method, 2–3 new practice problems (with revealable solutions) on the same
     concepts, 3–5 flashcards; all grounded in the actual session.
  3. The kit is persisted (verified in study_artifact) and reappears via /api/study/list.
  4. Force the cost hard-cap → generation refuses gracefully (no Claude call), the card
     shows the placeholder + a gentle message.
  5. Export includes the kit; deleting the account removes it (FK cascade).
  6. A second user's kits are never visible (RLS).

## Acceptance criteria (full checklist)
- [ ] ADR-047 written; pointers + architecture.md updated
- [ ] study_artifact table (Shape 2 RLS, FK-cascade to users, session_id on delete set null) lands; db reset clean
- [ ] Generation is a forced-tool Claude call (STUDY_KIT_TOOL, sibling of runSessionStartTool), grounded via the recap read, with a deterministic fallback
- [ ] The route cost-guards BEFORE the Claude call (new 'study_kit' CostKind); hard-cap refuses without generating
- [ ] Artifacts match the marketing union (notes/problems/flashcards); problems include solutions; concept keys constrained to CONCEPT_KEYS
- [ ] The extension RecapCard placeholder becomes real rendering (notes/problems/flip-flashcards); failure degrades to the placeholder; no host-DOM mutation
- [ ] study_artifact on the Sprint 16 export list + covered by the erasure cascade (asserted)
- [ ] Kits are available to all beta users; no entitlement gate (the one-line Pro hook is left for Sprint 23)
- [ ] `turbo run typecheck lint build test` green; Task 8 manual pass complete

## Risks
**The generated kit is low-quality or wrong (bad practice problems, wrong flashcard
answers).** Mitigation: it's grounded in the actual session's worked problem + the
concepts practiced (not free invention); the tool schema constrains structure; Task 8
judges quality on a real session; if quality is weak, the fix is prompt-side (the
generation prompt is one file), and the deterministic fallback ensures a bad response
never persists a broken kit. A "regenerate" affordance is the natural follow-up if
needed (flagged).

**Generation cost multiplies the per-user bill.** Mitigation: generation is on-demand
(triggered, not auto-per-session), cost-guarded with its own estimate, and refuses
under the hard cap; Sprint 23 can cap kit volume per tier; the global ceiling protects
the beta budget regardless.

**Persisting generated content changes the privacy surface.** Mitigation: study_artifact
is RLS-scoped, FK-cascades on erasure, and joins the export — the same discipline every
user table follows; the Sprint 19 data-safety disclosure must list "generated study
materials" as a stored data type (flagged in the handoff).

**The dashboard surface for past kits may not exist yet.** Mitigation: the extension
surface + the persisted table ship the feature on their own; the web "Study kits" list
is conditional on Sprint 22 and deferred to it if 22 hasn't landed — not a blocker.

**Reusing/refactoring buildSessionRecap regresses the recap.** Mitigation: the default
is source.ts *calls* buildSessionRecap (no change to it); a factor-out happens only if
needed and keeps the recap's behavior identical (its existing tests stay green).

## What the next sprint needs to know
**Sessions now leave a study kit behind.** A cost-guarded forced-tool generator turns a
session into persisted notes/problems/flashcards (grounded in the recap read), rendered
in the extension recap card; study_artifact is RLS-scoped, cascades on erasure, and is
on the export list.

- **Sprint 22 (dashboard)** inherits: a natural **"Study kits" list route** (`/study` or
  a dashboard tab) reading `/api/study/list` — the conditional web surface this sprint
  deferred; the persisted kits are ready to display.
- **Sprint 23 (billing)** inherits: study kits as a **candidate Pro feature** — the
  generation route already isolates the point where an entitlement check goes (a
  one-line `isPro`/flag gate on volume or access); "unlimited study kits" fits the PLAN
  §2.8 flag set.
- **The Sprint 19 data-safety disclosure** must now include "generated study materials"
  as a persisted data type — update /privacy + the CWS form before this reaches beta
  users (if it ships to the beta cohort).
- **Sprint 25's landing copy** can drop the "on the way" qualifier on the study-loop
  section once this ships — a marketing edit for that track to own, flagged not done.
- **Flashcard spaced-repetition** (wiring generated cards into a review schedule) is a
  deliberate later feature, not built here.
