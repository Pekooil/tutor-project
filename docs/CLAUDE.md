# Calyxa — Claude Code Working Instructions

## Architecture decisions (locked)
- Manifest V3 only. Never suggest MV2 patterns.
- Overlay uses shadow DOM. Never mutate the host page DOM.
- All API keys are server-side. Never put keys in the extension bundle.
- Audio is never persisted. STT is real-time streaming only.
- Free tier limits are enforced server-side. Client is a hint only.
- RLS policies must exist before any table receives data.

## Stack (locked)
- Extension: WXT + React + TypeScript
- Backend: Next.js API routes on Vercel
- Database: Supabase (Postgres + Auth + RLS)
- AI: Anthropic Claude API (server-side proxy only)
- STT: OpenAI Whisper API
- TTS: ElevenLabs streaming API

## Current phase
Phase 2, Sprint 17 — Onboarding + beta instrumentation (Task 1 of 9 — ADRs + pointers — done 2026-07-09; ADRs 039/042/043 — feedback KEEPS plan's 039; onboarding 037→042 and telemetry 038→043 renumbered off the prompt-caching track's collision). Sprint 16 — Cost control + compliance hardening (parallel track) — IN PROGRESS. Sprint 20's marketing landing page (parallel track) is COMPLETE (2026-07-06). Sprint 25 — landing page v2 to match the redesigned extension (parallel track, `/docs/sprint-25-plan.md`) — IN PROGRESS (Task 1 of 10 done 2026-07-09).

## File structure reference
See /docs/architecture.md

## What is NOT in scope for V1
- Firefox support
- Diagram/video understanding
- B2B / school licensing
- Parent dashboard
- Non-math subjects