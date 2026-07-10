# Sprint 17 — Onboarding + beta instrumentation (usability + observability)

## Goal
Make a first-time user's experience **guided, not cold** — and make the beta
**observable to you** without asking a single tester to file a report. This is the
second pre-beta gate sprint. By the end:

1. **Cold-start onboarding.** A brand-new user (zero `knowledge_nodes`) runs a
   short **8–12 item adaptive assessment** on first use that seeds an initial
   knowledge graph via the curriculum's prerequisite edges — instead of the tutor
   "calibrating" live on turn one against an empty profile. `onboarding_completed_
   at` (a `users` column that has existed, unused, since 0001) finally gets
   written.
2. **Error monitoring.** The first external observability in the project: a
   monitoring SDK wired into the background service worker, the content script,
   and the Next.js API routes, with **payloads scrubbed** of transcript, audio,
   page content, and raw identifiers.
3. **Privacy-safe product telemetry.** A typed event funnel (install → onboarding
   done → first session → nth session), per-leg latency (the Sprint 15
   `LatencyTrace` finally gets a sink), and annotation/voice usage rates — **no
   content, ever**, enforced by a schema that has no free-text field to misuse.
4. **In-extension feedback capture.** A lightweight "something's wrong / rate this
   session" affordance in the overlay, posting to a new RLS-scoped `feedback`
   table for you to triage — not a support desk, just capture.

```
first run (no knowledge_nodes)
   └─ Onboarding assessment (8–12 items, adaptive by strand)
        └─ seed knowledge_nodes via prerequisitesOf() propagation
        └─ write users.onboarding_completed_at
   └─ thereafter: normal tutoring (profile is no longer empty)

every session / turn / error
   └─ background worker (sole egress) ──▶ POST /api/telemetry  (typed events, no content)
                                     └──▶ POST /api/errors     (scrubbed exceptions)
   overlay "report / rate" ──────────────▶ POST /api/feedback  (RLS-scoped table)

monitoring SDK ── scrubbed ──▶ external error sink (background + content + API routes)
```

## Context
The curriculum is now real (Sprint 15: 66 concepts across 6 strands with
prerequisite edges, `difficultyPrior`s, and `title`s), which is exactly the input
a cold-start assessment needs — the plumbing (`getConcept`, `prerequisitesOf`,
`CONCEPT_KEYS`) exists and `concepts/index.ts` even notes the edges are "consumed
by the onboarding sprint's prior propagation." What does **not** exist (all
confirmed this sprint's planning): any onboarding/assessment flow (the only
cold-start handling is `CALIBRATING_PROFILE` in `profile-read.ts` + the "still
getting to know you" line in `InsightStrip.tsx` + the `KickoffCard` prediction
omission), **any error monitoring** (only `console.error`, ephemeral to server
logs), **any product telemetry** (the learning-model "pings" are in-UI toasts, not
metrics; `LatencyTrace` in `web/lib/voice/latency.ts` is computed but never sent
anywhere), and **any feedback UI** (the overlay and popup have none). The overlay
is cleanly decomposed (Sprint 14: TitleBar/Composer/InsightStrip/KickoffCard/
Transcript/AnnotationLayer/PingToasts around a thinner `Overlay.tsx`), so new
surfaces slot in without a monolith fight. The background worker is the **sole
network-egress context** (ADR-006), so every telemetry/error/feedback event routes
through it.

### Decisions locked for this sprint (recorded in ADR-037/038/039)
1. **Onboarding is an assessment that seeds the graph, not a tour.** 8–12 items
   selected across strands by `difficultyPrior`, adaptive only in the light sense
   that a confident-correct on a hard item lets its prerequisites be inferred
   (propagated via `prerequisitesOf`) rather than each asked. It writes real
   `knowledge_nodes` through the *existing* FSRS apply path (`apply.ts`), so the
   seeded state is the same shape the tutor already reads — no parallel seeding
   math. Cold-start onboarding is PLAN §2.4/§2.10's named deliverable.
