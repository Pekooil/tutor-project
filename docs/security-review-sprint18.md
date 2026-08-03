# Security review — Sprint 18 (ADR-044)

**Date:** 2026-07-11 · **Scope:** the release-candidate security pass — RLS
coverage, bearer + cron auth, the Sprint 16/17 route attack surface, the
no-secret-in-bundle proof, and the manifest cleaned for review. Per ADR-044
decision 4: one-line findings are fixed in-sprint; larger ones are filed with a
reason, never silently carried.

## Verdict

**No beta-blocking finding.** The locked invariants hold in the shipped shape:
every user-scoped table is RLS-isolated, the deny-all tables are closed,
telemetry is insert-only, cron auth fails closed, the extension bundle carries
no secret, and every `/api/*` route has an auth guard appropriate to its
caller. The manifest is now review-ready. Three items are **filed** (below),
none blocking: rate-limiting on the two intentionally-public endpoints, a
`tabs`-permission minimization to verify in Task 7, and the launch-time
`API_BASE` flip (Sprint 19).

## 1. RLS coverage (Task 5)

The sweep (`web/tests/rls.test.ts`, 32 tests, green) proves every table added
through migration 0017. **No missing or mis-scoped policy was found** — the
"missing RLS policy" one-liner ADR-044 anticipated does not exist here.

| Table | Shape | Result |
|---|---|---|
| `users` | 1 (`id`) | ✅ owner-only; B cannot read A |
| `sessions`, `knowledge_nodes`, `misconceptions`, `session_interactions`, `reinforcement_schedule` | 2 (`user_id`) | ✅ owner-only; cross-user SELECT/UPDATE denied; forged-insert denied by WITH CHECK |
| `feedback` | 2, no `deleted_at` (ADR-039) | ✅ owner-only; cross-user forge denied |
| `telemetry_event` | 2, **insert-only** (ADR-043) | ✅ owner can INSERT; **no one can SELECT** (even the owner); forge/other-user/null-user inserts denied |
| `waitlist`, `cost_ledger` | 3 (deny-all) | ✅ neither anon nor authenticated can read or write a real seeded row |

Teeth verified safely (no production policy dropped): the service-role client
(RLS bypassed) sees a seeded deny-all row while every client key sees nothing —
a stray permissive policy would flip the sweep red.

## 2. Auth review

### Bearer (`web/lib/auth/bearer.ts`)
- `clientFromBearer` rebuilds a **request-scoped** client carrying the caller's
  token, validated by `supabase.auth.getUser()` (a real server-side JWT check,
  not blind trust); every later query runs under that user's RLS, never the
  service role. Missing/empty token → 401. **Fails closed.** ✅
- `clientFromBearerOrCookie` tries the bearer header (extension), falls back to
  the cookie session (web dashboard); both paths 401 on no user. ✅

### Cron (`web/lib/cron/auth.ts` — `assertCronSecret`)
- Requires `Authorization: Bearer <CRON_SECRET>`; a **missing/misconfigured
  secret is a refusal (401), not a bypass** — fails CLOSED, unlike `costGuard`
  (which fails open by design). Constant-time compare (`timingSafeEqual`) with
  a length guard. `CRON_SECRET` is server-only, never `NEXT_PUBLIC_`. ✅
- **All three** service-role cron routes gate on it before touching the admin
  client: `cron/hard-delete-sweep`, `cron/reset-free-tier`,
  `cron/stripe-reconcile`. ✅

### Per-route guard map
| Route(s) | Guard |
|---|---|
| `ai/turn`, `ai/turn/stream`, `ai/stream`, `voice/stt`, `voice/tts`, `session/start`, `session/end`, `profile/overview` | `clientFromBearer` (RLS-scoped) |
| `account/export`, `account/delete`, `feedback`, `telemetry`, `onboarding` | `clientFromBearerOrCookie` |
| `errors` | `clientFromBearerOrCookie`, **non-fatal** (see §3) |
| `cron/*` | `assertCronSecret` + admin client |
| `waitlist` | public → service-role writer, validated (see §3) |
| `auth/login`, `auth/signup`, `auth/session`, `auth/logout` | cookie client (these establish auth) |
| `auth/token`, `auth/refresh` | mint/refresh from credentials/refresh-token (the auth endpoints themselves) |

## 3. Attack surface — the intentionally-public / Sprint 16-17 routes

- **`telemetry` / `feedback`** — authed; the row's `user_id` comes from the
  session, and the DB `WITH CHECK (auth.uid() = user_id)` enforces "attributed
  to self only" even if a body tried otherwise (proven by the Task 5 forge
  tests). Telemetry's payload is validated content-free against the
  `TelemetryEvent` union — no free-text field can ride (ADR-043).
- **`errors`** — **deliberately does not 401** (documented in the route): the
  point of error monitoring is to see failures that happen *without* a session
  (a crashed worker, a failed refresh). Strictly shape-validated (allow-list of
  `message`/`stack`/`context`, unknown keys rejected), the payload is scrubbed
  **client-side** before egress, and the extension holds **no** monitoring
  secret — only this server route does. **Reviewed and accepted.**
- **`waitlist`** — public by design (unauthenticated visitors), service-role
  writer only. Email-validated, honeypot field, `ON CONFLICT DO NOTHING` (no
  account-enumeration leak), `source` allow-listed. **Reviewed and accepted.**
