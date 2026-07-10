# Calyxa — Architecture

> **Status: stub.** To be filled in during the planning phase.

This document will describe how Calyxa fits together: the extension, the
web app, the backend API proxy, the database, and the AI / STT / TTS
integrations.

## Monorepo layout
- `/extension` — WXT Chrome extension (Manifest V3)
- `/web` — Next.js marketing site + mastery dashboard
- `/packages` — shared libraries: `learning-model` (pure FSRS update + decay,
  Sprint 09), `curriculum` (pure concept graph, Sprint 09), `ui` (design
  tokens as a Tailwind v4 `@theme` + shadow-DOM-safe overlay primitives,
  Sprint 10); `ai`, `auth`, `types`, `utils` remain unextracted
- `/supabase` — migrations, RLS policies, seed data
- `/docs` — architecture doc, ADRs, sprint plans

## Styling layer (Sprint 10)
One token source, two component systems: `/packages/ui/src/theme.css` is the
Tailwind v4 `@theme` for color/type/spacing/radius/shadow/motion. `/web` uses
shadcn/ui with its CSS variables mapped to those tokens; the overlay uses
custom shadow-DOM-safe primitives from `@calyxa/ui`. The overlay's Tailwind
sheet is compiled and injected into the shadow root (WXT `cssInjectionMode`),
never the host `<head>`, preserving ADR-002's no-leak guarantee. See
`/docs/brand.md` and ADR-018.

## Adaptive engine (Sprint 11)
`/api/ai/turn` now returns a structured JSON envelope (`say` / `annotations` /
`assessment` / `mode`, PLAN §2.5) and **writes**: one `session_interactions`
row per gradable turn (text only, no audio — ADR-011 upheld), reversing
ADR-013's "the turn writes nothing." `knowledge_nodes` FSRS updates
(`@calyxa/learning-model`) now run **per interaction**, off the turn's
critical path, instead of once per concept at session end — restoring the
`response_latency_ms` lucky-guess guard ADR-016 had to omit. Each
per-interaction apply also calls the reinforcement scheduler, which upserts
`reinforcement_schedule` (FSRS-inverted `due_at`, `R_d = 0.90`, PLAN §2.4).
`loadProfile` reads both new tables: due items surface as `dueForReview`
("let's revisit…"), and turn-time topic detection over already-extracted
page context (no new persistence) biases which concepts sort first,
implementing PLAN §2.3 query 1's page-relevant ordering. The separate
end-of-session summariser Anthropic call is retired; `/api/session/end`
reconciles any interactions its off-critical-path apply didn't finish. See
ADR-019, ADR-020, ADR-021.

## Annotation layer (Sprint 12)
`/api/ai/turn` now returns its envelope's `annotations` on the wire —
`{ reply, annotations? }`, field omitted when empty — closing the gap where
Sprint 11 validated annotations server-side but the route dropped them before
they reached the extension. The content script keeps an in-memory
equation→element registry captured alongside `PageContext` on every overlay
open (never serialized, never persisted); a resolver in the content script
turns each turn's annotations into live viewport rects in priority order —
`selector` → registry-first `textMatch` → a bounded visible-text search →
`bbox` — and **drops** (never guesses) any target it can't resolve. Resolved
rects render on a transparent, full-viewport SVG layer inside the existing
`<calyxa-overlay>` shadow root, in the same coordinate space the shadow-DOM
choice was made for (ADR-002), and re-resolve on scroll/resize. Annotations
replace per turn, respect `ttl_ms`, clear on panel close, and fully tear down
on overlay unmount — zero host-DOM writes, nothing persisted. See ADR-022,
ADR-023.

