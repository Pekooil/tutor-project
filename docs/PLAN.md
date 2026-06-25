# MathMentor — V1 Technical Plan

> **Status:** DRAFT — awaiting explicit approval. No production code, scaffolding, or
> dependency installation has been performed. This document is the sole deliverable
> for this session.
> **Author:** Lead Engineer / Architect
> **Date:** 2026-06-24

---

## Section 5 — Pre-Flight Checklist

All items below are fully specified by the product brief. None require a blocking decision;
the plan proceeds.

- [x] **Target browser:** Chromium (Chrome, Edge, Brave). Firefox post-V1. — *Understood.*
- [x] **Subject scope:** Mathematics only at V1. — *Understood.*
- [x] **Business model:** B2C freemium ($12/mo Pro). No B2B / school licensing at V1. — *Understood.*
- [x] **Compliance:** COPPA (min age 13) + GDPR from launch. — *Understood.*
- [x] **Voice:** Primary I/O with always-available text fallback. — *Understood.*
- [x] **Screen capture:** Text + LaTeX stable; image equations beta; diagrams/video post-V1. — *Understood.*
- [x] **Annotations:** Non-destructive overlay only; zero DOM mutation on host page. — *Understood.*
- [x] **Audio:** Never persisted; real-time STT only. — *Understood.*
- [x] **API keys:** Server-side only; never bundled in the extension. — *Understood.*
- [x] **Enforcement:** Free tier limits server-side authoritative. — *Understood.*

**No items flagged for clarification. Proceeding to the plan.**

One note on a *recommendation* (not a blocker) that affects several later sections: I treat
**DOM-based extraction (text + MathML + LaTeX) as the primary content path**, with screen
**screenshot** capture reserved for the *beta* image-equation path only. This follows directly
from the "zero DOM mutation / read-only content script" constraint and the stable-vs-beta scope
split, and it materially simplifies permissions and latency. Rationale is in §2.6 and ADR-001.

---

## 2.1 Tech Stack Recommendation

| Layer | Recommendation | Runner-up |
|---|---|---|
| Extension framework | **WXT** | Plasmo |
| Frontend (overlay UI) | **Preact + Vite** (via WXT) | React |
| Styling | **Tailwind CSS** (shadow-DOM-scoped) | CSS Modules |
| Backend framework | **Next.js (App Router route handlers) on Vercel Fluid Compute** | Express |
| Database | **PostgreSQL via Supabase** | Neon |
| Auth | **Supabase Auth** | Clerk |
| STT | **Deepgram (Nova streaming)** + Web Speech API fallback | OpenAI Whisper |
| TTS | **ElevenLabs Flash v2.5 (streaming)** + browser `SpeechSynthesis` fallback | OpenAI TTS |
| AI backbone | **Anthropic Claude** (tiered: Haiku 4.5 default, Sonnet 4.6 / Opus 4.8 escalation) | GPT-4o |
| ORM / query layer | **Drizzle ORM** | Prisma |
| Deployment | **Vercel** | Railway |

**Extension framework — WXT.** WXT gives first-class Manifest V3 support, file-based entrypoints
(`background`, `content`, `popup`), a Vite-powered dev server with HMR for content scripts, and
cross-browser builds (Chrome/Edge/Brave today, Firefox later for free) without locking us into a
proprietary abstraction the way Plasmo's messaging/storage layers can. Plasmo is excellent but its
opinionated abstractions add bundle weight and occasional friction with custom service-worker
lifecycles; vanilla MV3 maximises control but costs us weeks of tooling we'd rather spend on the
learning model. WXT is the pragmatic middle that stays close to the platform.

**Frontend (overlay UI) — Preact + Vite.** The overlay is injected into arbitrary third-party
pages, so runtime size is a first-order concern: Preact's ~4KB runtime versus React's ~45KB
directly reduces injection cost and parse time on the host page. `preact/compat` keeps the React
ecosystem (hooks, most libraries) available, so we lose little. The marketing site and dashboard
in `/web` use full React via Next.js — appropriate there because bundle size is amortised over a
first-party page load. We accept the minor cost of two renderers in exchange for a featherweight
injected surface.

**Styling — Tailwind CSS, scoped inside the shadow root.** Tailwind gives us velocity and a single
design language shared across overlay, popup, and dashboard. The usual objection (global CSS
collision) is neutralised because the overlay lives in a **shadow DOM**: we inject a compiled
Tailwind stylesheet *into the shadow root* with `preflight` contained, so host-page styles never
leak in and our styles never leak out. CSS Modules would also work but cost us the shared utility
vocabulary; vanilla CSS is too slow for the iteration pace.

**Backend framework — Next.js App Router route handlers on Vercel Fluid Compute.** The web
dashboard is already Next.js, so collocating the API as route handlers means one repo target, one
deploy, shared types, and shared auth. Fluid Compute removes the historic serverless objection for
AI proxying: it supports full Node.js, long execution (300s default), streaming responses, and
instance reuse to cut cold starts — exactly what a streaming STT→AI→TTS proxy needs. A standalone
Express service would be justified only if we needed long-lived sockets the platform couldn't host;
we don't for V1 (streaming over HTTP/SSE suffices). FastAPI would split our language surface for no
gain since the heavy ML is all behind third-party APIs.

**Database — PostgreSQL via Supabase.** The brief repeatedly assumes Supabase RLS, and that's the
right call: we need relational integrity (knowledge nodes ↔ misconceptions ↔ sessions), strong
row-level security as a hard requirement, JSONB for flexible profile blobs, and Postgres extensions
(`pg_trgm` for fuzzy misconception matching, optional `pgvector` for embedding similarity).
Supabase bundles Postgres + Auth + RLS + storage + a generous local dev story (`supabase` CLI). A
document store (Mongo) would fight our relational model; PlanetScale/MySQL lacks the RLS-in-the-DB
ergonomics we're leaning on.

**Auth — Supabase Auth.** Because authorisation is enforced by Postgres RLS, the cleanest design is
an auth provider that mints a JWT Postgres understands natively. Supabase Auth issues exactly that:
`auth.uid()` is available inside every RLS policy with zero glue. Clerk is a superb product but
pairing it with Supabase RLS means bridging Clerk JWTs into Postgres claims — extra moving parts for
no V1 benefit. NextAuth would push session logic into our app layer and weaken the
"database-enforced" guarantee we want.

**STT — Deepgram (Nova streaming).** The 2.5s round-trip budget is the deciding factor. Deepgram
streams partial transcripts over a WebSocket with strong endpointing, so we get a finalised
transcript within ~200–350ms of the user stopping speaking. Whisper (batch HTTP) adds a full upload
+ inference cycle that blows the latency budget for conversational turns. The browser Web Speech API
is free and we keep it as a zero-cost fallback (and offline-ish degraded mode), but its accuracy and
cross-browser consistency on math vocabulary are too weak to be primary.

**TTS — ElevenLabs Flash v2.5 (streaming).** Flash is purpose-built for conversational latency
(~75–150ms to first audio chunk) and streams, letting us begin playback while the model is still
generating later sentences. OpenAI TTS is good but higher first-byte latency; browser
`SpeechSynthesis` is free and is our fallback (and the Free-tier default voice), but its prosody and
voice quality undercut the premium feel that justifies the Pro tier.

**AI backbone — Anthropic Claude, tiered.** Claude's instruction-following and structured-output
discipline make it the strongest fit for a Socratic tutor that must *refuse to give answers* and
emit clean annotation JSON. We tier by turn complexity to protect latency and margin: **Haiku 4.5**
(`claude-haiku-4-5-20251001`) for the majority of conversational turns, escalating to **Sonnet 4.6**
(`claude-sonnet-4-6`) or **Opus 4.8** (`claude-opus-4-8`) for multi-step proof reasoning or
ambiguous problem diagnosis. GPT-4o is the designated fallback provider (ADR-002). Routing is
server-side so model choice never ships in the client.

**ORM / query layer — Drizzle ORM.** Drizzle is a thin, SQL-first, fully typed layer that compiles
to lean queries and runs cleanly on serverless/Fluid Compute (no engine binary like Prisma).
Crucially, it doesn't fight RLS: we issue queries through a request-scoped client carrying the
user's JWT, so policies still apply. Drizzle Kit handles migrations, but we keep **Supabase
migrations as the source of truth for RLS policies and triggers** (things best expressed in raw SQL)
and use Drizzle for table/types + app queries. Prisma's heavier runtime and historic edge friction
make it the runner-up.

**Deployment — Vercel.** Native Next.js, Fluid Compute for the streaming AI proxy, preview
deployments per PR, cron jobs for the monthly free-tier reset and reinforcement-queue maintenance,
and first-class env-var management for our server-side-only keys. Railway/Fly are viable for a
standalone backend but add a second deploy target we don't need.

### Stack Decision Summary

MathMentor is a **TypeScript-end-to-end, Supabase-centric system**. A lightweight **WXT + Preact +
Tailwind** extension renders a shadow-DOM overlay and does read-only DOM extraction on the host
page; it holds **no secrets** and talks only to our backend. That backend is **Next.js route
handlers on Vercel Fluid Compute**, which serve both the marketing/dashboard site and a streaming
**STT→AI→TTS proxy** that brokers **Deepgram**, **Claude**, and **ElevenLabs** so API keys stay
server-side. **Supabase Postgres** is the system of record, with **Drizzle** for typed app queries
and **Supabase migrations** owning RLS policies — authorization lives *in the database*, enforced by
**Supabase Auth** JWTs, satisfying the "RLS from day one" mandate. Shared learning-model logic and
types live in `/packages` so the same scoring code runs in tests, the API, and (read-only) the
dashboard. The pieces fit because they share one language, one auth/identity primitive that RLS
understands, one deploy target, and a clean trust boundary: **the client is dumb and keyless; the
server is authoritative.**

