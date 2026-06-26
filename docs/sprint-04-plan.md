# Sprint 04 — API proxy layer (no AI yet)

## Goal
Stand up the backend session API the extension talks to, and make the extension
actually call it. By the end, a signed-in extension can **start** and **end** a
tutoring session against the live backend, every call is authenticated with a
bearer token the extension holds (never a key in its bundle), and the **free-tier
session limit is enforced server-side** by an atomic counter that races cannot
defeat. The session row created in Sprint 03's `sessions` table now gets written
by a real endpoint — scoped to the caller by RLS — instead of by a test fixture.

This is the first sprint where `/extension` talks to `/web`. There is still **no
AI**: no `/voice`, no STT/TTS, no Claude call, no prompt assembly. A "session" this
sprint is purely a database lifecycle record (start → end) plus the tier decision
attached to it. The overlay shell and content script from Sprints 01–02 are
**untouched** except where the popup and background service worker must learn to
sign in and call the new endpoints.

## Context
Sprint 03 delivered the identity + data foundation: Supabase Auth, the `users` and
`sessions` tables with RLS enabled in-migration, and a `/web` app with working
email+password auth (signup/login/logout/session) behind a COPPA age gate and GDPR
consent. The `sessions` table exists but nothing writes to it except the Sprint 03
RLS test; `users` already carries the freemium columns (`free_session_count`,
`free_period_started_at`) as **nullable, behaviour-free** placeholders.

This sprint builds the layer the locked architecture calls the
**server-side API proxy**: the single authoritative surface between the extension
and the database. Three locked decisions from `/CLAUDE.md` drive it:
- **All API keys server-side; never in the extension bundle.** This is the reason
  the extension cannot embed the Supabase anon key and sign in directly — it must
  authenticate *through* our backend and hold only short-lived user tokens. This
  forces the bearer-token model in ADR-006.
- **Free-tier limits enforced server-side; the client is a display hint only.** The
  session-start endpoint is the single source of truth for the quota; the popup's
  "N sessions left" is advisory.
- **RLS on every user-data table before it receives data.** Already satisfied for
  `sessions` (Sprint 03). The new endpoints write through the **request-scoped**
  client carrying the caller's JWT, so RLS — not the route handler — is the final
  access check on every insert/update.

### Reconciliation with `/docs/PLAN.md` sprint numbering (read before Task 1)
`/docs/PLAN.md` §2.10 folds "/session start/end" and "extension sign-in" into its
own *Sprint 2*, and puts the *atomic free-tier gate* in its *Sprint 6*. The
`/docs/sprint-NN-plan.md` series is sequenced differently (Sprint 03 was the
auth+DB foundation). This sprint deliberately:
- builds the `/session` start/end API and the extension sign-in that PLAN §2.10
  Sprint 2 described, **and**
- **pulls the atomic free-tier gate forward** (PLAN §2.8, §2.3 query 3) so the
  session counter is enforced from the moment the endpoint exists, rather than
  shipping an ungated endpoint now and bolting enforcement on later.

What is *not* pulled forward from PLAN's freemium sprint: Stripe/billing, the full
entitlements resolver, Pro feature-flag gating, and the Vercel reset cron. This
sprint implements only the **free session counter** and its **rolling reset done
lazily at session start** (see below). This is recorded in ADR-007 so the split is
not re-litigated.

### Tier-enforcement model (read before Task 4)
The free quota is enforced by the **atomic `UPDATE … RETURNING`** of PLAN §2.3
query 3, run **in the same transaction** that inserts the `sessions` row, so a
started session always corresponds to a counted use and concurrent starts cannot
both slip under the limit. Because `@supabase/supabase-js` cannot wrap two
statements in one client-side transaction, this is implemented as a Postgres
function (`public.start_session(...)`) invoked via `supabase.rpc()`. The function
runs **SECURITY INVOKER**, so `auth.uid()` is the caller and RLS still applies to
both the `users` UPDATE and the `sessions` INSERT — the gate stays honest, not a
service-role bypass.

**Boundary behaviour is graceful degradation, not a hard block** (locked in PLAN
§2.8). When a free user is over quota, `start_session` still creates a session, but
marks it `counts_against_free = false` and returns `degraded: true`. With no AI
this sprint, "degraded" has no functional difference yet — but the **response
contract** (`{ degraded, counts_against_free, remaining }`) is established now so
the voice sprint can branch on it (text-only + browser `SpeechSynthesis`, upsell)
without changing the API shape. The extension surfaces `remaining` as a hint only.

**Rolling reset is lazy this sprint.** `start_session` resets
`free_session_count = 0` and bumps `free_period_started_at` when the caller's
period is ≥ 30 days old, *before* the quota check. The daily Vercel reconciliation
cron (PLAN §2.8) is **deferred** — the lazy check is correct on its own; the cron
is only a latency/cleanup optimisation and lands with billing.

