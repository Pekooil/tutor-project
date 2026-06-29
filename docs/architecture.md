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

## Architecture decision records
See `/docs/adr/`. Notably:
- ADR-001 — Extension framework (WXT)
- ADR-002 — Overlay rendering (shadow DOM)
- ADR-005 — Monorepo tooling (Turborepo + npm workspaces)
- ADR-018 — Design system (Tailwind v4 tokens, shadcn for web, shadow-DOM
  injection, no-host-mutation font strategy)

## To be documented
- System context diagram
- Data flow: content script → background service worker → backend proxy → AI / STT / TTS
- Auth and session model
- Free-tier enforcement (server-side)
- RLS policy model