---

## 2.2 Chrome Extension Architecture

### Manifest V3 structure & permissions

```jsonc
// manifest (generated by WXT) — illustrative
{
  "manifest_version": 3,
  "name": "MathMentor",
  "minimum_chrome_version": "116",       // Side Panel + stable MV3 APIs
  "permissions": [
    "activeTab",       // read/screenshot the focused tab ONLY after user invokes the shortcut
    "scripting",       // programmatic content-script injection on demand (not blanket)
    "storage",         // chrome.storage.session/local for ephemeral state across SW restarts
    "tabs",            // know active tab id/url for the session (URL is hashed before storage)
    "sidePanel"        // optional: dashboard-in-panel; overlay is primary (see ADR-001)
  ],
  "optional_permissions": [
    "tabCapture"       // BETA image-equation path only; requested at point of use
  ],
  "host_permissions": [],  // intentionally EMPTY at install; rely on activeTab gesture
  "background": { "service_worker": "background.js", "type": "module" },
  "action": { "default_title": "MathMentor" },
  "commands": {
    "activate-tutor": {
      "suggested_key": { "default": "Ctrl+Shift+M", "mac": "Command+Shift+M" },
      "description": "Open MathMentor on the current page"
    }
  },
  "content_security_policy": {
    "extension_pages": "script-src 'self'; object-src 'self'"
  }
}
```

| Permission | Why it's needed | Web Store review risk |
|---|---|---|
| `activeTab` | Grants temporary access to the *current* tab only when the user triggers the shortcut/action. This is our core read primitive and the least-privilege way to touch page content. | **Low** — explicitly designed for gesture-gated access. |
| `scripting` | Inject the content script / overlay on demand via `chrome.scripting.executeScript` instead of declaring broad `content_scripts` matches. | **Low–medium** — fine when paired with `activeTab` rather than `<all_urls>`. |
| `storage` | Persist ephemeral session state (auth token handle, active session id, UI prefs) across the **ephemeral** service worker's wake cycles. | **Low.** |
| `tabs` | Resolve the active tab's id and URL for the session record. URL is **hashed client-side** before it ever leaves the device or is stored (see §2.7). | **Low–medium** — justify URL use in the privacy disclosure. |
| `sidePanel` | Optional surface for the mastery dashboard inside the browser. Overlay remains the tutoring surface. | **Low.** |
| `tabCapture` *(optional)* | **Beta only.** Capture a still of the visible tab for image-equation OCR, requested at the moment the user opts into the beta feature. | **Medium** — capture permissions draw scrutiny; mitigated by being optional + gesture-gated + clearly disclosed. |

**Deliberately avoided:** `<all_urls>` host permissions and persistent `content_scripts` (replaced
by `activeTab` + `scripting`), `desktopCapture`/`getDisplayMedia` (over-broad, OS-level prompts),
and any `webRequest` permission. Keeping `host_permissions` empty at install is the single biggest
review-friendliness and trust win.

### Background service worker

**Owns:**
- The **command/action listener** (`chrome.commands.onCommand`, `chrome.action.onClicked`) that
  starts a session by injecting the overlay.
- All **network egress to our backend** (the worker is the only context that calls our API), so the
  content script and overlay never make cross-origin calls directly.
- **Session orchestration state**: current session id, auth token handle, tier snapshot.
- The **WebSocket / SSE relay** for the streaming voice pipeline (worker ↔ backend).
- **Optional-permission requests** for the beta capture path.

**Lifecycle constraints:** MV3 service workers are **ephemeral** — Chrome may terminate the worker
after ~30s idle and respawn it on the next event. Therefore:
- **No in-memory state is treated as durable.** Anything that must survive a restart is written to
  `chrome.storage.session` (cleared on browser close; never hits disk — good for token handles) or
  `chrome.storage.local` (UI prefs), or lives in the remote DB.
- We re-hydrate state at the top of every event handler from `chrome.storage.session`.
- Long-lived voice streams keep the worker alive via active ports/`fetch` streams; if the worker is
  killed mid-session, the overlay detects the dropped port and re-establishes it, re-reading the
  session id from storage and resuming against the backend session.
- No timers/`setInterval` for keepalive (anti-pattern); we rely on event-driven wake + storage.

### Content script

- **Injection strategy:** **on-demand**, via `chrome.scripting.executeScript` from the background
  worker when the user invokes the shortcut — *not* a static `<all_urls>` match. This means the
  script touches a page only after an explicit user gesture (aligns with `activeTab`).
- **What it reads:** visible text, `<math>` (MathML) nodes, elements with LaTeX (KaTeX/MathJax
  render containers expose source in `annotation` tags or `data-*`/`aria` attributes), `alt`/`aria`
  text, and element geometry (`getBoundingClientRect`) for annotation targeting. It builds a
  structured `PageContext` payload.
- **How it avoids mutation:** the content script **never writes to the host DOM**. It only reads.
  The single node it *attaches* is a `<mathmentor-root>` host element whose contents live entirely
  in a **shadow root** (closed mode) — this is an additive sibling node, not a mutation of page
  content, and it carries `all: initial` + isolated styles. No host attributes, classes, or text
  are altered. (See "No DOM mutation" constraint and ADR-001.)
- **Communication:** uses `chrome.runtime.sendMessage` / a long-lived `chrome.runtime.connect` port
  to the background worker. It does **not** call our backend directly. PageContext is sent to the
  worker, which forwards it to the API.

### Overlay (rendering approach)

- **Chosen: injected Shadow DOM overlay** (closed shadow root on a single `<mathmentor-root>` host,
  fixed-positioned, high but bounded `z-index`, `pointer-events` managed per-region). Preact renders
  into the shadow root; Tailwind's compiled stylesheet is adopted via `adoptedStyleSheets` *inside*
  the shadow root.
- **Why:** annotations must visually register against *host-page coordinates* (highlight this
  equation, draw an arrow to that term). An iframe is a separate coordinate space and can't easily
  overlay precise host geometry; the Side Panel API lives in a docked chrome region entirely outside
  the page, so it can't annotate page content at all. Shadow DOM gives us **style isolation**
  (no collision in either direction) *and* shared page coordinates for the annotation layer.
- **z-index / CSS collision avoidance:** style encapsulation via shadow DOM means host CSS can't
  reach our tree; we set `all: initial` on the host, use a single very high `z-index` on the host
  only, and render annotations on a transparent full-viewport SVG/canvas layer with
  `pointer-events: none` except on interactive controls.
- **Side Panel** is used *only* for the optional in-browser **dashboard** (mastery graph, history) —
  a first-party surface that doesn't need page coordinates — not for tutoring.

### Popup

- **Scope:** lightweight launcher + status only — sign-in entry point, "Start tutor on this page,"
  current tier + remaining free sessions, link to dashboard.
- **Limitations:** the popup's document is destroyed on blur/close, so it holds no session state and
  runs no tutoring logic. It is a thin control surface; all real work happens in the worker/overlay.

### Message-passing diagram

```text
                         ┌──────────────────────────────────────────────────────┐
   USER GESTURE          │                  HOST PAGE (read-only)               │
 Ctrl/Cmd+Shift+M  ───►  │   ┌───────────────┐        ┌──────────────────────┐  │
                         │   │ Content Script│        │  Overlay UI (Preact) │  │
                         │   │  (DOM reader) │        │  in CLOSED Shadow DOM│  │
                         │   └──────┬────────┘        └───────────┬──────────┘  │
                         └──────────┼───────────────────────────-─┼─────────────┘
                                    │ runtime.sendMessage /        │ port: audio frames,
                          PageContext│ connect(port)               │ UI events, annotations
                                    ▼                              ▼
                         ┌────────────────────────────────────────────────────────┐
                         │           BACKGROUND SERVICE WORKER (ephemeral)         │
                         │   • only network egress  • re-hydrates from storage     │
                         │   • relays voice stream  • holds session id + token     │
                         └───────────────┬─────────────────────────┬──────────────┘
                                         │ HTTPS / SSE / WS         │ chrome.storage.session
                                         ▼                          ▼ (token handle, session id)
                         ┌────────────────────────────────────────────────────────┐
                         │                BACKEND API (Next.js / Vercel)           │
                         │  /session  /voice (STT→AI→TTS proxy)  /profile  /billing│
                         │  holds ALL provider keys; enforces tier; applies RLS    │
                         └───────┬───────────────┬───────────────┬────────────────┘
                                 ▼               ▼               ▼
                            Deepgram(STT)    Claude(AI)     ElevenLabs(TTS)
                                 │
                                 ▼
                          Supabase Postgres (RLS) ◄── Stripe webhooks
```

---

## 2.3 Data Models

Conventions: all tables use `uuid` PKs (`gen_random_uuid()`), `created_at`/`updated_at`
`timestamptz` (`now()`), and a **soft-delete `deleted_at timestamptz null`** unless noted. All
user-scoped tables carry `user_id uuid` and have **RLS enabled** with the canonical policy
`USING (auth.uid() = user_id AND deleted_at IS NULL)` for select/update and matching `WITH CHECK`
on insert. `updated_at` is maintained by a shared `set_updated_at()` trigger.

### `users`

