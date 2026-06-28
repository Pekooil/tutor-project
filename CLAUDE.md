# Calyxa — Claude Code working instructions

## Read this file at the start of every session before doing anything else.

## Current sprint
Sprint 08 — Live learning profile
(Update this line at the start of each new sprint)

## Locked architecture decisions
- Extension framework: WXT (not Plasmo, not vanilla MV3)
- Manifest version: V3 only. Never suggest MV2 patterns.
- Overlay strategy: shadow DOM (decided in Sprint 02, do not pre-empt)
- All API keys: server-side only. Never put any key in the extension bundle.
- Session audio: never persisted. Real-time STT streaming only.
- Free tier limits: enforced server-side. Client is a display hint only.
- DOM policy: content script reads only. No mutations to host page DOM.
- RLS policy: every Supabase table must have RLS before receiving data.

## Locked stack
- Extension: WXT + React + TypeScript
- Backend: Next.js API routes (Sprint 03+)
- Database: Supabase — Postgres + Auth + RLS (Sprint 03+)
- AI: Anthropic Claude API via server-side proxy (Sprint 05+)
- STT: OpenAI Whisper API (Sprint 06+)
- TTS: ElevenLabs streaming API (Sprint 06+)

## V1 scope — what is NOT built until Phase 3+
- Firefox support
- Video frame / diagram understanding
- B2B / school licensing
- Parent dashboard
- Non-math subjects
- Offline mode
- Mobile app

## Monorepo structure
/extension    WXT Chrome extension
/web          Next.js marketing site + mastery dashboard
/packages     Shared: /ai, /learning, /auth, /types, /utils
/supabase     Migrations, RLS policies, seed data
/docs         Architecture doc, ADRs, sprint plans

## Agent scoping rules
When acting as a named agent, only read and modify files within your
declared scope. If a task requires touching a file outside your scope,
stop and ask before proceeding.
