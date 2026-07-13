## ADR-045: The beta ships unlisted and invite-gated — the release pipeline is versioned and rollback-first, and access rests on an invite claim, not link secrecy

**Status:** Decided

**Context:** Sprint 18 produced a **release candidate**: a review-ready manifest and a
machine-proven no-secret bundle (ADR-044). What stands between that candidate and a
tester actually using Calyxa is entirely **packaging + distribution**, and the audit of
that surface is stark. There is **no release automation** — `wxt zip` exists but is
unwired; the extension is built by hand to `dist/chrome-mv3` (a frozen snapshot per the
locked build rule), with no versioned artifact and no way back if a bad build ships.
There is **no distribution channel** — nothing is on the Chrome Web Store. And there is
**no invite mechanism at all**: Sprint 20's `waitlist` table is `{id, email, source,
created_at}` (migration 0012) with a POST-only capture route (`/api/waitlist`) — deny-all
to clients (Shape 3), no `invited_at`, no cohort, no claim, no send. PLAN §2.11 / ADR-006
locked "**Chrome Web Store only for V1**" (Firefox/AMO deferred). The product is used by
minors, so *who* gets in must be bounded, not open. This is the final pre-beta gate
sprint (compliance → observability → hardening → **store/distribution**); it turns the
candidate into an installed, invite-gated beta and builds the waitlist → invite pipeline
that converts Sprint 20's collected emails into installs.

**Decision:** The beta is **unlisted, invite-gated, and rollback-first**. Distribution
control does **not** rest on the install link being secret; it rests on an **invite claim
checked at signup**.

1. **Unlisted Chrome Web Store item, not a public listing.** Per ADR-006 / PLAN §2.11,
   the beta ships as an **unlisted** CWS item: installable only via a direct link handed
   to invited testers, discoverable by no one, no separate infrastructure stood up. WXT's
   multi-target build keeps the Firefox door open at zero V1 cost — unused here (out of
   scope). Going **public** (flip visibility, drop the invite gate, add paid acquisition)
   is a deliberate post-beta decision, not this sprint.

2. **The invite claim is the access gate — the link is not.** An unlisted item hides
   from search, but its install link is **shareable**, so distribution control cannot
   rest on link secrecy. The gate is at **signup**: the signup route checks the email
   against **invited `waitlist` rows** (or a valid `invite_code`) and, for an uninvited
   email, returns a **soft "you're on the waitlist, we'll email you" state — HTTP 200, no
   auth user created, no profile row, no email retained** — mirroring the age-gate's
   existing no-retention discipline (`web/app/api/auth/signup/route.ts`). Invited →
   proceed exactly as today. A leaked link therefore *installs* the extension but cannot
   *onboard* an uninvited email; the soft state converts a leaker into a waitlist signup
   rather than turning them away. **Install is open-via-link; use is invite-gated.**

3. **The waitlist stays anonymous / deny-all; invite state is additive columns.** The
   invite mechanism does **not** create a new user-scoped table and does **not** make
   `waitlist` user-scoped. It **adds columns** to the existing table — `invited_at
   timestamptz null`, `invite_code text null` (unique where not null), `cohort text null`
   — written **only** by a service-role admin path. `waitlist` remains **Shape 3**
   (deny-all to clients, service-role-only), and — because a pre-signup email is **not a
   user** — the invite columns take **no FK-to-users** (the Sprint 16 "every new
   user-scoped table FK-cascades to users + joins the export route" rule does not apply;
   these rows are anonymous, not user data). The signup-time allowlist check reads the
   table via the **service-role client**, exactly as the age gate already does. No
   RLS-shape change. Cohort management is a service-role admin action: select a batch of
   `waitlist` rows → set `invited_at` + generate `invite_code` → hand out the link + code.

4. **The release pipeline is scripted, versioned, and rollback-first.** `wxt zip` is
   wired into a repeatable `release` script that builds and zips a **versioned**
   artifact into a predictable, addressable path (`extension/release/calyxa-<version>.zip`);
   the **last N artifacts stay addressable** so a bad beta build is rolled back by
   re-uploading the prior one. The **Sprint 18 no-secret gate runs on the exact zipped
   artifact** before upload (`node scripts/check-no-secrets.mjs` against the build the zip
   contains), so the proof covers the bytes that ship. The human steps — bump version →
   `npm run -w extension release` → no-secret gate on the zip → upload to the CWS
   dashboard as **unlisted** → record the version + rollback pointer — live in
   `docs/release-runbook.md`, the standing path for every future extension update.

5. **Email sending is the one new external capability, and it is server-only + guarded.**
   Nothing in the repo sends application email today (Supabase Auth handles its own
   transactional mail; the waitlist route only captures). The invite notification needs a
   send path: `web/lib/email/invite.ts` `sendInvite(email, code, storeLink)`, called
   **only** from the service-role, **admin/`CRON_SECRET`-guarded** `POST /api/admin/invite`
   route. The path is **Supabase Auth's invite/magic-link if it fits, else a minimal
   transactional provider** called from that one server route. Its credential is
   **server-only** — the Sprint 18 no-secret bundle gate already covers it — and an
   **absent credential no-ops (logs, never throws)**, so dev is safe. The route also
   supports a **manual-send batch**: `send: false` returns the cohort (emails + codes +
   link) for Darcy to send by hand, so the first cohort can go out without wiring a
   provider at all. Send is a **bounded cohort**, never open signup, so the spam/abuse
   surface stays small.

6. **Submission starts as soon as the listing assets exist (mid-sprint).** CWS review
   latency — especially for a broad-host-permission (`<all_urls>`) extension — is the
   sprint's **long pole**, so the unlisted item is uploaded the moment Tasks 2–3 land (a
   buildable zip + a hosted `/privacy` URL + the data-safety form), and the invite
   pipeline (Tasks 4–6) is built **in parallel** while review runs. If review pushes back
   on `<all_urls>`, the manifest justification is documented (Sprint 18) and
   `activeTab`-narrowing is the recorded fallback.

**Rationale:**
- **Gating at signup, not at the link, is the only gate that actually holds.** An
  unlisted link is a discovery control, not an access control — it is shareable by
  design. Putting the gate on the invited-email check means the cohort is bounded even
  when the link leaks, and reuses the waitlist we already have as the allowlist rather
  than inventing an access table.
- **Additive columns on the deny-all waitlist keep the privacy posture intact.** The
  emails are anonymous pre-signup data; making them user-scoped (FK-to-users, export
  join) would be *wrong* — they aren't users yet. Deny-all + service-role writes is the
  same shape the table already has; the invite mechanism inherits it rather than opening
  a new surface.
- **Versioned + rollback-first is the cheap insurance a beta needs.** The whole point of
  a controlled channel is being able to pull a bad build; keeping the last N artifacts
  addressable makes rollback "re-upload the prior zip," and running the no-secret gate on
  the *exact zip* proves the shipped bytes, not merely the source.
- **A guarded, no-op-on-absent send path keeps a new failure surface bounded.** Send is
  service-role + admin/CRON-guarded and defaults to a manual batch, so the first cohort
  ships without standing up email infrastructure, and a missing credential degrades to a
  no-op instead of a boot failure — the same absent-tolerant discipline as ADR-043's DSN.

**Consequences:**
- **Enables:** a **versioned, rollback-able release artifact** (the standing path for
  every future update); an **unlisted, invite-gated beta** installable only by invited
  testers; the **waitlist-as-allowlist** with an invite send path; and **submission
  in-flight** while the invite pipeline finishes — i.e. Calyxa in beta testers' browsers.
- **Requires:** the `zip`/`release` scripts in `extension/package.json` + a version bump
  in `wxt.config.ts` + `docs/release-runbook.md` (Task 2); the additive
  `waitlist` invite migration (Task 4 — number confirmed at execution: **0018 is already
  taken by `0018_rate_limit.sql`, so this migration is `0019_waitlist_invite.sql`**);
  `POST /api/admin/invite` + `POST /api/invite/claim` + the signup allowlist edit
  (Task 5); `web/lib/email/invite.ts` + the admin-route send wiring (Task 6); listing
  assets + the unlisted upload (Task 7). Store submission needs a hosted `/privacy` URL
  (ADR-046).
- **Forecloses (this sprint):** a **public (listed) store presence + open signups** —
  the beta is unlisted + invite-gated, going public is post-beta; a **full email/CRM
  system** — invite send is minimal (Supabase invite or one transactional call, manual
  batch supported), marketing email is not built; **billing/entitlements** (Sprint 23,
  the beta is free); **Firefox/AMO packaging** (V1 deferred; WXT keeps the door open,
  unused). The **unlisted → public transition** and **paid acquisition** are future
  decisions — the invite allowlist is the throttle until then.
- **Disclosure:** the invite columns are anonymous pre-signup data and stay off the
  user-scoped export/erasure paths **by design** — this is the one place the "new table
  joins the export" rule deliberately does not apply, recorded here so a future audit
  doesn't read it as an omission.

> **Numbering note:** this ADR is **045**, the next free number at execution — the latest
> on disk was **044** (hardening + CI gate) and no parallel track (Sprint 22/23/24/25) had
> claimed 045/046, so the plan's provisional numbers hold without a renumber. Task-4's
> migration is renumbered from the plan's `0018` to **`0019`** because `0018_rate_limit.sql`
> already exists (the Sprint 18 public-endpoint rate-limiting carry-forward landed first).
> See ADR-006/PLAN §2.11 (CWS-only for V1 — the channel this implements), ADR-044 (the
> review-ready manifest + no-secret bundle this inherits and the release gate re-runs),
> ADR-046 (the `/privacy` page + data-safety disclosure the submission requires), and
> ADR-035/036 (export/erasure + URL hashing — the collection surface the disclosure
> enumerates). ADR-011 (audio never persisted) is unchanged.
