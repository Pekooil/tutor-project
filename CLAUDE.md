# Calyxa — Claude Code working instructions

## Read this file at the start of every session before doing anything else.

## Current sprint
Sprint 19 — Store packaging + private beta distribution — **IN PROGRESS (started 2026-07-12; Task 1 of 9 — ADRs + pointers — done)**. ADR-045 (unlisted Chrome Web Store per ADR-006; access gated by an invite CLAIM at signup, NOT link secrecy — uninvited email gets a soft "you're on the waitlist" 200 with no user created; `waitlist` gains additive `invited_at`/`invite_code`/`cohort` columns, STILL deny-all/Shape 3, NO FK-to-users since pre-signup emails aren't users; versioned rollback-first `wxt zip` release pipeline; email send is server-only + admin/CRON-guarded, absent-credential no-ops, manual-send batch supported). ADR-046 (the `/privacy` + `/terms` pages + Chrome data-safety disclosure generated from the ACTUAL verified collection surface — email, birth year, GDPR stamp, text transcripts no-audio, hashed page ids, typed no-content telemetry, feedback — truthful by construction; export/delete rights linked). Task-4 migration renumbered from the plan's `0018` to **`0019_waitlist_invite.sql`** (`0018_rate_limit.sql` already exists). Sprint 18 — Hardening: security, privacy & accessibility audit (release-candidate gate) — **COMPLETE (2026-07-12, all 9 tasks)**. ADR-044 (CI as the audit's home; no-secret proven against the BUILT bundle; a11y extended to the extension overlay/popup + Sprint 14/17 surfaces; fix-one-liners-file-the-rest; submission is Sprint 19). Delivered: the first CI (`.github/workflows/ci.yml`) — turbo gate + no-secret-in-bundle grep + extension a11y + RLS coverage sweep; a security review + manifest cleaned for review (prod origin, real name/version/description, justified permissions, no tabCapture, `tabs` permission dropped + verified live); a cross-site QA matrix (4 real sites, both degradation paths, SPA re-capture, no host-DOM mutation); and the Sprint-17 telemetry funnel completed (`voice_used` + `degraded_hit` wired via a server `degradedCap` annotation; `turn_latency`/`annotation_rendered` confirmed present). Full turbo gate green locally. **Accepted carry-forwards at close (Darcy's call 2026-07-12), NOT blockers:** (a) first green CI run ON GitHub still needs Actions secrets (a dedicated test Supabase + test keys) + a push — the workflow is complete/correct and the local gate is green; (b) live telemetry emission spot-check — `turn_latency`/`voice_used`/`degraded_hit` are code-complete + statically verified but NOT yet observed emitting on a real turn (no voice/capped turn has exercised the pipeline live; recommend a 2-min check); (c) 2 filed UX enhancements from the QA matrix — FU-1 crop-fallback → Sprint 24 (F1), FU-2 proactive-resting → Sprint 19 (F1); (d) security-review filed items — rate-limiting on the 2 public endpoints, and the `API_BASE` localhost→prod flip → Sprint 19. Sprint 17 — Onboarding + beta instrumentation (usability + observability) — **COMPLETE (2026-07-10, all 9 tasks)**. ADRs 039/042/043; migration 0017 (feedback + telemetry_event) applied LIVE; onboarding confirmed working; telemetry funnel (session_started/onboarding_completed/turn_latency/annotation_rendered), scrubbed error monitoring, and RLS-scoped feedback all route through the background worker; export/erasure cover both new tables. Carry-forwards: error-monitoring external sink needs a MONITORING_DSN (Sprint 18/19); voice_used/degraded_hit telemetry kinds defined but not yet emitted. Sprint 16 — Cost control + compliance hardening (parallel track) — IN PROGRESS. Sprint 20's marketing landing page (parallel track) is COMPLETE (2026-07-06). Sprint 25 — landing page v2 to match the redesigned extension (parallel track, `/docs/sprint-25-plan.md`) — IN PROGRESS (Task 1 of 10 — ADR + pointers — done 2026-07-09).
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
