# Beta-launch acceptance — Sprint 19 Task 9 (the real gate)

> **This is the end-to-end gate that authorizes distribution.** Sprint 19 is marked
> complete, and Calyxa ships to invited testers (🚀 DISTRIBUTE), **only when every
> box below is checked** by a real run. Writing this record does not pass the gate —
> a non-developer running it on a fresh machine does.
>
> **Status: ⏳ PENDING** — code/infra prerequisites are verified (Part A); the
> release-critical launch step (Part B) and the human acceptance run (Part C) are
> outstanding and are Darcy's to perform. Last prerequisite audit: **2026-07-13**.

Owner: Darcy (Chrome Web Store developer account + a fresh-machine tester).
Prerequisite audit + this record prepared by the Sprint 19 session.

---

## Part A — Prerequisites verified this session (machine-checkable) ✅

These were confirmed programmatically on 2026-07-13; they do not require re-checking
during the run unless something below changes.

| # | Prerequisite | Status | Evidence |
|---|---|---|---|
| A1 | **Invite migration live.** `waitlist` has `invited_at` / `invite_code` / `cohort`; RLS enabled; still deny-all (Shape 3); **no FK-to-users**. | ✅ | Supabase project `calyxa` (`bowqktakezzsviwvslew`): migration `20260713032543_waitlist_invite` applied; `list_tables` shows the three columns, `rls_enabled: true`, zero FK constraints on `waitlist`. |
| A2 | **Signup is invite-gated.** Age gate → consent → (invited email **or** valid `invite_code`) else **soft 200 `{waitlisted:true}` with NO auth user created**; uninvited email captured to waitlist, invite status never leaked. | ✅ | `web/app/api/auth/signup/route.ts` (code-verified): allowlist read via service-role admin client, uninvited path upserts waitlist + returns 200 before any `auth.signUp`. |
| A3 | **Admin invite route guarded, never public.** | ✅ | `web/app/api/admin/invite/route.ts`: `assertCronSecret()` fails closed at the top; service-role; `MAX_BATCH = 500`; `proxy.ts` exempts `/api/admin` from the cookie gate so the CRON_SECRET is the real (and only) gate. |
| A4 | **Invite send path server-only + dev-safe.** | ✅ | `web/lib/email/invite.ts`: `sendInvite` uses `RESEND_API_KEY` + `INVITE_FROM_EMAIL` (server env); **absent → logs + no-ops, never throws**; admin route defaults to `send:false` (manual-batch). Covered by the Sprint 18 no-secret bundle gate. |
| A5 | **`/privacy` + `/terms` render publicly (no auth).** | ✅ | `web/proxy.ts` `PUBLIC_PATHS` includes `/privacy` and `/terms`; pages exist (`web/app/privacy/page.tsx`, `web/app/terms/page.tsx`); privacy links account export/delete. |
| A6 | **Data-safety disclosure matches actual collection.** | ✅ | `docs/data-safety-disclosure.md` + `docs/store-listing.md` enumerate email, birth year, GDPR stamp, text transcripts (no audio), hashed page ids, typed no-content telemetry, feedback — the Sprints 03/16/17 surface. |
| A7 | **Release pipeline produces a versioned, addressable, secret-free zip.** | ✅ | `npm run -w extension release` → `extension/release/calyxa-0.1.0.zip`; no-secret grep clean on the **unzipped artifact**; keeps last 5 builds; runbook: `docs/release-runbook.md`. |
| A8 | **Task 8 latency fixes are in the build.** Mic pre-warm, text-mode streaming (`/api/ai/turn/stream` in the bundle), ≤8-turn history window. | ✅ | Extension 212 tests + web 427 tests green (2026-07-13); bundle grep confirms `/api/ai/turn/stream`; wall-clock confirmation is step C8 below. |
| A9 | **Beta-health + issue signals live.** `telemetry_event` (typed, no content) and `feedback` tables receiving rows; export/erasure cover both. | ✅ | Supabase `calyxa`: `telemetry_event` (83 rows), `feedback` (1 row), both RLS-enabled and FK-cascading to `users` (Sprint 17). |

---

## Part B — Release-critical launch step BEFORE the tester build 🔴

**The current `calyxa-0.1.0.zip` points at `localhost` and cannot be used by a real
tester.** This must be resolved, then the artifact rebuilt, before the run (and before
the CWS upload if not already done).

- [x] **B1 — Flip `API_BASE` to production.** ✅ Done 2026-07-13: `extension/src/lib/api.ts`
  now `https://calyxa.app`; `wxt.config.ts` NOTE updated; typecheck clean; `npm run -w
  extension release` rebuilt `extension/release/calyxa-0.1.0.zip`; no-secret gate clean on
  the new zip; built `background.js` calls **only** `https://calyxa.app` (the sole
  remaining `localhost:3000` is the manifest host-permission entry, kept intentionally so
  a dev revert needs no re-review).