### Extension auth model (read before Tasks 6–7)
The extension authenticates **through the backend**, never with an embedded key:
1. The popup collects email+password and asks the **background worker** to sign in.
2. The background `POST`s to `/api/auth/token`, which signs in server-side and
   returns `{ access_token, refresh_token, expires_at, user }` **in the body**
   (no cookies — the extension is not a cookie context for our origin).
3. The background stores the tokens in **`chrome.storage.session`** (cleared on
   browser close, never hits disk — PLAN §2.2 "good for token handles"), and is the
   *only* context that holds them. The popup and content script never see them.
4. Every `/api/session/*` call from the background sends
   `Authorization: Bearer <access_token>`. The backend builds a request-scoped
   Supabase client from that bearer so RLS evaluates the call as that user.
5. On a 401 (expired access token), the background calls `/api/auth/refresh` with
   the refresh token once, stores the new pair, and retries the original call.

The access token is the same Supabase JWT the web app uses; there is one identity
model across web and extension (ADR-003). The anon key never enters `/extension`.

## Execution model
A **single code session** owns this sprint end to end, worked **strictly in order
(1 → 8)**. The dependency chain is real: the migration (Task 2) must land before
the endpoints (Tasks 3–4) can call the RPC; the endpoints must exist and be tested
(Task 5) before the extension (Tasks 6–7) has anything to call; end-to-end
verification (Task 8) is last. Respect the per-task **scope** lines as a focus
discipline (touch only the listed files), but it is one session — no handoff.

Unlike Sprint 03, `/extension` **is** in scope this sprint — but only `src/lib`,
`src/background`, `src/popup`, `src/types/messages.ts`, and `wxt.config.ts`. The
overlay (`src/overlay/*`) and content script (`src/content/*`) are **not** touched.

## Files in scope

### Task 1 (planning / docs) creates or edits:
```
/docs/adr/ADR-006-extension-token-auth.md   ← new — bearer-token model for the extension
/docs/adr/ADR-007-freemium-session-gate.md  ← new — atomic free-tier gate + graceful degradation
/CLAUDE.md                                    ← edit one line: Current sprint → Sprint 04
/docs/CLAUDE.md                               ← edit one line: Current phase → Phase 1, Sprint 4
/docs/sprint-04-plan.md                       ← this file
```

### Database (Task 2) creates:
```
/supabase/migrations/0003_sessions_freemium.sql  ← session columns + indexes; free-tier column
                                                     normalisation; start_session + end_session RPCs;
                                                     lazy 30-day reset (no new tables → RLS unchanged)
```

### Web — auth plumbing (Task 3) creates:
```
/web/lib/auth/bearer.ts                ← extract Bearer token → request-scoped (RLS) client + user, or 401
/web/app/api/auth/token/route.ts       ← POST {email,password} → {access_token,refresh_token,expires_at,user}
/web/app/api/auth/refresh/route.ts     ← POST {refresh_token} → new token pair
```

### Web — session API + tier gate (Task 4) creates:
```
/web/lib/tier/session-gate.ts          ← FREE_SESSION_LIMIT + start/end helpers wrapping the RPCs
/web/app/api/session/start/route.ts    ← POST → bearer auth → atomic gate → create session
/web/app/api/session/end/route.ts      ← POST {sessionId} → bearer auth → set ended_at (RLS-scoped)
```

### Test (Task 5) creates:
```
/web/tests/session.test.ts             ← session start/end + tier enforcement, request-scoped clients
```

### Extension (Tasks 6–7) creates or edits:
```
/extension/src/lib/storage.ts          ← new — chrome.storage.session token + session-state wrappers
/extension/src/lib/api.ts              ← new — backend client (sign-in, refresh, start, end); bearer + auto-refresh
/extension/src/types/messages.ts       ← edit — add SIGN_IN / SIGN_OUT / START_SESSION / END_SESSION / SESSION_STATE
/extension/src/background/index.ts     ← edit — handle the new messages; re-hydrate tokens from storage
/extension/src/popup/main.tsx          ← edit — sign-in form + tier/remaining display + start/end buttons
/extension/wxt.config.ts               ← edit — add backend API origin to host_permissions
```

### Config (Task 6) edits:
```
/web/.env.local.example                ← document the dev API base URL the extension targets (no secrets)
```

