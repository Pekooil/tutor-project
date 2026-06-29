# Calyxa — Architecture

> **Status: stub.** To be filled in during the planning phase.

This document will describe how Calyxa fits together: the extension, the
web app, the backend API proxy, the database, and the AI / STT / TTS
integrations.

## Monorepo layout
- `/extension` — WXT Chrome extension (Manifest V3)
- `/web` — Next.js marketing site + mastery dashboard
- `/packages` — shared libraries: `learning-model` (pure FSRS update + decay,
  Sprint 09), `curriculum` (pure concept graph, Sprint 09); `ai`, `auth`,
  `types`, `utils` remain unextracted
- `/supabase` — migrations, RLS policies, seed data
- `/docs` — architecture doc, ADRs, sprint plans

## Architecture decision records
See `/docs/adr/`. Notably:
- ADR-001 — Extension framework (WXT)
- ADR-005 — Monorepo tooling (Turborepo + npm workspaces)

## To be documented
- System context diagram
- Data flow: content script → background service worker → backend proxy → AI / STT / TTS
- Auth and session model
- Free-tier enforcement (server-side)
- RLS policy model