| Column | Type | Null | Default | Description |
|---|---|---|---|---|
| `id` | uuid (PK, = `auth.users.id`) | no | — | Mirror of Supabase Auth user id. |
| `email` | citext | no | — | Account email (from auth). |
| `subscription_tier` | text enum(`free`,`pro`) | no | `'free'` | Current entitlement tier. |
| `stripe_customer_id` | text | yes | null | Stripe customer handle. |
| `stripe_subscription_id` | text | yes | null | Active subscription handle. |
| `subscription_status` | text | yes | null | `active`/`past_due`/`canceled` mirror of Stripe. |
| `subscription_renews_at` | timestamptz | yes | null | Period end for grace handling. |
| `age_verified` | boolean | no | `false` | Passed the ≥13 age gate. |
| `birth_year` | smallint | yes | null | Coarse age proof (year only, not full DOB). |
| `gdpr_consent_at` | timestamptz | yes | null | When consent was captured (null = not consented). |
| `gdpr_consent_version` | text | yes | null | Version of the consent text accepted. |
| `free_session_count` | int | no | `0` | Free sessions used in the current period. |
| `free_period_started_at` | timestamptz | no | `now()` | Anchor for the monthly reset. |
| `onboarding_completed_at` | timestamptz | yes | null | Cold-start assessment finished. |
| `created_at` | timestamptz | no | `now()` | — |
| `updated_at` | timestamptz | no | `now()` | — |
| `deleted_at` | timestamptz | yes | null | Soft delete / erasure marker. |

- **Indexes:** `unique(email)`, `unique(stripe_customer_id)`, `idx_users_tier (subscription_tier)`.
- **RLS:** user may `select`/`update` only their own row (`auth.uid() = id`). **No client insert**
  (rows created by a post-signup trigger / service role). **No client delete** (erasure goes through
  the deletion endpoint with service role).
- **Soft delete:** `deleted_at` set on erasure request, then a hard-delete job runs at T+30 days
  (see §2.7).

### `sessions`

| Column | Type | Null | Default | Description |
|---|---|---|---|---|
| `id` | uuid (PK) | no | `gen_random_uuid()` | Session id. |
| `user_id` | uuid (FK→users) | no | — | Owner. |
| `started_at` | timestamptz | no | `now()` | Session start. |
| `ended_at` | timestamptz | yes | null | Session end (null = in progress). |
| `page_url_hash` | text | yes | null | **SHA-256(salt‖normalized URL)** — raw URL never stored. |
| `page_domain` | text | yes | null | eTLD+1 only (e.g. `khanacademy.org`) for coarse analytics. |
| `detected_topic` | text | yes | null | Top-level math topic inferred from page context. |
| `mode` | text enum(`voice`,`text`) | no | `'voice'` | Primary modality used. |
| `interaction_count` | int | no | `0` | Denormalised count of interactions. |
| `counts_against_free` | boolean | no | `true` | Whether it decremented the free quota. |
| `created_at` / `updated_at` | timestamptz | no | `now()` | — |
| `deleted_at` | timestamptz | yes | null | Soft delete. |

- **Indexes:** `idx_sessions_user_started (user_id, started_at desc)`, `idx_sessions_domain (page_domain)`.
- **RLS:** standard owner policy.
- **Soft delete:** soft; cascades logically to interactions on erasure.

### `knowledge_nodes`

One row per (user, concept). This is the live mastery state.

| Column | Type | Null | Default | Description |
|---|---|---|---|---|
| `id` | uuid (PK) | no | `gen_random_uuid()` | — |
| `user_id` | uuid (FK→users) | no | — | Owner. |
| `concept_key` | text | no | — | Stable curriculum key, e.g. `algebra.quadratics.factoring`. |
| `mastery` | real | no | `0.0` | Current mastery estimate, 0–1 (decay-adjusted on read). |
| `stability` | real | no | `1.0` | Memory-stability (days) controlling decay rate. |
| `difficulty` | real | no | `0.3` | Intrinsic concept difficulty for this user, 0–1. |
| `confidence_band` | text enum(`low`,`medium`,`high`) | no | `'low'` | Estimate reliability. |
| `observation_count` | int | no | `0` | Number of graded interactions on this node. |
| `last_practiced_at` | timestamptz | yes | null | Last interaction timestamp. |
| `state` | text enum(`unseen`,`learning`,`weak`,`mastered`,`forgotten`) | no | `'unseen'` | Derived label. |
| `created_at` / `updated_at` | timestamptz | no | `now()` | — |
| `deleted_at` | timestamptz | yes | null | Soft delete. |

- **Indexes:** `unique(user_id, concept_key)`, `idx_kn_user_state (user_id, state)`,
  `idx_kn_user_lastpracticed (user_id, last_practiced_at)`.
- **RLS:** standard owner policy.
- **Soft delete:** soft (erasure cascade).

### `misconceptions`

Tracked, confirmed error patterns per user.

| Column | Type | Null | Default | Description |
|---|---|---|---|---|
| `id` | uuid (PK) | no | `gen_random_uuid()` | — |
| `user_id` | uuid (FK→users) | no | — | Owner. |
| `concept_key` | text | no | — | Concept the misconception attaches to. |
| `category` | text | no | — | Canonical misconception category, e.g. `sign_error.distribution`. |
| `description` | text | yes | null | Human-readable specifics from the detection. |
| `status` | text enum(`pending`,`active`,`resolved`) | no | `'pending'` | Lifecycle. |
| `occurrence_count` | int | no | `1` | Times observed. |
| `consecutive_correct` | int | no | `0` | Toward the 3-needed for resolution. |
| `first_seen_at` | timestamptz | no | `now()` | First observation. |
| `last_seen_at` | timestamptz | no | `now()` | Most recent observation. |
| `resolved_at` | timestamptz | yes | null | When confirmed resolved. |
| `embedding` | vector(1024) | yes | null | Optional `pgvector` for fuzzy matching of descriptions. |
| `created_at` / `updated_at` | timestamptz | no | `now()` | — |
| `deleted_at` | timestamptz | yes | null | Soft delete. |

- **Indexes:** `idx_misc_user_concept_cat (user_id, concept_key, category)`,
  `idx_misc_user_status (user_id, status)`, GIN `pg_trgm` on `description`, optional ivfflat on
  `embedding`.
- **RLS:** standard owner policy.
- **Soft delete:** soft.

### `session_interactions`

Individual exchanges within a session; the raw material for profile updates. **No audio is ever
stored here** — text transcript only.

| Column | Type | Null | Default | Description |
|---|---|---|---|---|
| `id` | uuid (PK) | no | `gen_random_uuid()` | — |
| `session_id` | uuid (FK→sessions) | no | — | Parent session. |
| `user_id` | uuid (FK→users) | no | — | Denormalised owner for RLS. |
| `turn_index` | int | no | — | Order within session. |
| `concept_key` | text | yes | null | Concept this exchange exercised. |
| `student_transcript` | text | yes | null | STT result (text only, no audio). |
| `tutor_response` | text | yes | null | Tutor's spoken text. |
| `outcome` | text enum(`correct`,`incorrect`,`partial`,`none`) | no | `'none'` | Graded result. |
| `self_confidence` | text enum(`low`,`med`,`high`,`unknown`) | no | `'unknown'` | Student-signalled certainty. |
| `response_latency_ms` | int | yes | null | Think-time signal (for lucky-guess heuristics). |
| `misconception_category` | text | yes | null | Category if the AI flagged one. |
| `applied_to_profile` | boolean | no | `false` | Idempotency guard for the update job. |
| `created_at` | timestamptz | no | `now()` | — |
| `deleted_at` | timestamptz | yes | null | Soft delete. |

- **Indexes:** `idx_si_session_turn (session_id, turn_index)`,
  `idx_si_user_applied (user_id, applied_to_profile)`.
- **RLS:** standard owner policy (via `user_id`).
- **Soft delete:** soft; purged with session on erasure.

### `reinforcement_schedule`

Spaced-repetition queue: one row per (user, concept) due item.

| Column | Type | Null | Default | Description |
|---|---|---|---|---|
| `id` | uuid (PK) | no | `gen_random_uuid()` | — |
| `user_id` | uuid (FK→users) | no | — | Owner. |
| `concept_key` | text | no | — | Concept to review. |
| `due_at` | timestamptz | no | — | Next review time. |
| `interval_days` | real | no | `1.0` | Current scheduling interval. |
| `last_review_at` | timestamptz | yes | null | Previous review. |
| `lapses` | int | no | `0` | Times forgotten/failed. |
| `priority` | real | no | `0.5` | Tie-break weight (weak/active-misconception boosts). |
| `created_at` / `updated_at` | timestamptz | no | `now()` | — |
| `deleted_at` | timestamptz | yes | null | Soft delete. |

- **Indexes:** `unique(user_id, concept_key)`, `idx_rs_user_due (user_id, due_at)`.
- **RLS:** standard owner policy.
- **Soft delete:** soft.

### Relationships

```text
users (1) ──< (N) sessions ──< (N) session_interactions
users (1) ──< (N) knowledge_nodes
users (1) ──< (N) misconceptions
users (1) ──< (N) reinforcement_schedule

knowledge_nodes.concept_key  ─┐ (logical join on concept_key + user_id)
misconceptions.concept_key    ─┤  (no hard FK — concept_key references a static
reinforcement_schedule.concept_key ─┘  curriculum graph shipped in /packages, not a table)
```

`concept_key` is a stable identifier into a **static curriculum graph** maintained in code
(`/packages/curriculum`), so we avoid a `concepts` table churn and keep the graph versioned with the
app. `user_id` is denormalised onto child tables (e.g. `session_interactions`) so every RLS policy
is a single-column check with no joins.

