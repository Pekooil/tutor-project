# Sprint 19 — Store packaging + private beta distribution 🚀 (distribute after this sprint)

> **This sprint replaced the earlier `sprint-19` prompt-caching cost proposal**
> (Darcy's call, 2026-07-09 — "overwrite 19 with Store+Beta"). That proposal
> self-labelled "renumber to fit your roadmap" and is already superseded by shipped
> work: prompt caching landed as `e9cb3bf feat: enabled prompt caching` +
> `docs/adr/ADR-037-prompt-caching-tutor-prefix.md`. Sprint 24 (now the tutor-quality
> sprint, no longer the GPT-4o-mini migration candidate) that cross-referenced the old
> sprint-19 should be repointed at that caching commit/ADR instead of this file.
>
> **Task 8 added (2026-07-10):** the cheap pre-beta latency + history-window fixes now
> gate distribution — see Task 8. These are the beta-readiness slice of the tutor-fix
> program (measure = Sprint 18 Task 8; deep model work = Sprint 24).
>
> **Provisional ADR numbers** (latest on disk = ADR-043; parallel tracks 24/25 may
> claim intervening numbers — confirm next-free at execution).

## Goal
Get Calyxa **into beta testers' browsers** — packaged, listed, and distributed
through a controlled channel — and build the **waitlist → invite pipeline** that
turns Sprint 20's collected emails into actual installs. This is the final pre-beta
gate sprint. By the end:

1. **A release pipeline exists.** `wxt zip` (unwired today) is scripted into a
   repeatable, versioned build → uploadable artifact, with a documented rollback
   (keep the last N builds addressable).
2. **A Chrome Web Store listing** is assembled from the brand system: the missing
   **privacy policy page** (`/privacy`, a hard store requirement), the **data-safety
   disclosures** that truthfully match what Sprints 16/17 collect, listing copy, and
   screenshots — the icons already exist.
3. **A private/unlisted distribution channel** so only invited testers meaningfully
   use it (the ADR-006/PLAN §2.11 "Chrome Web Store only for V1" call — unlisted, not
   public).
4. **The waitlist → invite pipeline**: the `waitlist` table (capture-only today) gets
   an invite mechanism (cohort selection + invited-state + a claim path), and a way
   to actually notify testers.
5. **Submission to review is initiated** — the long-pole latency — as early in the
   sprint as the assets allow.
6. **The tutor feels fast enough for a first impression.** Three cheap, mostly
   extension-side fixes land before invites widen, because a beta that opens with a
   ~5s mic cold-start and buffered text replies wastes the beta: (a) the mic
   cold-start (~5s click→recording, ADR-033) pre-warmed toward <500ms; (b) the text
   path switched from the buffered `/api/ai/turn` to the existing streaming
   `/api/ai/turn/stream` so text replies stream too; (c) the conversation history
   trimmed to the PLAN §2.5 6–8 turn window (today unbounded up to 40 messages),
   cutting per-turn tokens — cheaper AND faster every turn. No model/pedagogy change.

```
build:  wxt zip (versioned) ──▶ .zip ──▶ Chrome Web Store (UNLISTED)
listing: /privacy page + data-safety form + copy + screenshots (icons ready)
invite: waitlist (email) ──cohort select──▶ invited_at + invite claim ──▶ notify ──▶ install
gate:   a fresh tester installs from the channel → signs up (age gate + invite allowlist)
        → onboards → runs a real session → mastery persists across two sessions
```

## Context
The product is audited and gated (Sprint 18: CI, no-secret proof, a11y, RLS sweep,
review-ready manifest). What stands between "release candidate" and "a tester is
using it" is entirely **packaging + distribution + listing**, and the audit of that
surface is stark: **no `wxt zip`/release/signing automation** (the extension is built
manually to `dist/chrome-mv3`), **no privacy policy or terms page** (a Chrome Web
Store blocker), **no store listing assets except the icons** (no screenshots, promo
tiles, or description copy), and **no waitlist → invite mechanism at all** (Sprint 20's
`waitlist` table is `{id, email, source, created_at}` with a POST-only capture route —
no `invited_at`, no cohort, no claim, no email send). The auth pages are shadcn-styled
and a11y-conscious (adequate for a private beta, not marketing). The manifest is now
review-ready (Sprint 18). Sprint 17's telemetry funnel is the beta-health signal; its
feedback table is the tester-issue inbox.

### Decisions locked for this sprint (recorded in ADR-045/046)
1. **Unlisted Chrome Web Store, not a public listing.** Per ADR-006/PLAN §2.11
   ("Chrome Web Store only for V1"), the beta ships as an **unlisted** item:
   installable only via a direct link handed to invited testers, discoverable by no
   one. Trusted-tester channel without standing up separate infrastructure.
2. **The waitlist gains invite state; access is gated by an invite claim, not by the
   store link alone.** An unlisted link is shareable, so *install* is open-via-link but
   *use* is gated: a new account's email must be on an **invited** waitlist row (or
   carry a valid invite code) to complete signup/onboard. The store link controls
   discovery; the invite state controls access.
