# Sprint 18 — Hardening: security, privacy & accessibility audit (release-candidate gate)

> **Provisional ADR/number note.** ADR numbers here are written concretely from the
> next free number at time of writing (latest on disk = ADR-043). Parallel tracks
> (Sprint 24 tutor-quality, Sprint 25 landing v2) may claim intervening
> numbers — confirm the next-free number at execution and fix references in one pass.

## Goal
Turn a working product into a **release candidate**: audited for security, privacy,
and accessibility, with the gaps that a public beta cannot ship with closed — and,
for the first time, an **automation home** so those audits stay closed. This is the
third pre-beta gate sprint (compliance → observability → **hardening** → store). By
the end:

1. **CI exists.** There is no `.github/` in the repo today; every check is a local
   `turbo`/`npm` script. This sprint creates the first CI workflow so the gates
   below actually gate, on every push — not just when someone remembers to run them.
2. **No secret can reach the extension bundle** — asserted by a build-output grep in
   CI (the Sprint-04-era intent that was never implemented), covering the three
   provider keys **and** the Sprint 17 monitoring DSN.
3. **The a11y audit reaches the surfaces that matter.** `axe-core` runs today only on
   `/login`, `/signup`, `/account` (web) with contrast disabled; the **extension
   overlay + popup** — the primary student UI, plus every Sprint 14/17 surface
   (opening scan, progress bar, insight strip, onboarding, feedback affordance) —
   have **zero** a11y coverage. This sprint extends coverage to them and does a real
   contrast pass.
4. **A security review with teeth**: an RLS coverage sweep across all 17 migrations'
   tables (including the newest `cost_ledger`/`feedback`/`telemetry_event`), a
   bearer/cron-auth review, and **the manifest cleaned for review** — the production
   backend origin added (it's still dev-only `localhost:3000`), permissions
   minimized and each justified, the placeholder `0.0.0`/no-description fixed.
5. **A cross-site QA matrix** on real math pages, exercising the degradation paths
   (Sprint 16 caps, free-tier over-limit) and the SPA re-capture fix under real DOM
   churn.
6. **The telemetry funnel actually emits.** Sprint 17 defined `turn_latency`,
   `annotation_rendered`, `voice_used`, and `degraded_hit` in the `TelemetryEvent`
   union but only `session_started`/`onboarding_completed` are ever *sent* (Sprint 17
   handoff, KEY OPEN GAP). A release candidate cannot go to beta **blind to its own
   latency and annotation-render health** — the two signals that tell you whether the
   top user complaints (slow turns, sparse annotations) are real, and the baseline the
   Sprint 24 tutor-quality work will move. This sprint wires those four kinds to emit,
   plus an annotation **rendered-vs-dropped** counter, changing **no** tutoring
   behavior.

```
CI (new .github/workflows/ci.yml)
   ├─ typecheck · lint · build · test  (turbo, all workspaces)
   ├─ no-secret-in-bundle  (grep the built extension/dist for any provider key or DSN)
   ├─ a11y  (axe over web surfaces + the extension overlay/popup + Sprint 14/17 surfaces)
   └─ rls-coverage  (every user-scoped table has its Shape-2 policies; deny-all tables have none)

manual audit
   ├─ security review  (RLS sweep, bearer + CRON_SECRET, permission minimization)
   ├─ manifest for review  (prod origin added, perms justified, name/version/description real)
   └─ cross-site QA matrix  (Khan Academy + N sites; degradation + SPA re-capture)
```

## Context
Everything the beta needs is built and bounded (Sprints 11–17: the adaptive loop,
curriculum, voice, cost guardrail, GDPR export/erasure, onboarding, telemetry,
feedback). What has **never happened** is a formal pass that (a) proves the locked
invariants hold in the shipped artifact and (b) parks that proof in CI so it can't
silently regress. The audit of the current state is specific: **no CI at all** (no
`.github/`), **no secrets-in-bundle guard**, **axe only on three web pages** with
contrast disabled and **no extension coverage**, an **RLS test whose file the policy
README references but which may not exist**, and a **manifest still carrying a
dev-only backend origin, a `0.0.0` version, no description, and no reviewed
permission list**. Sprint 10 targeted WCAG AA and Sprint 16/17 added new surfaces and
new tables; this sprint runs the *formal* audit over all of it and builds the gate.

### Decisions locked for this sprint (recorded in ADR-044)
1. **CI is the audit's home; the audit is not "run some scripts once."** Every check
   this sprint hardens becomes a CI job so it gates every future push. GitHub Actions
   (the repo is on GitHub per the `gh`/PR workflow) running the same `turbo` tasks
   plus the new grep/a11y/RLS jobs.
2. **The no-secret guarantee is proven against the built output, not the source.**
   Source greps are necessary but not sufficient (a key could arrive via an env
   inline at build); the CI job builds `extension/dist/chrome-mv3` and greps the
   *emitted* JS for any provider key value and the monitoring DSN — the real
   artifact Darcy loads unpacked.
3. **A11y coverage extends to the extension, accepting jsdom's limits.** The overlay
   renders in a shadow root; the audit runs axe against the overlay's rendered React
   tree in jsdom (structure/roles/labels/focus order) the way the web test already
   does, and does the **contrast pass manually** against the brand.md AA pairs
   (jsdom can't compute contrast — the existing web test documents this same limit).
4. **The security review fixes what it can in-sprint and files the rest, with a
   reason.** Findings that are one-line fixes (manifest origin, a missing RLS policy,
   a permission that can be dropped) land here; anything larger is filed with an
   explicit defer-reason, never silently carried.
5. **This sprint hardens; Sprint 19 submits.** The store *submission* depends on
   assets that don't exist yet (privacy page, listing screenshots, release pipeline —
   all Sprint 19). This sprint produces the *prerequisites* submission needs: a clean,
   reviewed manifest and a proven no-secret bundle. The actual upload is Sprint 19.

### Reconciliation with `/docs/PLAN.md` + prior handoffs (read before Task 1)
- **PLAN Sprint 6 / §2.7 "hardening" + Sprint 10's deferred formal AA audit.** Sprint
  10 *targeted* AA and explicitly deferred "the formal full audit ... may add
  visual-regression tooling" to a later sprint. This is that sprint (minus visual-
  regression, which stays optional — see out-of-scope).
