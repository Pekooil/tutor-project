## ADR-039: In-app feedback is capture, not a ticketing system

**Status:** Decided

**Context:** During the beta we need a way for a tester to say "something's wrong"
or "rate this session" **from inside the overlay**, in the moment, without leaving
the page or filing a report elsewhere. Today there is **no feedback UI** anywhere
— the overlay and popup have none. The temptation with feedback is to grow it into
a support desk (statuses, reply threads, email, assignment). That is not what a
pre-beta gate needs, and it is not what we're building.

**Decision:** In-app feedback is **capture, not a ticketing system**: one overlay
affordance → one RLS-scoped table → manual triage.

1. **One affordance.** A small, unobtrusive "report / rate" control in the overlay
   (on `TitleBar` or `Composer`, reusing existing tokens — no new component
   system) opens a minimal popover that posts a `SEND_FEEDBACK` message to the
   background, which owns the `POST /api/feedback` call (sole egress, ADR-006).

2. **One table, Shape 2 RLS.** `feedback(id uuid pk, user_id uuid not null
   references users on delete cascade, session_id uuid null references sessions,
   kind text check in ('bug','rating','idea'), rating smallint null, message text
   null, created_at)` — `user_id`-keyed Shape 2 RLS (the caller selects/modifies
   only their own rows). `session_id` is an **optional** link to the active
   session when one exists; feedback given outside a session still records.

3. **`message` is the one deliberate user-authored free-text field this sprint.**
   Telemetry has no free-text field by construction (ADR-043); feedback
   intentionally does, because it *is* the point — it is text the user **chose** to
   write. It is RLS-scoped to that user, and it is covered by the Sprint 16 export
   and erasure paths (below). No content is captured that the user didn't type into
   this box on purpose.

4. **No PII beyond the authed `user_id`.** No email, no name, no contact field —
   triage happens against the `user_id` we already hold, not a new identity
   surface.

5. **Capture, not workflow.** No status field, no reply thread, no assignment, no
   email notification. Triage is **manual** — the maintainer reads the table. If a
   real ticketing need emerges post-beta, it reads this same table; it is not
   pre-built here.

6. **It joins the Sprint 16 data-rights paths.** The table FK-cascades to `users`
   (`on delete cascade`), so Sprint 16's erasure sweep reaches it, and it is added
   to the account **export** route. Every new user-scoped table must carry that FK
   and appear in the export (ADR-035); `feedback` does.

**Rationale:**
- The value of beta feedback is *volume and immediacy*, not workflow — a control
  the tester can hit the instant something feels wrong will surface more than a
  support desk they have to context-switch into.
- Reusing the background egress + the existing tokens means the affordance adds a
  seam, not a subsystem: same auth, same choke point, same design language.
- Making `message` the *single* free-text field, explicitly named as the one
  user-authored exception, keeps the ADR-043 "no content" guarantee crisp — there
  is exactly one place a user's words are stored, it is by their choice, and it is
  fully covered by export/erasure.
- FK-cascade + export inclusion means feedback inherits the data-rights posture
  Sprint 16 built, rather than becoming an un-erasable island of user text.

**Consequences:**
- **Enables:** an in-the-moment tester-issue inbox (Sprint 19's beta uses it as
  the tester-issue channel) with zero support-desk build.
- **Requires:** the `feedback` table in migration 0015 (Task 2, Shape 2 RLS, FK
  cascade); the `/api/feedback` route (Task 4, insert-only, RLS-scoped, no GET);
  the `SEND_FEEDBACK` message type + background handler (Task 6); the overlay
  affordance + popover (Task 7).
- **Disclosure:** the store data-safety disclosure (Sprint 19) lists the feedback
  free-text field truthfully as user-authored, RLS-scoped, export/erasure-covered.
- **Forecloses (this sprint):** any status workflow, reply thread, email, or
  ticketing UI on feedback — capture only; a viewing/triage UI beyond
  service-role/manual reads is post-beta tooling over the same table.

> **Numbering note:** this ADR keeps the plan's number **039** — it was the one
> Sprint 17 ADR number the plan chose that was still free (037/038 were taken by
> the prompt-caching track, 040/041 by landing-demo-v2 + the cost guardrail). Its
> two sibling ADRs were renumbered off the collision: cold-start-onboarding
> (plan's 037) → **ADR-042**, telemetry-and-error-privacy (plan's 038) →
> **ADR-043**. See both for the other two halves of Sprint 17.