## Profile visibility (Sprint 13)
The adaptive engine (Sprints 09–12) is now visible to the student through three
display-ephemeral surfaces on the Sprint 10 overlay — none of them add a table or a
migration. A new read-only `GET /api/profile/overview` serializes the same
`loadProfile` read the turn prompt already uses, with concept keys resolved to
human-readable titles (`@calyxa/curriculum`'s new `title`/`strandLabel` fields), and
renders before the student's first question in a session. The envelope gains an
optional `profile_tags` field — structured references (`reviewing` / `known-gap` /
`due-review` / `strength`) the tutor can attach to a turn — which the turn route
**grounds** against the exact `LearningProfile` it rendered into that turn's prompt
before returning it; an ungrounded tag is dropped, never rendered, so the student never
sees a claim about their own history that the profile read didn't actually support.
`/api/session/end` gains an optional `recap`, built only after its existing reconcile
sweep has run, from the tables that reconcile just updated — mastery, resolved/added
misconceptions, next reinforcement due dates — and broadcasts it to all tabs as a new
`SESSION_ENDED` message so the recap renders regardless of whether the popup or a new
overlay End-session control (which reuses the existing `END_SESSION` handler) ended the
session. Mastery deltas shown in the recap are computed client-side against the
overview snapshot already held from panel open — no baseline is fetched or stored.

The scope extension (same sprint) adds the loop's live voice: **event pings** — a
transient toast for exactly two events, a named upward `MasteryState` transition or a
completed misconception-resolution streak — computed at turn time by the same extracted
FSRS core (`computeNodeUpdate`) the off-critical-path apply runs, so the prospective
result cannot drift from the eventual write; routine ticks, band upticks, first-contact
transitions, and newly *detected* misconceptions are all deliberately silent (new gaps
surface only in the recap). **Cross-session callbacks** — the tutor referencing a real
prior session, at most once per conversation — draw on a new additive `priorWork` leg of
`loadProfile` (≤3 digest entries with mechanically derived outcome lines) and extend the
grounding gate with a `callback` tag kind. The **recap** deepens with a conservative
trend rollup (≥3 consecutive strictly-improving sessions only) and the FSRS forward look
(due dates straight from `reinforcement_schedule`). The confidence-vs-correctness
mismatch feature is deferred pending its proxy decision. See ADR-024, ADR-025, ADR-026.

## Session lifecycle + overlay surfaces (Sprint 14)
A session is now **problem-sized and auto-managed**, reversing part of ADR-007's
manually-toggled model (the atomic `start_session` gate itself is unchanged — only
its trigger point moves). A session starts one of two ways: the **proactive opening
scan** (ADR-030) — a new, AI-initiated turn kind that fires on panel **expand** when
the freshly-captured `PageContext` shows a plausible problem, before the student has
sent anything — or, when the scan finds nothing (or degrades), the student's first
*sent* turn, as a fallback trigger (ADR-027, amended). Opening the panel on a blank
page, reading the overview, and minimizing still start nothing. The opening scan
reads the same topic-biased `LearningProfile` read (Sprint 11) and the existing
`callback` cross-session-digest mechanism (ADR-024/026) as any other turn, and emits
`say` + an annotation + an optional grounded `callback` tag — **never** `assessment`,
which `envelope.ts` already tolerates as the "opening turn, no prior student answer"
case, so no schema change was needed for it. The envelope gains two additive fields
on every turn: `solution_progress` (0–1, model-emitted, client-clamped with bounded
regression and monotone easing) and `session` (`{ complete, reason }`, one of three
named end-conditions: solved, answered-then-declined-follow-up,
corrected-follow-up-retry). A malformed or absent `session` field is a non-close, the
safe failure; on a real completion the tutor says "Now closing tutoring session.",
the background POSTs the existing `/api/session/end`, and the overlay runs a
close choreography (recap → green ring sweep on ✕ → panel close + transcript clear).
The popup loses its Start/End controls entirely and becomes a display-only surface
(sign-in state, remaining quota, degraded notice). Neither new envelope field, nor
the opening scan's turn, is persisted differently — the opening scan writes the same
`session_interactions` row shape as any other turn, just assessment-less, and no
migration is added (ADR-028, ADR-030). Page context and the equation-element
registry (ADR-022) now capture on panel **expand** rather than mount, fixing a
Sprint 13 live-find where an SPA's post-load render (e.g. Khan Academy) could leave a
session context-blind — and that same fresh capture is what the opening scan's
plausible-problem check runs against. See ADR-027, ADR-028, ADR-030.

The 1,247-line `Overlay.tsx` is decomposed into five presentational components —
`TitleBar`, `Composer`, `InsightStrip`, `Transcript`, `PingToasts` — with
`Overlay.tsx` kept as the state owner and composition root (state moved, not
redesigned). The title card's − minimizes (collapse to pill, session continues) and
✕ ends the session (now with the ring countdown); the old standalone "End session"
button and the Typing/Voice mode chip are deleted; Send becomes an ↵ icon button. The
overview/recap render above the composer as an auto-dismissing strip rather than
inline in the transcript flow, and profile tags/pings pick up a shared kind→color
mapping from new additive `theme.css` aliases (no new palette values, ADR-018
discipline preserved). The composer also gains a thin, low-saturation solution-
progress bar, visually distinct from the strip's brighter transient bar.

Annotations move to a **box-first** default (`highlight` renders as an outlined
rect, the primary vocabulary; circle/arrow remain for when shape adds meaning). The
model is steered to annotate whenever a reply references on-screen PAGE CONTEXT —
tightened same-sprint from a permission to an **expectation** (ADR-029 amendment) —
and the rendering layer gains a deterministic label-collision pass so same-region
annotations no longer produce overlapping labels (ADR-022's ≤3 cap and
drop-don't-guess resolution unchanged). Annotations are also **color-linked to the
text that names them**: when `say` refers to something it is also annotating, the
prompt requires it to reuse that annotation's exact `target.text` substring (no new
envelope field), and the client assigns each turn's annotations a deterministic
color from a small fixed palette, shared between the on-page box and the matching
substring in the chat bubble — an exact-match-only link, so a paraphrase renders as
plain text rather than a guessed color (ADR-029 amendment). Turn-time pings (ADR-026)
gain three new
kinds on top of the original two — `unseen->learning`/`unseen->mastered` join
`mastery-up`'s transition set, plus new `mastery-progress` (≥+0.10 in-state) and
`streak-progress` (`RESOLUTION_STREAK − 1`) kinds, superseded by
`misconception-resolved` on the completing turn — still computed exclusively by the
shared FSRS core, never the LLM, now bounded by a client-side per-concept-per-kind
session cap. See ADR-029, which also amends ADR-026.

The tutor's replies also get shorter by prompt contract (default ≤3 sentences / one
idea per turn, full explanations only on explicit request) — a pure prompt change,
no new wire field, banked by Sprint 15's voice-latency work.