- **Sprint 16 handoff**: "the cost guard, cron auth, and export/delete as new attack
  surface to review; the RLS sweep must include `cost_ledger` (deny-all) and confirm
  the crons' service-role use is `CRON_SECRET`-gated only." Done here.
- **Sprint 17 handoff**: "confirm no secret in the extension bundle — extend the 'no
  key in bundle' check to the monitoring key; the three new routes as attack surface;
  the telemetry union's no-content property to spot-check; the new overlay surfaces
  for the AA audit." Done here.

### The no-secret CI job greps the built artifact (read before Tasks 2, 3)
The extension talks to the backend only via `extension/src/lib/api.ts`; source greps
for `ANTHROPIC_API_KEY`/`OPENAI_API_KEY`/`ELEVENLABS_API_KEY` are already clean. The
new guard runs `wxt build`, then greps `extension/dist/chrome-mv3/**/*.js` for each
key's *value* (from CI env, so a real leaked value is caught, not just the literal
name) and for the monitoring DSN. It fails the build on any hit. This is the
locked-architecture "never put any key in the extension bundle" made enforceable.

### A11y coverage: extend the existing axe harness, don't invent one (read before Task 4)
`web/tests/axe-web-surfaces.test.ts` already spawns `next dev` and runs `axe.run`
over `/login`, `/signup`, `/account` at WCAG 2.1 A/AA (contrast disabled — jsdom).
The extension overlay/popup render React trees; the audit adds an extension-side
axe spec (jsdom, the Sprint 12 vitest setup) over the overlay's mounted tree and the
popup, covering the Sprint 14 surfaces (TitleBar/Composer/InsightStrip/KickoffCard/
Transcript/PingToasts/AnnotationLayer), the Sprint 17 Onboarding + feedback
affordance, and states (recording, degraded, calibrating). Contrast is the one thing
jsdom can't do — a manual pass against `/docs/brand.md`'s AA pairs covers the new
tokens (Sprint 14 tag/annotation palette, and confirm Sprint 22's future chart
tokens are out of scope here).

