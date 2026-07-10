## ADR-043: Telemetry + error monitoring are content-free by construction

**Status:** Decided

**Context:** The beta needs to be **observable to us** without asking a single
tester to file a report — and it currently isn't. There is **no error
monitoring** in the project (only `console.error`, ephemeral to server logs),
**no product telemetry** (the learning-model "pings" are in-UI toasts, not
metrics), and the Sprint 15 `LatencyTrace` (`web/lib/voice/latency.ts`, carrying
`sttMs/aiMs/ttsMs/networkMs/totalMs`) is computed on every turn but **never sent
anywhere**. Adding observability to a tutoring product used by minors is exactly
the place where a naive implementation leaks content: an error report that
carries the tutor's reply, a telemetry event that "just adds a note field" with
the student's question, a stack trace that embeds the page URL. The background
service worker is the project's **sole network-egress context** (ADR-006), and
Sprint 16 already set the privacy posture (URL hashing at rest, RLS-scoped
export/erasure). This ADR extends that posture to the new observability streams.

**Decision:** Telemetry and error monitoring are **content-free by construction,
not by review** — the data shapes are built so that attaching content is a type
error, not a policy violation.

1. **Telemetry is a typed discriminated union with no free-text field.**
   `web/lib/telemetry/events.ts` defines `TelemetryEvent` as a closed union of
   typed shapes — e.g. `{ kind: 'onboarding_completed', itemCount, ms }`,
   `{ kind: 'session_started', mode }`, `{ kind: 'turn_latency', sttMs, aiMs,
   ttsMs, totalMs }`, `{ kind: 'annotation_rendered', count, fallback }`,
   `{ kind: 'voice_used', … }`, `{ kind: 'degraded_hit', … }`. **No variant
   carries a string the user typed or the tutor said, a page URL, or audio.** A
   future contributor literally cannot attach a transcript without changing the
   type — and `validateEvent()` + the `/api/telemetry` route validate each event
   against the union and **reject unknown shapes**, so an event carrying an
   unexpected string field is refused at the boundary. A test fails the build if a
   free-text field is added to the union. This is the privacy guarantee, and it is
   **structural**.

2. **`LatencyTrace` is the first real sink for the per-leg numbers.** The Sprint
   15 trace (`sttMs/aiMs/ttsMs/networkMs/totalMs`) maps directly onto the
   `turn_latency` event — the numbers that were computed-then-dropped now flow to
   the `telemetry_event` table.

3. **Error monitoring scrubs *before* it sends.** The monitoring SDK's
   `beforeSend` (`web/lib/monitoring/init.ts`) strips message bodies, any
   `say`/transcript/student-text field, and page content/URLs, keeping only
   **stack traces + route/handler names + a coarse user id at most**. The tutor's
   reply is already persisted where it belongs (`session_interactions`), so error
   logs never become a second, unscrubbed copy of content. A missing DSN is a
   **no-op**, never a boot failure — absent-tolerant by design.

4. **The extension bundle holds no monitoring secret.** Per the locked "no key in
   the extension bundle" rule, the extension either uses a **public DSN** or
   (preferred) **relays scrubbed errors through `POST /api/errors`** — the
   background worker forwards a scrubbed error shape and the server relays it to
   the sink. The Sprint 18 "no key in bundle" CI check is extended to cover the
   monitoring key.

5. **All three streams route through the background worker (ADR-006).** The
   overlay and content script never talk to the network directly; they post
   messages to the background, which owns the `/api/telemetry`, `/api/errors`, and
   `/api/feedback` calls. Telemetry is **batched** (flush on N events / on
   interval) to avoid a request per event, and telemetry failures are **swallowed**
   — a lost telemetry event never affects the user.

6. **The `telemetry_event` table is insert-only from the owner; reads are
   service-role.** Shape 2 RLS (`user_id`-keyed) but the client may only insert its
   own events, never read the aggregate; analysis reads happen via service-role
   queries. `user_id` comes from the authed session, **never from the body**. No
   audio, no `say`/student text, no raw domain — only Sprint 16's URL hash if a
   page dimension is ever needed, and it isn't this sprint.

**Rationale:**
- A guarantee enforced by a *type* survives contributor churn in a way a code-
  review convention does not — "there is no field to put a transcript in" is a
  stronger promise than "please don't put a transcript here."
- Scrubbing at `beforeSend` means the scrub is one auditable function, not a rule
  each error site must remember; the SDK cannot ship content because the content
  never reaches the wire.
- Routing through the background reuses the one egress seam we already trust
  (ADR-006), so the new streams inherit its auth and its single-choke-point
  auditability rather than opening three new network surfaces in the overlay.
- Batching + swallowed failures keep telemetry off the user's hot path entirely:
  it is our tooling input, never a dependency of a working turn.

**Consequences:**
- **Enables:** a beta health signal (onboarding-completion rate, first-session
  rate, per-leg latency, degraded-hit rate) and scrubbed crash reporting across
  web API + background + content — the first external observability in the project.
- **Requires:** `telemetry/events.ts` + the `/api/telemetry` route (Task 4); the
  monitoring SDK deps + `monitoring/init.ts` + the framework instrumentation hook
  + `/api/errors` relay (Task 5); the extension's `monitoring.ts` + the background
  batching/egress + the new `SEND_TELEMETRY`/`LOG_ERROR` message types (Task 6).
- **Forecloses (this sprint):** a product-analytics **viewing UI** — telemetry
  lands in a table read by service-role queries; a dashboard is post-beta tooling
  (it reads the same table). Session-replay, funnels-as-a-service, and third-party
  product analytics are out; the typed table is the V1 surface.
- **Disclosure:** the store data-safety disclosure (Sprint 19) must list telemetry
  collection truthfully — the typed union is the exact scope, and it carries no
  content by construction.

> **Numbering note:** this ADR is the plan's **ADR-038**, renumbered to **043**
> because 038 was already taken by the reopen-Anthropic-only ADR from the
> prompt-caching track (and 040/041 by landing-demo-v2 + the cost guardrail).
> Sprint 17's three ADRs are **042** (cold-start onboarding), **043** (this,
> telemetry + error privacy), and **039** (in-app feedback — the one plan number
> still free). The **one** deliberate user-authored free-text field this sprint is
> ADR-039's `feedback.message`, not telemetry — feedback the user chose to write,
> RLS-scoped, export/erasure-covered. See ADR-042 and ADR-039.