## Files explicitly out of scope
```
/extension/src/overlay/*       (overlay shell unchanged — Sprint 02 stays as-is)
/extension/src/content/*       (content script unchanged — no DOM/extraction work this sprint)
/web/app/api/voice/*           (STT→AI→TTS proxy — Sprint 05+)
/web/app/api/profile/*         (live profile load/update — Sprint 05+)
/web/app/api/billing/*         (Stripe Checkout + webhooks — later sprint)
/web/app/api/me/*              (GDPR export/erasure — later sprint)
/web/app/api/cron/*            (reset/reconcile crons — deferred; lazy reset covers this sprint)
/packages/*                    (shared libs arrive with AI/learning — Sprint 05+)
/supabase/migrations/0001*,0002* (Sprint 03 migrations — do not edit; 0003 is additive)
```

Also out of scope this sprint (no pre-empting later work):
- **AI / voice / STT / TTS.** A "session" is a DB lifecycle record only; nothing
  streams, nothing calls Claude/Whisper/ElevenLabs.
- **Stripe / billing / Pro upgrade**, and the full **entitlements resolver** and
  Pro feature-flag gating. Only the binary free-session counter + a `degraded`
  flag exist this sprint.
- **The reset cron.** Rolling reset is done lazily at session start; the daily
  Vercel cron lands with billing.
- **Drizzle ORM.** The endpoints use `@supabase/supabase-js` + the `start_session`
  RPC directly, consistent with Sprint 03.
- **New tables.** No `knowledge_nodes` / `misconceptions` / `session_interactions`
  — those arrive with the learning sprints, each with RLS in its own migration.
- **The overlay and content script.** No annotation, no page extraction, no mic.

Do not create any file not listed above. If something seems needed but is not
listed, add it to "What the next sprint needs to know" and ask before creating it.

---

## Task 1 — Extension-auth + freemium-gate ADRs + sprint pointers (planning / docs)

Write two ADRs using the project's ADR format (ADR-001…ADR-005):

```
## ADR-00N: [Title]
**Status:** Decided
**Context:** [why this needed a decision]
**Decision:** [what was chosen]
**Rationale:** [why]
**Consequences:** [what this forecloses or enables]
```

ADR-006 — Extension authenticates with a bearer token via the backend:
- Context: the locked key policy forbids any key in the extension bundle, so the
  extension cannot embed the Supabase anon key and call Supabase directly. It needs
  an auth model that puts no key in the bundle yet lets RLS evaluate its calls as
  the signed-in user. Candidates: anon key in bundle (rejected by policy), a custom
  session-token table, or bearer the Supabase user JWT obtained via the backend.
- Decision: the extension signs in **through the backend** (`/api/auth/token`),
  receives `{ access_token, refresh_token, expires_at }` in the body, stores them
  **only in `chrome.storage.session`** in the **background worker**, and sends
  `Authorization: Bearer <access_token>` on every `/api/session/*` call. The
  backend builds a request-scoped Supabase client from the bearer (RLS applies). A
  401 triggers a single `/api/auth/refresh` + retry.
- Rationale: no key ships in the extension; one identity primitive (the Supabase
  JWT) across web and extension (ADR-003); `chrome.storage.session` keeps tokens
  off disk and clears them on browser close (PLAN §2.2); the worker is the only
  network-egress context (PLAN §2.2) so tokens never reach the popup/content
  script.
- Consequences: enables RLS-enforced extension calls with no embedded key; REQUIRES
  a body-returning token endpoint distinct from the web cookie flow, and refresh
  handling in the background; the API origin must be in the extension's
  `host_permissions` so the worker can call it cross-origin; forecloses any direct
  extension→Supabase call.

ADR-007 — Free-tier session gate: atomic, server-authoritative, graceful:
- Context: the free limit must be enforced where the client cannot tamper with it,
  and concurrent session starts must not both slip under the limit. We also had to
  decide the over-limit behaviour and where the rolling reset lives.
- Decision: enforce at **session start** via an atomic `UPDATE users SET
  free_session_count = free_session_count + 1 … WHERE tier='free' AND
  free_session_count < $limit RETURNING …`, run in the **same transaction** as the
  `sessions` INSERT inside a **SECURITY INVOKER** Postgres function
  (`start_session`) so RLS still applies. Over-limit = **graceful degradation**: the
  session still starts but `counts_against_free=false`, `degraded=true`. The rolling
  30-day reset is performed **lazily inside `start_session`**; the daily cron is
  deferred.
- Rationale: a single atomic statement is race-safe; SECURITY INVOKER keeps the
  gate inside RLS rather than bypassing it; graceful degradation matches the locked
  product decision (never lock a student out mid-study); the lazy reset is correct
  without the cron, which is only a latency optimisation.
- Consequences: enables a tamper-proof counter from day one and a stable
  `{degraded, counts_against_free, remaining}` response the voice sprint branches
  on; REQUIRES `users.free_session_count` / `free_period_started_at` to be NOT NULL
  with sane defaults (migration 0003 normalises them); defers Stripe, the
  entitlements resolver, Pro gating, and the reset cron.