## Curriculum at launch scale + voice latency (Sprint 15)
The knowledge graph grows from the Sprint 09 stopgap (eight `algebra.*`
concepts, one strand) to launch scale: ≈70 concepts across six strands —
`algebra1`, `geometry`, `algebra2`, `trig-precalc`, `calculus`, `prob-stats` —
one module per strand under `/packages/curriculum/src/concepts/`,
concatenated into the existing `CONCEPTS`/`CONCEPT_KEYS` exports (import sites
unchanged). The eight Sprint 13 keys are frozen byte-identical (a test pins
them); every addition is additive, with no migration anywhere — concept keys
stay strings by design (ADR-009/ADR-014). `Concept` gains
`aliases: readonly string[]`, closing the Sprint 11 audit's alias-drift flag
structurally: `topic.ts`'s hand-maintained alias table is deleted and its
detection table derives from the curriculum at import time, and
`KNOWN_CONCEPT_KEYS` (`web/lib/learning/types.ts`) becomes a re-export of
`CONCEPT_KEYS` — one source of truth for concept keys, titles, and aliases.
The turn prompt's key vocabulary switches from "all known keys" to a bounded
relevant subset (profile nodes ∪ topic-detected keys ∪ due keys ∪ strand
neighbors, capped ~24); `envelope.ts` keeps validating assessments against the
full key list, so a correct key outside the injected subset is kept, not
dropped. See ADR-032.

