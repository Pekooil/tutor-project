# Sprint 03 — Auth + database (no extension yet)

## Goal
Stand up the persistence and identity foundation the whole product sits on: a
Supabase project, the first tables with row-level security enabled **in the same
migration that creates them**, and a Next.js `/web` app with working
email + password auth (signup, login, session, logout). Signup runs behind a
COPPA age gate and an explicit GDPR consent step. By the end, a real person can
sign up in a browser, sign back in, and see their auth user **and** their
mirrored profile row appear in the Supabase dashboard — with RLS proven to stop
one user from reading another's data.

No extension work this sprint. `/extension` is untouched; the overlay shell from
Sprint 02 stays exactly as it is. This sprint is purely `/web` + `/supabase`.

## Context
Sprint 02 delivered the isolated shadow-DOM overlay shell in `/extension`. The
overlay is now an extension point with no data behind it. Everything the tutor
will eventually persist — profiles, sessions, mastery state — needs a database,
an identity model, and the authorization backstop the locked architecture
mandates: **RLS on every user-data table before it receives data.**

This is the first sprint to touch `/web` and `/supabase`. Both directories are
declared in the npm workspaces / monorepo layout (see `ADR-005` and
`/docs/architecture.md`) but do not exist yet; non-matching workspace globs have
resolved cleanly since Sprint 01, so creating `/web` now is additive and must not
break the root `npm install` / `turbo` pipeline.

Two locked decisions from `/CLAUDE.md` drive this sprint and are recorded as ADRs
in Task 1 so they are not re-litigated later:
- **Supabase Auth** is the identity provider because authorization is enforced by
  Postgres RLS. Supabase Auth mints a JWT Postgres reads natively — `auth.uid()`
  is available inside every policy with zero glue (see `/docs/PLAN.md` §2.1, §2.7).
- **COPPA (min age 13) + GDPR consent from launch** (`/docs/PLAN.md` line 19,
  §2.7). The age gate and consent capture are not optional polish; they gate
  account creation and first data processing respectively.

### RLS-from-creation reconciliation (read this before Task 3)
The locked policy is: *every Supabase table must have RLS before receiving data.*
We honor it literally — RLS is `ENABLE`d and the canonical policies are created
**inside the same migration** that runs `CREATE TABLE`. There is never a window
in which a table exists without RLS. The migration is the source of truth for
both schema and policy (`ADR-005` keeps Supabase migrations owning RLS/triggers).

This sprint creates **two** tables on purpose, to exercise both RLS policy shapes
end-to-end:
- `users` — keyed on `id` (= `auth.users.id`); policy is `auth.uid() = id`.
- `sessions` — a user-scoped child table keyed on `user_id`; policy is the
  canonical `auth.uid() = user_id`.

The remaining domain tables (`knowledge_nodes`, `misconceptions`,
`reinforcement_schedule`, `session_interactions`) are **out of scope**: each is
created — with its RLS in the same migration — in the later sprint that first
writes to it, per the same mandate. We are not pre-building empty schema.

## Execution model
A **single code session** owns this entire sprint end to end — there is no agent
split and nothing runs in parallel. Work the tasks **strictly in order** (1 → 8):
the schema must exist before the web app can authenticate against it, and each
task's acceptance gate must pass before starting the next. The dependency that
forced sequencing is real regardless of who does the work: the web signup flow
relies on the `handle_new_user` trigger mirroring `auth.users` into
`public.users`, so the database (Tasks 2–3) is built and verified before the
Next.js app (Tasks 4–6).

Respect the per-task **scope** lines below as a focus discipline (touch only the
listed files for that task), but it is all one session — no handoff, no
re-deriving context between tasks.

The two ADRs and the two CLAUDE.md sprint-pointer edits (Task 1) are
sprint-planning artifacts in `/docs` and the repo root, done first — the same way
Sprint 02's ADR-002 was written before any implementation.

## Files in scope

### Task 1 (planning / docs) creates or edits:
```
/docs/adr/ADR-003-auth-and-rls.md          ← new — Supabase Auth + request-scoped RLS model
/docs/adr/ADR-004-age-gate-and-consent.md  ← new — COPPA age gate + GDPR consent flow
/CLAUDE.md                                  ← edit one line: Current sprint → Sprint 03
/docs/CLAUDE.md                             ← edit one line: Current phase → Phase 1, Sprint 3
/docs/sprint-03-plan.md                     ← this file
```

