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

## To be documented
- System context diagram
- Data flow: content script → background service worker → backend proxy → AI / STT / TTS
- Auth and session model
- Free-tier enforcement (server-side)
- RLS policy model
