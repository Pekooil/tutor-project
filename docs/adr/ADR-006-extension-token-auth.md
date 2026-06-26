## ADR-006: Extension authenticates with a bearer token via the backend

**Status:** Decided

**Context:** The locked key policy forbids any key in the extension bundle,
so the extension cannot embed the Supabase anon key and call Supabase
directly the way `/web` does. It still needs an auth model that puts no key
in the bundle yet lets RLS evaluate its calls as the signed-in user.
Candidates considered: shipping the anon key in the bundle (rejected by
policy), a custom session-token table fronted by our own API, or bearing the
same Supabase user JWT obtained through the backend.

**Decision:** The extension signs in **through the backend**
(`POST /api/auth/token`), receiving `{ access_token, refresh_token,
expires_at, user }` in the response body. The background worker stores these
tokens **only in `chrome.storage.session`** and is the sole context that
holds them — the popup and content script never see them. Every
`/api/session/*` call from the background sends `Authorization: Bearer
<access_token>`; the backend builds a request-scoped Supabase client from
that bearer so RLS evaluates the call as that user. A `401` triggers exactly
one `POST /api/auth/refresh` + retry of the original call.

**Rationale:**
- No Supabase key — anon or service-role — ever ships in the extension
  bundle.
- Reuses the same identity primitive (the Supabase user JWT) across `/web`
  and `/extension` (ADR-003) instead of standing up a second auth system.
- `chrome.storage.session` keeps tokens off disk and clears them on browser
  close, unlike `.local`/`.sync`.
- Confining tokens to the background worker matches the worker being the
  only network-egress context in this codebase; the popup and content script
  have no reason to ever hold a token.

**Consequences:**
- Enables: RLS-enforced extension calls with no embedded key, and a single
  identity model the voice sprint (Sprint 05+) can build on without a new
  auth path.
- Requires: a body-returning token endpoint (`/api/auth/token`,
  `/api/auth/refresh`) distinct from the web app's cookie-setting
  login/logout/session routes; the backend API origin must be present in the
  extension's `host_permissions` so the worker can call it cross-origin.
- Forecloses: any direct extension-to-Supabase call; `@supabase/supabase-js`
  is never imported in `/extension`.