Then make two one-line edits:
- /CLAUDE.md: change the "Current sprint" line to
    Sprint 04 — API proxy layer (no AI yet)
- /docs/CLAUDE.md: change "Current phase" from "Phase 1, Sprint 3" to
    "Phase 1, Sprint 4"

Do not change any other line in either CLAUDE.md.

Acceptance gate before Task 2:
  - ADR-006 and ADR-007 exist and follow the ADR format exactly.
  - Both CLAUDE.md sprint-pointer lines are updated and nothing else changed.

---

## Task 2 — Migration 0003: session columns, freemium normalisation, RPCs

Scope: /supabase/migrations only. This migration is **additive** — it must not edit
0001/0002 and must re-run cleanly on a fresh `supabase db reset`.

Create /supabase/migrations/0003_sessions_freemium.sql containing, in order:

1) **Finish the `sessions` table** per /docs/PLAN.md §2.3 (Sprint 03 created it
   minimal on purpose). Add the deferred columns:
   - `page_url_hash text null` (SHA-256(salt‖URL) — raw URL never stored; the
     hashing itself lands when extraction does, column added now)
   - `detected_topic text null`
   - `interaction_count int not null default 0`
   - `counts_against_free boolean not null default true`
   Add indexes: `idx_sessions_user_started (user_id, started_at desc)` and
   `idx_sessions_domain (page_domain)`. RLS already covers `sessions` from 0002 —
   the new columns inherit it; **no policy change needed** (state this explicitly).

2) **Normalise the freemium columns** on `users` so the atomic gate has sane,
   non-null state to operate on (Sprint 03 left them nullable and behaviour-free):
   - backfill `free_session_count = 0` where null, then
     `ALTER … SET DEFAULT 0, SET NOT NULL`;
   - backfill `free_period_started_at = now()` where null, then
     `SET DEFAULT now(), SET NOT NULL`.
   Add the remaining §2.3 user indexes: `unique(stripe_customer_id)` (partial,
   `where stripe_customer_id is not null`) and `idx_users_tier (subscription_tier)`.