### The manifest is cleaned for review, not rewritten (read before Task 5)
`extension/wxt.config.ts` today: `permissions: [storage, activeTab, scripting, tabs]`,
`host_permissions: [<all_urls>, http://localhost:3000/*]` (dev-only), no `name`
override (derives `@calyxa/extension`), `version: 0.0.0`, no `description`, icons by
convention (`public/icon/{16,32,48,128}.png` — present). This sprint: **add** the
production backend origin alongside the dev one (the launch TODO in the config
comment), set a real `name`/`description`/starting `version`, and justify each
permission in a comment (`activeTab` + `tabs` for the current-tab URL→hash;
`scripting` for content-script injection; `storage`; `<all_urls>` for the content
script). Confirm **no `tabCapture`** crept in (the beta OCR path stays deferred).

## Execution model
A **single code session** owns this sprint end to end, worked **strictly in order
(1 → 9)**. The chain: ADR (Task 1); CI scaffold (Task 2) is the home the later jobs
plug into; the no-secret job (Task 3) needs the build wired; the a11y extension
(Task 4) and the RLS sweep (Task 5) are independent audit jobs; the security review +
manifest cleanup (Task 6) fixes findings; the cross-site QA (Task 7) is manual and
exercises the whole; the telemetry emission (Task 8) completes the Sprint 17
observability funnel so the gate can *see* latency/annotation health; the
release-candidate sign-off (Task 9) is the gate. One session — no handoff.

This sprint touches: a new `/.github/workflows/`, `web/tests/` (a11y + RLS specs),
`extension/tests/` (overlay/popup axe + telemetry emission), `extension/wxt.config.ts`
(manifest), the overlay/content telemetry-emission sites (Task 8 only), and small
fixes across whatever the security review flags (expected: a missing RLS policy, the
manifest origin, a permission comment). It does **not** change any tutoring or
learning *behavior* — the single carve-out is Task 8, which only *emits* telemetry
kinds Sprint 17 already defined (no decision logic touched) — and it does not build
store assets/submission (Sprint 19).

## Files in scope

### Task 1 (ADR + sprint pointers) creates or edits:
```
/docs/adr/ADR-044-hardening-and-ci-gate.md ← new (provisional #) — CI as the audit's home (GitHub Actions running turbo + the new jobs); the no-secret-in-bundle guarantee proven against the BUILT artifact (values from CI env, covers the 3 provider keys + the Sprint 17 monitoring DSN); a11y coverage extended to the extension overlay/popup + Sprint 14/17 surfaces (jsdom structure + manual contrast); the fix-in-sprint-or-file-with-reason discipline; submission is Sprint 19, this sprint produces its prerequisites.
/CLAUDE.md                                  ← edit one line: Current sprint → Sprint 18 — Hardening: security, privacy & accessibility audit
/docs/CLAUDE.md                             ← edit one line: Current phase → Phase 2, Sprint 18
/docs/sprint-18-plan.md                     ← this file
/docs/architecture.md                       ← edit: first CI (GitHub Actions) with the audit gates; a11y coverage now spans the extension UI; manifest cleaned for review
```

### Task 2 (CI scaffold) creates:
```
/.github/workflows/ci.yml ← new — the first CI. Jobs: (a) install + `turbo run typecheck lint build test` across workspaces (the existing local gate, now automated); (b) placeholder steps that Tasks 3–5 fill (no-secret, a11y, rls). Runs on push + PR. Node/pnpm-or-npm matching the repo. Secrets (provider keys, monitoring DSN, Supabase test creds) referenced from GitHub Actions secrets, never inlined.
```

