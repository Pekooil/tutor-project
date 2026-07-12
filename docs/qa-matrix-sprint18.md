# Cross-site QA matrix — Sprint 18 (ADR-044)

**Date:** 2026-07-11 · **Scope:** the release-candidate cross-site QA pass —
real tutoring sessions on real math pages, exercising the Sprint 14 SPA
re-capture-on-expand fix under client-side navigation, the shadow-DOM /
read-only-DOM invariants, annotation resolve-vs-drop, and **both** degradation
paths (free-tier over-limit + the Sprint 16 cost hard-cap). Per ADR-044
decision 4: findings that are one-line fixes land in-sprint; larger ones are
filed with a reason.

## How to read this doc (execution note)

This matrix has two kinds of rows:

- **Code-level pre-verification** (§4, §5, §6) — claims I can substantiate by
  reading the shipped source (DOM policy, shadow-DOM isolation, no `tabCapture`,
  the annotation drop contract, both degradation code paths, the `tabs`
  permission analysis). These are recorded as **✅ verified (static)** below and
  do not need a browser.
- **Live browser rows** (§2, §3 result columns) — the actual per-site sessions.
  These **require Darcy's Chrome with `extension/dist/chrome-mv3` loaded
  unpacked** (the locked test-artifact flow, CLAUDE.md). They **cannot** be run
  from the in-app Browser pane, which can't load an unpacked extension. The
  procedure to run each is in §7; the result columns are left `☐ pending` for
  the live run and are the only thing this doc is waiting on.

Nothing here changes behavior — this is an audit pass over the built artifact.

## Verdict

> **No beta-blocking finding; gate met via filed follow-ups.** Live run
> 2026-07-11 (Darcy, Chrome + unpacked `dist/chrome-mv3`). The overlay mounts in
> the shadow root with no host-DOM mutation on every site, the Khan Academy SPA
> re-capture (C6) works, and **all three degradation paths behave gracefully**
> (free-tier "on the house", cost hard-cap "resting", cost soft-cap). Two
> **out-of-scope UX enhancements** were surfaced and **filed** (§9): a crop-tool
> fallback when no problem is recognized, and a proactive (pre-prompt) display of
> the resting message. Neither is a correctness defect. The
> `tabs`-permission drop (§6) was **confirmed and applied** — `tabs` is removed
> from the manifest, verified live. No open items.

---

## 1. Test artifact + environment

| Item | Value |
|---|---|
| Build under test | `extension/dist/chrome-mv3` — **rebuild before loading** (`npm --prefix extension run build`; the frozen snapshot does NOT auto-update, CLAUDE.md) |
| Manifest | `name` "Calyxa — AI math tutor", `version` 0.1.0, prod origin present (Task 6) |
| Backend | `API_BASE` still `http://localhost:3000` (filed Sprint 19, security-review §7.3) → **run `web` dev server locally for the live pass** |
| Account | a signed-in beta user (the pill only mounts when `signedIn`, content/index.ts step 6) |

> Because the shipped `API_BASE` is still localhost (deliberately, Sprint 19),
> the live QA runs against `npm --prefix web run dev`, not prod. The prod origin
> is in the manifest so the host-permission review is done; the constant flip is
> Sprint 19's.

## 2. Site matrix — real math pages

Four renderer families, chosen to exercise every branch of the annotation
resolver (`extension/src/content/annotations.ts`) and the SPA re-capture path:

| # | Site / renderer | Why it's here |
|---|---|---|
| S1 | **Khan Academy** exercise (MathJax CHTML, **SPA**) | The Sprint 14 re-capture-on-expand fix under client-side navigation; MathJax visible-tree-has-no-text → assistive-MathML token correlation (`resolveMathJaxSubRect`) |
| S2 | **A MathJax-rendered page** (e.g. a math.stackexchange question, static nav) | MathJax without the SPA churn — isolates the renderer from the navigation variable |
| S3 | **A KaTeX page** (e.g. a docs/course page rendering KaTeX) | The KaTeX `.katex-html` leaf walk + the exponent `foldNotation` fix ("5t^2" ↔ "5t2") |
| S4 | **A plain / native-MathML or text page** (e.g. a static worksheet HTML) | The bounded visible-text search path + native `<math>` leaf walk; the "no equations, text-only" opening-scan gate |