3) **`public.start_session(p_page_domain text, p_mode text, p_free_limit int)`** —
   `RETURNS` the new session row plus quota fields. `LANGUAGE plpgsql`,
   **`SECURITY INVOKER`** (RLS applies; `auth.uid()` is the caller). In one
   function body (one transaction):
   - resolve the caller: `v_uid := auth.uid()`; if null, raise (the route also
     guards, but defend in depth).
   - **lazy reset**: if the caller's `free_period_started_at < now() - interval
     '30 days'`, set `free_session_count = 0, free_period_started_at = now()`.
   - **atomic gate** (PLAN §2.3 query 3): `UPDATE users SET free_session_count =
     free_session_count + 1 WHERE id = v_uid AND subscription_tier = 'free' AND
     free_session_count < p_free_limit AND deleted_at is null RETURNING
     free_session_count` into `v_count`. Pro users skip the increment (the WHERE
     `tier='free'` makes the UPDATE a no-op for them — treat that as "not
     degraded, unlimited").
   - determine `v_counts := (tier='free' AND the UPDATE matched)`;
     `v_degraded := (tier='free' AND the UPDATE did NOT match)` (i.e. over limit).
   - `INSERT INTO sessions (user_id, page_domain, mode, counts_against_free)
     VALUES (v_uid, p_page_domain, p_mode, v_counts) RETURNING *`.
   - return `id, started_at, mode, counts_against_free, v_degraded as degraded,
     greatest(p_free_limit - v_count, 0) as remaining` (remaining is a hint;
     null/unlimited for Pro).
   Grant `EXECUTE` to `authenticated`.

4) **`public.end_session(p_session_id uuid)`** — `SECURITY INVOKER`,
   `RETURNS sessions`. `UPDATE sessions SET ended_at = now() WHERE id =
   p_session_id AND user_id = auth.uid() AND ended_at is null AND deleted_at is null
   RETURNING *`. Because it is INVOKER, RLS + the `user_id = auth.uid()` predicate
   both guarantee a caller can only end their own in-progress session; a non-match
   returns zero rows (the route maps that to 404/409). Grant `EXECUTE` to
   `authenticated`.

Apply the migration to the Sprint 03 project. Confirm `sessions` has the new
columns, the indexes exist, `users.free_session_count`/`free_period_started_at` are
`NOT NULL`, and both functions exist. When done, paste 0003 in full and state:
(a) no existing migration was edited, (b) `sessions` RLS is unchanged and still
enabled, (c) both RPCs are SECURITY INVOKER so RLS applies.

Acceptance gate before Task 3:
  - `supabase db reset` (or fresh apply) runs 0001→0003 cleanly.
  - `start_session` increments `free_session_count` for a free user under the limit
    and creates a `counts_against_free=true` session; over the limit it creates a
    `counts_against_free=false` session and does NOT increment past the limit.
  - `end_session` sets `ended_at` only on the caller's own in-progress session.

---

## Task 3 — Bearer-token auth plumbing (web)

Scope: /web/lib/auth, /web/app/api/auth/token, /web/app/api/auth/refresh.

/web/lib/auth/bearer.ts:
  - `export async function clientFromBearer(request: Request)` → reads the
    `Authorization: Bearer <token>` header; if absent/malformed return `{ error:
    401 }`. Otherwise build a request-scoped Supabase client that carries the JWT
    (createServerClient/createClient with `global: { headers: { Authorization:
    'Bearer ' + token } }` and no cookie persistence), call `getUser()` to validate
    the token, and return `{ supabase, user }`. This client makes RLS evaluate every
    query as that user — the bearer analogue of /web/lib/supabase/server.ts.
  - Confirm the option names against the installed `@supabase/supabase-js@2.108`
    before relying on them.

/web/app/api/auth/token/route.ts (POST { email, password }):
  - `signInWithPassword` via a plain supabase client (anon key, no cookie binding).
    On success return `{ access_token, refresh_token, expires_at, user }` from
    `data.session` in the body — **no Set-Cookie**. On failure 401. This is the
    extension's sign-in entry point (ADR-006); the web app keeps using the
    cookie-setting /api/auth/login untouched.

/web/app/api/auth/refresh/route.ts (POST { refresh_token }):
  - `supabase.auth.refreshSession({ refresh_token })`; on success return the new
    `{ access_token, refresh_token, expires_at }`; on failure 401 (the extension
    treats 401 here as "signed out" and clears storage).

Do not change /api/auth/login, /logout, /session — the web cookie flow is
unchanged. When done, list files created and paste bearer.ts and token/route.ts.

Acceptance gate before Task 4:
  - `next build`, typecheck, lint pass.
  - `POST /api/auth/token` with valid creds returns a body with access_token +
    refresh_token and sets no auth cookie; bad creds → 401.
  - A request with `Authorization: Bearer <that access_token>` resolves to the
    correct user via `clientFromBearer`; a missing/garbage token → 401.

---

## Task 4 — Session endpoints + tier gate (web)

Scope: /web/lib/tier, /web/app/api/session.

/web/lib/tier/session-gate.ts:
  - `export const FREE_SESSION_LIMIT = 10;` (the monthly free allowance; PLAN §2.8
    example). One constant, server-side, single source of truth.
  - `startSession(supabase, { pageDomain, mode })` → calls
    `supabase.rpc('start_session', { p_page_domain, p_mode, p_free_limit:
    FREE_SESSION_LIMIT })` and returns the typed row.
  - `endSession(supabase, sessionId)` → calls `supabase.rpc('end_session', {
    p_session_id: sessionId })`.

/web/app/api/session/start/route.ts (POST { pageDomain?, mode? }):
  - `clientFromBearer(request)`; 401 if no user.
  - default `mode='voice'`, validate `mode ∈ {voice,text}`; `pageDomain` optional
    (eTLD+1 string or null — no raw URL).
  - call `startSession`; return `{ sessionId, mode, degraded, countsAgainstFree,
    remaining }` (200). The gate ran server-side; the client cannot influence it.

/web/app/api/session/end/route.ts (POST { sessionId }):
  - `clientFromBearer(request)`; 401 if no user.
  - call `endSession`; if zero rows → 404 (`{ error: 'no such open session' }`);
    else return `{ sessionId, endedAt, interactionCount }`.

Both endpoints are bearer-only (the extension is the caller); they do not read
cookies. RLS + the RPC predicates mean a stolen/forged sessionId for another user
ends nothing. When done, list files created, paste start/route.ts in full, and
state the exact line where the tier decision is made (it's the RPC — the route
never computes the limit itself).

Acceptance gate before Task 5:
  - `next build`, typecheck, lint pass.
  - With a fresh free user's bearer: 10 starts return `degraded=false,
    countsAgainstFree=true` with `remaining` counting down; the 11th returns
    `degraded=true, countsAgainstFree=false`, and `users.free_session_count` does
    not exceed 10.
  - `/api/session/end` with the caller's open `sessionId` sets `ended_at`; with
    another user's sessionId → 404, that session stays open.
  - No-bearer call to either endpoint → 401.

---

## Task 5 — Automated session + tier-enforcement test (acceptance gate)

Scope: /web/tests. This is the sprint's hard guarantee that the gate and ownership
checks live in the backend, not the client.

Create /web/tests/session.test.ts (vitest, the runner Sprint 03 used). Against the
Sprint 03 project, using **request-scoped bearer/anon clients for assertions** and
the **service role only for fixtures** (same discipline as rls.test.ts):
1) Create two users A and B (admin client for setup; capture each one's
   access_token via `/api/auth/token` or `signInWithPassword`).
2) As A's bearer client, `start_session` → assert a session row exists scoped to A
   (`counts_against_free=true`, `degraded=false`, `remaining` decremented).
3) Drive A to the limit (loop `start_session` `FREE_SESSION_LIMIT` times); assert
   the next start returns `degraded=true, counts_against_free=false` and that
   `users.free_session_count` (read as A) never exceeds the limit.
4) As B's bearer client, attempt `end_session(A_session_id)` → assert zero rows /
   no effect (RLS + predicate); confirm A's session is still open.
5) As A's bearer client, `end_session(A_session_id)` → assert `ended_at` set.
6) Assert a call with no bearer is rejected by the route (401), and that the
   service role is used only for fixture setup, never for the assertions.

Wire it into the `web` workspace `test` script (already `vitest run`). When done,
paste the test and its passing output.

Acceptance gate before Task 6:
  - The test passes: the 11th free session degrades; the counter never exceeds the
    limit; B cannot end A's session; A can; no-bearer is 401.
  - Assertions use request-scoped clients; service role only sets up fixtures.

---

## Task 6 — Extension backend client + token storage

Scope: /extension/src/lib, /extension/wxt.config.ts, /web/.env.local.example.

/extension/src/lib/storage.ts — thin wrappers over `chrome.storage.session`
(NOT `.local` — tokens must not hit disk; PLAN §2.2):
  - `getAuth()/setAuth({access_token,refresh_token,expires_at,user})/clearAuth()`
  - `getActiveSession()/setActiveSession({sessionId,mode,degraded,remaining})/clearActiveSession()`
  Every value is re-read from storage at the top of each background handler (the
  worker is ephemeral — no durable in-memory state, PLAN §2.2).

/extension/src/lib/api.ts — the backend client, **only ever called from the
background worker** (PLAN §2.2: the worker is the sole network-egress context):
  - `API_BASE` from a build-time constant (default `http://localhost:3000` for
    dev; documented in /web/.env.local.example and the file's header).
  - `signIn(email,password)` → POST /api/auth/token → store auth via storage.ts.
  - `signOut()` → clearAuth + clearActiveSession.
  - `refresh()` → POST /api/auth/refresh with the stored refresh_token → store the
    new pair; on 401 clearAuth and surface "signed out".
  - `startSession({pageDomain,mode})` / `endSession(sessionId)` → attach
    `Authorization: Bearer <access_token>`; **on 401, call refresh() once and retry
    the original request**; persist/clear the active session via storage.ts.