### Database (Tasks 2–3) creates:
```
/supabase/config.toml                              ← supabase CLI project config (local stack)
/supabase/migrations/0001_init_users.sql           ← set_updated_at + handle_new_user + users + RLS
/supabase/migrations/0002_sessions.sql             ← sessions table + RLS (proves user_id policy shape)
/supabase/policies/README.md                        ← documents the canonical policy SQL (per ADR-005)
/supabase/seed/seed.sql                             ← empty/minimal; real rows come from signup
```

### Web app (Tasks 4–6) creates:
```
/web/package.json                          ← next, react, @supabase/supabase-js, @supabase/ssr
/web/next.config.ts
/web/tsconfig.json                         ← extends /tsconfig.base.json
/web/.env.local.example                    ← documents required env vars (no real secrets)
/web/middleware.ts                         ← refresh session + guard (dashboard) routes
/web/lib/supabase/client.ts                ← browser client (anon key)
/web/lib/supabase/server.ts                ← server client (cookie-bound, anon key)
/web/lib/supabase/admin.ts                 ← service-role client (server-only module)
/web/lib/consent.ts                        ← CONSENT_VERSION constant + min-age helper
/web/app/layout.tsx
/web/app/page.tsx                          ← minimal landing with Sign up / Log in links
/web/app/signup/page.tsx                   ← signup form: email, password, birth year, consent checkbox
/web/app/login/page.tsx                    ← login form
/web/app/(dashboard)/account/page.tsx      ← authed-only page that reads the user's own profile row
/web/app/api/auth/signup/route.ts          ← server-enforced age gate + signUp + profile finalize
/web/app/api/auth/login/route.ts           ← password sign-in, sets session cookies
/web/app/api/auth/logout/route.ts          ← sign-out, clears session
/web/app/api/auth/session/route.ts         ← returns current session/user (GET)
```

### Test (Task 7) creates:
```
/supabase/tests/rls.test.ts   (or /web/tests/rls.test.ts — your call; state which)
```

## Files explicitly out of scope
```
/extension/*             (no extension work this sprint — overlay shell stays as-is)
/packages/*              (shared libs arrive when AI/learning land, Sprint 05+)
/web/app/api/session/*   (the authoritative free-tier session endpoint — later sprint)
/web/app/api/voice/*     (AI/STT/TTS — Sprint 05+)
/web/app/api/billing/*   (Stripe — later sprint)
/web/app/api/me/*        (GDPR export/delete endpoints — later sprint)
```

Also out of scope this sprint (no pre-empting later work):
- The learning-model tables (`knowledge_nodes`, `misconceptions`,
  `reinforcement_schedule`, `session_interactions`). Each is created with its RLS
  in the migration of the sprint that first writes to it.
- The request-scoped **Drizzle** client / ORM layer. This sprint uses
  `@supabase/supabase-js` + `@supabase/ssr` directly. Drizzle wiring lands with
  the `/session` endpoint sprint.
- Stripe / freemium / `free_session_count` enforcement, AI, STT, TTS.
- Data export (`/api/me/export`) and erasure (`/api/me/delete`). The schema
  carries `deleted_at` so these are addable later without migration churn, but the
  endpoints are not built now.
- Email deliverability/SMTP. For dev, signup is verified with email confirmation
  **disabled** in the Supabase project (note it in env docs); production email
  confirmation is a launch-hardening task.
- Any extension ↔ backend call. Nothing in `/extension` talks to `/web` yet.

Do not create any file not listed above. If something seems needed but is not
listed, add it to "What the next sprint needs to know" and ask before creating it.

---

## Task 1 — Auth/RLS + age-gate ADRs + sprint pointers (planning / docs)

Write two ADRs using the project's ADR format (the one used by ADR-001, ADR-002,
ADR-005):

```
## ADR-00N: [Title]
**Status:** Decided
**Context:** [why this needed a decision]
**Decision:** [what was chosen]
**Rationale:** [why]
**Consequences:** [what this forecloses or enables]
```

ADR-003 — Auth provider + request-scoped RLS data access:
- Context: authorization must live in the database (RLS-from-day-one mandate); we
  needed an identity provider whose token Postgres can evaluate inside policies,
  and a query pattern that makes the DB — not the API layer — the final access
  check. Candidates: Supabase Auth, Clerk + JWT bridging, custom.