### Per-site checks (columns)

For each site, confirm every column. `PASS` / `FAIL (note)` / `N/A`.

| Check | What it proves | S1 KA | S2 MathJax | S3 KaTeX | S4 plain |
|---|---|---|---|---|---|
| **C1 Overlay mounts in shadow root** — `<calyxa-overlay>` present on `<html>`, panel opens on the shortcut; DevTools shows a `#shadow-root` | ADR-002 shadow-DOM isolation; no style leak into host | ☐ | ☐ | ☐ | ☐ |
| **C2 No host-DOM mutation** — with the panel open + a turn taken, the host page's light DOM is unchanged (DevTools → inspect body subtree; no injected nodes/attrs/styles outside `<calyxa-overlay>`) | Locked read-only-DOM policy | ☐ | ☐ | ☐ | ☐ |
| **C3 Opening scan fires appropriately** — a first assistant bubble appears on a page with math/enough text; **nothing** on a blank/non-math page (the `isPlausibleProblem` gate) | ADR-030 gate; no wasted model call | ☐ | ☐ | ☐ | ☐ |
| **C4 Annotations resolve or drop cleanly** — drawn boxes sit on the right term; anything unresolvable draws **nothing** (never a wrong box); `console.debug` shows the drop diagnostic | ADR-022 drop-never-guess | ☐ | ☐ | ☐ | ☐ |
| **C5 A full turn round-trips** — text turn streams; a voice turn transcribes → speaks; the progress bar / pins update | the whole loop works on this page | ☐ | ☐ | ☐ | ☐ |
| **C6 SPA re-capture** (S1 only) — open panel on problem A, minimize, navigate to problem B **without a reload**, re-expand: the next turn is grounded in **problem B**, not A | Sprint 14 Task 6 re-capture-on-expand (`handlePanelExpand`) | ☐ | N/A | N/A | N/A |