/extension/wxt.config.ts — add the backend origin to `host_permissions` so the
worker can call it cross-origin without CORS friction (dev: `http://localhost:3000/*`;
leave a comment that the production origin is added at launch). Do not remove the
existing `<all_urls>` entry (it serves the content script) — add alongside it.

/web/.env.local.example — add a commented line documenting the dev API base URL the
extension targets (`http://localhost:3000`). No secrets; the extension holds no key.

When done, list files created/edited and paste api.ts in full (especially the
401→refresh→retry path).

Acceptance gate before Task 7:
  - `cd extension && pnpm/npm run typecheck` passes and `wxt build` exits 0.
  - api.ts imports nothing that pulls a Supabase key into the bundle (grep the built
    output for the anon/service keys — neither may appear).
  - Tokens are written to `chrome.storage.session`, never `.local`/`.sync`.

---

## Task 7 — Extension background + popup wiring

Scope: /extension/src/background, /extension/src/popup, /extension/src/types/messages.ts.

/extension/src/types/messages.ts — add to the `MessageType` union:
  `SIGN_IN | SIGN_OUT | START_SESSION | END_SESSION | SESSION_STATE`
  (SESSION_STATE is the worker's reply describing auth + active-session state for
  the popup to render). Keep the existing `CONTENT_READY`/`TOGGLE_OVERLAY`.

/extension/src/background/index.ts — register handlers (synchronously, at wake, per
the existing MV3 discipline in this file). Re-hydrate from storage at the top of
each handler. On:
  - `SIGN_IN {email,password}` → `api.signIn` → reply SESSION_STATE.
  - `SIGN_OUT` → `api.signOut` → reply SESSION_STATE (signed out).
  - `START_SESSION {pageDomain?,mode?}` → `api.startSession` → reply SESSION_STATE
    (now with active sessionId + degraded/remaining).
  - `END_SESSION` → `api.endSession(active sessionId)` → reply SESSION_STATE.
  Note: these handlers DO call `sendResponse` asynchronously, so their listener must
  `return true` (unlike the existing logging listener, which deliberately returns
  false — see the comment already in this file). Keep the two behaviours separate.

