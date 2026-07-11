## ADR-044: Hardening the release candidate — CI is the audit's home, and the no-secret guarantee is proven against the built artifact

**Status:** Decided

**Context:** Sprints 11–17 made the product curriculum-complete, voice-fast, cost-
bounded, GDPR-covered, onboarded, and observable. What has **never happened** is a
formal pass that (a) proves the locked invariants hold in the *shipped* artifact and
(b) parks that proof somewhere it can't silently regress. The audit of the current
state is specific and unflattering: there is **no CI at all** — no `.github/` exists,
and every gate (`turbo run typecheck lint build test`) runs only when a human
remembers to; there is **no secret-in-bundle guard**, though "never put any key in
the extension bundle" has been a locked-architecture rule since Sprint 04 and Sprint
17 added a fourth secret (the monitoring DSN) to protect; the a11y audit runs `axe`
on exactly **three web pages** (`/login`, `/signup`, `/account`) with the contrast
rule disabled and has **zero** coverage of the extension overlay/popup — the primary
student UI and every Sprint 14/17 surface; the policy README references an RLS
coverage test **whose file may not exist**; and the manifest (`extension/wxt.config.
ts`) still carries a **dev-only** backend origin (`localhost:3000`), a **`0.0.0`**
version, **no description**, and **no reviewed permission list**. Sprint 10 targeted
WCAG AA and explicitly deferred the *formal* full audit; Sprint 16/17 added new
surfaces (`cost_ledger`, `feedback`, `telemetry_event`) and new attack surface (the
cost guard, cron auth, export/erasure, three new routes). This is the third pre-beta
gate sprint (compliance → observability → **hardening** → store), and it runs that
deferred formal audit over all of it *and builds the gate that keeps it closed*.

**Decision:** The audit is not "run some scripts once" — it is a set of **automated
gates that run on every push**, plus a **manual review that fixes one-liners in
sprint and files the rest with a reason**.

1. **CI is the audit's home.** A first GitHub Actions workflow
   (`.github/workflows/ci.yml`, the repo is on GitHub per the `gh`/PR flow) runs the
   existing `turbo` gate (typecheck · lint · build · test across all workspaces) on
   every push and PR, plus the three new jobs below. Every check this sprint hardens
   becomes a CI job so it gates every *future* push — the standing rule from here on
   is "add a job, don't rely on remembering to run it." All secrets (the three
   provider keys, the monitoring DSN, the Supabase test creds) come from **GitHub
   Actions secrets**, never inlined in the workflow.

2. **The no-secret guarantee is proven against the *built* output, not the source.**
   Source greps for `ANTHROPIC_API_KEY`/`OPENAI_API_KEY`/`ELEVENLABS_API_KEY` are
   already clean, but a source grep is necessary-not-sufficient — a key could arrive
   via an env inline at build time. The CI job builds `extension/dist/chrome-mv3`
   (the exact artifact Darcy loads unpacked) and greps the *emitted*
   `**/*.{js,html,json}` for each key's **value** (from CI env, so a genuinely leaked
   value is caught, not merely the literal name) **and** the monitoring DSN. Any hit
   fails the job. The grep lives in `scripts/check-no-secrets.mjs` so the guarantee
   is reproducible off-CI too (`node scripts/check-no-secrets.mjs`). This is the
   locked "never put any key in the extension bundle" rule made *enforceable*.

3. **A11y coverage extends to the extension, accepting jsdom's one limit.** The
   overlay renders a React tree into a shadow root; the audit adds an extension-side
   `axe` spec (jsdom, the Sprint 12 vitest setup) over the overlay's mounted tree and
   the popup — the Sprint 14 surfaces (TitleBar/Composer/InsightStrip/KickoffCard/
   Transcript/PingToasts/AnnotationLayer, as they exist), the Sprint 17 Onboarding +
   feedback affordance, and the recording/degraded/calibrating states — asserting
   **zero violations at WCAG 2.1 A/AA**. Contrast is the **one** thing jsdom cannot
   compute (the existing web spec documents this same limit): it is covered by a
   **manual pass** (`docs/a11y-contrast-audit.md`) against `/docs/brand.md`'s AA
   pairs, focused on the new Sprint 14 tag/annotation palette and the degraded/
   resting-state tokens, pass/fail recorded. The manual-contrast + jsdom-structure
   split is the standing a11y model; a real-browser (Playwright) axe run is the
   flagged escalation if a future surface ever needs true contrast automation.

4. **An RLS coverage sweep with teeth.** A single spec (`web/tests/rls-coverage.
   test.ts`, or the file the policy README already names — verified first) proves,
   against a test Supabase: for **every user-scoped table** (users, sessions,
   knowledge_nodes, misconceptions, session_interactions, reinforcement_schedule,
   feedback, telemetry_event) a second fixture user cannot read or modify the first's
   rows; for **deny-all tables** (waitlist, cost_ledger) no client key can read or
   write; and `telemetry_event` is **insert-only** (a client cannot SELECT its own
   events back), matching ADR-043. It is wired into CI, and it must **fail
   meaningfully** when a policy is dropped (spot-checked).