### Task 3 (no-secret-in-bundle CI job) creates / edits:
```
/.github/workflows/ci.yml            ← edit — a job that runs `npm --prefix extension run build` then greps extension/dist/chrome-mv3/**/*.{js,html,json} for each of ANTHROPIC_API_KEY/OPENAI_API_KEY/ELEVENLABS_API_KEY (their VALUES from CI env) and the SENTRY/monitoring DSN value; ANY hit fails the job. Also greps for obvious literals as a backstop.
/scripts/check-no-secrets.mjs        ← new — the grep logic as a small script the CI job calls (also runnable locally: `node scripts/check-no-secrets.mjs`), so the guarantee is reproducible off-CI too.
```

### Task 4 (a11y coverage extension) creates / edits:
```
/extension/tests/a11y-overlay.test.ts ← new — jsdom + axe over the mounted overlay tree (Sprint 14 decomposition makes the components mountable) and the popup: roles, labels, focus order, the ↵ send button aria-label, the −/✕ controls, the progress bar's role, the Onboarding surface, the feedback affordance; asserts zero violations at WCAG 2.1 A/AA (contrast rule disabled, jsdom-limited, mirroring the web spec).
/web/tests/axe-web-surfaces.test.ts   ← edit — keep the three surfaces; add any Sprint 16/17 web surface a real user hits (the account page's new export/delete controls).
/docs/a11y-contrast-audit.md          ← new — the manual contrast pass: every new token (Sprint 14 tag/annotation palette, the degraded/resting states) checked against brand.md AA pairs, pass/fail recorded; the one place jsdom can't cover, done by hand and written down.
```

### Task 5 (RLS coverage sweep) creates / edits:
```
/web/tests/rls-coverage.test.ts ← new (or the file the policy README names, if it exists — verify first) — for EVERY user-scoped table (users, sessions, knowledge_nodes, misconceptions, session_interactions, reinforcement_schedule, feedback, telemetry_event): a second fixture user cannot read/modify the first's rows; for deny-all tables (waitlist, cost_ledger): no client key (anon or authed) can read or write; telemetry_event is insert-only (a client cannot SELECT its own events back). Runs against a test Supabase.
/.github/workflows/ci.yml       ← edit — an rls job that runs the sweep (with test Supabase creds from Actions secrets).
```

### Task 6 (security review + manifest cleanup) edits:
```
/extension/wxt.config.ts ← edit — add the PRODUCTION backend origin to host_permissions alongside the dev one (the config's own launch-TODO); set a real manifest `name` ("Calyxa — AI math tutor" or brand-approved), a `description`, and a real starting `version` (e.g. 0.1.0 for the beta) instead of 0.0.0; a one-line justification comment per permission; confirm NO tabCapture. cssInjectionMode/shadow-DOM config untouched (ADR-002).
(security-review fixes) ← edit — whatever the review finds as a one-line fix: a missing RLS policy on a table, a droppable permission, a bearer/cron-auth tightening. Each recorded. Larger findings are FILED (a docs note + a spawned task), not silently carried.
/docs/security-review-sprint18.md ← new — the review record: RLS sweep results, bearer.ts + assertCronSecret review (cron auth fails CLOSED — confirm), permission justification table, the no-secret proof, and the filed-not-fixed list with reasons.
```

### Task 7 (cross-site QA matrix — manual) creates:
```
/docs/qa-matrix-sprint18.md ← new — the manual matrix: real tutoring sessions on Khan Academy (exercising the Sprint 14 SPA re-capture-on-expand fix under client-side navigation) + 2–3 other real math sites (a static page, a MathJax page, a KaTeX page); for each, confirm overlay renders in the shadow root with no host-DOM mutation, annotations resolve or drop cleanly, the opening scan fires appropriately, and BOTH degradation paths behave: free-tier over-limit (Sprint 07/16 `degraded`) and the Sprint 16 cost hard-cap ("resting" message), verified with a temporarily low cap.
```