/extension/src/popup/main.tsx — replace the Sprint-01 placeholder with a real (but
minimal) launcher (PLAN §2.2 popup scope): when signed out, an email+password form
that sends SIGN_IN; when signed in, show the tier/`remaining` hint, a "Start tutor
on this page" button (sends START_SESSION; derive `pageDomain` as eTLD+1 from the
active tab URL), an "End session" button when a session is active, and "Sign out".
The popup holds **no tokens and no session logic** — it only messages the worker and
renders the SESSION_STATE reply (the popup document dies on blur; PLAN §2.2).

When done, list files edited and describe the sign-in → start → end message flow.

Acceptance gate before Task 8:
  - `wxt build` exits 0; typecheck passes.
  - Loading the unpacked extension, the popup shows a sign-in form; after sign-in it
    shows tier + remaining and a Start button.
  - No token value is ever passed in a message to/from the popup (inspect the
    SESSION_STATE payload — it carries display fields, not the access_token).

---

## Task 8 — End-to-end manual verification (manual)

This is the sprint's headline acceptance criterion: **the extension can start and
end a session against the live backend, and the free limit is enforced.**

With `cd web && next dev` running and the unpacked extension loaded:
  1. Open the popup → sign in with a Sprint 03 test account → popup shows the tier
     and "N sessions left".
  2. On any page, click "Start tutor on this page". In Supabase → Table editor →
     `public.sessions`: a new row exists, `user_id` = the signed-in user,
     `ended_at` null, `counts_against_free=true`; `users.free_session_count`
     incremented by 1.
  3. Click "End session" → the same row now has `ended_at` set.
  4. Repeat start until the free limit (10) is reached. The 11th start still creates
     a session but with `counts_against_free=false`; the popup reflects
     "0 left"/degraded; `free_session_count` does not exceed 10.
  5. Manually set the test user's `free_period_started_at` to 31 days ago, then
     start a session → `free_session_count` resets to 0/1 (lazy reset fired).
  6. Sign out → `chrome.storage.session` auth is cleared; a START_SESSION now fails
     "not signed in" (no anonymous session is created).
  7. Confirm the Supabase anon and service-role keys appear **nowhere** in the built
     `/extension/dist` output (grep for the keys / `SERVICE_ROLE` / `SUPABASE_` —
     none may be present); the extension holds only user tokens.
  8. Confirm `/extension/src/overlay/*` and `/extension/src/content/*` are
     unchanged vs. the start of the sprint (git diff is empty for them).

---

## Acceptance criteria (full checklist)

- [ ] `npm install` and `turbo run typecheck lint build` pass from the repo root
      with the new web files and extension changes present
- [ ] `cd web && next build` exits 0; `wxt build` exits 0
- [ ] Migration 0003 applies cleanly on a fresh `supabase db reset` (0001→0003) and
      edits no prior migration; `sessions` RLS unchanged and still enabled
- [ ] `users.free_session_count` and `free_period_started_at` are NOT NULL with
      defaults; new `sessions` columns + indexes exist
- [ ] `start_session` / `end_session` are SECURITY INVOKER (RLS applies)
- [ ] `/api/auth/token` returns tokens in the body and sets no auth cookie;
      `/api/auth/refresh` rotates them; web cookie flow (login/logout/session)
      unchanged
- [ ] `/api/session/start` enforces the free limit server-side via the atomic RPC;
      the 11th free session degrades (`counts_against_free=false, degraded=true`)
      and the counter never exceeds the limit
- [ ] `/api/session/end` ends only the caller's own open session (RLS + predicate);
      another user's sessionId → 404, session stays open
- [ ] Both session endpoints reject calls with no/invalid bearer token (401)
- [ ] Automated session test passes (request-scoped clients for assertions, service
      role for fixtures only)
- [ ] Extension signs in via the backend, stores tokens **only** in
      `chrome.storage.session`, and starts/ends a session end-to-end
- [ ] 401 from a session call triggers one refresh + retry in the background
- [ ] No Supabase anon/service-role key appears in the built `/extension/dist`
- [ ] `/extension/src/overlay/*` and `/extension/src/content/*` are untouched
- [ ] ADR-006 and ADR-007 exist; both CLAUDE.md sprint pointers updated
- [ ] git log shows commits for this sprint's tasks

---

## Risks