3. **The privacy page + data-safety disclosure are generated from the truth.** They
   enumerate exactly what Sprints 03/16/17 collect: email, birth year (age gate), GDPR
   consent stamp, learning profile + session transcripts (text, no audio — ADR-011),
   hashed page identifiers (Sprint 16), telemetry (typed, no content — Sprint 17), and
   feedback. Nothing disclosed that isn't collected; nothing collected omitted.
4. **The release pipeline is scripted, versioned, rollback-first.** `wxt zip` produces
   a versioned artifact; the last N artifacts stay addressable so a bad beta build is
   rolled back by re-uploading the prior one.
5. **Submission starts as soon as the listing assets exist** (mid-sprint), because
   review latency — especially with a broad-host-permission extension — is the sprint's
   long pole. The invite pipeline is built in parallel while review runs.

### Reconciliation with `/docs/PLAN.md` + prior handoffs (read before Task 1)
- **PLAN §2.11 ADR-006** ("Chrome Web Store only for V1; Firefox/AMO deferred") — the
  unlisted-CWS channel implements it; WXT's multi-target build keeps the Firefox door
  open without V1 effort (out of scope).
- **Sprint 17 handoff**: "the telemetry funnel as the beta health signal
  (onboarding-completion, first-session, degraded-hit rates), the feedback table as the
  tester-issue inbox; the store/data-safety disclosure must list telemetry + feedback
  truthfully." Load-bearing here.
- **Sprint 16 handoff**: "page identifiers are hashed" + "any new user-scoped table
  MUST FK-cascade to users + appear in the export route" — the invite mechanism is
  designed around this (columns on the anonymous, deny-all `waitlist`, not a new
  user-scoped table).
- **Sprint 20 handoff**: "the waitlist → beta funnel has `source` tags; export is a
  service-role query; no emails are sent by anything — a launch task owns the
  announcement." This sprint is that launch task.

### The unlisted link is not the access gate — the invite claim is (read before Tasks 4, 5)
An unlisted store item hides from search but its install link is shareable, so
distribution control cannot rest on link secrecy. The access gate is at **signup**: the
signup route checks the email against invited `waitlist` rows (or a valid invite code)
and refuses onboarding for an uninvited email with a soft "you're on the waitlist,
we'll email you" state — not a hard error, no user created. This bounds the cohort even
if the link leaks and reuses the existing waitlist as the allowlist. Cohort management:
select a batch of `waitlist` rows → mark `invited_at` → send the link + code.