### Three most critical SQL queries

**1. Build the session profile context (loaded into the AI system prompt at session start).**
Returns the weakest/most-relevant nodes + active misconceptions for the detected topic.

```sql
-- $1 = auth user, $2 = array of candidate concept_keys from page context
SELECT kn.concept_key, kn.mastery, kn.stability, kn.confidence_band, kn.state,
       kn.last_practiced_at,
       COALESCE(
         json_agg(json_build_object('category', m.category, 'desc', m.description))
         FILTER (WHERE m.id IS NOT NULL), '[]'
       ) AS active_misconceptions
FROM knowledge_nodes kn
LEFT JOIN misconceptions m
       ON m.user_id = kn.user_id
      AND m.concept_key = kn.concept_key
      AND m.status = 'active'
      AND m.deleted_at IS NULL
WHERE kn.user_id = $1
  AND kn.deleted_at IS NULL
  AND (kn.concept_key = ANY($2) OR kn.state IN ('weak','forgotten'))
GROUP BY kn.id
ORDER BY (kn.concept_key = ANY($2)) DESC,   -- page-relevant first
         kn.mastery ASC                      -- then weakest first
LIMIT 25;
```

*Why:* this is the hot path that personalises every session; it must be fast (covered by
`idx_kn_user_state`) and bounded (LIMIT 25) so profile context never blows the token budget.

**2. Fetch due reinforcement items (drives "let's revisit…" prompts and the dashboard queue).**

```sql
-- $1 = auth user, $2 = now()
SELECT rs.concept_key, rs.due_at, rs.interval_days, rs.priority, kn.mastery, kn.state
FROM reinforcement_schedule rs
JOIN knowledge_nodes kn
  ON kn.user_id = rs.user_id AND kn.concept_key = rs.concept_key AND kn.deleted_at IS NULL
WHERE rs.user_id = $1
  AND rs.deleted_at IS NULL
  AND rs.due_at <= $2
ORDER BY rs.priority DESC, rs.due_at ASC
LIMIT 10;
```

*Why:* powers spaced reinforcement (a Pro feature) and the daily review nudge; `idx_rs_user_due`
makes it index-only-ish and cheap to poll.

**3. Atomic free-tier consumption check (server-authoritative gate at session start).**

```sql
-- $1 = auth user, $2 = monthly limit (e.g. 10). Runs in a transaction in the API.
UPDATE users
   SET free_session_count = free_session_count + 1,
       updated_at = now()
 WHERE id = $1
   AND subscription_tier = 'free'
   AND free_session_count < $2
   AND deleted_at IS NULL
RETURNING free_session_count;     -- 0 rows => over limit => degrade gracefully
```

*Why:* a single atomic `UPDATE … RETURNING` is race-safe under concurrent session starts and is the
**authoritative** enforcement point (client display is advisory only, per the constraints).

---

## 2.4 Learning Profile System

### Knowledge graph update algorithm

**Inputs per interaction:** prior `mastery`, prior `stability`, `difficulty`, `outcome`
(correct/partial/incorrect), `self_confidence`, `response_latency_ms`, `time_since_last` (days),
and a `reasoning_quality` flag the AI emits (sound / shallow / none).

**Model:** an FSRS-flavoured two-variable model. `mastery` is the *retrievability-adjusted*
competence; `stability` controls the exponential decay half-life; an Elo-style delta nudges mastery
toward observed performance, scaled by confidence and reasoning quality to neutralise lucky guesses.

```text
function updateKnowledgeNode(node, interaction):
    # --- 1. DECAY: apply forgetting since last practice ---
    t = interaction.time_since_last_days
    retrievability = (1 + t / (9 * node.stability)) ** -1        # FSRS power-decay, 0..1
    effective_mastery = node.mastery * retrievability

    # --- 2. GRADE: map outcome to a target in [0,1] ---
    grade = { correct: 1.0, partial: 0.5, incorrect: 0.0 }[interaction.outcome]

    # --- 3. LUCKY-GUESS / FALSE-MASTERY GUARDS ---
    # A "correct" answer with no/shallow reasoning, low self-confidence, or implausibly fast
    # latency is discounted toward a partial — we don't reward guessing.
    is_suspect_correct = (grade == 1.0) and (
          interaction.reasoning_quality in ('none','shallow')
       or interaction.self_confidence == 'low'
       or interaction.response_latency_ms < FAST_GUESS_MS(node.difficulty))
    if is_suspect_correct:
        grade = 0.6                      # credited, but not as true mastery
        learning_rate_scale = 0.5        # and updated cautiously
    else:
        learning_rate_scale = 1.0

    # Symmetric guard: a wrong answer with sound reasoning (a slip) is softened.
    if grade == 0.0 and interaction.reasoning_quality == 'sound':
        grade = 0.25

    # --- 4. UPDATE MASTERY (Elo-style, confidence-weighted K) ---
    K = BASE_K * learning_rate_scale * confidence_weight(node.observation_count)
        # K shrinks as observation_count grows -> estimates stabilise over time
    new_mastery = clamp(effective_mastery + K * (grade - effective_mastery), 0, 1)

    # --- 5. UPDATE STABILITY (memory strengthens on success, resets on failure) ---
    if grade >= 0.6:
        # success grows stability more when recall happened at low retrievability (desirable difficulty)
        new_stability = node.stability * (1 + STAB_GROWTH * (1 - retrievability) * (1 - node.difficulty))
    else:
        new_stability = max(MIN_STABILITY, node.stability * STAB_PENALTY)   # e.g. *0.5

    # --- 6. DIFFICULTY drift (slow) ---
    new_difficulty = clamp(node.difficulty + DIFF_LR * ((1 - grade) - node.difficulty), 0.05, 0.95)

    # --- 7. CONFIDENCE BAND + STATE LABEL ---
    band = 'low' if node.observation_count < 3
         else 'medium' if node.observation_count < 8 else 'high'

    state =
        'mastered'  if new_mastery >= 0.85 and band != 'low'
      : 'weak'      if new_mastery <  0.50
      : 'forgotten' if (new_mastery * retrievability_at(7_days, new_stability)) < 0.30  # will lapse soon
      : 'learning'

    persist(node, new_mastery, new_stability, new_difficulty, band, state,
            last_practiced_at = now, observation_count += 1)
    scheduleReinforcement(node)   # see scheduler below
```

- **Decay function:** FSRS power form `R = (1 + t/(9·S))^-1`. Higher `stability` → slower decay.
- **Lucky guess vs true mastery:** discounted via `grade` re-mapping + halved `K` when a "correct"
  lacks reasoning/confidence or is implausibly fast; sound-but-wrong "slips" are softened so one slip
  doesn't tank a known concept.
- **Weak vs forgotten:** `weak` = current mastery < 0.50. `forgotten` = projected retrievability
  one week out falls below 0.30 (i.e., it will lapse without review) — this is what feeds urgency
  into the scheduler.

### Misconception detection

```text
function processMisconception(interaction):
    # 1. IDENTIFY: the AI classifies each wrong/partial answer into a canonical category
    #    (e.g. 'sign_error.distribution') + a free-text description. No category => no candidate.
    if interaction.outcome in ('incorrect','partial') and interaction.misconception_category:
        cand = { user, concept_key, category, description, embedding? }

        # 2. MATCH against existing rows for this user+concept:
        #    exact category match first; else fuzzy (pg_trgm on description, or pgvector cosine).
        existing = findMisconception(user, concept_key,
                      category == cand.category
                      OR trigram_sim(description, cand.description) > 0.6
                      OR cosine(embedding, cand.embedding) > 0.85)

        if existing is None:
            insert(status='pending', occurrence_count=1, consecutive_correct=0)   # 1st instance
        elif existing.status == 'pending':
            # 3. TWO-INSTANCE THRESHOLD: 2nd matching instance promotes pending -> active
            existing.occurrence_count += 1
            existing.last_seen_at = now
            if existing.occurrence_count >= 2: existing.status = 'active'
            existing.consecutive_correct = 0     # any recurrence resets the resolution streak
        elif existing.status == 'active':
            existing.occurrence_count += 1; existing.last_seen_at = now
            existing.consecutive_correct = 0

    # 4. RESOLUTION: a CORRECT, soundly-reasoned answer on a concept with active misconceptions
    elif interaction.outcome == 'correct' and interaction.reasoning_quality == 'sound':
        for m in activeMisconceptions(user, interaction.concept_key):
            m.consecutive_correct += 1
            if m.consecutive_correct >= 3:       # 3 clean performances confirm resolution
                m.status = 'resolved'; m.resolved_at = now
```

- **Identification:** AI-labelled category + description from the graded interaction.
- **Two-instance threshold:** first instance is `pending` (could be a one-off slip); the second
  *matching* instance promotes it to `active` and surfaces it in the profile.
- **Matching:** exact `category` first, then fuzzy (`pg_trgm` trigram similarity > 0.6, or optional
  `pgvector` cosine > 0.85 on descriptions) so phrasings of the same error collapse together.
- **Resolution:** **three** consecutive correct, soundly-reasoned performances on the concept flip
  `active → resolved`; any recurrence resets the streak. (ADR-004 covers rule-based vs model-inferred
  category sourcing.)

### Spaced reinforcement scheduler

**Choice: FSRS (Free Spaced Repetition Scheduler).** Justification: we already maintain
`stability`/`difficulty`/retrievability in the knowledge model, so FSRS is a *direct* read of that
state rather than a parallel system. FSRS targets a configurable **desired retention** and is more
accurate than SM-2's fixed ease-factor heuristic, especially for heterogeneous concept difficulty.
SM-2 is the runner-up (simpler, well-understood) but would force a second, less faithful memory model
alongside the one driving mastery. We target **desired retention `R_d = 0.90`**.