### Task 8 (telemetry emission — completes the Sprint 17 funnel) edits:
```
/extension/src/overlay/Overlay.tsx        ← edit — in handleMicStop, assemble the LatencyTrace across the voice legs (mic-stop → STT final → turn TTFT → first-audio) already timed in voice-timing.ts, and EMIT `turn_latency` via the Sprint-17 onSendTelemetry prop; emit `voice_used` on a completed voice turn. Emission only — no change to the turn/voice control flow.
/extension/src/overlay/voice-timing.ts    ← edit (if needed) — expose the per-leg timings the LatencyTrace needs; the sentence accumulator/timing already exists, this just surfaces the marks.
/extension/src/content/annotations.ts     ← edit — the resolver already knows which targets rendered vs dropped ("DROP, NEVER GUESS", MAX_ANNOTATIONS_PER_TURN=3); EMIT `annotation_rendered` with a rendered/dropped/requested count. THIS is the diagnostic that tells whether sparse annotations are an EMISSION problem (model under-annotates) or a RESOLUTION problem (targets drop) — the fork Sprint 24 needs answered.
/extension/src/lib/api.ts + background     ← edit — emit `degraded_hit` when a route returns `{degraded:true}` (STT/TTS/turn), reusing the Sprint-17 sendTelemetry egress. No new message types if the existing SEND_TELEMETRY path covers it.
/extension/tests/telemetry-routing.test.ts ← edit — assert all four kinds now emit with the correct TYPED shape; validateEvent still rejects any extra/free-text field (Sprint 17 no-content invariant); a completed voice turn produces turn_latency + voice_used, an annotated turn produces annotation_rendered with counts.
```
NOTE: this is the one Task that touches overlay/content product code. It is scoped to
**emission of already-defined telemetry** — zero change to tutoring, grading, annotation
selection, or the voice pipeline's behavior. It exists because a release candidate must
not be signed off blind to its own latency/annotation health (Sprint 17 KEY OPEN GAP).

### Files explicitly out of scope
```
Product features / AI / learning BEHAVIOR   (audit + gate sprint; Task 8's telemetry EMISSION is the sole product-code carve-out, and it changes no behavior)
Fixing latency / annotation frequency / correctness itself  (Task 8 only MEASURES them; the fixes are Sprint 19 cheap-wins + Sprint 24 tutor-quality)
Store listing assets, privacy page, wxt zip/release, waitlist→invite  (Sprint 19)
Visual-regression tooling (Storybook/Chromatic/Percy)  (optional, deferred — see below)
/web/components/marketing/**             (Sprint 25's landing v2 owns marketing surfaces; audit them only for gross a11y, don't restyle)
Dashboard / chart tokens                 (Sprint 22 — its surfaces don't exist yet to audit)
```
Also out of scope (no pre-empting later roadmap sprints):
- **The actual Chrome Web Store submission + upload** — Sprint 19 (needs the privacy
  page + listing assets + release pipeline this sprint deliberately does not build).
- **Visual-regression screenshots over `/packages/ui`** — Sprint 10 flagged it as a
  *maybe*; deferred as optional post-beta tooling, not a beta gate.
- **A full pen-test / third-party security audit** — the in-house review + RLS sweep +
  no-secret proof is the V1 bar; a formal external audit is post-GA if ever.

Do not create any file not listed above. If something seems needed but is not listed,
add it to "What the next sprint needs to know" and ask before creating it.

---

## Task 1 — Hardening + CI-gate ADR + sprint pointers (planning / docs)
Write ADR-044 in the project format (match ADR-001…ADR-043). Fix the CI-as-home
decision, the built-artifact no-secret proof, the extension a11y coverage + manual
contrast, and the fix-or-file discipline. Update pointers + architecture.md.

Acceptance gate before Task 2:
  - ADR reads as a decision; the "submission is Sprint 19" boundary is explicit; no
    code touched.

