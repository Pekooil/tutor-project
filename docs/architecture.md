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
  deferred with candidates recorded

## To be documented
- System context diagram
- Data flow: content script → background service worker → backend proxy → AI / STT / TTS
- Auth and session model
- Free-tier enforcement (server-side)
- RLS policy model