```text
function scheduleReinforcement(node):
    S = node.stability                 # days (post-update)
    R_d = 0.90                         # desired retention
    # Invert FSRS retrievability R = (1 + t/(9S))^-1  for t at R = R_d:
    interval_days = 9 * S * (1/R_d - 1)            # => ~ 9*S*0.111 = S at R_d=0.9
    interval_days = clamp(interval_days, MIN_INT, MAX_INT)   # e.g. [0.5, 365]

    # urgency overrides: weak nodes & active misconceptions get pulled forward
    if node.state in ('weak','forgotten'): interval_days *= 0.5
    priority = 0.5
             + (0.3 if hasActiveMisconception(node) else 0)
             + (0.2 if node.state in ('weak','forgotten') else 0)

    upsert reinforcement_schedule(user, concept_key,
        due_at = now + interval_days, interval_days, priority,
        lapses += (1 if last_outcome_failed else 0), last_review_at = now)
```

Decision rules: success → interval grows with stability; failure → stability (and thus interval)
collapses toward `MIN_STABILITY`, with `lapses` incremented; weak/misconception concepts surface
sooner and rank higher in the due queue.

### Cold start handling

**Onboarding assessment flow.**
- **Length:** 8–12 items (target 10), ~5–7 minutes. Math-only.
- **Topic coverage:** spans the V1 curriculum top-level strands (arithmetic/pre-algebra, algebra,
  geometry, trigonometry, pre-calc/functions) so the initial graph has at least one anchored
  estimate per strand.
- **Difficulty distribution:** start at medium; **adaptive branching** (a lightweight 2-parameter
  IRT-lite ladder, *not* full IRT): each correct answer steps difficulty up, each miss steps it
  down, within the current strand. We pick a simple ability-ladder over full IRT for V1 because we
  lack a calibrated item bank — IRT needs per-item difficulty/discrimination parameters we won't
  have until we've collected response data (revisit post-V1).
- **Initial graph state:** every assessed concept gets a seeded `knowledge_node`
  (`mastery` from item response, `confidence_band='low'`, `observation_count=1`, `state` derived).
  Un-assessed concepts are **left `unseen`** but receive *prior* estimates propagated along the
  static curriculum graph (a prerequisite that was answered correctly raises priors of its
  dependents slightly; a failed prerequisite lowers them). `stability` seeded to a small default.
- **Confidence indicator over time:**
  - **Session 1:** "Calibrating — early estimate" (band mostly `low`).
  - **Session 4:** "Getting to know you" (mix of `low`/`medium`).
  - **Session 9+:** "Profile calibrated" (enough observations for `high` bands on practised
    concepts). The indicator is literally an aggregate of per-node `confidence_band`s weighted by
    `observation_count`.

---

## 2.5 AI Integration Layer

### System prompt architecture

```text
You are MathMentor, a patient, encouraging math tutor for an independent high-school or
college student. You teach MATH ONLY. You speak out loud (your text is converted to speech),
so write the way a great tutor talks: warm, concise, one idea at a time.

═══════════════════ PEDAGOGY ═══════════════════
DEFAULT MODE IS SOCRATIC. Your job is to make the student do the thinking.
- Lead with questions and small steps. Ask the student to take the next step themselves.
- Give hints in escalating size: first a nudge, then a pointed hint, then a worked micro-step.
- NEVER state the final answer in Socratic mode. Guide them to produce it.
SWITCH TO DIRECT EXPLANATION only when ANY of these is true, and say briefly that you're
switching ("Let me show you this part, then you try"):
  1. The student has attempted and is stuck after ~3 escalating hints on the same step.
  2. The student explicitly asks to be shown / says they're overwhelmed or frustrated.
  3. It's a definition or notation fact they could not be expected to derive.
After a direct explanation, immediately return to Socratic mode with a check-for-understanding
question that applies what you just showed.

═══════════════════ STUDENT PROFILE (injected) ═══════════════════
{{LEARNING_PROFILE_SUMMARY}}
  // mastery levels for relevant concepts, active misconceptions to watch for and gently probe,
  // learning-style preferences, and a confidence note (how reliable these estimates are).
Use this to calibrate difficulty and to watch for the listed misconceptions WITHOUT naming them
clinically. If a profile estimate is low-confidence, verify with a quick question before assuming.

═══════════════════ PAGE CONTEXT (injected) ═══════════════════
{{PAGE_CONTEXT}}
  // the math the student is currently looking at: extracted text, LaTeX/MathML equations,
  // and element references available for annotation.
Anchor the session to THIS content. Refer to "the equation on your screen," not abstractions.

═══════════════════ HARD RULES — NEVER ═══════════════════
- NEVER give a final answer without scaffolding while in Socratic mode.
- NEVER claim certainty when the input (transcript or page context) is ambiguous or low-quality.
  Say what you see, ask a clarifying question, or ask the student to read/copy the step.
- NEVER answer anything outside mathematics. Redirect warmly: "That's outside what I can help with —
  want to get back to the problem on your screen?"
- NEVER invent page content you cannot see. If extraction is incomplete, ask the student to read it.
- NEVER shame mistakes. Treat every error as information.

═══════════════════ OUTPUT FORMAT ═══════════════════
Return a single JSON object and NOTHING else:
{
  "say": "<the spoken response — plain, natural sentences, no markdown, no LaTeX read-aloud
           gibberish; verbalize math naturally e.g. 'x squared plus three x'>",
  "annotations": [ <zero or more annotation objects, schema below> ],   // optional
  "mode": "socratic" | "direct",                 // which mode this turn used
  "assessment": {                                // your read of the student's LAST answer; omit on your opening turn
     "concept_key": "<key or null>",
     "outcome": "correct" | "incorrect" | "partial" | "none",
     "reasoning_quality": "sound" | "shallow" | "none",
     "misconception_category": "<canonical category or null>",
     "confidence": "low" | "med" | "high"        // YOUR confidence in this assessment
  }
}
Keep "say" under ~60 spoken words unless giving a direct explanation. One question at a time.
```

### Context window management

- **Session history kept per turn:** last **6–8 turns verbatim** (≈ the active reasoning thread),
  plus a **rolling running summary** of earlier turns (regenerated every ~8 turns) so older context
  is retained compressed rather than dropped. Target ≈ 1,200 tokens for history.
- **Profile summary truncation:** the profile is rendered server-side to a bounded summary —
  **top-K weakest + page-relevant nodes (K≈12)** and **active misconceptions only (cap ≈ 8)**,
  each one line. If still over budget, drop lowest-priority nodes first; never drop active
  misconceptions for relevant concepts. Target ≈ 800 tokens.
- **Per-turn token budget (target, fast model):**

| Component | Budget (tokens) |
|---|---|
| System prompt (static pedagogy + rules) | ~900 |
| Profile summary (injected) | ~800 |
| Page context (injected, truncated) | ~1,500 |
| Conversation history (verbatim + summary) | ~1,200 |
| Model response (max output) | ~600 |
| **Total per turn** | **≈ 5,000** |

Page context is truncated to the equations/text nearest the student's focus; system + pedagogy
block is cached (prompt caching) across turns so only the volatile parts re-tokenise.

### Annotation instruction format

```json
{
  "annotations": [
    {
      "id": "a1",
      "type": "highlight | circle | arrow | label | step-indicator",
      "target": {
        "kind": "selector | bbox | textMatch",
        "selector": "math .mjx-mn:nth-of-type(2)",      // when kind=selector (resolved in content script)
        "bbox": { "x": 120, "y": 340, "w": 80, "h": 28 },// when kind=bbox (host-page viewport coords)
        "text": "x^2 + 3x"                               // when kind=textMatch (first visible match)
      },
      "style": { "color": "amber", "weight": "med" },
      "label": "what changed here?",                      // for type=label / step-indicator
      "step": 2,                                          // for type=step-indicator ordering
      "ttl_ms": 0                                         // 0 = persist until turn end / cleared
    }
  ]
}
```

- **Supported types:** `highlight`, `circle`, `arrow`, `label`, `step-indicator`.
- **Targeting:** three resolvers in priority order — CSS `selector` (most precise, from the
  extracted DOM refs), `bbox` viewport coordinates (fallback for canvas/image math), or `textMatch`
  (the overlay finds the first visible occurrence and computes its rect). The content script
  resolves `selector`/`textMatch` to live rects at draw time.
- **Render & cleanup:** annotations draw on the transparent SVG overlay layer in the shadow root,
  positioned in host-viewport coordinates and **repositioned on scroll/resize** via a single
  `IntersectionObserver`/`scroll` handler. All annotations for a turn are tagged with the turn id;
  the layer is **cleared at the end of each turn** (or on `ttl_ms` expiry) and **fully torn down on
  session end** when `<mathmentor-root>` is removed — leaving the host page byte-for-byte unchanged.

### STT → AI → TTS pipeline (single voice interaction)