## Task 2 — CI scaffold (GitHub Actions)
Scope: `/.github/workflows/ci.yml` running the existing `turbo` gate on push/PR, with
placeholder jobs for Tasks 3–5. Secrets from Actions, never inlined.

Acceptance gate before Task 3:
  - CI green on a no-op PR running the full turbo gate; the workflow is the home the
    next jobs plug into.

## Task 3 — No-secret-in-bundle CI job
Scope: `scripts/check-no-secrets.mjs` + the CI job. Greps the BUILT extension output
for the three key values + the monitoring DSN.

Acceptance gate before Task 4:
  - A deliberately planted key value in the bundle fails the job; a clean build passes;
    the script runs locally too.

## Task 4 — A11y coverage extension
Scope: `extension/tests/a11y-overlay.test.ts` + the web spec edit + the manual
contrast doc. Zero axe violations on the extension surfaces (contrast disabled in
jsdom, done manually).

Acceptance gate before Task 5:
  - The overlay + popup + Onboarding + feedback affordance pass axe A/AA in jsdom; the
    contrast doc records a pass on every new token against brand.md pairs.

## Task 5 — RLS coverage sweep
Scope: `web/tests/rls-coverage.test.ts` + the CI job. Every user-scoped table proven
isolated; deny-all tables proven closed; telemetry insert-only proven.

Acceptance gate before Task 6:
  - The sweep passes and fails meaningfully when a policy is removed (spot-check by
    dropping one); wired into CI.

## Task 6 — Security review + manifest cleanup
Scope: `wxt.config.ts` + review fixes + the review doc. Manifest cleaned for review;
one-line findings fixed; larger ones filed with reasons.

Acceptance gate before Task 7:
  - The manifest carries the prod origin, a real name/description/version, justified
    permissions, no tabCapture; the review doc records the RLS/bearer/cron results and
    the filed-not-fixed list.

## Task 7 — Cross-site QA matrix (manual)
Scope: `docs/qa-matrix-sprint18.md`. Real sessions on ≥3 real math sites; both
degradation paths exercised; SPA re-capture confirmed.

Acceptance gate before Task 8:
  - Every matrix row passes or has a filed follow-up; no host-DOM mutation observed;
    both degradation paths behave gracefully.

## Task 8 — Telemetry emission (completes the Sprint 17 funnel)
Scope: wire the four defined-but-never-emitted telemetry kinds — `turn_latency`,
`annotation_rendered`, `voice_used`, `degraded_hit` — to actually emit, plus an
annotation rendered-vs-dropped counter (see the Task 8 file block). Emission only;
no tutoring/learning/voice **behavior** changes. This turns the Sprint 17 funnel from
"union defined" into "signal flowing," so the RC sign-off (and the Sprint 24
tutor-quality baseline) can see real latency and annotation-render rates instead of
guessing.

Rationale for its inclusion in an audit sprint: a release candidate cannot be
responsibly signed off while blind to the two metrics behind the top user
complaints. This is completing observability, not adding a feature.

Acceptance gate before Task 9:
  - A real voice turn emits `turn_latency` (full leg breakdown) + `voice_used`; an
    annotated turn emits `annotation_rendered` with rendered/dropped/requested counts;
    a capped route emits `degraded_hit`; `validateEvent` still rejects any extra or
    free-text field (Sprint 17 no-content invariant); no change to any turn's behavior.

## Task 9 — Release-candidate sign-off
Scope: confirm all CI jobs green, all audit docs complete, all one-line findings
fixed, and the four telemetry kinds emitting (Task 8). This is the gate into Sprint 19
(store + distribution).

Acceptance gate (sprint close):
  - `turbo run typecheck lint build test` + the new CI jobs all green; a11y/security/
    QA docs complete; the manifest is review-ready; the four telemetry kinds emit with
    typed no-content shape; the filed-not-fixed list is the only carried debt, each
    item with a reason.

