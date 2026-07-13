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
Phase 2, Sprint 18 — Hardening: security, privacy & accessibility audit (release-candidate gate) — **COMPLETE (2026-07-12, all 9 tasks; ADR-044)**. First CI (GitHub Actions) with the audit gates: turbo + no-secret-in-bundle + extension a11y + RLS coverage sweep; security review + manifest cleaned for review (`tabs` dropped, verified live); cross-site QA matrix (4 sites, both degradation paths); Sprint-17 telemetry funnel completed (`voice_used`/`degraded_hit` wired). Accepted carry-forwards at close (not blockers): first green CI run on GitHub needs Actions secrets + a push; a live telemetry emission spot-check is still outstanding (code-complete + statically verified only); 2 filed UX enhancements (FU-1 → Sprint 24, FU-2 → Sprint 19); security-review filed items (public-endpoint rate-limiting, `API_BASE` prod flip) → Sprint 19. Sprint 17 — Onboarding + beta instrumentation — **COMPLETE (2026-07-10, all 9 tasks; ADRs 039/042/043; migration 0017 applied live)**. Sprint 16 — Cost control + compliance hardening (parallel track) — IN PROGRESS. Sprint 20's marketing landing page (parallel track) is COMPLETE (2026-07-06). Sprint 25 — landing page v2 to match the redesigned extension (parallel track, `/docs/sprint-25-plan.md`) — IN PROGRESS (Task 1 of 10 done 2026-07-09).

## File structure reference
See /docs/architecture.md

## What is NOT in scope for V1
- Firefox support
- Diagram/video understanding
- B2B / school licensing
- Parent dashboard
- Non-math subjects