```text
 t=0ms   Student stops speaking (Deepgram endpointing detects end-of-speech)
   │
   │  [STT finalize]  Deepgram streams final transcript        ~150–300ms
   ▼
 ~250ms  Overlay→(port)→Service Worker→(SSE/WS)→Backend  /voice turn
   │       payload: final transcript + session id            ~30–60ms net
   ▼
 ~300ms  Backend assembles prompt (cached system + profile + page + history)
   │       [Claude call, streaming]  time-to-first-token       ~350–550ms
   ▼
 ~750ms  First tokens arrive. Backend parses streaming JSON incrementally;
   │       as soon as the first SENTENCE of "say" is complete, it is
   │       forwarded to ElevenLabs Flash (streaming TTS)        handoff ~10ms
   ▼
 ~800ms  [TTS Flash] first audio chunk returned               ~120–180ms
   │       Backend streams audio chunks → Service Worker → Overlay
   ▼
≈1.0–1.1s ◄── TTS AUDIO BEGINS PLAYING (first chunk)  ✅ well under 2.5s
   │
   │  Remaining sentences of "say" stream Claude→TTS→playback in parallel
   │  while the student already hears the opening. Annotations (parsed from
   │  the same stream) are dispatched to the overlay as they complete.
   ▼
 (turn continues streaming to natural end)
```

**Target latencies:** STT finalize ≤ 300ms · network legs ≤ 60ms each · AI TTFT ≤ 550ms ·
sentence→TTS handoff ≤ 10ms · TTS first audio ≤ 180ms → **first audible response ≈ 1.0–1.1s**,
comfortably under the 2.5s ceiling. The key technique is **sentence-level streaming overlap**: we do
not wait for the full Claude response before starting TTS (see ADR-003).

---

## 2.6 Screen Capture & Content Extraction

**Primary path is NOT screen capture — it's read-only DOM extraction.** The content script reads
visible text, MathML (`<math>`), and LaTeX source (KaTeX/MathJax expose source in
`<annotation encoding="application/x-tex">` and `data-*`/`aria-label`), plus element rects for
annotation. This needs **no capture permission**, no permission prompt, and produces clean,
high-confidence structured math directly. This is the **stable** V1 content path.

**Beta image-equation path — `chrome.tabs.captureVisibleTab`.** For equations that exist only as
images/canvas (no DOM math), we capture a **still** of the visible tab.
- **Why `captureVisibleTab` over the alternatives:** it returns a single screenshot of the *active*
  tab with no intrusive OS picker. `chrome.tabCapture`/`getDisplayMedia` are for **media streams**
  and trigger heavier prompts (and `getDisplayMedia` shows an OS-level screen-picker every time —
  terrible UX for a per-equation grab). `desktopCapture` is broader still (whole-screen/OS). For a
  one-shot frame of the page the user is already looking at, `captureVisibleTab` is the least-
  privilege fit. It requires `activeTab` (already gesture-gated) or the optional `<all_urls>`; we use
  the **`activeTab` gesture**, so the user sees no separate prompt beyond invoking the tutor.
- **Where it runs / message-size limits:** `captureVisibleTab` is called **in the background service
  worker**, which already holds the network egress role. The image therefore **never passes through
  `chrome.runtime.sendMessage`** (which has practical payload limits and would be wasteful for a
  multi-MB PNG) — the worker uploads the frame **directly to the backend** as a binary `fetch` body.
  The content script only sends a small "capture requested + crop rect" message. If a crop is needed,
  the worker downscales/crops via `OffscreenCanvas` before upload.
- **Extraction pipeline (image → structured math):** worker uploads the frame to
  `/extract/equation`; the backend runs **Mathpix OCR** (math-specialised, returns LaTeX +
  confidence) as primary, with **Claude vision** (`claude-sonnet-4-6`) as a fallback/cross-check for
  layout-heavy captures. The result is normalised to the same `PageContext` math shape as the DOM
  path.
- **Confidence threshold / fallback:** if OCR confidence `< 0.80`, we **do not silently trust it**.
  The overlay shows the recognised LaTeX rendered back to the student and asks "Did I read this
  right?" — and if they say no (or confidence `< 0.5`), we **fall back to copy-paste**: "Could you
  type or paste the equation for me?" The text fallback is always one tap away.
- **V1 scope enforcement (stable vs beta) in code:** a **server-driven feature flag**
  (`features.image_capture = 'off' | 'beta' | 'on'`, fetched with the profile and cached in
  `chrome.storage`) gates the capture entrypoint. When `beta`, the capture button renders with a
  **"Beta" badge** and the optional `tabCapture`/capture permission is requested at first use. Diagrams,
  handwriting, and video are not wired at all (post-V1). The flag is checked **server-side too** so a
  tampered client can't enable an unshipped path.

---

## 2.7 Privacy & Compliance Implementation

- **Age gate.** During sign-up (in `/web` auth flow, before any profile is created), we collect
  **birth year only** (not full DOB — data minimisation). If computed age `< 13`: we **do not create
  a user profile row**, block account creation, show a COPPA-compliant "you must be 13+" message, and
  store nothing beyond an ephemeral, non-identifying "under-13 attempt" counter (no email retained).
  `users.age_verified=true` and `birth_year` are written only on pass. The extension refuses to start
  a session if `age_verified` is false (server-checked).
- **GDPR consent.** Captured on the same onboarding screen, *before* first data processing, via an
  explicit opt-in checkbox (no pre-tick). On accept we store `gdpr_consent_at = now()` and
  `gdpr_consent_version` (e.g. `2026-06-01`). Processing endpoints assert non-null consent server-side;
  re-consent is forced when the version string changes. Consent covers: profile storage, page-context
  processing, and real-time audio→text transcription (explicitly noting audio is not retained).
- **Session audio is never persisted.** The audio path is: mic → overlay `MediaRecorder`/PCM frames
  → service worker → backend → **Deepgram WebSocket (in-memory passthrough)**. The backend handler
  holds audio bytes only in a streaming buffer it never writes to disk, Blob, or DB; it persists
  **only the returned transcript** into `session_interactions.student_transcript`. Guaranteed in code
  by: (1) the `/voice` handler has **no storage/Blob client imported** in its module; (2) audio
  buffers are function-local and GC'd per chunk; (3) a unit/integration test asserts no storage write
  occurs during a voice turn; (4) Deepgram is configured with zero-retention. The audio chunk type is
  a `ReadableStream` that is piped, never `await`-collected.
- **Data export (portability).** `GET /api/me/export` (authenticated) returns a single **JSON**
  document containing the user's `users` row (minus internal Stripe ids), all `sessions`,
  `session_interactions`, `knowledge_nodes`, `misconceptions`, and `reinforcement_schedule` rows —
  generated on demand, streamed as a download. JSON chosen for fidelity of nested/structured data
  (CSV would flatten the graph poorly); a CSV-per-table zip is a possible later convenience.
- **Account deletion (right to erasure).** `POST /api/me/delete` sets `users.deleted_at=now()`
  (immediate logical erasure: RLS hides the row, sessions stop) and enqueues a **hard-delete job**.
  The cascade hard-deletes in FK-safe order: `session_interactions` → `sessions` →
  `reinforcement_schedule` → `misconceptions` → `knowledge_nodes` → `users`, plus the Supabase Auth
  user and Stripe customer (cancel subscription). **Hard delete** (not anonymisation) for all
  user-linked rows. **Timeline commitment: within 30 days**, typically next daily job run. Backups
  age out on their own ≤ 35-day rotation, documented in the privacy policy.
- **Row-level security.** RLS is `ENABLE`d on every user-data table *in the same migration that
  creates it* (mandate). Canonical policies: `SELECT/UPDATE/DELETE USING (auth.uid() = user_id AND
  deleted_at IS NULL)` and `INSERT WITH CHECK (auth.uid() = user_id)`. `users` keys on `id`. App
  queries run through a **request-scoped Supabase/Drizzle client carrying the user's JWT**, so the DB
  itself rejects cross-user access even if the API layer has a bug. The Stripe webhook and deletion
  jobs use the **service role** (RLS-bypassing) and are the only privileged paths, isolated in
  server-only modules.
- **URL hashing.** The visited page URL is sensitive (reveals what a student studies). The content
  script/worker **normalises** the URL (strip query/fragment/auth) then computes
  `SHA-256(server_salt ‖ normalized_url)` — the **salt is server-side**, so the worker sends the
  normalized URL to the backend over TLS and the **backend computes and stores only the hash** in
  `sessions.page_url_hash`; the raw URL is never persisted. We additionally store `page_domain`
  (eTLD+1) for coarse analytics only. (Hashing server-side with a secret salt prevents rainbow-table
  reversal that a client-side unsalted hash would allow.)

---

## 2.8 Freemium Enforcement