### Waitlist stays anonymous/deny-all; invite state is additive columns (read before Task 4)
`waitlist` is Shape 3 (deny-all, service-role-only) because it holds anonymous
pre-signup emails. The invite mechanism adds columns to it (`invited_at`,
`invite_code`, `cohort`) written only by a service-role admin path — it does **not**
become user-scoped and does **not** need FK-to-users (the email isn't a user yet). The
signup-time allowlist check reads it via the service-role client (as the signup route
already does for the age gate). No RLS-shape change; still deny-all to clients.

### Email sending is the one new external capability (read before Task 6)
Nothing in the repo sends application email today (Supabase Auth handles its own
transactional mail; the waitlist route only captures). The invite notification needs an
email path. Decision: use **Supabase Auth's invite/magic-link** if it fits, else a
minimal transactional provider called only from a service-role server route
(`/api/admin/invite`, admin/CRON_SECRET-guarded). Its credential is server-only (the
Sprint 18 no-secret gate covers it); the choice is recorded in ADR-045. The route also
supports a **manual-send batch** (return the cohort for Darcy to email by hand first).

## Execution model
A **single code session** owns this sprint end to end, worked **strictly in order
(1 → 9)**. The chain: ADRs (Task 1); the release pipeline (Task 2) is first so a
buildable artifact exists; the privacy page + data-safety (Task 3) unblock submission;
the waitlist invite migration (Task 4) precedes the invite route + signup allowlist
(Task 5) and the notification path (Task 6); submission is initiated once Tasks 2–3
land (Task 7, parallel with 4–6); the pre-beta latency + history fixes (Task 8) land
before the gate so testers get a fast tutor; the beta-launch acceptance is the gate
(Task 9). One session — no handoff.

This sprint touches: `extension/package.json` (a zip/release script) + `wxt.config.ts`
(version bump only), a new `web/app/privacy/page.tsx` (+ terms), a new
`supabase/migrations/0018_waitlist_invite.sql`, new `web/app/api/admin/invite/` +
`web/app/api/invite/claim/` routes, `web/app/api/auth/signup/route.ts` (the allowlist
check), `web/public/store/` (screenshots), `/docs/` (listing copy + runbook), and — for
Task 8 only — the extension overlay/mic + `turn-request.ts` history window. It does
**not** touch the AI/learning **grading or pedagogy** paths or any billing (Sprint 23);
Task 8's overlay work is latency/token plumbing (mic warm-up, stream vs buffer, history
trim), not tutoring behavior.

## Files in scope

### Task 1 (ADRs + sprint pointers) creates or edits:
```
/docs/adr/ADR-045-beta-distribution-channel.md ← new (provisional #) — unlisted Chrome Web Store (ADR-006 implemented); access gated by invite-claim at signup, NOT link secrecy; waitlist-as-allowlist (additive columns, still deny-all); the email/invite send path decision (Supabase invite vs minimal transactional, server-only credential, manual-send-batch option); versioned rollback-first release pipeline.
/docs/adr/ADR-046-privacy-policy-and-data-safety.md ← new (provisional #) — the /privacy page + Chrome data-safety disclosure generated from the ACTUAL collection surface (email, birth year, GDPR stamp, text transcripts no-audio, hashed page ids, typed no-content telemetry, feedback); truthful-by-construction; export/delete rights (Sprint 16) linked from the page.
/CLAUDE.md                                      ← edit one line: Current sprint → Sprint 19 — Store packaging + private beta distribution
/docs/CLAUDE.md                                 ← edit one line: Current phase → Phase 2, Sprint 19
/docs/sprint-19-plan.md                         ← this file
/docs/architecture.md                           ← edit: release pipeline (wxt zip, versioned, unlisted CWS); /privacy + /terms pages; waitlist invite pipeline; beta = invite-gated signup
```

### Task 2 (release pipeline) creates / edits:
```
/extension/package.json    ← edit — add "zip": "wxt zip" and a "release" script that builds + zips the versioned artifact into a predictable, addressable path (e.g. extension/release/calyxa-<version>.zip); keep the last N.
/extension/wxt.config.ts   ← edit — version bump only (Sprint 18 set name/description/starting version). No permission/config change.
/docs/release-runbook.md   ← new — the human steps: bump version → `npm run -w extension release` → run the Sprint 18 no-secret gate on the zipped artifact → upload to the CWS developer dashboard (unlisted) → record the version + rollback pointer.
```

### Task 3 (privacy page + data-safety) creates / edits:
```
/web/app/privacy/page.tsx ← new — the hosted privacy policy: what's collected (Task-1 enumeration), why, retention, the audio-never-persisted + hashed-page-id disciplines, and the export/delete rights with a link to the account page (Sprint 16). Marketing token system; server component.
/web/app/terms/page.tsx   ← new — minimal terms (beta disclaimer, acceptable use, no warranty). Same tokens.
/web/proxy.ts (or the public-path list) ← edit — ensure /privacy and /terms are public (no auth), matching how /api/waitlist was made public in Sprint 20.
/docs/data-safety-disclosure.md ← new — the exact Chrome Web Store data-safety form answers (data types, purposes, sharing, encryption in transit, deletion mechanism) — the source Darcy transcribes into the CWS form; MUST match Sprints 16/17 collection exactly.
```