2. **Telemetry is typed and content-free by construction.** Events are a closed
   union of typed shapes with **no free-text field**; a future call literally
   cannot attach a transcript or a page URL because the type won't hold one. No
   audio, no `say`/student text, no raw domain (only the Sprint 16 hash if a page
   dimension is ever needed — and it isn't this sprint).
3. **Error monitoring scrubs before it sends.** The SDK's `beforeSend` strips
   message bodies, transcript fragments, and identifiers to a coarse user id at
   most; stack traces + route/handler names only. The tutor's reply is already
   persisted where it belongs (`session_interactions`), so error logs never become
   a second, unscrubbed copy of content.
4. **Feedback is capture, not a ticketing system.** One overlay affordance → one
   RLS-scoped `feedback` table (Shape 2, `user_id`-keyed) → your manual triage.
   No status workflow, no reply thread, no email.
5. **All three event streams route through the background worker.** The overlay
   and content script never talk to the network directly (ADR-006); they post
   messages to the background, which owns the `/api/telemetry`, `/api/errors`, and
   `/api/feedback` calls. New message types, same seam.

### Reconciliation with `/docs/PLAN.md` (read before Task 1) — what this implements
- **§2.4 cold-start handling.** PLAN §2.4/§2.10 specify the 8–12 item assessment,
  strand-adaptive routing, prerequisite prior propagation, and the "Calibrating →
  Getting to know you → Calibrated" progression. This sprint ships it, using the
  real curriculum as the item pool and the existing FSRS apply as the writer.
- **Beta capture + hardening (PLAN Sprint 6 / §2.7).** The launch-gate sprint
  named "beta capture" and observability; this sprint delivers the telemetry +
  error + feedback halves. The privacy discipline (no content, scrubbed) is a
  direct extension of §2.7 and Sprint 16's hashing posture.
- **V1 scope holds.** No IRT/item-calibration (PLAN defers it — "requires response
  data we won't have at launch"); onboarding uses the simpler `difficultyPrior`
  ladder + prerequisite propagation, exactly as PLAN §2.4 specifies for V1.

### The assessment writes through the existing FSRS apply, not a new seeder (read before Tasks 3, 6)
`web/lib/learning/apply.ts` already turns a graded observation into a
`knowledge_nodes` upsert (mastery/stability/difficulty/state via the FSRS model).
Onboarding produces the same kind of observation per assessed item and feeds it
through that path, so a seeded node is byte-identical in shape to one written by a
real tutoring turn — `loadProfile` reads it with zero special-casing, and the
"calibrating" fallback simply stops firing because the graph is no longer empty.
Prerequisite propagation is the one addition: a confident-correct on concept C
lets `prerequisitesOf(C)` be seeded at a modest prior without asking each, so 8–12
items cover far more than 8–12 nodes. This is server-side (`/web/lib/onboarding/`,
new) — the item *bank* is a data structure over `@calyxa/curriculum`, not a new
migration.

### Telemetry has no free-text field — that is the privacy guarantee (read before Tasks 4, 5)
The event type is a discriminated union: `{ kind: 'onboarding_completed',
itemCount, ms }`, `{ kind: 'session_started', mode }`, `{ kind: 'turn_latency',
sttMs, aiMs, ttsMs, totalMs }`, `{ kind: 'annotation_rendered', count, fallback }`,
etc. None carries a string the user typed or the tutor said, a page URL, or audio.
This is enforced structurally, not by review: the `/api/telemetry` route validates
against the union and rejects anything else, so a future contributor cannot
"just add a note field" without changing the type and tripping the test. The
Sprint 15 `LatencyTrace` (`sttMs/aiMs/ttsMs/networkMs/totalMs`) is exactly one
such event and is this sprint's first real sink for those numbers.

### Onboarding is a new overlay surface, gated on an empty profile (read before Task 7)
The overlay is decomposed, so onboarding is a new `Onboarding.tsx` component
mounted by `Overlay.tsx` when `overview.calibrating` is true and
`onboarding_completed_at` is null — the same signal `InsightStrip` already uses to
show "still getting to know you." It runs once, writes the graph, and is never
shown again. It reuses the Composer's input affordances for free-response items
and adds simple choice items; it does not touch the tutoring loop's state machine.
A user can **skip** — skipping just leaves the profile empty and the tutor
calibrates live exactly as today (the fallback is preserved, not removed).

## Execution model
A **single code session** owns this sprint end to end, worked **strictly in order
(1 → 9)**. The chain: ADRs (Task 1); the feedback + telemetry + error tables/
routes (Tasks 2–5) are server-side and precede the extension wiring that calls
them (Task 6); the onboarding item bank + seeding (Task 3) precedes the onboarding
UI (Task 7) that drives it; error monitoring (Task 5) spans web + extension; tests
(Task 8) gate manual acceptance (Task 9). One session — no handoff.

This sprint touches: `/supabase/migrations` (0015 feedback + telemetry_event
tables), new `/web/app/api/{telemetry,errors,feedback}/` routes, new `/web/lib/
onboarding/`, `/web/lib/telemetry/`, the monitoring SDK config in both `/web` and
`/extension`, the extension overlay (a new `Onboarding.tsx` + a "report" affordance
+ background message routing), and `/web/lib/voice/latency.ts` (wire its trace to
the telemetry event). It does **not** touch the learning FSRS math (`apply.ts`/
`profile-read.ts` are consumed, not changed beyond the seeding entry point), the
AI prompt/envelope, the cost/compliance work from Sprint 16, or the curriculum
package (read-only as the item pool).

## Files in scope

### Task 1 (ADRs + sprint pointers) creates or edits:
> **ADR renumber (done 2026-07-09):** the plan's 037/038 were stale — both were
> already taken by the prompt-caching track (037 prompt-caching, 038
> reopen-Anthropic-only), and 040/041 by landing-demo-v2 + the cost guardrail. Only
> the two collided numbers move; the feedback ADR **keeps its plan number 039** (it
> was the one Sprint 17 number still free, and was recorded as reserved for it).
> Mapping: cold-start-onboarding **037 → 042**, telemetry-and-error-privacy
> **038 → 043**, in-app-feedback **039 (unchanged)**. In-text references to
> "ADR-037/038/039" below should be read against this mapping.
```
/docs/adr/ADR-042-cold-start-onboarding.md ← new (was plan's 037) — the 8–12 item assessment: item bank over @calyxa/curriculum, difficultyPrior selection, prerequisite prior propagation via prerequisitesOf, writes through the EXISTING apply.ts FSRS path (no parallel seeder), writes onboarding_completed_at, skippable (fallback to today's live calibration preserved).
/docs/adr/ADR-043-telemetry-and-error-privacy.md ← new (was plan's 038) — typed content-free event union (no free-text field, structurally enforced); LatencyTrace as the first sink; error-monitoring scrub (beforeSend strips content + identifiers; traces + route names only); everything routes through the background worker (ADR-006); no audio, no say/student text, no raw URL (Sprint 16 hash only if ever needed).
/docs/adr/ADR-039-in-app-feedback.md         ← new (KEEPS plan's 039) — one overlay affordance → RLS-scoped feedback table (Shape 2) → manual triage; capture not ticketing; optional session-id link; no PII beyond the authed user_id.
/CLAUDE.md                                    ← edit one line: Current sprint → Sprint 17 — Onboarding + beta instrumentation
/docs/CLAUDE.md                               ← edit one line: Current phase → Phase 2, Sprint 17
/docs/sprint-17-plan.md                       ← this file
/docs/architecture.md                         ← edit: cold-start onboarding seeds the graph; telemetry/error/feedback event streams via the background worker; monitoring SDK in web + extension
```

### Task 2 (migrations — feedback + telemetry tables) creates:
```
/supabase/migrations/0015_feedback_and_telemetry.sql ← new — (a) feedback(id uuid pk, user_id uuid not null references users on delete cascade, session_id uuid null references sessions, kind text check in ('bug','rating','idea'), rating smallint null, message text null, created_at) — Shape 2 RLS (user_id-keyed, select/modify own). (b) telemetry_event(id uuid pk, user_id uuid null references users on delete cascade, kind text not null, payload jsonb not null default '{}', created_at) — Shape 2 RLS BUT insert-only from the owner (no client read of the aggregate; reads are service-role only for your analysis). Both carry FK on delete cascade to users (the Sprint 16 erasure sweep must reach them) and appear in the export route. RLS-in-migration (ADR-005); re-runs clean.
```
Note: the `feedback.message` free-text field is the ONE deliberate user-authored
text in this sprint — it is feedback the user chose to write, RLS-scoped to them,
and covered by export/erasure. Telemetry has no such field (ADR-038).

### Task 3 (web — onboarding item bank + seeding) creates:
```
/web/lib/onboarding/item-bank.ts  ← new — a pure structure over @calyxa/curriculum: selectAssessmentItems() picks 8–12 concepts spanning the 6 strands by difficultyPrior (easy anchor per strand + a few reaches); each item carries { conceptKey, prompt, kind: 'choice'|'free', ... }. Data over the curriculum, no migration.
/web/lib/onboarding/seed.ts       ← new — seedFromAssessment(supabase, results): for each graded item, build the same observation shape apply.ts consumes and call the EXISTING apply path; for a confident-correct, propagate a modest prior to prerequisitesOf(conceptKey) (seed-if-absent, never overwrite a real node). Writes onboarding_completed_at. Server-only; RLS-scoped (writes the caller's own nodes).
/web/app/api/onboarding/route.ts  ← new — POST { results }: validates, calls seedFromAssessment, returns { seededCount }. GET (or a field on /api/profile/overview) exposes whether onboarding is needed (calibrating && onboarding_completed_at is null). Bearer/cookie authed.
```

### Task 4 (web — telemetry + feedback routes) creates:
```
/web/lib/telemetry/events.ts    ← new — the TelemetryEvent discriminated union (onboarding_completed, session_started, turn_latency, annotation_rendered, voice_used, degraded_hit, ...); a validateEvent() guard. NO free-text field anywhere in the union — the privacy guarantee (ADR-038).
/web/app/api/telemetry/route.ts ← new — POST { events: TelemetryEvent[] }: validate each against the union (reject unknown shapes), insert into telemetry_event (kind + payload jsonb). Bearer/cookie authed; user_id from the session (never from the body). No GET (reads are service-role for your analysis).
/web/app/api/feedback/route.ts  ← new — POST { kind, rating?, message?, sessionId? }: insert into feedback (RLS-scoped to the caller). Bearer/cookie authed. No GET.
```

### Task 5 (web + extension — error monitoring) creates / edits:
```
/web/package.json + /extension/package.json ← edit — add the monitoring SDK (e.g. @sentry/nextjs for web, @sentry/browser for the extension contexts). Additive dependency.
/web/lib/monitoring/init.ts        ← new — server + client init with a beforeSend that strips message bodies, any say/transcript/student-text field, and page content/URLs; keeps route/handler name + a coarse user id. DSN from env, absent-tolerant (no DSN → no-op, never a boot failure).
/web/instrumentation.ts (or the framework's hook) ← new/edit — register the server init (Next.js instrumentation hook).
/extension/src/lib/monitoring.ts   ← new — init for the background worker + content script contexts; same scrub; the extension never ships a secret, only a public DSN (or routes errors through /api/errors — see below). 
/web/app/api/errors/route.ts       ← new — POST for extension-originated errors that should not carry a client DSN: the background worker forwards a scrubbed error shape here and the server relays it to the sink; keeps the "no key in the extension bundle" rule intact (ADR: extension holds no monitoring secret).
```

### Task 6 (extension — event routing through the background worker) edits:
```
/extension/src/types/messages.ts   ← edit — new message types: SEND_TELEMETRY, SEND_FEEDBACK, LOG_ERROR (overlay/content → background). Mirror the payload types by convention (like AiReplyPayload before them).
/extension/src/background/index.ts ← edit — handlers for the three new message types that POST to /api/telemetry, /api/feedback, /api/errors respectively (the background is the sole egress — ADR-006); batch telemetry (flush on interval / on N events) to avoid a request per event; failures are swallowed (a lost telemetry event never affects the user). Wire the monitoring init here.
/extension/src/content/index.ts    ← edit — wire the content-script monitoring init; forward content-context errors via LOG_ERROR.
```

### Task 7 (extension — onboarding UI + feedback affordance) creates / edits:
```
/extension/src/overlay/Onboarding.tsx ← new — the assessment surface: renders items from /api/onboarding, collects choice/free responses (reusing Composer input affordances), posts results, shows the "Getting to know you" → "Calibrated" progression, and a SKIP that leaves the profile empty (today's fallback). Presentational + a small local state machine; no tutoring-loop coupling.
/extension/src/overlay/Overlay.tsx    ← edit — mount <Onboarding/> when calibrating && onboarding not completed; on completion/skip, fall through to the normal panel; emit a telemetry event on completion. The tutoring state machine (Sprint 14) is untouched — onboarding is a pre-panel gate, not a turn.
/extension/src/overlay/InsightStrip.tsx ← edit — the "still getting to know you" copy defers to onboarding when onboarding is available (it becomes the post-onboarding calibrating state, or is unchanged if the user skipped).
/extension/src/overlay/TitleBar.tsx OR Composer.tsx ← edit — a small "report / rate" affordance (an unobtrusive control) that opens a minimal feedback popover → SEND_FEEDBACK; wired to the current sessionId when one is active. Reuses existing tokens; no new component system.
```

### Task 8 (tests) creates / edits:
```
/web/tests/onboarding.test.ts   ← new — selectAssessmentItems spans all 6 strands within the 8–12 bound; seedFromAssessment writes nodes via the apply path (same row shape as a tutoring turn), propagates priors to prerequisitesOf without overwriting real nodes, writes onboarding_completed_at; a subsequent loadProfile no longer returns CALIBRATING_PROFILE.
/web/tests/telemetry.test.ts    ← new — the event union has NO free-text field (a compile/lint-level assertion + a runtime test that /api/telemetry rejects an event carrying an unexpected string field); valid events insert; user_id comes from the session, never the body.
/web/tests/feedback.test.ts     ← new — feedback inserts RLS-scoped (a second user can't read it); export includes feedback rows; the erasure sweep removes them (FK cascade).
/web/tests/monitoring.test.ts   ← new — beforeSend strips a planted transcript/URL/message field and keeps route name + coarse id; a missing DSN is a no-op, not a throw.
/extension/tests/telemetry-routing.test.ts ← new — pure: the background batch/flush reducer (flush on N or interval), and that a failed telemetry POST is swallowed (no user-visible effect).
```

### Files explicitly out of scope
```
/web/lib/learning/{apply,profile-read,scheduler,events}.ts (apply is CALLED by seeding, not modified; profile-read's CALIBRATING_PROFILE fallback stays)
/packages/curriculum/**            (read-only as the item pool; no concept/alias/title change — Sprint 15 owns it)
/web/lib/ai/**                     (no prompt/envelope/model change)
Sprint 16 cost/compliance code     (unchanged; telemetry respects the erasure/hash posture but adds no cost logic)
/web/lib/tier/**                   (unchanged)
```
Also out of scope (no pre-empting later roadmap sprints):
- **IRT / item calibration / an adaptive item-response engine** — PLAN defers it
  (needs response data we won't have at launch); onboarding uses the
  `difficultyPrior` ladder + prerequisite propagation only.
- **A product-analytics dashboard for YOU** — telemetry lands in a table read by
  service-role queries; a viewing UI is post-beta tooling, not this sprint.
- **A support/ticketing workflow on feedback** — capture only; triage is manual.
- **Session-replay, funnels-as-a-service, third-party product analytics** —
  out; the typed table is the V1 surface.

Do not create any file not listed above. If something seems needed but is not
listed, add it to "What the next sprint needs to know" and ask before creating it.

---

## Task 1 — Onboarding + observability ADRs + sprint pointers (planning / docs)
Write ADR-037/038/039 in the project format. Fix the assessment size (8–12), the
"seed through apply.ts, not a parallel seeder" rule, the content-free-union
guarantee, the scrub contract, and the single feedback free-text exception (user-
authored, RLS-scoped, export/erasure-covered). Update pointers + architecture.md.

Acceptance gate before Task 2:
  - Three ADRs read as decisions; the telemetry union's no-free-text guarantee is
    stated as a structural (not review-based) property; no code touched.

## Task 2 — Migrations: feedback + telemetry tables (supabase)
Scope: `0015_feedback_and_telemetry.sql` per the annotation. Both FK-cascade to
users; both appear in Sprint 16's export + erasure paths.

Acceptance gate before Task 3:
  - `supabase db reset` clean 0001→0015; RLS Shape 2 on both; typecheck passes
    with regenerated types; a note added so Sprint 16's export/erasure lists gain
    the two tables (or a follow-up filed if that code must change).

## Task 3 — Web: onboarding item bank + seeding
Scope: `/web/lib/onboarding/*` + `/api/onboarding`. Seeds via the existing apply
path; propagates priors; writes `onboarding_completed_at`.

Acceptance gate before Task 4:
  - A simulated assessment seeds nodes with the same shape a tutoring turn writes;
    `loadProfile` stops returning `CALIBRATING_PROFILE`; prerequisite propagation
    seeds-if-absent without clobbering.

## Task 4 — Web: telemetry + feedback routes
Scope: `telemetry/events.ts` + the two routes. The union has no free-text field.

Acceptance gate before Task 5:
  - `/api/telemetry` rejects an event with an unexpected string field; valid
    events insert with user_id from the session; `/api/feedback` inserts RLS-scoped.

## Task 5 — Web + extension: error monitoring
Scope: SDK deps + init in both runtimes + the `/api/errors` relay. Scrub before
send; no monitoring secret in the extension bundle.

Acceptance gate before Task 6:
  - A thrown server error appears in the sink with content stripped and route name
    kept; a missing DSN is a no-op; the extension holds no secret (errors relay via
    /api/errors or a public DSN only).

## Task 6 — Extension: event routing through the background worker
Scope: `messages.ts`, `background/index.ts`, `content/index.ts`. Sole-egress
respected; telemetry batched; failures swallowed.

Acceptance gate before Task 7:
  - A telemetry event fired from the overlay reaches `/api/telemetry` via the
    background; a forced POST failure is invisible to the user; a content-script
    error reaches the sink via LOG_ERROR.

## Task 7 — Extension: onboarding UI + feedback affordance
Scope: `Onboarding.tsx` + `Overlay.tsx` mount + `InsightStrip` copy + the feedback
affordance. Onboarding gated on empty-profile; skippable to today's fallback.

Acceptance gate before Task 8:
  - A fresh user sees onboarding, completes it, and lands in a non-empty profile;
    a skip lands in today's live-calibration fallback; the report/rate affordance
    posts feedback tied to the active session.

## Task 8 — Tests (gate)
Scope: per the annotations. Server tests + pure extension helpers; no browser
harness.

Acceptance gate before Task 9:
  - `turbo run typecheck lint build test` green; the no-free-text telemetry
    assertion fails when a string field is added to the union.

## Task 9 — Onboarding + instrumentation acceptance (manual)
On a real page, as a brand-new dev user (fresh account, zero nodes):
  1. First open → onboarding assessment runs (8–12 items across strands);
     complete it → profile is seeded (verified in `knowledge_nodes`), the tutor's
     first turn is calibrated, `onboarding_completed_at` is set.
  2. Fresh account #2 → skip onboarding → tutor calibrates live exactly as today
     (fallback intact).
  3. Run a session → telemetry events (session_started, turn_latency,
     annotation_rendered) land in `telemetry_event` with NO content/URL/audio.
  4. Force a server error and a background-worker error → both appear in the
     monitoring sink, scrubbed (no transcript, no page content).
  5. Use the report/rate affordance → a `feedback` row appears, tied to the
     session; confirm it exports (Sprint 16) and would erase (FK cascade).

## Acceptance criteria (full checklist)
- [ ] ADR-037/038/039 written; pointers + architecture.md updated
- [ ] feedback + telemetry_event tables (Shape 2 RLS, FK cascade to users) land in 0015; both added to Sprint 16's export + erasure coverage
- [ ] Onboarding: 8–12 adaptive items across 6 strands; seeds knowledge_nodes via the existing apply path; propagates prerequisite priors; writes onboarding_completed_at; skippable to today's fallback
- [ ] Telemetry: typed content-free event union (no free-text field, enforced); LatencyTrace wired as an event; user_id from the session; batched via the background worker
- [ ] Error monitoring in web API + background + content, scrubbed (no transcript/audio/URL); no monitoring secret in the extension bundle; missing-DSN is a no-op
- [ ] Feedback: one overlay affordance → RLS-scoped feedback table; the single user-authored free-text field is export/erasure-covered
- [ ] All three event streams route through the background (sole egress, ADR-006)
- [ ] `turbo run typecheck lint build test` green; Task 9 manual pass complete

## Risks
**Onboarding friction makes first-run worse, not better.** A 12-item quiz before
the first answer can feel like homework. Mitigation: 8–12 is the cap not the
floor; it is skippable (fallback preserved); prerequisite propagation means few
items cover many nodes; Task 9 judges the felt length live and the item count is a
one-constant tune.

**The seeded graph is miscalibrated and the tutor opens with wrong assumptions.**
Mitigation: seeding writes *modest* priors (not confident mastery) and only
seeds-if-absent, so real tutoring quickly corrects them via the same FSRS path;
propagation is conservative (a modest prior, never "mastered"); the whole graph is
data the tutor overwrites with evidence.

**Telemetry silently captures content despite the guarantee.** Mitigation: the
guarantee is structural — the union has no field to hold content, and the route
rejects unknown shapes; the test fails the build if a string field is added; the
one free-text field (feedback.message) is user-authored, RLS-scoped, and
export/erasure-covered by design.

**The monitoring SDK leaks a secret into the extension bundle.** Mitigation: the
extension holds no monitoring secret — it uses a public DSN or, preferably, relays
scrubbed errors through `/api/errors`; the "no key in the extension bundle" CI
check (Sprint 18) covers the monitoring key too.

**Telemetry volume balloons into a request per event.** Mitigation: the background
batches (flush on N or interval) and swallows failures; a lost event never affects
the user; the table is service-role-read only, so it is your tooling input, not a
hot path.

**A deleted user's telemetry/feedback survives erasure.** Mitigation: both tables
FK-cascade to users, and Sprint 16's erasure sweep + export were explicitly
extended to cover them (Task 2 gate); the test asserts cascade removal.

## What the next sprint needs to know
**First-run is guided and the beta is observable.** Onboarding seeds the graph
through the real FSRS path; typed content-free telemetry, scrubbed error
monitoring, and RLS-scoped feedback all flow through the background worker into
tables the erasure/export paths already cover.

- **Sprint 18 (hardening/audit)** inherits: the monitoring init (confirm no secret
  in the extension bundle — extend the "no key in bundle" CI check to the
  monitoring key), the three new routes as attack surface, the telemetry union's
  no-content property to spot-check, and the new overlay surface (Onboarding) +
  feedback affordance for the AA audit.
- **Sprint 19 (store/beta)** inherits: the telemetry funnel as the **beta health
  signal** (onboarding-completion rate, first-session rate, degraded-hit rate from
  Sprint 16's caps) and the feedback table as the tester-issue inbox — both are
  how you'll know the beta is working without asking anyone.
- **The store/data-safety disclosure (Sprint 19)** must now list telemetry +
  feedback collection truthfully — the typed union + the one feedback free-text
  field are the exact scope to disclose.
- **The onboarding item bank** is data over the curriculum; adding a concept in a
  future curriculum sprint should add it to a strand's assessment anchors if it
  should be assessed — a data edit, flagged here.
- **A product-analytics viewing UI for the telemetry table** is deliberately not
  built (service-role queries suffice at V1); if wanted post-beta it reads the
  same table.