**C6 detail (the headline row).** `capturedPageContext` is refreshed on *every*
`PANEL_EXPANDED_EVENT`, not just first open (content/index.ts,
`handlePanelExpand`). On Khan Academy's SPA the exercise DOM swaps under
client-side navigation with no page reload, so the fix to verify is: after a KA
"next problem" (or a different-skill navigation) with the panel minimized, the
*re-expand* must re-read the new problem. Confirm by asking the tutor something
problem-specific and checking the answer matches problem B. Also confirm a stale
annotation from problem A **drops** on re-anchor rather than mis-anchoring
(re-anchor's `isConnected` + matched-text check).

## 3. Degradation paths — both must behave gracefully

Two independent paths, forced independently. See §7 for the exact env knobs.

| Path | Trigger | Server behavior | What the student sees | Result |
|---|---|---|---|---|
| **D1 Free-tier over-limit** (Sprint 07/16, ADR-007) | Exceed `FREE_SESSION_LIMIT` (20/mo) free sessions | `start_session` RPC returns `degraded:true`, `remaining` ≤ 0; **the session still starts** ("on the house") | Popup card: *"Free limit reached for this month — this session is on the house."* Tutoring continues normally | ☐ |
| **D2 Cost hard-cap** (Sprint 16, ADR-041) | Global day cost ledger over the **hard** cap | `/api/ai/turn`(+stream) short-circuit to `{ reply: "Calyxa is resting for today — the tutor is back tomorrow.", degraded:true }` — no provider call | The "resting" message renders as the assistant reply; no crash, no 500; opening scan returns empty (renders nothing) | ☐ |
| **D3 Cost soft-cap** (Sprint 16, ADR-041) | Global day cost over the **soft** (not hard) cap | Turn proceeds normally but carries `degraded:true`; voice legs degrade | Reply is normal; voice may fall back to text-only; `degraded_hit` telemetry emits (Task 8) | ☐ |

**Grace criteria (all three):** no unhandled exception in the overlay/background
console, no host-page breakage, the overlay stays usable, and the degradation
message is the friendly copy above (never a raw error). D2's "resting" copy is
verbatim from `web/app/api/ai/turn/route.ts` (`COST_RESTING_MESSAGE`).

## 4. Code-level pre-verification — DOM + isolation invariants

These are verifiable from the source and are recorded here so the live pass only
has to confirm them visually, not discover them.

- **Read-only host DOM — ✅ verified (static).** Grep of the two host-page-reading
  modules (`content/annotations.ts`, `content/pageExtractor.ts`) for every
  DOM-write API (`setAttribute`/`appendChild`/`innerHTML`/`textContent =`/
  `classList.*`/`.style.`/`createElement`/…) returns **only reads**: the two
  `outerHTML`/`textContent` hits in `pageExtractor.ts:219,264` are right-hand-side
  reads of `mathNode` (capturing MathML), not writes. Every host touch is
  `querySelector`/`createTreeWalker`/`getBoundingClientRect`/`checkVisibility`.
  The drawing all happens **inside** the `<calyxa-overlay>` shadow root
  (`AnnotationLayer`), never the host light DOM. → **C2 should hold; the live
  check is a visual confirmation.**
- **Shadow-DOM isolation — ✅ verified (static).** `content/index.ts` builds the
  overlay via `createShadowRootUi` on a single `<calyxa-overlay>` host anchored to
  `document.documentElement`, `cssInjectionMode: 'ui'` (stylesheet routed **into**
  the shadow root, not the host `<head>`). While closed the host footprint is
  zero (mount is deferred to `applySignedIn`). → **C1.**
- **No `tabCapture`/`desktopCapture` — ✅ verified (static).** Zero usages in
  `extension/src`; the only occurrence is the negative-assertion comment in
  `wxt.config.ts:50`. The beta OCR path stays deferred. (Matches security-review §5.)
- **Overlay host excluded from its own reads — ✅ verified (static).** Both the
  registry resolver (`isInsideOverlay` → `closest('calyxa-overlay')`) and the
  visible-text `TreeWalker` (`acceptNode` rejects anything under the overlay host)
  exclude the extension's own subtree, so annotations can't anchor to overlay
  chrome.

## 5. Code-level pre-verification — annotation resolve/drop contract

Substantiates C4 ahead of the live pass (`content/annotations.ts`):

- **Drop, never guess — ✅ verified (static).** `resolveTarget` returns
  `undefined` (→ dropped, `console.debug` only, reply unaffected) on every
  unresolved path; `resolveCappedAnnotations` skips dropped targets. No path
  fabricates a rect.
- **Per-turn cap — ✅ verified (static).** `MAX_ANNOTATIONS_PER_TURN = 3`, applied
  *before* resolution (defence-in-depth on the prompt cap).
- **Renderer coverage — ✅ verified (static).** Sub-term rect resolution dispatches
  on element shape: KaTeX (`.katex-html` leaf walk), MathJax (`mjx-math` visible ↔
  `mjx-assistive-mml` text token correlation, with a tag-shape guard), native
  `<math>` leaf walk. The `foldNotation` fix unifies "5t^2"/"5t²"/"5t^{2}" with a
  KaTeX textContent of "5t2". → the S1/S3 sub-term rows should draw tight boxes,
  not whole-equation boxes.
- **SPA re-anchor safety — ✅ verified (static).** `reanchorOne` re-verifies a
  `range` anchor still holds the exact matched text (`node.data.slice === matched`)
  before re-rect-ing, and drops `bbox` anchors on any scroll/resize — so an
  in-place SPA text rewrite can't mis-anchor. → underpins C6's "stale annotation
  drops cleanly."

**What the live pass adds that static can't:** jsdom does no layout
(`getBoundingClientRect` is zeros), so whether a target actually resolves to a
**visible on-page rect** — and whether the box lands on the *right* glyphs — is
only observable in a real browser. That is exactly what C4 is for.

## 6. The `tabs` permission drop — security-review filed item #2

Task 6 filed (`security-review-sprint18.md` §7.2): *"drop `tabs` only if URL→hash
still resolves in Task 7's real session."* Static analysis of every `tabs`/
`sender.tab` use in `background/index.ts`:

| Use site | What it reads | Needs `tabs` permission? |
|---|---|---|
| `deriveTabDomain(sender.tab?.url)` (lines 115, 126) | the **sender** content-script tab's `url` | **No** — `sender.tab.url` is exposed by the `<all_urls>` **host** permission, not `tabs` |
| `chrome.tabs.query({active,currentWindow})` → `tab.id` (line 365, toggle relay) | only `tab.id` | **No** — `tabs.query` runs without the permission; only sensitive props (`url`/`title`/…) are gated, and only `id` is read |
| `chrome.tabs.query({})` → `tab.id` (line 764, SESSION_STATE broadcast) | only `tab.id` | **No** — same as above |

**Static conclusion:** `tabs` appears **droppable** — the only URL read is
`sender.tab.url` (host-permission-covered) and the queries touch only `tab.id`.
**But this is exactly the claim ADR-044 says to verify live, not assert.** The
Chrome host-permission ↔ `sender.tab.url` behavior must be confirmed against the
real runtime.

**Live verification procedure (do NOT drop blind):**
1. In `wxt.config.ts`, remove `'tabs'` from `permissions` (leave `activeTab`,
   `scripting`, `storage`, and the host permissions).
2. Rebuild; load unpacked.
3. Start a session (send a turn) on any site; confirm the session row's
   `page_url_hash` is **non-null** in Supabase (URL→hash still resolved via
   `sender.tab.url`) — this is the `deriveTabDomain` path.
4. Confirm the keyboard-shortcut toggle still opens the panel (the `tab.id`
   query path) and SESSION_STATE still mounts/unmounts the pill across tabs on
   sign-in/out.
5. **If all pass →** drop is safe; commit the smaller manifest and note it in the
   security-review doc. **If `page_url_hash` goes null →** keep `tabs`, record the
   real dependency. Either outcome is a one-line manifest result recorded here.

| Result | ☐ pending live run — dropped / kept (with reason) |
|---|---|

## 7. How to run the live pass

```
# 1. Backend
npm --prefix web run dev            # localhost:3000 (API_BASE target)

# 2. Extension (rebuild — the snapshot is frozen)
npm --prefix extension run build    # writes extension/dist/chrome-mv3

# 3. Load unpacked
#    chrome://extensions → Developer mode → Load unpacked → extension/dist/chrome-mv3
#    Sign in (the pill only mounts for a signed-in user)

# 4. Walk S1–S4 (§2): open panel, take a text + a voice turn, watch annotations,
#    open DevTools on the host page to confirm C1/C2, and the extension's
#    service-worker + content consoles for C4 drop diagnostics.

# 5. Force the degradation paths (§3):
#    D2/D3 cost caps — cost-model.ts reads the caps as `Number(env) || default`,
#    so the override MUST be a POSITIVE integer: `0` is falsy and silently
#    falls back to the $50 default (it does NOT force the cap). Set on the web
#    dev server (restart it with the env prefix — a running server won't pick
#    up a new env):
#        COST_HARD_CAP_CENTS_OVERRIDE=1 npm --prefix web run dev
#            -> hard cap = 1 cent; the first real turn crosses it -> D2 ("resting")
#        COST_SOFT_CAP_CENTS_OVERRIDE=1 COST_HARD_CAP_CENTS_OVERRIDE=999999 npm --prefix web run dev
#            -> soft crossed, hard not -> D3 (turn proceeds, carries degraded:true)
#    (Unset/restart normally afterwards. A "resting" turn makes NO provider
#     call, so it adds no spend; but it reads the shared day ledger — prefer a
#     local/throwaway Supabase, never prod. See the Sprint 17 incident note.)
#    D1 free-tier — set FREE_SESSION_LIMIT low or exhaust it on a test user;
#        confirm the popup "on the house" card + that tutoring still works.
```

> **Cost-cap caution.** The cap overrides move the *shared* `cost_ledger` day
> counter that every process hitting the live project sees (Sprint 17 handoff).
> Run D2/D3 against a local/throwaway Supabase or a quiet window, and unset the
> overrides immediately after — do not leave a 0 hard cap set.

## 8. Results log (fill on the live run)

Live run 2026-07-11 (Darcy). PASS / PASS+filed / pending.

| Row | Result | Notes |
|---|---|---|
| S1 Khan Academy C1–C6 | ✅ PASS | incl. C6 SPA re-capture on client-side navigation |
| S2 MathJax C1–C5 | ✅ PASS + filed | tested `https://www.mathjax.org/` (project homepage, not a problem): overlay mounts, no host-DOM mutation, text box usable; no concept card = **correct** empty-scan for a non-problem page. Poor fallback UX → FU-1 |
| S3 KaTeX C1–C5 | ✅ PASS | |
| S4 plain/native C1–C5 | ✅ PASS + filed | tested `https://accessibility.psu.edu/math/mathml/` (MathML demo, not a problem): same as S2 → FU-1 |
| D1 free-tier over-limit (T7) | ✅ PASS | "on the house" card shown; tutoring continued |
| D2 cost hard-cap "resting" (T5) | ✅ PASS + filed | resting message correct + graceful; only shown *after* a prompt — proactive display → FU-2 |
| D3 cost soft-cap (T6) | ✅ PASS | turn proceeds, degraded flag carried |
| `tabs` permission drop (§6) | ✅ DROPPED | confirmed live 2026-07-12: new session wrote non-null `page_url_hash` with `tabs` removed; toggle/broadcast still work. `wxt.config.ts` updated, security-review §5/§6/§7.2 amended |

## 9. Filed / follow-ups

Both UX findings below are **behavior changes, out of Sprint 18's audit scope**
("Product features / AI / learning BEHAVIOR"), so per ADR-044 decision 4 they are
filed, not fixed in-sprint. Neither is a correctness defect — the current
behavior is correct, just improvable.

- **FU-1 — Crop-tool fallback when no problem is recognized (from S2/S4).** On a
  page with math but no curriculum-mapped problem, the opening scan correctly
  shows no concept card, but leaves the student at a blank composer. Requested:
  route to the existing crop/reframe flow (`ReframeTool.tsx` /
  `extractTextInRect` / the CheckinCard "no, other" entry point). Spawned as a
  background task. Target sprint TBD (Sprint 19 UX / Sprint 24 tutor-quality).
- **FU-2 — Proactive "resting" display (from D2/T5).** The cost-hard-cap message
  is only delivered as a reply after the student sends a turn; requested to show
  it on panel open, before a prompt is spent. Needs a cheap cap-status read (no
  Claude call). Spawned as a background task. Target: Sprint 19.
- **`tabs` permission drop (§6) — DONE, dropped 2026-07-12.** Static analysis
  said droppable; confirmed in a live session (new session wrote a non-null
  `page_url_hash` with `tabs` removed, toggle/broadcast still worked). Removed
  from `wxt.config.ts`; `security-review-sprint18.md` §5/§6/§7.2 amended from
  "filed" to "resolved". This was the one manifest change the matrix produced.

A genuinely beta-blocking failure (host-DOM mutation, a mis-anchored annotation,
a broken degradation path) is precisely what this gate exists to catch before
invites — none was found.

---

*Pre-verification (§4–§6) complete 2026-07-11. Live rows (§2–§3, §8) run
2026-07-11 (Darcy, Chrome + unpacked build): all sites + all three degradation
paths pass; two UX enhancements filed (§9); the `tabs` permission dropped and
verified live (§6). No open items.*