Three voice-pipeline defects from live use are fixed without reopening the
sequential STT → turn → TTS shape (ADR-003/PLAN §2.5 stands): the mic's
~5s cold start is instrumented (dev-only timing marks around `getUserMedia` /
`recorder.start()` / meter wiring) before being fixed with a construct-once
`AudioContext` (module-level, `resume()` per use, never holding a stream
between turns — ADR-011 upheld) and a parallelized `SpeechRecognition`
startup, budgeted at click→capturing ≤500ms with a ≤100ms UI acknowledgment;
the TTS leg streams end-to-end — the route's existing server-side
pass-through is joined by a chunked `VOICE_TTS_STREAM` background port (the
`AI_STREAM` pattern) and a `MediaSource`-fed overlay player so playback starts
at the first buffered chunk instead of the full clip, word-reveal pacing
moving to `timeupdate`, with today's one-shot buffered path kept alive as a
first-class per-utterance fallback, targeting p50 time-to-first-audio ≤2.5s;
and the ElevenLabs voice is pinned — explicit `model_id` + `voice_settings`,
per-request id logging, and a boot-time (not call-time) assertion that
`ELEVENLABS_VOICE_ID` is present and well-formed, failing loud on env drift
rather than silently degrading to the wrong voice. Audio is still never
persisted anywhere in this pipeline (ADR-011); the STT leg is untouched. See
ADR-033.

