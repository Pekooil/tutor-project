## ADR-003: Auth provider + request-scoped RLS data access

**Status:** Decided

**Context:** Authorization must live in the database (the RLS-from-day-one
mandate). We needed an identity provider whose token Postgres can evaluate
directly inside RLS policies, and a query pattern that makes the database —
not the API layer — the final access check. The candidates considered were
Supabase Auth, Clerk with JWT claims bridged into Postgres, and a custom auth
implementation.

**Decision:** Use Supabase Auth (email + password this sprint) as the
identity provider, issuing the JWT that Postgres reads natively via
`auth.uid()`. App queries run through a request-scoped Supabase client that
carries the signed-in user's JWT (via `@supabase/ssr` cookie session), so RLS
evaluates every read/write as that user. A separate service-role client
(which bypasses RLS) is confined to server-only modules, reserved for the few
privileged paths that legitimately need it — the post-signup trigger context
this sprint, and webhooks/erasure jobs later.

**Rationale:**
- `auth.uid()` is available inside every RLS policy with zero glue code.
- One auth/identity primitive shared by `/web` now and `/extension` later,
  rather than standing up a second identity system.
- Avoids the moving parts of bridging Clerk claims into a Postgres-readable
  JWT.
- Keeping authorization in the database means an API-layer bug cannot leak
  cross-user data — the database is the final check, not the API.

**Consequences:**
- Enables: RLS-enforced access from day one, and a single identity primitive
  usable by both `/web` now and `/extension` later.
- Requires: strict separation of the anon/request-scoped client from the
  service-role client — the service-role key must never reach the browser
  bundle.
- Forecloses: client-trusted authorization; the API layer is never treated as
  the final access check.
- Defers: the Drizzle ORM layer to a later sprint — this sprint uses
  `@supabase/supabase-js` + `@supabase/ssr` directly.