## Acceptance criteria (full checklist)
- [ ] ADR-044 written; pointers + architecture.md updated
- [ ] First CI (GitHub Actions) runs the full turbo gate on push/PR
- [ ] No-secret-in-bundle CI job greps the BUILT extension for the 3 provider keys + monitoring DSN; a planted value fails it
- [ ] Extension overlay + popup + Sprint 14/17 surfaces pass axe A/AA (jsdom); manual contrast pass recorded against brand.md AA pairs
- [ ] RLS coverage sweep: every user-scoped table isolated, deny-all tables closed, telemetry_event insert-only — in CI
- [ ] Manifest: production backend origin added, real name/description/version, justified permissions, no tabCapture
- [ ] Security review doc: RLS + bearer + cron-auth results, permission table, filed-not-fixed list with reasons
- [ ] Cross-site QA matrix passed on ≥3 real math sites; both degradation paths exercised; SPA re-capture confirmed; no host-DOM mutation
- [ ] Telemetry emission: `turn_latency`, `annotation_rendered` (with rendered/dropped counts), `voice_used`, `degraded_hit` all emit on a real turn, typed + no-content; no tutoring behavior change
- [ ] `turbo run typecheck lint build test` + all CI jobs green

## Risks
**The audit finds a large problem late.** Mitigation: the review fixes one-liners in
sprint and *files* larger findings with a reason rather than expanding scope
mid-sprint; a genuinely beta-blocking finding (e.g. an RLS hole) is exactly what this
gate exists to catch before invites — better late here than in the wild.

**jsdom can't prove contrast, so the a11y "pass" is partial.** Mitigation: this is
the same documented limit the existing web axe test carries; the manual contrast pass
(recorded in a doc) covers exactly the gap, focused on the new tokens; if it ever
needs to be automated, a real-browser axe run (Playwright) is the follow-up, flagged.

**CI secrets handling introduces its own leak.** Mitigation: all secrets come from
GitHub Actions secrets, never inlined in the workflow; the no-secret job itself would
catch a key that reached the bundle; the workflow is reviewed as part of Task 6.

**Adding the production origin to the manifest breaks the dev flow.** Mitigation: the
prod origin is *added alongside* the dev `localhost:3000` (the config comment's own
intent), not replacing it; Darcy's `dist/chrome-mv3` test flow is unchanged; Task 7
confirms a real session still works.

**The RLS sweep needs a live test Supabase and is flaky in CI.** Mitigation: it uses
dedicated fixture users with teardown (the Sprint 12/13 test discipline); if hosted-
Supabase flakiness bites CI, the job can run against a local `supabase start` in the
workflow — recorded as the fallback.

## What the next sprint needs to know
**The product is audited and the gates are automated.** CI runs the turbo gate + a
no-secret-in-bundle proof + extension a11y + an RLS coverage sweep on every push; the
manifest is cleaned for review (prod origin, real name/version/description, justified
permissions); the security + a11y + QA records exist.

- **Sprint 19 (store + beta distribution)** inherits: a **review-ready manifest** and a
  **proven no-secret bundle** — the two things store submission depends on — so it can
  focus on the assets it must still build (privacy page, listing screenshots, release
  pipeline, waitlist→invite). The filed-not-fixed list is its pre-submission checklist.
  It also inherits the newly-live telemetry funnel and, in its Task 8, the **cheap
  beta-readiness latency fixes** (mic cold-start, text streaming, history window).
- **The telemetry funnel now emits** `turn_latency` + `annotation_rendered` (with
  drop counts) + `voice_used` + `degraded_hit`. This is the **baseline** Sprint 24's
  tutor-quality work reads to decide whether sparse annotations are an emission or a
  resolution problem, and to measure the latency/correctness fixes against real numbers.
- **The CI home** is now where every future sprint's gates live — add a job, don't
  rely on "remember to run it."
- **Visual-regression tooling** stays deliberately unbuilt; if a UI-heavy sprint wants
  it, it plugs into the CI that now exists.
- **The manual-contrast + jsdom-a11y split** is the standing a11y model — a real-
  browser axe run is the escalation if a future surface needs true contrast automation.