### Task 4 (waitlist invite migration) creates:
```
/supabase/migrations/0018_waitlist_invite.sql ← new (number at execution) — ALTER waitlist ADD invited_at timestamptz null, invite_code text null (unique where not null), cohort text null. STILL Shape 3 (deny-all to clients; service-role writes only) — no RLS-shape change, no FK-to-users (pre-signup emails aren't users), re-affirmed in the comment. Re-runs clean.
```

### Task 5 (invite route + signup allowlist) creates / edits:
```
/web/app/api/admin/invite/route.ts ← new — POST (admin/CRON_SECRET-guarded, service-role): given a cohort/batch selector, mark N waitlist rows invited_at = now() + generate invite_code; return the batch. Supports `send: boolean` (auto-send vs return-for-manual). No public access.
/web/app/api/invite/claim/route.ts ← new — POST { code }: validates an invite_code against an un-consumed invited waitlist row; used by signup to authorize an email (or folded into signup).
/web/app/api/auth/signup/route.ts  ← edit — after the age gate + consent (unchanged), add the INVITE ALLOWLIST check: the email must belong to an invited waitlist row (or the request carries a valid invite_code). Uninvited → soft 200 "you're on the waitlist" state (NOT a hard error, NOT a created user — mirrors the age-gate no-retention discipline). Invited → proceed exactly as today. Reuses the service-role read the age gate already uses.
```

### Task 6 (invite notification) creates / edits:
```
/web/lib/email/invite.ts        ← new — sendInvite(email, code, storeLink): the chosen send path (Supabase invite/magic-link OR a minimal transactional provider); server-only credential from env (Sprint 18 gate covers it). Absent credential → logs + no-ops (dev-safe), never throws.
/web/app/api/admin/invite/route.ts ← edit — when send:true, call sendInvite per row; when send:false, return the batch for manual send.
```

### Task 7 (listing assets + submission) creates:
```
/web/public/store/*.png ← new — Chrome Web Store screenshots (1280×800) captured from a REAL dev build showing the overlay on a math page (no mockups); optional promo tile.
/docs/store-listing.md  ← new — listing copy: title, short + full description, category, the /privacy URL, screenshot captions — the source Darcy pastes into the CWS dashboard. Submission is INITIATED here (upload the Task-2 zip as unlisted, fill the Task-3 data-safety form); review latency starts while Tasks 4–6 finish.
```

### Task 8 (pre-beta latency + history-window fixes) creates / edits:
```
/extension/src/overlay/Overlay.tsx (+ the mic-capture module) ← edit — PRE-WARM the mic: acquire/keep the getUserMedia stream (and permission) warm so click→recording is <500ms instead of the ~5s ADR-033 cold-start. Client-only; no persisted audio (ADR-011 unchanged — a warm stream is not a stored recording).
/extension/src/lib/api.ts + /extension/src/overlay/Overlay.tsx ← edit — route TEXT-mode turns through the existing streaming `aiTurnStream` (`/api/ai/turn/stream`, envelope SSE) instead of the buffered `/api/ai/turn`, so text replies stream token-by-token like voice already does. The stream route + runTutorTurnEnvelopeStream already exist (Sprint 15); this is a client switch, no new server route.
/extension/src/overlay/Overlay.tsx (stripHistory) + /web/lib/ai/turn-request.ts ← edit — enforce the PLAN §2.5 6–8 turn window: trim the history the client sends (and defensively clamp server-side under the existing MAX_MESSAGES=40 ceiling) to the last ~8 turns. Fewer input tokens every turn → lower cost + faster TTFT. Pure windowing, no summary/pedagogy change.
/extension/tests/*.test.ts (+ /web/tests/turn-request or equivalent) ← edit/new — assert: text mode consumes the stream (sayDelta events observed); history is capped to the window before send; the mic warm-up path degrades safely if permission is absent. Latency itself is verified manually in Task 9 + read off the Sprint 18 telemetry.
```
NOTE: Task 8 is the beta-readiness slice only — mic warm-up, stream-vs-buffer, history
trim. It does NOT change grading, annotation selection, model, or pedagogy (that is
Sprint 24). It is placed before the acceptance gate so Task 9 verifies a fast tutor.