- Decision: Supabase Auth (email + password this sprint) issuing the JWT that
  Postgres reads via `auth.uid()`. App queries run through a request-scoped
  Supabase client that carries the signed-in user's JWT (via `@supabase/ssr`
  cookie session), so RLS evaluates every read/write as that user. A separate
  **service-role** client (RLS-bypassing) is confined to server-only modules for
  the two privileged paths that legitimately need it (the post-signup trigger
  context and, later, webhooks/erasure jobs).
- Rationale: `auth.uid()` is available in every policy with zero glue; one
  auth/identity primitive shared by web (now) and extension (later); avoids the
  Clerk→Postgres claims-bridging moving parts. RLS in the DB means an API bug
  cannot leak cross-user data.
- Consequences: enables RLS-enforced access from day one and a single identity
  primitive; REQUIRES strict separation of the anon/request-scoped client from
  the service-role client (service role never reaches the browser bundle);
  forecloses client-trusted authorization; defers Drizzle to a later sprint.

ADR-004 — COPPA age gate + GDPR consent:
- Context: COPPA (min age 13) and GDPR consent are launch requirements. We must
  refuse under-13 accounts while minimising data, and capture consent before any
  processing.
- Decision: collect **birth year only** (data minimisation, not full DOB) at
  signup. The age gate is enforced **server-side before the auth user/profile is
  created** — under-13 attempts create no `auth.users` row and no `public.users`
  row, and retain no email. GDPR consent is an explicit, **non-pre-ticked** opt-in
  captured on the same screen; on accept we store `gdpr_consent_at` and
  `gdpr_consent_version`. `birth_year`/`age_verified=true`/consent are written
  only on a passing, consenting signup.
- Rationale: server-side enforcement matches the "limits enforced server-side"
  mandate (client is a hint only); birth-year-only minimises PII; versioned
  consent enables forced re-consent when the text changes.
- Consequences: enables compliant launch posture; REQUIRES signup to route
  through a server handler (not a raw client `signUp`) so the gate cannot be
  bypassed; sets up `gdpr_consent_version` as the re-consent trigger; processing
  endpoints (later sprints) must assert non-null consent server-side.

Then make two one-line edits:
- /CLAUDE.md: change the "Current sprint" line to
    Sprint 03 — Auth + database (no extension yet)
- /docs/CLAUDE.md: change "Current phase" from "Phase 1, Sprint 2" to
    "Phase 1, Sprint 3"

Do not change any other line in either CLAUDE.md.

Acceptance gate before Task 2:
  - ADR-003 and ADR-004 exist and follow the ADR format exactly.
  - Both CLAUDE.md sprint-pointer lines are updated and nothing else changed.

---

## Task 2 — Supabase project + env wiring

Scope: /supabase + repo-root env wiring only.

Create the Supabase project for MathMentor and capture its credentials. Either:
(a) the hosted project via the Supabase MCP / dashboard, or (b) the local stack
via `supabase init` + `supabase start`. State which you used.

Record the three credentials the web app needs, WITHOUT committing any secret:
- Project URL            → NEXT_PUBLIC_SUPABASE_URL
- anon / publishable key → NEXT_PUBLIC_SUPABASE_ANON_KEY  (client-safe)
- service-role key        → SUPABASE_SERVICE_ROLE_KEY      (server-only, NEVER client)

Concretely:
- Create /supabase/config.toml (CLI project config).
- Ensure `.env*.local` is gitignored at the repo root; if not, add it. Real
  secrets live ONLY in /web/.env.local (created in Task 4 from the example file)
  and are never committed.
- For dev, disable email confirmation in the Supabase Auth settings so signup is
  immediately testable; note this in /web/.env.local.example as a dev-only setting
  to revisit before launch.

