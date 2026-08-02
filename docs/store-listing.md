# Chrome Web Store listing — source of truth + submission runbook (Sprint 19 / Task 7)

Everything Darcy pastes into the Chrome Web Store developer dashboard to submit
Calyxa as an **unlisted** beta (ADR-045 / ADR-006), plus the step-by-step
submission checklist. Submission here is what starts CWS review — the sprint's
long pole — so it runs while Tasks 4–6/8 finish.

> **Two parts of this task are inherently manual** (flagged in the Task 7 report):
> (1) the **screenshots** must be captured from the real extension loaded unpacked
> in Chrome on a live math page — Claude can't load an unpacked extension in its
> in-app browser, and mockups are not allowed (see the shot list); (2) the **upload +
> submit** happens in the CWS dashboard under Darcy's developer account. This doc is
> the paste-ready source for both.

---

## Prerequisites (one-time)

- A **registered Chrome Web Store developer account** (one-time US $5 fee) at
  https://chrome.google.com/webstore/devconsole — required before anything can be
  uploaded.
- The release artifact: run `npm run -w extension release` → produces
  `extension/release/calyxa-0.1.0.zip`, then `node scripts/check-no-secrets.mjs`
  (see `docs/release-runbook.md`).

---

## Store listing tab — copy to paste

**Product name**
```
Calyxa — AI math tutor
```

**Summary** (short description, ≤132 characters)
```
A patient AI math tutor for any web page — Calyxa guides you through problems step by step instead of just giving the answer.
```

**Category:** Education
**Language:** English (United States)

**Detailed description**
```
Calyxa is the math tutor that lives on your screen.

Stuck on a problem? Open Calyxa on any web page — a homework portal, a PDF, a
practice site — and it sees the problem you're working on, talks you through it
out loud, and points at the exact step you're missing. It never just hands you
the answer. It helps you get there yourself.

What makes Calyxa different:

• It works where you already study. Calyxa runs as an overlay on the page you're
  on — no copy-pasting into a separate app.

• It guides, it doesn't solve for you. Calyxa asks the right question, nudges you
  past the step you're stuck on, and draws right on the problem to show you what
  it means — the way a good tutor sits next to you.

• It adapts to you. Calyxa keeps track of what you've mastered and where your
  misconceptions are, and it tailors each session to that — so it spends time on
  what you actually need.

• You can talk to it. Ask a question out loud and hear the explanation back,
  hands-free, while you keep working.

Your privacy comes first. Your microphone audio is never stored. The pages you
visit are recorded only as a one-way hash — never the URL or the contents. You
can export or permanently delete everything Calyxa holds about you at any time.
Full details: https://calyxa.app/privacy

Calyxa is free to start, with a Pro plan for unlimited sessions.
```

**Single purpose** (CWS requires one clear purpose)
```
An AI math tutor that helps a student understand and work through math problems
on any web page, as an on-page overlay.
```

**Permission justifications** (from the Sprint 18 reviewed manifest / security review)
```
- Host permission <all_urls>: the content script must run on ANY page a student
  visits to see the math problem they're stuck on — homework portals, PDFs,
  practice sites — so the tutor works where they already study. It reads the page
  only; it never modifies the host page (shadow-DOM overlay).
- storage: keeps the background worker's small state across service-worker wake
  cycles.
- activeTab: reads the current tab on the user's toggle gesture (open the overlay).
- scripting: Manifest V3 programmatic content-script injection.
- No tabCapture / desktopCapture: the OCR/screen path is not built; no screen or
  tab capture is requested.
```

**Privacy policy URL**
```
https://calyxa.app/privacy
```

**Support / contact email**
```
calyxasupport@gmail.com
```

---

## Privacy practices (data-safety) tab

Transcribe the answers from **`docs/data-safety-disclosure.md`** — it is written 1:1
to what Calyxa actually collects (Sprints 16/17) and holds the exact data types,
purposes, sharing answer, encryption-in-transit answer, the three certifications,
and the deletion mechanism. Do not answer this tab from memory — use that doc.

---

## Store settings

- **Visibility: Unlisted.** Installable only by direct link, discoverable by no one
  (ADR-045 / ADR-006). NOT public.
  ⚠️ **Revisit before this submission**: ADR-045 set Unlisted for the invite-gated
  beta; signup is now open (the 2026-07-17 public-launch conversion removed the
  invite gate). Unlisted no longer matches an open-signup product — confirm with
  Darcy whether to flip to Public before submitting, rather than carrying the old
  beta-era setting forward by default.
- Distribution: your choice of regions (all is fine for a beta).
- Icon: the 128×128 icon already in the bundle is reused by the store; no separate
  upload needed.

---

## Screenshots — shot list (REQUIRED: 1–5, exactly 1280×800 PNG)

Capture from the **real extension**, not the marketing demo. See
`web/public/store/README.md` for how to capture and what to name the files. Suggested set:

1. **`01-opening-scan.png`** — the overlay open on an algebra problem, showing the
   proactive opening scan reading the problem.
   *Caption:* "Calyxa sees the problem you're on — and opens with a read on where to start."
2. **`02-annotation.png`** — a tutoring turn with a Meadow annotation pointing at the
   exact step on the problem.
   *Caption:* "It points at the step you're missing — drawing right on the problem."
3. **`03-voice.png`** — the mic active / a spoken explanation in progress.
   *Caption:* "Ask out loud and hear it back — hands-free while you work."
4. **`04-checkin-or-recap.png`** — the check-in (prediction) card or the end-of-session
   recap with mastery.
   *Caption:* "Calyxa adapts to what you've mastered and what you haven't."

(3 strong shots beat 5 weak ones. All must be 1280×800.)

**Optional promo tile:** small tile 440×280 (`promo-tile.png`) — a clean wordmark on
the brand ground. Not required to submit.

---

## Submission checklist — this INITIATES review (the Task 7 acceptance gate)

1. [ ] Build + verify the artifact: `npm run -w extension release`, then
       `node scripts/check-no-secrets.mjs` (must print the ✓). → `calyxa-0.1.0.zip`.
2. [ ] CWS Developer Dashboard → **New item** → upload `calyxa-0.1.0.zip`.
3. [ ] **Store listing** tab: paste product name, summary, description, single
       purpose, category, language (above). Add the screenshots from
       `web/public/store/`.
4. [ ] **Privacy practices** tab: paste the privacy policy URL + permission
       justifications (above); fill the data-safety form from
       `docs/data-safety-disclosure.md`.
5. [ ] **Distribution / Visibility**: set to **Unlisted**.
6. [ ] **Submit for review.** → review is now in-flight (this is the gate).
7. [ ] Once approved (or as soon as the unlisted install URL exists), record it:
       set `CALYXA_STORE_URL` in the Vercel project env (it feeds the Task 6 invite
       email's store link) and note the item ID + rollback pointer in
       `docs/release-runbook.md`.

---

## Notes / carry-forwards

- **`<all_urls>` review risk** (ADR-045 Risks): review may push back on the broad host
  permission. The justification above is the defense; `activeTab`-narrowing is the
  recorded fallback if required.
- **`CALYXA_STORE_URL`** stays unset until the unlisted URL exists (step 7). Until then
  Task 6's invite email shows a "pending" placeholder for the link, so send the first
  cohort *after* the URL is recorded (or via the manual batch with the link pasted in).
- Every future update re-uses `docs/release-runbook.md`; this doc is the listing copy
  source for those updates too.
