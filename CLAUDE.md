# Calyxa — Claude Code working instructions

## Read this file at the start of every session before doing anything else.

## Current sprint
Sprint 18 — Hardening: security, privacy & accessibility audit (release-candidate gate) — **IN PROGRESS (started 2026-07-10)**. ADR-044 (CI as the audit's home; no-secret proven against the BUILT bundle; a11y extended to the extension overlay/popup + Sprint 14/17 surfaces; fix-one-liners-file-the-rest; submission is Sprint 19). Builds the first CI (`.github/workflows/ci.yml`): turbo gate + no-secret-in-bundle grep + extension a11y + RLS coverage sweep; plus a security review, a manifest cleaned for review (prod origin, real name/version/description, justified permissions, no tabCapture), and a cross-site QA matrix. Task 1 (ADR + pointers) done. Sprint 17 — Onboarding + beta instrumentation (usability + observability) — **COMPLETE (2026-07-10, all 9 tasks)**. ADRs 039/042/043; migration 0017 (feedback + telemetry_event) applied LIVE; onboarding confirmed working; telemetry funnel (session_started/onboarding_completed/turn_latency/annotation_rendered), scrubbed error monitoring, and RLS-scoped feedback all route through the background worker; export/erasure cover both new tables. Carry-forwards: error-monitoring external sink needs a MONITORING_DSN (Sprint 18/19); voice_used/degraded_hit telemetry kinds defined but not yet emitted. Sprint 16 — Cost control + compliance hardening (parallel track) — IN PROGRESS. Sprint 20's marketing landing page (parallel track) is COMPLETE (2026-07-06). Sprint 25 — landing page v2 to match the redesigned extension (parallel track, `/docs/sprint-25-plan.md`) — IN PROGRESS (Task 1 of 10 — ADR + pointers — done 2026-07-09).
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
- Build artifact: Darcy tests against `extension/dist/chrome-mv3` (production
  build, loaded unpacked in Chrome). After ANY extension source change, run
  `npm run build` in /extension — `dist/chrome-mv3` is a frozen snapshot and
  does NOT auto-update (only `dist/chrome-mv3-dev` does, via `wxt dev`).

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
