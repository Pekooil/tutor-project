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

## Marketing site (Sprint 20)
`/web/app/page.tsx` becomes the public landing page, built as a **parallel
track** alongside the product-roadmap sprints (15–19) — it shares no files
with them except `/web/package.json`. Structurally it borrows Cluely's
layout (full-bleed hero, product demo center stage, scroll-driven feature
reveals), rendered in Calyxa's existing light `@calyxa/ui` palette and voice
(ADR-018, `/docs/brand.md`) rather than a dark, hype-forward skin.

The product demo is a **recreation, never an import**: components under
`/web/components/marketing/demo/` rebuild the overlay's visual vocabulary
(panel chrome, transcript bubbles, color-linked annotations, the profile
tags/insight strip, pings, the solution-progress bar, the voice waveform)
from `@calyxa/ui` tokens, driven by a pure scene-script + step-reducer engine
rather than by the real WXT/shadow-DOM runtime. `/extension` is never
imported into `/web`; fidelity is instead checked by eyeball against a real
dev build. `motion` (framer-motion) is added to `/web`, scoped by ADR-031 to
the marketing component tree only — product surfaces (dashboard, account,
the overlay) keep ADR-018's CSS-only, reduced-motion-safe transitions
unchanged.

A new `waitlist` table (RLS enabled, zero policies — service-role write only
via `POST /api/waitlist`) replaces account signup as the page's promoted
action; `/signup` and `/login` remain reachable but de-emphasized. The page
also markets a "study loop" (per-session notes/practice problems/flashcards)
that does not exist as a shipped product feature — a deliberate, recorded
marketing-ahead-of-product call (ADR-031) with a named fuse: real artifact
generation must ship, or the section's copy must be softened, before the
waitlist converts to beta invitations. See ADR-031.

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

## To be documented
- System context diagram
- Data flow: content script → background service worker → backend proxy → AI / STT / TTS
- Auth and session model
- Free-tier enforcement (server-side)
- RLS policy model