### Task 9 (beta-launch acceptance — manual, the real gate) creates:
```
/docs/beta-launch-acceptance.md ← new — the record of the end-to-end gate (below). Distribution proceeds only when this passes.
```

### Files explicitly out of scope
```
AI / learning grading + pedagogy code  (Task 8's mic/stream/history plumbing is the sole overlay carve-out; grading, model, annotation selection stay untouched → Sprint 24)
Deep latency work (STT streaming, tiering, verification)  (Task 8 is only the cheap wins; the rest is Sprint 24 tutor-quality)
Billing / Stripe / entitlements        (Sprint 23; the beta is free)
Study materials generation             (Sprint 21)
Dashboard                              (Sprint 22)
Firefox / AMO packaging                (V1 deferred — WXT keeps the door open, unused here)
Public (listed) store presence + paid acquisition  (beta is unlisted + invite-gated)
```
Also out of scope (no pre-empting later roadmap sprints):
- **A public store listing / open signups** — the beta is unlisted + invite-gated;
  going public is a post-beta decision, the invite allowlist is the throttle until then.
- **A full email/CRM system** — invite send is minimal (Supabase invite or one
  transactional call, manual-batch supported); marketing email is not built.
- **Resolving the study-loop marketing framing** — already resolved (Sprint 25/ADR-040
  reframed it to "on the way"; the extension RecapCard shows a placeholder). No action.

Do not create any file not listed above. If something seems needed but is not listed,
add it to "What the next sprint needs to know" and ask before creating it.

---

## Task 1 — Distribution + privacy ADRs + sprint pointers (planning / docs)
Write ADR-045/046 in the project format. Fix the unlisted-channel + invite-gate
decision, the truthful data-safety enumeration, and the email-send path. Update
pointers + architecture.md; repoint the sprint-24 cross-ref to the caching commit.

Acceptance gate before Task 2:
  - Both ADRs read as decisions; the data-safety enumeration matches Sprints 16/17
    collection exactly; no code touched.

## Task 2 — Release pipeline
Scope: the zip/release script + version bump + runbook. A versioned, addressable,
rollback-able artifact.

Acceptance gate before Task 3:
  - `npm run -w extension release` produces `calyxa-<version>.zip`; the Sprint 18
    no-secret gate passes on the zipped artifact; the runbook is followable.

## Task 3 — Privacy page + data-safety
Scope: `/privacy` + `/terms` (public) + the data-safety disclosure doc. Truthful,
linked to export/delete.

Acceptance gate before Task 4:
  - /privacy renders publicly (no auth), enumerates the real collection surface, links
    account export/delete; the data-safety doc maps 1:1 to what's collected.

## Task 4 — Waitlist invite migration
Scope: `0018_waitlist_invite.sql`. Additive columns; still deny-all.

Acceptance gate before Task 5:
  - `db reset` clean; waitlist gains invited_at/invite_code/cohort; RLS still deny-all
    (no client can read it); no FK-to-users introduced.

## Task 5 — Invite route + signup allowlist
Scope: the admin invite route + the signup allowlist check. Uninvited → soft "you're
on the waitlist," no user created.

Acceptance gate before Task 6:
  - An invited email signs up + onboards normally; an uninvited email gets the soft
    waitlist state with no user/profile created; the admin route is not publicly
    callable.

## Task 6 — Invite notification
Scope: `sendInvite` + the admin route wiring. Server-only credential; absent → no-op;
manual-batch supported.

Acceptance gate before Task 7:
  - A test invite send delivers the store link + code (or returns the batch for manual
    send); no credential in any bundle.

## Task 7 — Listing assets + submission
Scope: screenshots + listing copy; initiate the unlisted submission.

Acceptance gate before Task 8:
  - The unlisted item is uploaded with the /privacy URL and the data-safety form
    filled; review is in-flight.