- Both public endpoints shared one gap at review time: **no rate-limiting** —
  filed (§7.1), not a Sprint 18 one-liner (needs traffic data + infra).
  **Since RESOLVED in Sprint 19** — both now enforce
  `web/lib/rate-limit/limiter.ts`; see §7.1.

## 4. No-secret-in-bundle (Task 3)

`scripts/check-no-secrets.mjs`, wired as the CI `no-secret-in-bundle` job,
builds `extension/dist/chrome-mv3` and greps every emitted file for the **values**
of `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` / `ELEVENLABS_API_KEY` /
`MONITORING_DSN` / `SUPABASE_SERVICE_ROLE_KEY` (from CI env) plus backstop
literals (key shapes, Sentry DSN shapes, the secret var names). A planted value
fails the job; the clean build passes. The locked "never put any key in the
extension bundle" rule is now **enforced**, not just asserted. ✅

## 5. Manifest cleaned for review (`extension/wxt.config.ts`)

Before: WXT derived `name`/`version` from package.json (`@calyxa/extension`,
`0.0.0`), no `description`, dev-only `host_permissions`. Now (verified in the
built `dist/chrome-mv3/manifest.json`):

- `name`: **"Calyxa — AI math tutor"**; `description`: real one-line listing
  copy; `version`: **`0.1.0`** (beta start).
- `host_permissions`: production origin **`https://tutor-project-web.vercel.app/*`**
  added **alongside** `http://localhost:3000/*` (not replacing it).
- **No `tabCapture` / `desktopCapture`** (confirmed: 0 occurrences in the
  extension and the built manifest). The beta OCR path stays deferred.

### Permission justification
| Permission | Justification |
|---|---|
| `storage` | Background-worker state across service-worker wake cycles (`lib/storage.ts`). |
| `activeTab` | The current tab on user gesture (the toggle-overlay command relay). |
| `scripting` | Programmatic MV3 content-script injection. |
| ~~`tabs`~~ | **DROPPED (Task 7, confirmed live 2026-07-12).** Was: read the sender/active tab URL to derive the session's page domain. Removed — the code reads only `sender.tab.url` (covered by `<all_urls>`) and `tab.id` (ungated); a live session confirmed `page_url_hash` still resolves without it. |
| `<all_urls>` (host) | The content script must run on any page the student visits. |
| `http://localhost:3000/*`, `https://tutor-project-web.vercel.app/*` (host) | The background worker's `fetch` to the backend (`lib/api.ts`, ADR-006). |

## 6. Fixed in-sprint (one-liners)

- Manifest metadata (`name`/`description`/`version`) set, and the production
  backend origin added to `host_permissions` — the manifest cleanup itself.
- **`tabs` permission dropped (Task 7, confirmed live 2026-07-12).** The one
  permission §7.2 flagged as possibly droppable was verified in a real session
  (a new session still wrote a non-null `page_url_hash` with `tabs` removed) and
  is now gone from the manifest — a smaller review footprint. See §7.2.
- No other one-line security fix was warranted: RLS is complete (§1), auth is
  sound (§2).

## 7. Filed — not fixed at review time, with reasons

> **Status update (2026-08-03):** all three items below have since been
> RESOLVED. Each entry is kept for the audit trail, struck through and annotated
> with how and when it was closed. Nothing in this section is an open finding.

1. ~~**Rate-limiting on the two public endpoints (`/api/errors`, `/api/waitlist`).**~~
   **RESOLVED (Sprint 19) — implemented.** Both are intentionally unauthenticated,
   and at review time were bounded only by strict shape validation + honeypot +
   idempotency, with no request-rate limiting. A Postgres-backed rate-limit
   primitive now exists (`web/lib/rate-limit/limiter.ts`, migration
   `0018_rate_limit.sql`) and both endpoints enforce it: `checkRateLimit(…,
   clientBucket(request, …))` → `tooManyRequests()` in
   `web/app/api/waitlist/route.ts` and `web/app/api/errors/route.ts`. Covered by
   `web/tests/rate-limit.test.ts`. The original "needs real traffic data + a
   primitive this sprint does not introduce" reasoning no longer applies.
2. ~~**`tabs` permission minimization.**~~ **RESOLVED (Task 7, 2026-07-12) —
   dropped.** The background reads the page URL via `sender.tab.url` (exposed by
   the `<all_urls>` host permission, not `tabs`) and only `tab.id` from
   `chrome.tabs.query()` (ungated). Verified in a real session: with `tabs`
   removed and the extension reloaded, a new session still wrote a non-null
   `sessions.page_url_hash` and the toggle/broadcast paths still worked. The
   permission is now removed from `wxt.config.ts` (moved to §6, fixed-in-sprint).
3. ~~**Extension `API_BASE` still `http://localhost:3000`.**~~ **RESOLVED
   (Sprint 19, verified live 2026-07-15) — flipped.** At review time the manifest
   carried the prod origin but `lib/api.ts`'s `API_BASE` constant still targeted
   localhost, so the shipped build did not talk to prod. It is now
   `export const API_BASE = 'https://calyxa.app'` (`extension/src/lib/api.ts:51`),
   verified live against the deployed routes. No permissions re-review was needed
   (the host permission was already in place).