Reconcile with the locked key policy ("all API keys server-side; never in the
extension bundle"): the anon key is client-safe by design and only ships in the
/web app, never in /extension; the service-role key is server-only. Neither key
ever enters the extension bundle. State this explicitly when done.

Acceptance gate before Task 3:
  - A reachable Supabase project exists (hosted or local) and you can run SQL
    against it.
  - The three credentials are recorded and `.env*.local` is gitignored; no secret
    is staged for commit.

---

## Task 3 — Schema migration + RLS + triggers

Scope: /supabase/migrations, /supabase/policies.

Create /supabase/migrations/0001_init_users.sql containing, in order:
1) `set_updated_at()` — a trigger function that sets NEW.updated_at = now().
2) `handle_new_user()` — SECURITY DEFINER trigger function on
   `auth.users AFTER INSERT` that inserts a matching row into `public.users`
   (id = NEW.id, email = NEW.email, defaults for everything else:
   subscription_tier='free', age_verified=false, gdpr_consent_at=null). This is
   the only sanctioned privileged insert into `users` — clients never insert.
3) `CREATE TABLE public.users` per /docs/PLAN.md §2.3 (id uuid PK = auth.users.id,
   email citext unique, subscription_tier text check in ('free','pro') default
   'free', age_verified boolean default false, birth_year smallint null,
   gdpr_consent_at timestamptz null, gdpr_consent_version text null,
   created_at/updated_at timestamptz default now(), deleted_at timestamptz null).
   Include the Stripe/free-tier/onboarding columns from §2.3 as nullable now so
   later sprints need no migration to start using them. Do NOT build behavior on
   them this sprint.
4) Indexes: unique(email).
5) Triggers: BEFORE UPDATE → set_updated_at; the AFTER INSERT on auth.users →
   handle_new_user.
6) RLS — IN THIS SAME MIGRATION, immediately after the table:
     alter table public.users enable row level security;
     -- self read/update only; keyed on id (not user_id) because users.id = auth.uid()
     create policy users_select_own on public.users
       for select using (auth.uid() = id and deleted_at is null);
     create policy users_update_own on public.users
       for update using (auth.uid() = id and deleted_at is null)
                  with check (auth.uid() = id);
   NO client insert policy (rows come from the trigger) and NO client delete
   policy (erasure is a later service-role path).

Create /supabase/migrations/0002_sessions.sql:
- `CREATE TABLE public.sessions` per §2.3 (id uuid PK gen_random_uuid(),
  user_id uuid not null references public.users(id), started_at/ended_at,
  page_domain text null, mode text check in ('voice','text') default 'voice',
  created_at/updated_at/deleted_at). Keep it minimal — only the columns needed to
  prove the user_id RLS shape; the rest land when the /session endpoint sprint
  needs them.
- RLS in the same migration, the CANONICAL user-scoped policy:
     alter table public.sessions enable row level security;
     create policy sessions_select_own on public.sessions
       for select using (auth.uid() = user_id and deleted_at is null);
     create policy sessions_modify_own on public.sessions
       for all using (auth.uid() = user_id and deleted_at is null)
                with check (auth.uid() = user_id);
- BEFORE UPDATE → set_updated_at trigger.

Document the canonical policy SQL in /supabase/policies/README.md so future tables
copy it verbatim (ADR-005: migrations own RLS; policies/ documents it).

Apply both migrations to the project from Task 2. Confirm with `\d public.users`
(or the dashboard) that RLS is enabled on BOTH tables.

When done, paste both migration files in full and state: (a) that RLS is enabled
on users and sessions, (b) that no table was ever created without RLS in the same
migration.

Acceptance gate before Task 4:
  - Both migrations apply cleanly (idempotent re-run or fresh DB both succeed).
  - `users` and `sessions` both show `rowsecurity = true`.
  - Manually inserting a row into `auth.users` (or a test signup) produces a
    mirrored `public.users` row via the trigger.

---

## Task 4 — Next.js /web scaffold + Supabase clients

Scope: /web only.

Scaffold a Next.js App Router app (TypeScript) as the `web` npm workspace.
- /web/package.json: next, react, react-dom, @supabase/supabase-js,
  @supabase/ssr. Pin versions; the app must build under the root turbo pipeline.
  Add `build`, `lint`, `typecheck` scripts so `turbo run <task>` picks it up.
- /web/tsconfig.json extends /tsconfig.base.json.
- /web/.env.local.example documenting NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY (with a comment that
  the service-role key is server-only and must never be NEXT_PUBLIC_*). Copy it to
  /web/.env.local and fill in the real values from Task 2 (do not commit it).

Three Supabase clients, cleanly separated:
- /web/lib/supabase/client.ts — browser client via createBrowserClient (anon key).
- /web/lib/supabase/server.ts — server client via createServerClient bound to
  Next cookies (anon key); this is the request-scoped client that carries the
  user JWT so RLS applies (ADR-003).