## Task 8 — Pre-beta latency + history-window fixes
Scope: the three cheap beta-readiness fixes (see the Task 8 file block): mic
pre-warm (<500ms click→recording), text-mode routed through the existing streaming
turn, and history trimmed to the 6–8 turn window. Extension-side latency/token
plumbing only — no grading/model/pedagogy change.

Acceptance gate before Task 9:
  - Mic starts recording in <500ms on a warm session; text replies stream (sayDelta
    observed) rather than arriving whole; the client sends at most ~8 turns of history;
    `turbo`/extension tests green; the Sprint 18 `turn_latency` telemetry shows the
    improved legs.

## Task 9 — Beta-launch acceptance (manual, the real gate)
A tester who was NOT part of development, on a fresh machine:
  1. Receives an invite (email on an invited waitlist row) with the unlisted link.
  2. Installs the extension from the link.
  3. Signs up — passes the age gate; the invite allowlist accepts their email.
  4. Completes onboarding (Sprint 17), runs a real tutoring session with annotations +
     tags + recap, hits (or doesn't) the free-tier limit gracefully.
  5. Opens a second session — mastery from session one is still there.
  6. An uninvited stranger with the same link gets the soft waitlist state, not access.
  7. The tester's telemetry funnel events and any feedback appear server-side.
  8. The session **feels responsive**: mic starts near-instantly, replies stream in
     (voice and text), no multi-second dead air on turn start (Task 8 verified live).

## Acceptance criteria (full checklist)
- [ ] ADR-045/046 written; pointers + architecture.md updated; sprint-24 cross-ref repointed to the caching commit
- [ ] `npm run -w extension release` produces a versioned, addressable zip; no-secret gate passes on it; rollback runbook exists
- [ ] /privacy + /terms render publicly; data-safety disclosure matches Sprints 16/17 collection exactly; export/delete linked
- [ ] waitlist gains invited_at/invite_code/cohort (still deny-all, no FK-to-users); db reset clean
- [ ] Signup is invite-gated: invited email proceeds, uninvited gets a soft waitlist state with no user created; admin invite route guarded
- [ ] Invite notification sends the unlisted link + code (or returns a manual-send batch); credential server-only
- [ ] Unlisted CWS item submitted with /privacy URL + data-safety form; review in-flight
- [ ] Pre-beta latency fixes: mic cold-start <500ms, text mode streams, history trimmed to ~8 turns; extension tests green
- [ ] Beta-launch acceptance passed end-to-end by a non-developer on a fresh machine, session feels responsive → 🚀 DISTRIBUTE

## Risks
**Chrome Web Store review rejects/delays over the broad `<all_urls>` host permission.**
Mitigation: the manifest is minimized + justified (Sprint 18), the content script
genuinely needs `<all_urls>` (a tutor on any math page), the data-safety form is
truthful, and submission starts early so latency runs in parallel; if review pushes
back, the justification is documented and `activeTab`-narrowing is the recorded fallback.

**The unlisted link leaks and uninvited users flood in.** Mitigation: access is gated
at signup by the invite allowlist, not the link — a leaked link installs the extension
but an uninvited email can't onboard; the soft-waitlist state converts leakers into
waitlist signups rather than turning them away.

**The privacy/data-safety disclosure drifts from what's actually collected.**
Mitigation: generated from the Task-1 enumeration cross-checked against Sprints 16/17
code; the data-safety doc maps 1:1; any future collection change must update both
(flagged in the handoff).

**Email sending is a new failure surface / spam risk.** Mitigation: send is
service-role-only and admin/CRON-guarded; manual-send batch lets Darcy send the first
cohort by hand; absent credentials no-op; volume is a bounded cohort, not open signup.

**A bad beta build ships with no way back.** Mitigation: the release pipeline is
versioned and keeps the last N artifacts addressable; rollback is re-uploading the prior
version per the runbook; the no-secret gate runs on the exact artifact.

**Mic pre-warm looks like always-on recording (a privacy/trust regression).**
Mitigation: keeping a `getUserMedia` stream warm is not persistence — ADR-011
(audio never persisted, real-time STT only) is unchanged; the mic indicator/UX must
still make capture state obvious, and the warm stream releases on session end. If
warm-hold proves too aggressive, warming on overlay-open (not page-load) is the
recorded fallback. Task 8 is the *cheap* latency slice only; the sequential
STT→turn→TTS legs and any deeper latency work stay in Sprint 24.

**Task 8 latency work slips the beta.** Mitigation: all three fixes are small and
independent (mic warm, stream switch, history trim); any one can be dropped to a
fast-follow beta build without blocking distribution — the acceptance gate (Task 9)
verifies whichever landed, and the Sprint 18 telemetry quantifies the rest.

## What the next sprint needs to know
**Calyxa is in beta.** An unlisted, invite-gated Chrome Web Store build is installable
by invited testers; the release pipeline is versioned + rollback-able; /privacy +
data-safety are truthful and hosted; the waitlist is now an allowlist with an invite
send path; the telemetry funnel + feedback table are the live beta-health + issue
signals.

- **The post-beta sprints (21 study materials, 22 dashboard, 23 billing)** now build on
  a live product with real users — each should watch the Sprint 17 telemetry funnel and
  feedback inbox for what beta users need first.
- **Sprint 24 (tutor quality & cost)** inherits the residual tutor problems this sprint
  only partly addressed: correctness (wrong answers accepted/produced), sparse
  annotations, deeper latency (sequential voice legs), and cost. Task 8 handled the
  *cheap* latency wins; the eval-driven model tiering + answer verification are Sprint
  24. The `turn_latency`/`annotation_rendered` telemetry now flowing from beta is its
  input data — decide it against real usage, not guesses.
- **The unlisted→public transition** is a future decision (flip listing visibility, drop
  the invite gate, add paid acquisition) — not built here; the invite allowlist is the
  throttle until then.
- **The data-safety disclosure is now load-bearing**: any new data collection (Sprint 21
  artifacts, Sprint 23 billing/Stripe customer data) MUST update /privacy + the
  data-safety form before it ships to beta users.
- **The release runbook** is the standing path for every future extension update.
- **Firefox/AMO** stays deferred (WXT keeps the multi-target door open); revisit
  post-V1 only.

## Filed for this sprint — deferred UX from Sprint 18 Task 7 (not in the locked 1–9 chain)

> Assigned here by Darcy (2026-07-12) from the Sprint 18 cross-site QA matrix
> (`docs/qa-matrix-sprint18.md`, degradation path D2 / test T5 / follow-up FU-2).
> A small beta-readiness UX fix — natural companion to Task 8's cheap-wins slice,
> but its own item (touches the cost-guard read + overlay, not mic/stream/history).
> Slot it into Task 8 or run it standalone; confirm the approach before building.
> Kept here so it isn't lost.

**F1 — Proactive "resting" display when the cost hard cap is in effect.**

*Finding:* when the global cost hard cap fires (ADR-041), the resting refusal —
`COST_RESTING_MESSAGE = "Calyxa is resting for today — the tutor is back tomorrow."`
(`web/app/api/ai/turn/route.ts`, `.../turn/stream/route.ts`, `.../ai/stream/route.ts`)
— is delivered only as the **reply to a turn the student already sent**. So the
student types a full prompt, waits, and only then learns the tutor is unavailable
today. The degradation path itself is correct + graceful (it PASSED the Sprint 18
QA matrix, D2) — this is a proactive-UX improvement on top.

*Requested behavior:* surface the resting state **proactively** — show the resting
message on panel/session open while the hard cap is in effect, **before** the
student spends a prompt.

*Approach (confirm before building):* the client needs to learn the hard-cap
state **without a Claude call**. Options:
- (a) have `GET /api/session/start` (or a lightweight status endpoint) report a
  `resting` flag derived from the same `costGuard`/`cost_ledger` check
  (`web/lib/tier/cost-guard.ts`), and have the overlay show the resting banner on
  open when set;
- (b) a dedicated cheap "cap status" read.
- Do **NOT** make a Claude call just to detect the cap. Overlay entry point: the
  opening-scan / check-in path in `extension/src/overlay/Overlay.tsx` +
  `extension/src/content/index.ts`.

*Why it's a fit here:* it's a first-impression beta-readiness UX fix (a tester
hitting the cap and wasting a prompt is exactly the beta friction Task 8 targets),
and it's small + independent of the store/invite pipeline.