- **Where tier logic lives: server-side API middleware is authoritative**, backed by DB state, with
  RLS as the data-access backstop and the client as a *display-only* hint. Client-side checks are
  trivially defeated (it's an extension the user controls), so the **session-start endpoint** is the
  single source of truth: it runs the atomic free-quota `UPDATE … RETURNING` (§2.3 query 3) and the
  feature-flag check before issuing a session token. The extension shows remaining sessions purely
  for UX.
- **`free_session_count` tracking & monthly reset.** Incremented atomically **at session start**
  (only for `tier='free'` and only when under the limit), inside the same transaction that creates
  the `sessions` row, so a started session always corresponds to a counted use and races are
  impossible. **Reset** is rolling per-user: a **Vercel Cron** (daily) resets
  `free_session_count=0` and bumps `free_period_started_at` for any user whose period is ≥ 30 days
  old; a lazy check at session start does the same if cron lagged. **Boundary behaviour = graceful
  degradation, not a hard block:** when over quota, the session still starts in **text-only mode with
  the browser `SpeechSynthesis` voice** (no premium Deepgram/ElevenLabs), Pro analytics hidden, plus
  an upsell — the student is never fully locked out mid-study.
- **Pro subscription via Stripe.** Checkout from the dashboard creates a Stripe Customer + Checkout
  Session. We listen for webhooks: `checkout.session.completed`, `customer.subscription.updated`,
  `customer.subscription.deleted`, `invoice.payment_failed`. Each verified webhook updates
  `users.subscription_tier/status/stripe_*` and `subscription_renews_at`. **Missed-webhook
  resilience:** (1) the webhook handler is **idempotent** (keyed on Stripe event id) and (2) a daily
  **reconciliation cron** pulls subscription status from the Stripe API for any user whose
  `subscription_renews_at` has passed or whose status looks stale, so a dropped webhook self-heals
  within a day. `past_due` enters a grace window before downgrade.
- **Feature-flag system.** A small `entitlements` resolver computes, from `subscription_tier` +
  status, a flag set: `{ voice_premium, misconception_graph, spaced_reinforcement, full_dashboard,
  unlimited_history, image_capture }`. Resolved **server-side**, attached to the session token, and
  cached in `chrome.storage` for display. Every Pro-only endpoint re-checks the entitlement
  server-side (never trusts the cached client value). Flags are also overridable per-user for
  staged rollouts (e.g., `image_capture='beta'`).

---

## 2.9 File & Folder Structure

```text
mathmentor/
├─ package.json                      # workspaces root (pnpm), shared scripts
├─ pnpm-workspace.yaml               # workspace globs
├─ turbo.json                        # Turborepo pipeline (build/test/lint/typecheck) — see ADR-005
├─ tsconfig.base.json                # shared TS config, path aliases to /packages
│
├─ extension/                        # all Chromium extension code (WXT)
│  ├─ wxt.config.ts                  # WXT config: manifest, permissions, targets
│  ├─ entrypoints/
│  │  ├─ background.ts               # service worker: egress, session orchestration, voice relay
│  │  ├─ content.ts                  # on-demand content script: read-only DOM extraction
│  │  ├─ overlay/                    # Preact overlay rendered into closed shadow DOM
│  │  │  ├─ index.tsx                # overlay mount + shadow root + adoptedStyleSheets
│  │  │  ├─ AnnotationLayer.tsx      # SVG annotation rendering + scroll/resize reposition
│  │  │  ├─ VoiceController.ts       # mic capture, VAD, audio frame piping (no persistence)
│  │  │  └─ TextFallback.tsx         # always-available typed input
│  │  └─ popup/                      # thin launcher: sign-in, tier/status, dashboard link
│  ├─ lib/
│  │  ├─ messaging.ts                # typed runtime message + port helpers
│  │  ├─ storage.ts                  # chrome.storage.session/local wrappers (state re-hydration)
│  │  ├─ pageExtractor.ts            # MathML/LaTeX/text + rect extraction
│  │  └─ api.ts                      # backend client (called only from background)
│  └─ assets/                        # icons, fonts
│
├─ web/                              # marketing site + mastery dashboard + API (Next.js App Router)
│  ├─ app/
│  │  ├─ (marketing)/                # landing, pricing, legal (privacy/terms)
│  │  ├─ (dashboard)/                # mastery graph, history, misconceptions, billing
│  │  ├─ onboarding/                 # age gate + GDPR consent + cold-start assessment UI
│  │  └─ api/                        # backend route handlers (Fluid Compute)
│  │     ├─ session/route.ts         # start/end session; AUTHORITATIVE free-tier gate
│  │     ├─ voice/route.ts           # STT→AI→TTS streaming proxy (audio never persisted)
│  │     ├─ profile/route.ts         # load profile context; apply post-session updates
│  │     ├─ extract/equation/route.ts# beta image OCR (Mathpix + Claude vision)
│  │     ├─ me/export/route.ts       # GDPR data export (JSON)
│  │     ├─ me/delete/route.ts       # erasure request -> soft delete + enqueue hard delete
│  │     ├─ billing/webhook/route.ts # Stripe webhooks (idempotent, service role)
│  │     └─ cron/                    # reset-free-quota, reconcile-subs, hard-delete, sched-maint
│  ├─ middleware.ts                  # auth/session guard for dashboard + API
│  └─ next.config.ts
│
├─ packages/                         # shared, framework-agnostic logic & types
│  ├─ core-types/                    # zod schemas + TS types (PageContext, Annotation, API I/O)
│  ├─ learning-model/                # ⭐ the differentiator — PURE functions, heavily unit-tested
│  │  ├─ knowledgeUpdate.ts          # mastery/stability/decay update (§2.4)
│  │  ├─ misconceptions.ts           # detection/match/resolution (§2.4)
│  │  ├─ scheduler.ts                # FSRS reinforcement scheduling (§2.4)
│  │  └─ coldStart.ts                # onboarding assessment + initial graph seeding
│  ├─ curriculum/                    # static curriculum graph (concept_key registry + prereqs)
│  ├─ ai/                            # prompt assembly, profile summarisation, model routing/budget
│  ├─ entitlements/                  # tier -> feature-flag resolver (server-side authoritative)
│  └─ config/                        # shared eslint/tsconfig/tailwind presets
│
├─ supabase/                         # database source of truth
│  ├─ migrations/                    # SQL: tables + indexes + RLS policies (RLS in same migration)
│  ├─ policies/                      # documented RLS policy SQL (referenced by migrations)
│  └─ seed/                          # local dev seed data
│
└─ docs/
   ├─ PLAN.md                        # this document
   └─ adr/                           # one file per ADR (see §2.11), Architecture Decision Records
```

---

## 2.10 Build Order & Milestones (Phases 1–2, two-week sprints)

Sequencing honours the four rules: shell/overlay before AI (S1) → AI on a **hardcoded** profile
before the live profile system (S3) → profile system built & **tested in isolation** before wiring
(S4) before connection (S5) → freemium/privacy enforced **before** any public launch (S6).

### Sprint 1 — Extension shell & overlay
- **Goal:** the keyboard shortcut opens a non-destructive shadow-DOM overlay that displays real
  extracted page math; no AI.
- **Deliverables:** WXT project; MV3 manifest with `activeTab`+`scripting`+`storage`; command
  handler; on-demand content-script injection; closed-shadow-DOM Preact overlay with Tailwind
  isolation; `pageExtractor` (MathML/LaTeX/text + rects); typed messaging; storage-based state
  re-hydration; popup stub.
- **Acceptance criteria:** (1) On 5 representative math sites (KaTeX, MathJax, MathML, plain-text,
  PDF-in-tab) the overlay opens via `Cmd/Ctrl+Shift+M` and lists ≥80% of visible equations. (2)
  DOM-diff snapshot proves **zero host-DOM mutation** (only `<mathmentor-root>` added). (3) Overlay
  styles unaffected by host CSS on all 5 sites. (4) Killing the service worker mid-session and
  re-triggering restores state from `chrome.storage`.
- **Blockers/risks:** MathJax/KaTeX expose LaTeX inconsistently across versions; shadow-DOM +
  Tailwind `adoptedStyleSheets` browser quirks. *Mitigation:* extractor adapters per renderer; early
  cross-browser smoke tests.

### Sprint 2 — Backend, DB schema, auth, RLS
- **Goal:** a deployed backend with the full schema, auth, and RLS, callable by the extension; no AI.
- **Deliverables:** Next.js on Vercel; Supabase project; all migrations (tables + indexes + **RLS in
  same migration**); Supabase Auth; Drizzle setup; request-scoped JWT client; `/session`
  start/end (without tier gate yet) returning a session token; extension sign-in via popup;
  service-role isolation for privileged paths.
- **Acceptance criteria:** (1) Automated RLS test: user A **cannot** read/write user B's rows on
  every table (DB rejects). (2) `/session` creates a `sessions` row scoped to the caller. (3)
  Extension signs in and starts/ends a session end-to-end. (4) `supabase db reset` reproduces schema
  locally from migrations.
- **Blockers/risks:** RLS + Drizzle JWT plumbing subtleties. *Mitigation:* lock the request-scoped
  client pattern first; RLS test suite is a gate.

### Sprint 3 — AI integrated with a HARDCODED profile (voice pipeline)
- **Goal:** a real Socratic voice conversation about the page, using a fixed sample profile.
- **Deliverables:** `/voice` streaming proxy (Deepgram STT → Claude → ElevenLabs TTS) with
  **sentence-level streaming overlap**; overlay mic capture + VAD + audio piping (no persistence);
  text fallback; system prompt (§2.5) with a **hardcoded** profile + live page context; annotation
  JSON parsed and rendered/cleaned on the overlay; model routing (Haiku default).
- **Acceptance criteria:** (1) Median first-audio latency **< 2.5s** (target ~1.1s) over 20 trials.
  (2) Tutor stays Socratic and refuses direct answers per rules in a scripted eval set. (3)
  Annotations highlight the correct on-screen equation in ≥80% of selector/textMatch cases and are
  fully removed at turn/session end. (4) Test proves **no audio bytes** are written to storage during
  a voice turn. (5) Text fallback always available.
- **Blockers/risks:** latency budget; streaming JSON parsing of partial model output. *Mitigation:*
  tolerant incremental JSON parser; sentence chunker; Web Speech/`SpeechSynthesis` fallback path.

### Sprint 4 — Learning model built & UNIT-TESTED IN ISOLATION
- **Goal:** the `learning-model` package fully implements and tests scoring/scheduling without any AI
  or DB wiring.
- **Deliverables:** `knowledgeUpdate`, `misconceptions`, `scheduler` (FSRS), `coldStart` as pure
  functions in `/packages/learning-model`; curriculum graph in `/packages/curriculum`; comprehensive
  unit tests incl. decay, lucky-guess discounting, weak/forgotten thresholds, 2-instance promotion,
  3-correct resolution, FSRS intervals; property-based tests for monotonicity/bounds.
- **Acceptance criteria:** (1) ≥90% line coverage on the package. (2) Golden-case tests: documented
  input sequences produce expected mastery/stability/state and schedule. (3) Functions are pure
  (no I/O) — verified by import-boundary lint. (4) Runs identically in Node test and (later) the API.
- **Blockers/risks:** tuning constants (K, decay, growth). *Mitigation:* constants centralised &
  documented; tests assert *behavioural* properties, not magic numbers, so tuning won't break them.

### Sprint 5 — Connect profile ↔ AI + cold start
- **Goal:** sessions load the **live** profile into the prompt and write **real** updates afterward;
  new users complete onboarding.
- **Deliverables:** `/profile` load (query 1) → profile summariser (§2.5 truncation) → injected into
  prompt; post-turn `assessment` from the model persisted to `session_interactions`; end-of-session
  job applies `learning-model` updates to `knowledge_nodes`/`misconceptions`/`reinforcement_schedule`
  (idempotent via `applied_to_profile`); cold-start assessment UI + initial graph seeding; profile
  confidence indicator.
- **Acceptance criteria:** (1) Two consecutive sessions on the same concept show the profile
  influencing tutor behaviour (difficulty/misconception probing) — verified in a scripted multi-
  session eval. (2) After a session, DB state matches `learning-model` expectations for the recorded
  interactions. (3) Re-running the update job is idempotent. (4) New user finishes onboarding → graph
  seeded across all strands; indicator reads "calibrating" at S1.
- **Blockers/risks:** model assessment reliability (mislabelled outcomes). *Mitigation:* confidence
  field gates updates; low-confidence assessments apply reduced `K`; eval set tracks label accuracy.

### Sprint 6 — Freemium, privacy/compliance, beta capture, hardening (launch gate)
- **Goal:** server-authoritative tiers, full COPPA/GDPR implementation, and beta image capture — ready
  for public launch.
- **Deliverables:** atomic free-tier gate in `/session` + graceful degradation; Vercel Crons (reset,
  reconcile, hard-delete, schedule maint); Stripe Checkout + idempotent webhooks + reconciliation;
  entitlements resolver + server-checked Pro gating; age gate + GDPR consent capture; data export
  (JSON) + deletion cascade; URL hashing (server-side salt); beta image OCR path behind feature flag
  with Beta badge; dashboard (mastery graph, history, misconceptions — Pro-gated).
- **Acceptance criteria:** (1) Free user blocked from an 11th premium session **server-side** (client
  tamper can't bypass) but still gets degraded text mode. (2) Simulated dropped Stripe webhook
  self-heals via reconciliation within one cron cycle. (3) Under-13 signup is refused and stores no
  profile. (4) Export returns complete JSON; deletion removes all user rows within the job and is
  verified absent. (5) `sessions.page_url_hash` present, raw URL absent anywhere. (6) Image capture
  appears only when flag=`beta`, shows OCR confirmation, falls back to paste under threshold.
- **Blockers/risks:** Stripe webhook edge cases; Web Store review of capture permission.
  *Mitigation:* reconciliation cron as the safety net; keep `tabCapture` **optional** + gesture-gated +
  clearly disclosed; submit for review early in the sprint.

---

## 2.11 Open Technical Decisions (ADR Stubs)

```text
## ADR-001: Overlay rendering strategy
**Status:** Proposed
**Context:** The tutor must draw annotations registered to host-page coordinates without mutating
or colliding with the host page.
**Options considered:**
- Injected iframe overlay
- Injected closed Shadow DOM overlay
- Chrome Side Panel API
**Recommendation:** Closed Shadow DOM overlay. It gives full style isolation (no collision either
direction) AND shares the host viewport's coordinate space, which annotations require. An iframe is a
separate coordinate space (hard to anchor annotations); the Side Panel lives outside the page (cannot
annotate page content) and is reserved for the dashboard.
**Consequences:** Enables precise, non-destructive annotations and bulletproof style isolation;
forecloses simple cross-origin sandboxing that an iframe would give, so we must be disciplined about
what runs in the injected context (no secrets, minimal surface).
```

```text
## ADR-002: AI model selection and fallback
**Status:** Proposed
**Context:** We need a tutor model that follows Socratic constraints, emits clean structured JSON,
and meets a tight latency budget at sustainable cost.
**Options considered:**
- Anthropic Claude (tiered Haiku/Sonnet/Opus)
- OpenAI GPT-4o
- Google Gemini
**Recommendation:** Claude as primary, tiered by turn complexity (Haiku 4.5 default; Sonnet 4.6 /
Opus 4.8 escalation), with GPT-4o as a provider-level fallback behind a server-side router that
normalises prompt + output schema across providers.
**Consequences:** Strong instruction-following and structured output, latency/cost control via
tiering, and resilience to a single-provider outage; cost of maintaining a provider-abstraction layer
and dual prompt/eval coverage.
```

```text
## ADR-003: Voice pipeline latency optimisation
**Status:** Proposed
**Context:** Total STT→AI→TTS round-trip must stay under 2.5s to feel conversational.
**Options considered:**
- Wait for the full AI response, then synthesize TTS
- Stream the AI response and synthesize TTS sentence-by-sentence (overlap)
**Recommendation:** Streaming with sentence-level overlap — forward each completed sentence of the
"say" field to streaming TTS as it arrives, so playback begins ~1s in while later sentences generate.
**Consequences:** Achieves ~1.0–1.1s first-audio; requires a tolerant incremental JSON/sentence
parser and careful handling if a later sentence revises intent (we commit sentences as spoken).
```

```text
## ADR-004: Misconception detection approach
**Status:** Proposed
**Context:** We must classify student errors into stable, matchable categories for tracking and
resolution.
**Options considered:**
- Fixed rule-based category taxonomy
- Fully model-inferred free-form labels
- Hybrid: model classifies INTO a fixed taxonomy (+ free-text detail), fuzzy-matched
**Recommendation:** Hybrid — the model maps each error to a canonical category from a curated
taxonomy and adds a free-text description; matching uses exact category first, then pg_trgm/pgvector
fuzzy match on descriptions.
**Consequences:** Stable, analyzable categories with human-readable nuance and robust dedup; requires
maintaining the taxonomy and periodic review of unmatched/"other" labels to grow it.
```

```text
## ADR-005: Monorepo tooling
**Status:** Proposed
**Context:** We have extension + web/API + shared packages + supabase and want fast, cached
build/test across them.
**Options considered:**
- Turborepo + pnpm workspaces
- Nx
- Plain npm/pnpm workspaces (no task orchestrator)
**Recommendation:** Turborepo over pnpm workspaces. Lightweight, great caching, minimal config, and a
natural fit with Vercel; the shared learning-model/types packages benefit most from cached
build/test.
**Consequences:** Fast incremental CI and clean package boundaries; Nx's heavier generators/plugins
are foregone (acceptable at this scale), and we accept Turbo's lighter dependency-graph features.
```

```text
## ADR-006: Extension store distribution strategy
**Status:** Proposed
**Context:** V1 targets Chromium; Firefox is named as post-V1, but tooling choices affect future cost.
**Options considered:**
- Chrome Web Store only (Chrome/Edge/Brave share Chromium)
- Chrome Web Store + Firefox AMO at launch
**Recommendation:** Chrome Web Store only for V1 (covers Chrome, Edge, Brave). Because WXT supports a
Firefox target, we keep the door open without spending V1 effort on AMO review, MV3-on-Firefox
differences, and a second voice/permissions QA matrix.
**Consequences:** Fastest path to launch on the target audience's browsers; Firefox users wait until
post-V1, and we defer (but don't preclude) AMO-specific work thanks to WXT's multi-target builds.
```

---

## What is not planned (deferred to Phase 3+)

| Deferred item | Why deferred |
|---|---|
| **Firefox / AMO distribution** | V1 audience is on Chromium; AMO review + MV3 differences + a second QA matrix aren't worth V1 time. WXT keeps the path open. |
| **Diagrams, handwriting, and video capture** | Far harder recognition problem than text/LaTeX; image equations are already only *beta*. Needs a dedicated vision pipeline. |
| **Non-math subjects** | Product is deliberately math-only at V1; the curriculum graph, prompts, and evals are math-specialised. |
| **Mobile / native apps** | Product is a desktop Chromium extension; mobile browsers don't support extensions the same way. Separate surface entirely. |
| **Full IRT adaptive assessment & item bank calibration** | Requires response data we won't have at launch; V1 uses a simpler ability-ladder. Revisit once we have data. |
| **B2B / school / LMS licensing & SSO** | Explicitly out of scope; B2C freemium only. Different auth, billing, and compliance (FERPA) surface. |
| **Collaborative / multiplayer tutoring, teacher dashboards** | No B2B at V1; adds real-time infra and a second persona. |
| **Offline mode** | The tutor depends on server-side AI/STT/TTS; offline is not feasible for the core loop. |
| **CSV/zip export, self-serve consent dashboard beyond required flows** | JSON export + deletion satisfy GDPR obligations at V1; conveniences can follow. |
| **Provider self-hosting / on-device models** | Cost/latency of managed APIs is acceptable for V1; on-device is a later optimisation. |
| **Gamification, streaks, social features** | Not core to the learning-model differentiator; post-V1 retention work. |

---

*End of plan. Awaiting explicit approval before any scaffolding or implementation begins.*