## Cost control + compliance hardening (Sprint 16)
The pre-beta gate: a bounded spend ceiling and the GDPR/COPPA flows a public
beta with minors requires, built *around* the shipped freemium/age/consent
machinery without touching it. **A global cost guardrail** adds a second,
aggregate ceiling above the per-user free-tier gate (ADR-007): migration 0013's
`cost_ledger` (one row per UTC day, `spent_cents`; RLS enabled with **zero
policies** — deny-all to clients) and `cost_guard(p_estimated_cents)` — a
`SECURITY DEFINER`, atomic add-and-check RPC mirroring `start_session`'s
race-proof pattern, the ledger's only writer, returning `{ soft_exceeded,
hard_exceeded, spent_cents }`. Every paid route (`ai/turn`, `ai/stream`,
`ai/turn/stream`, `voice/stt`, `voice/tts`) calls `costGuard(estimate)` *before*
the provider, with per-provider estimate constants from `web/lib/tier/
cost-model.ts` (budget-accurate, not invoice-accurate). **Soft cap** → voice
degrades to text + browser `SpeechSynthesis` (the §2.8 over-quota path reused);
**hard cap** → the turn route returns a friendly "resting for today" with no
provider call and never a 500. `FREE_SESSION_LIMIT` is retuned from Sprint 15's
per-turn cost data and mirrored into the marketing `Pricing.tsx` (test-bound so
the two can't drift). The `start_session` contract is unchanged — only the
limit's value moves. See ADR-041.

**Account data-rights flows.** `GET /api/account/export` serializes the caller's
rows from all six user-scoped tables to JSON through the *authenticated*
(RLS-scoped) client — RLS is the guarantee that it returns only the caller's own
data, not a `where` clause. `POST /api/account/delete` is phase one of a
**two-phase erasure**: it sets `erasure_requested_at` + `deleted_at` on the
caller's `users` row (immediate logical erasure via RLS + a durable queue
marker), signs out, and returns — it does **not** delete in-request, and is
idempotent. Phase two is the cron sweep (below), gated on a 7-day grace window,
which hard-deletes via the service-role admin client — a single `delete` of the
`auth.users` root cascades `public.users` and every user-scoped table through the
FK `on delete cascade` already declared in 0002/0004/0007/0008 — then verifies
absence. Every new user-scoped table from here on MUST carry that FK and appear
in the export. See ADR-035.

**First Vercel Cron infrastructure** (`/vercel.json`, three daily routes, all
`CRON_SECRET`-gated via a shared constant-time `assertCronSecret`): `reset-free-
tier` (a safety net normalizing dormant accounts the lazy `start_session` reset
never reaches), `hard-delete-sweep` (executes ADR-035's erasure queue), and
`stripe-reconcile` (a wired no-op **stub** — Sprint 23/billing owns its body; the
seam exists, no Stripe SDK ships). The service-role admin client is used only in
cron routes, only behind the secret gate. **Page identifiers are hashed at
rest:** `web/lib/privacy/url-hash.ts`'s `hashPageDomain` = HMAC-SHA256(domain,
`URL_HASH_SALT`) → hex (salt server-only, never bundled); `/api/session/start`
now writes `page_url_hash` and **stops writing plaintext `page_domain`** on new
rows. This deliberately supersedes PLAN §2.7's "keep `page_domain` for coarse
analytics" — the future dashboard (Sprint 22) groups by hash, and a coarse-domain
display is a later explicit reopening, not a silent default. See ADR-036.

## Onboarding + beta instrumentation (Sprint 17)
The second pre-beta gate: make first-run **guided, not cold**, and make the beta
**observable to us** without asking a tester to file anything. **Cold-start
onboarding** — a brand-new user (zero `knowledge_nodes`) runs a short **8–12 item
adaptive assessment** on first use that **seeds the knowledge graph** instead of
the tutor calibrating live against an empty profile. The item bank
(`web/lib/onboarding/item-bank.ts`) is a pure data structure over
`@calyxa/curriculum` — `selectAssessmentItems()` picks 8–12 concepts spanning the
6 strands by `difficultyPrior` (an easy anchor per strand + a few reaches); no
migration. Seeding (`web/lib/onboarding/seed.ts`) writes through the **existing
FSRS apply path** (`apply.ts`), so a seeded node is byte-identical to one a
tutoring turn writes and `loadProfile` reads it with zero special-casing; a
confident-correct propagates a **modest, seed-if-absent** prior to
`prerequisitesOf(C)` so 8–12 items cover far more than 8–12 nodes. It writes the
dormant `users.onboarding_completed_at` (unused since 0001). It is **skippable** —
a skip leaves the profile empty and the tutor calibrates live exactly as today
(the `CALIBRATING_PROFILE` fallback in `profile-read.ts` is preserved). The UI is
a new `Onboarding.tsx` overlay surface mounted by `Overlay.tsx` when `calibrating
&& onboarding_completed_at is null`; it does not touch the tutoring state machine.
See ADR-042.

**Privacy-safe observability, content-free by construction.** Three event streams
all route through the background worker (sole egress, ADR-006). **Telemetry**
(`web/lib/telemetry/events.ts`) is a typed discriminated union with **no free-text
field** — `onboarding_completed`, `session_started`, `turn_latency`,
`annotation_rendered`, `voice_used`, `degraded_hit`, … — validated at
`/api/telemetry`, which rejects unknown shapes; a contributor cannot attach a
transcript/URL without changing the type and tripping a test. The Sprint 15
`LatencyTrace` (`web/lib/voice/latency.ts`) is its first real sink
(`turn_latency`). `telemetry_event` is Shape 2 RLS but **insert-only from the
owner** (reads are service-role for analysis); `user_id` comes from the session,
never the body; the background **batches** events and **swallows** failures.
**Error monitoring** (`web/lib/monitoring/init.ts` + the extension's
`monitoring.ts`) scrubs before it sends — `beforeSend` strips message bodies,
transcript fragments, and page content/URLs, keeping stack traces + route/handler
names + a coarse user id at most; a missing DSN is a no-op; the extension holds
**no monitoring secret** (public DSN or the `/api/errors` relay). **Feedback** —
one unobtrusive overlay affordance → the RLS-scoped `feedback` table (Shape 2,
`user_id`-keyed, optional `session_id` link) → manual triage; `feedback.message`
is the **one** deliberate user-authored free-text field this sprint, export- and
erasure-covered. Both new tables FK-cascade to `users` and join Sprint 16's
export + erasure paths (migration 0015). See ADR-043 (telemetry + error privacy)
and ADR-039 (feedback).

## Marketing site (Sprint 20, revised by Sprint 25)
`/web/app/page.tsx` is the public landing page, built as a **parallel
track** alongside the product-roadmap sprints — it shares no files with them
except `/web/package.json`. Structurally it borrows Cluely's layout
(full-bleed hero, product demo center stage, scroll-driven feature reveals),
rendered in Calyxa's existing light `@calyxa/ui` palette and voice (ADR-018,
`/docs/brand.md`) rather than a dark, hype-forward skin.

The product demo is a **recreation, never an import**: components under
`/web/components/marketing/demo/` rebuild the overlay's visual vocabulary
from tokens, driven by a pure scene-script + step-reducer engine rather than
by the real WXT/shadow-DOM runtime. Sprint 20 recreated the Sprint-14-era
overlay; **Sprint 25 (ADR-040, provisional number) rebuilds the recreation
to the redesigned overlay**: the glass panel and idle-pill shell, the
tutor-mode session header (stage subtitle + clock), the board strip,
un-bubbled tutor turns with answer chips, milestone markers, the three-tone
ping system, the check-in (AI-prediction) and recap cards, and the Meadow
annotation system (ordinal triples, label pills, why-notes, step badges,
leaders, draw-on motion). The retired vocabulary — the solution-progress
bar, per-bubble profile tags, and the pre/post insight strips — is deleted
from the scene engine end-to-end, with a test asserting no marketing
component references it. The hero plays the full session arc (scan →
check-in → session → recap); the hero H1 itself carries decorative
Meadow-style annotations plus above-the-fold ping/mode elements; a dedicated
adaptive-features section ("It adapts while you work") demonstrates
misconception prediction, tutor modes, annotation anatomy, and a tap-to-fire
ping catalog. `/extension` is never imported into `/web`; fidelity is
checked by eyeball against a production extension build. `motion`
(framer-motion) remains scoped by ADR-031 to the marketing component tree
only — product surfaces (dashboard, account, the overlay) keep ADR-018's
CSS-only, reduced-motion-safe transitions unchanged.

A `waitlist` table (RLS enabled, zero policies — service-role write only via
`POST /api/waitlist`) replaces account signup as the page's promoted action;
`/signup` and `/login` remain reachable but de-emphasized. The "study loop"
section (per-session notes/practice problems/flashcards) was originally
marketed as live under ADR-031 §4's recorded fuse; that fuse is **resolved**
(ADR-031 amendment, 2026-07-09): generation is deferred post-beta, so the
section is reframed as roadmap — "on the way," no beta promise — chained
visually off the recap card's "Generated for you" placeholder slot. See
ADR-031 and ADR-040.

## Architecture decision records
See `/docs/adr/`. Notably:
- ADR-001 — Extension framework (WXT)
- ADR-002 — Overlay rendering (shadow DOM)
- ADR-005 — Monorepo tooling (Turborepo + npm workspaces)
- ADR-008 — Claude proxy (plain-text output — superseded for the envelope
  path by ADR-019; its "no annotation consumer" deferral is revisited by
  ADR-022)
- ADR-012 — Page-context extraction (no annotation rects — "no consumer" —
  revisited by ADR-022, which adds the in-memory equation-element registry)
- ADR-013 — Page-context injection ("the turn writes nothing" — reversed by
  ADR-019 for `session_interactions`, page-context injection itself unchanged)
- ADR-016 — Learning-model package (FSRS at session-end granularity —
  superseded by ADR-019's per-interaction granularity)
- ADR-018 — Design system (Tailwind v4 tokens, shadcn for web, shadow-DOM
  injection, no-host-mutation font strategy)
- ADR-019 — Structured JSON output envelope + per-turn `session_interactions`
  persistence + per-interaction FSRS
- ADR-020 — Reinforcement scheduler (`reinforcement_schedule`, FSRS-inverted
  `due_at`, query 2)
- ADR-021 — Turn-time topic detection biases the profile read; read-time
  decay + due items surfaced into the prompt
- ADR-022 — Annotation rendering layer: shadow-root SVG, resolver priority
  (selector → registry-first textMatch → bounded text search → bbox),
  drop-don't-guess fallback
- ADR-023 — Annotations ride the existing wire additively
  (`{ reply, annotations? }`) and are never persisted
- ADR-024 — Three profile-visibility surfaces (overview / in-session tags / recap),
  display-ephemeral, tags grounded against the exact profile injected that turn,
  display fields server-rendered; decides the Sprint 11 audit's mode/confidence
  question against persistence
- ADR-025 — Profile data on the wire: a new read-only overview route;
  `profile_tags` + the recap ride existing responses additively; the overlay's
  End-session control reuses the existing `END_SESSION` path; deltas computed
  client-side against the panel-open overview snapshot
- ADR-026 — Turn-time event pings computed by the shared FSRS core (never the
  LLM; two event kinds only, the silences a recorded contract), cross-session
  callbacks from the `priorWork` digest with the grounding gate extended,
  recap trend rollup + forward look; the confidence-mismatch proxy decision
  deferred with candidates recorded (amended by ADR-029: three more ping kinds,
  same never-the-LLM contract, plus a client-side session cap)
- ADR-027 — Problem-sized sessions: revisits ADR-007's manual trigger (not its
  atomic gate), AI-signaled + client-confirmed completion (three named
  end-conditions), popup demoted to a display hint, `FREE_SESSION_LIMIT`
  renumbering deliberately deferred to Sprint 16; AMENDED same-sprint (ADR-030):
  the start trigger widens from "first sent turn only" to "opening scan finds a
  problem, OR first sent turn as the fallback"
- ADR-028 — Solution-progress signal: model-emitted `solution_progress`,
  client-clamped (bounded regression, floor, monotone easing, forced full on
  `'solved'`); ephemeral, never persisted, never conflated with mastery
- ADR-029 — Annotation legibility: outlined box as the primary annotation type,
  proactive prompt steering, a deterministic label-collision layout pass; AMENDS
  ADR-026 with three new ping kinds (two added `mastery-up` transitions,
  `mastery-progress`, `streak-progress`) and their client-side session cap;
  AMENDED again same-sprint: proactive steering raised from permission to
  expectation, plus the color-link mechanism (exact `target.text` reuse in
  `say`, deterministic per-turn palette, no new envelope field)
- ADR-030 — The proactive opening scan: a new AI-initiated turn kind firing on
  panel expand when a plausible problem is detected, reusing the topic-biased
  profile read and the `callback` grounding gate, never emitting `assessment`;
  makes open-with-a-detected-problem the session start (amends ADR-027),
  degrades to silence (never a wrong guess) on failure or an unidentifiable
  problem; explicitly forecloses a free/uncounted scan mode
- ADR-031 — Marketing landing page: Cluely's structure in Calyxa's skin; the
  demo is a token-driven recreation that never imports `/extension`; `motion`
  scoped to the marketing component tree only; the study loop marketed as
  live with a recorded pre-invite fuse; a server-write-only `waitlist` table
  (RLS enabled, zero policies) as the page's promoted action over signup
- ADR-032 — Curriculum expansion to launch scale: six strands (~70 concepts),
  the eight Sprint 13 keys frozen byte-identical, `aliases` moved onto the
  concept (closes the Sprint 11 audit's alias-drift flag), `KNOWN_CONCEPT_KEYS`
  re-exports `CONCEPT_KEYS`, and the turn prompt's key vocabulary capped to a
  bounded relevant subset (~24) with full-list validation unchanged at parse
- ADR-033 — Voice pipeline latency: instrumented mic cold start with a
  construct-once `AudioContext` and parallelized `SpeechRecognition` startup
  (click→capturing ≤500ms, UI ack ≤100ms); TTS streamed end-to-end via a
  chunked background port + `MediaSource` playback with the buffered path kept
  as a first-class fallback (p50 time-to-first-audio ≤2.5s); ElevenLabs voice
  pinned (explicit `model_id`/`voice_settings`, boot-time fail-loud assertion);
  wrong-voice root cause recorded in the ADR's amendment box once Task 7 runs
- ADR-035 — Data export + two-phase erasure (Sprint 16): export = RLS-scoped
  read → JSON of the caller's six tables (RLS is the guarantee, not a `where`);
  deletion queues in-request (`erasure_requested_at` + `deleted_at`, idempotent,
  no in-request cascade) and a cron sweep executes the FK `on delete cascade`
  via the service-role admin client past a 7-day grace window, verifying
  absence; every new user-scoped table must carry the cascade FK + join the
  export
- ADR-036 — First Vercel Cron infra + URL hashing at rest (Sprint 16):
  `vercel.json` + three `CRON_SECRET`-gated daily routes (reset-free-tier safety
  net, hard-delete-sweep executing ADR-035's queue, stripe-reconcile no-op stub
  for Sprint 23); `page_url_hash` = HMAC-SHA256(domain, server-only salt),
  plaintext `page_domain` no longer written on new rows (supersedes PLAN §2.7's
  keep-domain line — dashboard groups by hash, ADR-036)
- ADR-041 — Global cost guardrail (Sprint 16, renumbered from the plan's 034
  which status-pins holds): an aggregate daily ceiling above the per-user gate
  (ADR-007) — atomic `SECURITY DEFINER` `cost_guard` RPC over a deny-all
  `cost_ledger`, called before every provider; soft cap degrades voice to text +
  browser TTS (§2.8 reuse), hard cap refuses gracefully (never a 500 or a
  provider call); per-provider estimate constants (budget- not invoice-accurate);
  retunes `FREE_SESSION_LIMIT` from Sprint 15 data with a test-bound Pricing sync
- ADR-039 — In-app feedback is capture, not ticketing (Sprint 17; KEEPS the plan's
  number — 039 was the one Sprint 17 ADR number still free): one overlay affordance
  → RLS-scoped `feedback` table (Shape 2, `user_id`-keyed, optional `session_id`) →
  manual triage; `feedback.message` is the ONE deliberate user-authored free-text
  field this sprint (export/erasure-covered); no status workflow/reply/email;
  FK-cascades to `users` and joins Sprint 16's export + erasure paths
- ADR-042 — Cold-start onboarding (Sprint 17; the plan's ADR-037, renumbered —
  037/038 were taken by the prompt-caching track, 040/041 by
  landing-demo-v2 + the cost guardrail): an 8–12 item adaptive assessment on first
  run (zero `knowledge_nodes`) seeds the graph via `difficultyPrior` selection
  across the 6 strands + `prerequisitesOf` prior propagation (modest,
  seed-if-absent), writing through the EXISTING `apply.ts` FSRS path (no parallel
  seeder) and the dormant `onboarding_completed_at`; skippable to today's
  live-calibration fallback; a new `Onboarding.tsx` overlay surface gated on the
  empty profile; no IRT/item calibration (V1 defers it)
- ADR-043 — Telemetry + error monitoring content-free by construction (Sprint 17;
  the plan's ADR-038, renumbered): a typed `TelemetryEvent` discriminated union
  with NO free-text field (the structural privacy guarantee — the route rejects
  unknown shapes; a test fails the build if a string field is added), `LatencyTrace`
  as the first sink, error `beforeSend` scrub (traces + route names + coarse id
  only), no monitoring secret in the extension bundle (public DSN or `/api/errors`
  relay), all three streams through the background worker (ADR-006), batched +
  failure-swallowing telemetry, service-role-read-only `telemetry_event`
- ADR-040 (Sprint 25 — provisional number now resolved: Sprint 17 claimed 039 as
  anticipated and Sprint 25 kept 040, so no renumber was needed) — Landing page
  v2: the marketing demo recreates the
  REDESIGNED overlay (modes/pings/milestones/board strip/check-in/recap/
  Meadow annotations), retired scene vocabulary deleted with a
  no-retired-features test; the hero plays the full session arc and the H1
  is annotated; a dedicated adaptive-features section; the study loop
  reframed as roadmap with no beta promise (amends ADR-031 §4, resolving its
  fuse); tokens consumed from `@calyxa/ui` or the DemoStage-scoped mirror,
  `theme.css` read-only

## To be documented
- System context diagram
- Data flow: content script → background service worker → backend proxy → AI / STT / TTS
- Auth and session model
- Free-tier enforcement (server-side)
- RLS policy model