- /web/lib/supabase/admin.ts — service-role client. Add `import 'server-only'`
  (or equivalent guard) so it can never be imported into a client component.

- /web/middleware.ts: refresh the Supabase session on each request and redirect
  unauthenticated users away from (dashboard) routes to /login. Public routes
  (/, /signup, /login, /api/auth/*) stay open.
- Minimal /web/app/layout.tsx + /web/app/page.tsx (landing with Sign up / Log in
  links). No design polish required — function over form this sprint.

Confirm @supabase/ssr cookie API names against the installed version before
relying on them. When done, list every file created and paste client.ts,
server.ts, admin.ts, and middleware.ts in full.

Acceptance gate before Task 5:
  - `npm install` from repo root succeeds with /web present.
  - `npm run typecheck` and `npm run lint` from root pass (web included in turbo).
  - `cd web && next build` exits 0.
  - admin.ts cannot be imported from a client component (server-only guard present).

---

## Task 5 — Auth route handlers

Scope: /web/app/api/auth, /web/lib/consent.ts.

Create /web/lib/consent.ts:
  export const CONSENT_VERSION = '2026-06-01';
  export const MIN_AGE = 13;
  export function meetsMinAge(birthYear: number, now = new Date()): boolean
    → (now.getFullYear() - birthYear) >= MIN_AGE   // coarse, year-only by design

Route handlers (all under /web/app/api/auth):

signup/route.ts (POST { email, password, birthYear, consent }):
  - SERVER-ENFORCE the age gate FIRST: if !meetsMinAge(birthYear) → 403 with a
    COPPA "you must be 13+" message and CREATE NOTHING (no auth user, no profile,
    retain no email). This is the authoritative check (ADR-004); the client form
    check is only a hint.
  - Require consent === true (explicit opt-in). Reject otherwise; do not proceed.
  - Create the auth user via the server client (supabase.auth.signUp). The
    handle_new_user trigger mirrors it into public.users automatically.
  - Finalize the profile: write birth_year, age_verified=true,
    gdpr_consent_at=now(), gdpr_consent_version=CONSENT_VERSION onto the user's own
    row. Use the request-scoped (RLS) client under the new session so the
    self-update policy applies; do NOT use the service role for this.
  - Return the session (cookies set) or a clear error.

login/route.ts (POST { email, password }):
  - supabase.auth.signInWithPassword; on success the session cookies are set by
    the server client. Return the user.

logout/route.ts (POST): supabase.auth.signOut; clear session.

session/route.ts (GET): return the current user/session (or 401 if none) — used
  by the dashboard and as a smoke-test endpoint.

Keep the service-role client out of every path except where a privileged action
genuinely requires it (none do this sprint — signup finalize uses the RLS client).

When done, list every file created and paste signup/route.ts in full, plus the
exact age-gate branch.

Acceptance gate before Task 6:
  - `next build`, typecheck, lint pass.
  - POST /api/auth/signup with birthYear making age < 13 returns 403 and creates
    no auth user and no users row (verify in the dashboard).
  - POST /api/auth/signup with a valid adult birth year + consent creates the auth
    user, the trigger creates the users row, and the row has age_verified=true,
    birth_year set, gdpr_consent_at non-null, gdpr_consent_version=CONSENT_VERSION.

---

## Task 6 — Onboarding UI: age gate + GDPR consent

Scope: /web/app/signup, /web/app/login, /web/app/(dashboard)/account.

signup/page.tsx — a form posting to /api/auth/signup with:
  - email, password
  - birth year (a number/select input; year only — never collect full DOB)
  - a GDPR consent checkbox that is **NOT pre-ticked** (ADR-004). Its label states
    what is consented to (profile storage, page-context processing, and real-time
    audio→text with audio not retained) and references the consent version. Submit
    is disabled until the box is checked.
  - client-side it may show the "must be 13+" hint, but the server is
    authoritative; surface the server's 403 message if returned.

login/page.tsx — email + password form posting to /api/auth/login, then redirect
to /account on success.

(dashboard)/account/page.tsx — an authenticated-only page (guarded by middleware)
that loads the signed-in user's OWN profile row via the request-scoped server
client and displays a few fields (email, tier, age_verified, consent version).
This is the visible proof that RLS-scoped reads work end to end. Add a logout
button hitting /api/auth/logout.

When done, list every file created and describe the signup → account happy path.

Acceptance gate before Task 7:
  - `next build`, typecheck, lint pass.
  - In a browser: signup (adult + consent) → redirected to /account showing the
    user's own row; logout works; login works; visiting /account while logged out
    redirects to /login.

---

## Task 7 — Automated RLS isolation test (acceptance gate)

This is the sprint's hard guarantee that authorization lives in the database.

Create an automated test (/supabase/tests/rls.test.ts or /web/tests/rls.test.ts —
state which). It must, against the Task 2 project:
1) Create two users, A and B (via signup or the admin client for setup only).
2) As A's request-scoped (JWT/anon) client, insert a `sessions` row for A.
3) As B's request-scoped client, attempt to SELECT and UPDATE A's `sessions` row →
   assert zero rows / permission denied (RLS blocks it).
4) As A's client, SELECT A's own row → assert it is returned.
5) Assert B cannot SELECT A's `users` row, and A can read only A's own.
Use the anon/request-scoped clients for the assertions (NOT the service role — the
service role bypasses RLS and would invalidate the test). The service role may be
used only to set up/tear down fixtures.

Wire it into the workspace test script. When done, paste the test and its passing
output.

Acceptance gate before Task 8:
  - The RLS test passes: cross-user read/write is denied; same-user access works.
  - The test uses request-scoped clients for assertions, service role only for
    fixtures.

---

## Task 8 — End-to-end manual verification (manual)

This is the sprint's headline acceptance criterion: **a user can sign up, sign
in, and their data appears in the Supabase dashboard.**

Run `cd web && next dev`, open the app, and:
  1. Sign up with an adult birth year and the consent box checked. Confirm you
     land on /account and see your own profile fields.
  2. In the Supabase dashboard → Authentication → Users: the new auth user is
     listed. In Table editor → public.users: the mirrored row exists with
     age_verified=true, birth_year set, gdpr_consent_at non-null,
     gdpr_consent_version = the current CONSENT_VERSION.
  3. Log out, then log back in with the same credentials → back on /account.
  4. Try signing up with a birth year that makes age < 13 → blocked with the COPPA
     message; confirm NO new auth user and NO users row were created.
  5. Try submitting signup with the consent box unchecked → blocked.
  6. While logged out, visit /account directly → redirected to /login.
  7. Confirm the service-role key appears nowhere in the client bundle (search the
     built /web output for the key/`SERVICE_ROLE` — it must not be present).

---

## Acceptance criteria (full checklist)

- [ ] `npm install` runs without errors from the repo root with /web present
- [ ] `npm run typecheck` from root: zero TypeScript errors (web included)
- [ ] `npm run lint` from root: passes
- [ ] `cd web && next build` exits 0
- [ ] Both Supabase migrations apply cleanly; `users` and `sessions` show
      `rowsecurity = true` (RLS enabled in the same migration that created each)
- [ ] `handle_new_user` trigger mirrors every new `auth.users` row into
      `public.users`
- [ ] Signup (adult + consent) creates the auth user + profile row with
      age_verified=true, birth_year, gdpr_consent_at, gdpr_consent_version set
- [ ] Login establishes a session; logout clears it; /account is guarded
- [ ] Under-13 signup is refused server-side and creates NO auth user and NO
      users row (verified in dashboard)
- [ ] Consent checkbox is not pre-ticked and is required to submit
- [ ] Automated RLS test passes: user B cannot read/write user A's rows;
      same-user access works (assertions use request-scoped clients)
- [ ] New auth user + mirrored profile row both visible in the Supabase dashboard
- [ ] Service-role key is absent from the client bundle; admin.ts is server-only
- [ ] /extension is untouched (Sprint 02 overlay shell unchanged)
- [ ] ADR-003 and ADR-004 exist; both CLAUDE.md sprint pointers updated
- [ ] git log shows commits for this sprint's tasks

---

## Risks

**RLS gaps are silent.** A table without RLS, or a missing `WITH CHECK`, leaks
data with no error — it just returns rows it shouldn't. Mitigation: RLS is created
in the same migration as the table (mandate), the `policies/README.md` gives a
copy-verbatim canonical policy, and the Task 7 automated test is a hard gate that
fails the sprint if cross-user access ever succeeds.

**Service-role key leakage.** The service-role key bypasses RLS entirely; if it
ever reaches the browser bundle, the whole authorization model is void.
Mitigation: it lives only in `/web/lib/supabase/admin.ts` behind a `server-only`
guard, is never prefixed `NEXT_PUBLIC_`, and Task 8 greps the built output to
confirm its absence. It also never enters `/extension` (locked key policy).

**Age gate bypass.** A client-only age check is trivially defeated (it's a web
form). Mitigation: the gate is enforced in the `/api/auth/signup` route BEFORE the
auth user is created (ADR-004); the form check is a UX hint only, matching the
"limits enforced server-side; client is a hint" mandate.

**Trigger vs. profile-finalize ordering.** `handle_new_user` creates the
`public.users` row at auth-signup time with defaults; the route then updates
birth_year/consent. If the update is attempted before the session is established,
the RLS self-update policy rejects it. Mitigation: finalize under the new
session's request-scoped client, after signUp returns the session; never use the
service role for the finalize (keeps the RLS path honest and tested).

**@supabase/ssr cookie API drift.** The `createServerClient` / cookie-handling API
has changed across `@supabase/ssr` versions. Mitigation: pin the version and
confirm the cookie option names against the installed version before relying on
them — the same discipline ADR-001 applies to WXT.

**Email confirmation off in dev.** Disabling email confirmation makes signup
testable without SMTP but is NOT a production posture. Mitigation: it is flagged as
dev-only in `.env.local.example`; re-enabling confirmation (and wiring email) is a
documented launch-hardening task, not silently shipped.

**`/web` breaking the turbo pipeline.** `/web` is a new workspace; a missing
`build`/`lint`/`typecheck` script or a tsconfig that doesn't extend the root
breaks `turbo run`. Mitigation: Task 4 adds all three scripts and extends
`/tsconfig.base.json`; the root commands are an acceptance gate.

**Single-session scope creep.** With no agent boundary, it is tempting to start
the web app before the database is verified, or to drift into deferred files.
Mitigation: the Execution model section mandates strict 1→8 ordering with
per-task acceptance gates, and the per-task scope lines bound which files each task
may touch.

---

## What the next sprint needs to know

**The identity + data foundation is live.** Future sprints add tables and
endpoints on top of it; they do not rebuild auth or the RLS model.
- **RLS contract (ADR-003):** every new user-data table is created with RLS
  ENABLED in the same migration, using the canonical policy documented in
  `/supabase/policies/README.md` — `users` keys on `id`, everything else on
  `user_id`. App reads/writes go through the request-scoped server client
  (`/web/lib/supabase/server.ts`) so the DB enforces access; the service-role
  client (`/web/lib/supabase/admin.ts`, server-only) is reserved for the few
  privileged paths (webhooks, erasure jobs) added later.
- **Auth (ADR-003):** Supabase Auth, email + password, sessions in cookies via
  `@supabase/ssr`. `auth.uid()` is available in every policy. The extension will
  reuse this same identity primitive when it starts calling the backend (a later
  sprint), so there is one auth model across web and extension.
- **Compliance (ADR-004):** the age gate (birth-year-only, server-enforced) and
  GDPR consent (`CONSENT_VERSION` in `/web/lib/consent.ts`, non-pre-ticked) are in
  place. Processing endpoints added later MUST assert non-null `gdpr_consent_at`
  server-side and force re-consent when `CONSENT_VERSION` changes. The `users`
  table already carries the Stripe / free-tier / onboarding columns (nullable), so
  freemium and billing land without a schema migration.

**Deferred to later sprints (deliberately not built):**
- The learning-model tables (`knowledge_nodes`, `misconceptions`,
  `reinforcement_schedule`, `session_interactions`) — created with RLS when the
  AI/learning sprints first write to them.
- The request-scoped **Drizzle** client and the authoritative `/api/session`
  free-tier gate — the next backend sprint per `/docs/PLAN.md` §2.8.
- GDPR data export (`/api/me/export`) and erasure (`/api/me/delete`); the schema's
  `deleted_at` columns are ready for them.
- Production email confirmation / SMTP, Stripe billing, and any AI/STT/TTS.
- The extension still does not talk to the backend. That wiring is a later sprint.
