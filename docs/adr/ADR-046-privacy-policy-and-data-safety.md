## ADR-046: The privacy page and the Chrome data-safety disclosure are generated from the actual collection surface — truthful by construction

**Status:** Decided

**Context:** A hosted **privacy policy page is a hard Chrome Web Store requirement**, and
the CWS **data-safety form** must declare exactly what data the extension collects, why,
whether it's shared, whether it's encrypted in transit, and how a user deletes it. Calyxa
has **neither** today: there is no `/privacy` route, no `/terms`, and no data-safety
source doc. The product is used by minors, so the disclosure has to be **exactly right** —
nothing declared that isn't collected, nothing collected omitted — and it has to stay
right as later sprints add collection. The collection surface is knowable precisely
because Sprints 03/16/17 built it deliberately, and it was **verified against the code**
for this ADR (migrations `0001`–`0017`, the signup route, and the telemetry/feedback
tables), not recalled:

| What | Where | Notes |
|---|---|---|
| **Email + password** | Supabase Auth; `waitlist.email` pre-signup | Auth is Supabase-managed; waitlist email is anonymous until signup |
| **Birth year + `age_verified`** | `users.birth_year` (signup age gate) | Year only, for the min-age gate — not a full DOB |
| **GDPR consent stamp** | `users.gdpr_consent_at` + `gdpr_consent_version` | Timestamp + version of the consent accepted |
| **Learning profile** | `knowledge_nodes`, `misconceptions`, `reinforcement_schedule` | FSRS mastery state, misconceptions, review schedule |
| **Session transcripts (text)** | `session_interactions` | The student's typed turns + the tutor's replies — **text only, NO audio** (ADR-011) |
| **Hashed page identifiers** | `sessions.page_url_hash` | HMAC-SHA256(domain, server-only salt); plaintext domain no longer written (ADR-036) |
| **Telemetry (typed, no content)** | `telemetry_event` | A closed typed union — latency/counts/kinds, **no free-text, no URL, no audio** (ADR-043) |
| **Feedback** | `feedback` | The ONE deliberate user-authored free-text field (ADR-039), user-chosen |
| **(operational, not user data)** | `cost_ledger` (day-keyed, anonymous), `waitlist` invite columns (anonymous pre-signup) | Deny-all; not tied to a user identity |

**Audio is never collected** (ADR-011: real-time STT streaming only, never persisted).
**No API keys ship in the extension** (ADR-044). Export + two-phase erasure already exist
(ADR-035) and are reachable from the account page.

**Decision:** The `/privacy` page and the data-safety disclosure are **generated from that
enumeration** and cross-checked against Sprints 16/17 code — **truthful by construction**,
not by after-the-fact review.

1. **`/privacy` (public, server component, marketing token system).** A hosted policy
   that enumerates **exactly the table above**: what is collected, **why** (tutoring +
   the adaptive model + beta observability + support), **retention** (persisted until the
   user deletes; audio never persisted; telemetry content-free), and the **disciplines
   that bound it** — *audio is never stored*, *page identifiers are hashed at rest*,
   *telemetry carries no content by construction*, *no keys in the client*. It states the
   **export + delete rights** (ADR-035) and **links to the account page** where the user
   exercises them. It is rendered in the **marketing token system** (`@calyxa/ui` /
   `/docs/brand.md`), a server component, and is **public — no auth**.

2. **`/terms` (public, same tokens).** Minimal beta terms: a **beta disclaimer**
   (pre-release, may change/break), **acceptable use**, and **no warranty**. Same token
   system, same public treatment.

3. **Both pages are public — added to the public-path allowlist.** `/privacy` and `/terms`
   join the no-auth public paths **the same way `/api/waitlist` was made public in
   Sprint 20** (`web/proxy.ts` / the public-path list) — the CWS reviewer and any tester
   must reach `/privacy` without an account.

4. **`docs/data-safety-disclosure.md` is the CWS-form source of truth.** It records the
   **exact answers** Darcy transcribes into the Chrome data-safety form: data **types**
   (the table above), **purposes** (app functionality + personalization + analytics +
   support — never advertising, never sold), **sharing** (not shared with third parties;
   the AI/STT/TTS providers are **processors** under Calyxa's server-side proxy, not
   independent recipients, and receive **no audio at rest** and **no keys in the client**),
   **encryption in transit** (HTTPS/TLS to the Vercel backend and Supabase), and the
   **deletion mechanism** (the account page's export/erasure, ADR-035). It **maps 1:1** to
   the collection surface — the doc, `/privacy`, and the actual tables must agree.

5. **The disclosure is load-bearing and must move with the code.** Any **future
   collection change** — Sprint 21 study-materials artifacts, Sprint 23 billing/Stripe
   customer data — **MUST update `/privacy` + `docs/data-safety-disclosure.md` + the CWS
   form before it ships to beta users.** This is recorded in the handoff so the coupling
   isn't silently broken.

**Rationale:**
- **Generating the disclosure from the enumerated tables — not from memory — is what makes
  it truthful.** The failure mode for a data-safety form is drift: a field gets added, the
  form doesn't. Anchoring `/privacy` and the form to a verified table (and asserting they
  map 1:1) makes the truthful version the *only* version that type-checks against reality.
- **The hashing / no-audio / content-free disciplines are the disclosure's strongest
  claims**, and they're already structural (ADR-011/036/043), so the policy can state them
  as guarantees rather than intentions.
- **Public, no-auth pages are a store hard requirement** — a reviewer reaches `/privacy`
  before installing anything — so reusing the Sprint 20 public-path seam is the minimal
  correct change.
- **Naming the providers as processors, not recipients**, is the honest framing: they run
  under the server-side proxy, get no audio at rest and no client keys, and the user's
  data isn't *shared* in the data-safety sense — it's *processed* to deliver the tutor.

**Consequences:**
- **Enables:** the two things store submission is blocked on today — a **hosted privacy
  policy URL** and a **truthful data-safety form source** — plus public `/terms`; together
  they unblock the Task-7 unlisted upload (ADR-045).
- **Requires:** `web/app/privacy/page.tsx` + `web/app/terms/page.tsx` + the public-path
  edit in `web/proxy.ts` + `docs/data-safety-disclosure.md` (all Task 3). The page links
  to the existing account export/erasure surface (ADR-035); no new collection, no new
  route beyond the two pages.
- **Forecloses (this sprint):** a **full legal/ToS review** (this is a beta disclaimer +
  a truthful disclosure, not counsel-drafted terms — a pre-GA item if ever); a
  **cookie/consent-banner system** (the marketing site sets no tracking cookies; GDPR
  consent is captured at signup, ADR-035, not via a banner); and **per-jurisdiction
  policy variants** (one honest global policy for V1 beta).
- **Disclosure:** the disclosure is now a **standing coupling** — the "any new collection
  updates both" rule is the maintenance contract, flagged for Sprints 21/23.

> **Numbering note:** this ADR is **046**, paired with ADR-045 (beta distribution) as the
> two Sprint 19 planning ADRs — latest on disk was 044, no parallel track claimed 045/046.
> See ADR-035 (export + two-phase erasure — the rights this page links), ADR-036 (URL
> hashing at rest — the hashed-page-id claim), ADR-043 (telemetry content-free by
> construction — the no-content telemetry claim), ADR-039 (feedback = the one user-authored
> free-text field), ADR-011 (audio never persisted — the no-audio claim), and ADR-045 (the
> unlisted submission this unblocks).