5. **The security review fixes one-liners in sprint and files the rest, with a
   reason.** The review sweeps RLS across all 17 migrations' tables, confirms
   `bearer.ts` + the `CRON_SECRET` cron auth **fail closed**, and cleans the manifest
   **for review** (not a rewrite): the production backend origin **added alongside**
   the dev `localhost:3000` (the config's own launch-TODO, so Darcy's dev flow is
   unchanged); a real `name`/`description`/starting `version` (e.g. `0.1.0`) instead
   of `0.0.0`; a one-line justification per permission (`activeTab`+`tabs` for the
   current-tab URL→hash, `scripting` for content-script injection, `storage`,
   `<all_urls>` for the content script); and confirmation that **no `tabCapture`**
   crept in (the beta OCR path stays deferred). Findings that are one-line fixes (a
   missing RLS policy, a droppable permission, a manifest origin) land here; anything
   larger is **filed** with an explicit defer-reason (a docs note + a spawned task),
   never silently carried. The record is `docs/security-review-sprint18.md`.

6. **This sprint hardens; Sprint 19 submits.** The store *submission* depends on
   assets that do not exist yet — a privacy page, listing screenshots, a release
   pipeline, the waitlist→invite flow — all of which are **Sprint 19**. This sprint
   deliberately builds none of them. It produces the two **prerequisites** submission
   needs: a **clean, reviewed manifest** and a **proven no-secret bundle**. The
   actual Chrome Web Store upload is out of scope here.

**Rationale:**
- A gate that runs only when remembered is not a gate. Parking each audit check in CI
  converts a one-time pass into a standing invariant — the same reason ADR-043 made
  the telemetry privacy guarantee *structural* rather than a review convention.
- Proving no-secret against the *built* artifact closes the exact gap a source grep
  leaves open (a value inlined at build) and matches how the rule is actually at
  risk; greping the artifact Darcy loads unpacked audits the thing that ships.
- Extending the *existing* axe harness rather than inventing a new one keeps the a11y
  audit cheap and consistent, and accepting jsdom's contrast limit (covered manually)
  is the same trade the web spec already documents — honest about the one thing the
  automation can't do rather than pretending it can.
- Fix-one-liners-file-the-rest keeps an audit sprint from silently ballooning into a
  remediation sprint: a genuinely beta-blocking finding (an RLS hole) is exactly what
  this gate exists to catch *before* invites, and filing-with-a-reason keeps the
  carried debt visible instead of buried.

**Consequences:**
- **Enables:** the first CI in the project — every future sprint's gates now have a
  home; a machine-checked proof that no provider key or monitoring DSN reaches the
  bundle; a11y coverage of the primary student UI for the first time; a proven RLS
  isolation sweep; and a review-ready manifest — the two things (clean manifest +
  no-secret bundle) that Sprint 19's store submission inherits as done.
- **Requires:** `.github/workflows/ci.yml` (Task 2) + `scripts/check-no-secrets.mjs`
  (Task 3); `extension/tests/a11y-overlay.test.ts` + the web axe edit +
  `docs/a11y-contrast-audit.md` (Task 4); `web/tests/rls-coverage.test.ts` + its CI
  job (Task 5); the manifest cleanup in `wxt.config.ts` + one-line security fixes +
  `docs/security-review-sprint18.md` (Task 6); `docs/qa-matrix-sprint18.md` (Task 7);
  the release-candidate sign-off (Task 8). Test Supabase creds must be added to
  GitHub Actions secrets for the RLS job.
- **Forecloses (this sprint):** the actual Chrome Web Store submission/upload and its
  assets (privacy page, listing screenshots, release pipeline, waitlist→invite) —
  **Sprint 19**; **visual-regression tooling** (Storybook/Chromatic/Percy) — Sprint
  10 flagged it as an optional maybe, deferred as post-beta tooling that plugs into
  the CI that now exists; a **full third-party pen-test** — the in-house review + RLS
  sweep + no-secret proof is the V1 bar, a formal external audit is post-GA if ever;
  and dashboard/chart-token a11y — Sprint 22's surfaces don't exist yet to audit.
- **The filed-not-fixed list is Sprint 19's pre-submission checklist** — each carried
  item recorded with a reason, the only debt this gate permits to cross the boundary.

> **Numbering note:** this ADR is **044**, the next free number at execution — the
> latest on disk was **043** (telemetry + error privacy) and no parallel track
> (Sprint 24 migration candidate, Sprint 25 landing v2) had claimed an intervening
> number, so the plan's provisional `044` holds without a renumber. See ADR-035/036
> (export/erasure + cron/URL-hashing — the review's cron-auth and RLS surface),
> ADR-041 (cost guardrail — `cost_ledger` deny-all, in the RLS sweep), ADR-043
> (telemetry insert-only + the monitoring DSN the no-secret job now covers), and
> ADR-002 (shadow-DOM overlay — the a11y surface and the untouched manifest injection
> config).