- [ ] **B2 — Confirm the uploaded artifact is the prod-pointed build.** The zip uploaded to
  the CWS dashboard must be **the `calyxa-0.1.0.zip` rebuilt after B1** (the localhost-pointed
  one is overwritten locally, but verify the dashboard build is the new one).
- [ ] **B3 — (Optional, for automated invite email) set `RESEND_API_KEY` +
  `INVITE_FROM_EMAIL` in Vercel.** Absent → invite send no-ops and the admin route
  returns the batch for manual send (A4), which is a valid path for the first cohort.
- [ ] **B4 — Deploy the proxy fix to `calyxa.app`. 🔴 (found during this audit, 2026-07-13)**
  The four Sprint-17 bearer-authed extension routes — `/api/telemetry`, `/api/feedback`,
  `/api/onboarding`, `/api/errors` — were **missing from `web/proxy.ts`'s exemption list**,
  so in production every extension call to them was redirected **307 → /login** before the
  handler ran (empirically confirmed against live `calyxa.app`). Effect: **onboarding never
  shows** (status check degrades to `{needed:false}`) and **telemetry + feedback never
  record** — i.e. acceptance steps **C4 and C7 would fail**. Fixed in `web/proxy.ts` (same
  class as the already-exempt `/api/session`, `/api/ai`, `/api/cron`, `/api/admin`);
  verified locally (routes now 401/400 via their own auth; protected pages still 307).
  **This fix must be deployed to `calyxa.app` (Vercel) before the acceptance run** — the
  route-level tests bypass middleware, so nothing but a deploy makes it live. Recommended
  follow-up: a `proxy.ts` exemption regression test (this is the 2nd time this class shipped).

---

## Part C — The end-to-end acceptance run (human, on a fresh machine) ⏳

A tester who was **not** part of development, on a **fresh** machine/profile. Check each
box only when observed. If any step fails, do **not** distribute — file the failure and
re-run after the fix.

- [ ] **C1 — Invite received.** Tester's email is on an **invited** `waitlist` row
  (`POST /api/admin/invite` marked it `invited_at` + minted an `invite_code`); they
  received the **unlisted store link + code** (auto-send if B3 done, else Darcy sent the
  returned batch by hand).
- [ ] **C2 — Install from the unlisted link.** The extension installs from the Chrome Web
  Store unlisted item (not loaded unpacked).
- [ ] **C3 — Signup passes the age gate + invite allowlist.** Tester signs up; the age
  gate accepts a ≥13 birth year; the allowlist accepts their invited email (or the code).
  A profile row is created with the GDPR consent stamp.
- [ ] **C4 — Onboarding + a real tutoring session.** Tester completes the Sprint 17
  onboarding, then runs a real session on a math page: **annotations** draw, **status
  pins/tags** fire, a **recap** appears at session end; the free-tier limit (if hit) is
  handled gracefully (not a crash).
- [ ] **C5 — Mastery persists across sessions.** Tester opens a **second** session; the
  mastery/profile from session one is still there (not reset).
- [ ] **C6 — Uninvited stranger is soft-gated, not admitted.** A different email with the
  **same install link** attempts signup and gets the **soft "you're on the waitlist"**
  state — **no account created, no access** (verifies the link is not the gate; the
  invite claim is).
- [ ] **C7 — Signals land server-side.** The tester's telemetry funnel events
  (`session_started`, `onboarding_completed`, `turn_latency`, `annotation_rendered`,
  `voice_used`/`degraded_hit` as applicable) and any submitted **feedback** appear in the
  `telemetry_event` / `feedback` tables, scoped to their user.
- [ ] **C8 — It feels responsive (Task 8, verified live).** Mic starts recording
  **near-instantly** on a warm session (not the old ~5s cold start); replies **stream in**
  for both **voice and text** (no multi-second dead air at turn start); the Sprint 18
  `turn_latency` telemetry shows improved legs.

---

## Distribution decision

- [ ] **All of Part B and Part C checked → 🚀 DISTRIBUTE.** Record the shipped version
  and the rollback pointer (prior addressable zip) per `docs/release-runbook.md`, then
  update the sprint acceptance checklist and mark Sprint 19 complete.

**Do not mark Sprint 19 complete until this box is checked.** As of the 2026-07-13 audit,
Part A is green and **B1 (the `API_BASE` flip + rebuilt artifact) is done**; what remains is
**B2** (upload the rebuilt, prod-pointed zip — the in-review build points at localhost and
is non-functional), **B4** (deploy the `web/proxy.ts` fix to `calyxa.app`, without which
onboarding/telemetry/feedback fail), the CWS submission being in-flight, and **Part C** (the
human run). B2 + B4 are hard blockers for the acceptance run.