**Anon key creeping into the extension bundle.** The easy (wrong) path is to
`import { createClient } from '@supabase/supabase-js'` in the extension and sign in
directly with the anon key — violating the locked key policy. Mitigation: the
extension imports no Supabase SDK and holds no key (ADR-006); it only `fetch`es our
backend; Task 8 greps the built output for any key. If a future task "needs" the
SDK in the extension, stop and ask.

**Tier gate that isn't atomic.** Doing the read-then-increment in the route (two
round-trips) lets two concurrent starts both pass the check and exceed the limit.
Mitigation: the increment and the `sessions` insert are one `start_session`
transaction using `UPDATE … WHERE free_session_count < limit RETURNING` (PLAN §2.3
query 3); the Task 5 test drives the user to the boundary and asserts the counter
never exceeds the limit.

**SECURITY DEFINER by reflex.** Writing `start_session`/`end_session` as DEFINER
would bypass RLS and silently let a bug touch another user's rows. Mitigation: both
are **INVOKER**; the test proves cross-user `end_session` is a no-op. (Contrast the
one legitimate DEFINER function, `handle_new_user`, from Sprint 03.)

**Refresh loop / silent sign-out.** A bad refresh path can hammer
`/api/auth/refresh` or strand the user signed-in-but-unauthorised. Mitigation: a
401 triggers **exactly one** refresh + retry; a 401 from refresh itself clears auth
and reports "signed out" — no retry loop.

**CORS / host_permissions for the worker.** A cross-origin `fetch` from the worker
to our API fails without the API origin in `host_permissions`. Mitigation: Task 6
adds the dev origin (`http://localhost:3000/*`) alongside the existing `<all_urls>`,
with a note to add the production origin at launch.

**MV3 listener return-value trap.** This sprint's message handlers call
`sendResponse` asynchronously, so their listener must `return true` — but the
existing logging listener in `background/index.ts` deliberately returns `false`
(its comment explains why a stray `true` hangs the sender). Mitigation: keep the
async handlers in a separate listener that returns true; do not flip the existing
one.

**Tokens on disk.** Putting tokens in `chrome.storage.local`/`.sync` persists them
to disk / across devices. Mitigation: tokens live only in `chrome.storage.session`
(PLAN §2.2); Task 6's gate checks the storage area used.

**Migration editing instead of adding.** Editing 0001/0002 to add columns breaks
`supabase db reset` reproducibility and the Sprint 03 RLS test's assumptions.
Mitigation: all changes are in additive 0003; the reset acceptance gate runs the
full 0001→0003 chain.

**Pulling freemium forward → scope creep.** With the gate in scope it is tempting
to also build Stripe, entitlements, Pro gating, and the cron. Mitigation: ADR-007
and the out-of-scope list fix the line at "free session counter + lazy reset +
degraded flag"; everything else is explicitly deferred.

---

## What the next sprint needs to know

**The API proxy layer is live and authenticated.** The extension now talks to the
backend through a single authoritative surface; future sprints add endpoints behind
the same auth + RLS pattern, they do not rebuild it.
- **Auth (ADR-006):** the extension holds a Supabase user JWT in
  `chrome.storage.session` (background worker only) and sends it as
  `Authorization: Bearer`. New extension-facing endpoints use
  `clientFromBearer` (`/web/lib/auth/bearer.ts`) so RLS evaluates them as the
  caller. The web app keeps its cookie flow. One identity model across both.
- **Sessions:** `/api/session/start` and `/api/session/end` own the session
  lifecycle. The `sessions` table now has its full §2.3 column set
  (`page_url_hash`, `detected_topic`, `interaction_count`, `counts_against_free`).
  The **voice sprint** attaches its STT→AI→TTS stream to an already-started session
  id and branches on the `degraded` flag (text-only + `SpeechSynthesis` when over
  quota) without changing the API shape.
- **Freemium (ADR-007):** the free counter is enforced atomically in
  `start_session`; `FREE_SESSION_LIMIT` lives in `/web/lib/tier/session-gate.ts`.
  The rolling reset is **lazy**; the **daily reconciliation cron is still owed** and
  lands with billing, along with Stripe, the entitlements resolver, and Pro feature
  gating. `users` already carries the Stripe columns (nullable) so billing needs no
  schema migration.

**Deferred to later sprints (deliberately not built):**
- AI / voice / STT / TTS (`/api/voice`), prompt assembly, the learning model and
  its tables — Sprint 05+.
- Stripe billing + webhooks, the entitlements resolver, Pro feature-flag gating,
  and the reset/reconcile crons.
- Drizzle ORM (still `@supabase/supabase-js` + RPC).
- Page extraction, annotation, and mic capture in the overlay/content script — the
  extension still only starts/ends sessions; it does not yet read the page or
  stream audio.
- GDPR export/erasure endpoints (`deleted_at` columns are ready for them).
