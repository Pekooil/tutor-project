# Sprint 07 — Screen capture + content extraction

## Goal
Make Calyxa **see what the student is looking at**. By the end, a signed-in student
opens the overlay on a page with a math problem and the tutor can **reference the
specific content on their screen** — "let's start with the x² + 5x + 6 in the first
problem" — instead of asking them to retype it. This fills the one slot the prompt has
held empty since Sprint 05:

```
overlay open → content script reads host-page math (text + LaTeX/MathML)
            → PageContext → AI turn → system prompt PAGE CONTEXT slot → Claude
```

The content lands the only way the locked **DOM policy** allows: the content script
**reads** the host page (it never mutates it), captures a bounded `PageContext` on
overlay open, and sends it with the AI turn the same overlay → content → **background
worker** (sole network-egress context) → backend path Sprint 05 built. The §2.5
prompt's `PAGE CONTEXT (injected)` block — hardcoded to "(no page context this turn)"
through Sprint 06 — is now filled.

This sprint ships the **stable** content path only: **read-only DOM extraction of text
+ LaTeX/MathML**, which needs **no capture permission and no permission prompt** (PLAN
§2.6). Despite this sprint's brief title ("Screen capture + content extraction"), PLAN
§2.6 is explicit that the **primary path is NOT screen capture — it is read-only DOM
extraction**; the **beta image-equation path** (`chrome.tabs.captureVisibleTab` →
Mathpix OCR / Claude vision) is a separate, flag-gated deliverable that is **deferred**
to its own sprint. That divergence between the brief's title and PLAN §2.6's stable/beta
split is recorded in **ADR-012**, the same way Sprint 06 recorded its Whisper-vs-Deepgram
split in ADR-010.

**Page content is never persisted this sprint** (mirroring the audio-never-persisted
discipline of ADR-011). `PageContext` is read fresh on overlay open, sent with the turn
over TLS, injected into the prompt, and discarded — there is **no migration and no DB
write** (the learning tables still do not exist — ADR-009). URL hashing
(`sessions.page_url_hash`), `page_domain` analytics, and any persistence of what the
student studies land with the learning/DB sprint, not here. The **annotation layer**
(element rects / `bbox` / `targetSelector`) still has **no consumer** (ADR-008), so the
extractor reads **text + equations only** — no rects, no annotations this sprint. Output
stays **plain text** (the §2.5 JSON envelope remains deferred — ADR-008/ADR-010).

## Context
Sprint 05 delivered the **text AI tier** and Sprint 06 the **voice tier**, both routed
overlay → content (`sendAiTurn` / `sendVoiceStt` / `sendVoiceTts`) → background → backend.
The §2.5 system prompt is assembled in `/web/lib/ai/system-prompt.ts`
(`buildSystemPrompt(profile)`), called by `runTutorTurn` in `/web/lib/ai/claude.ts`,
behind `/api/ai/turn`. Through Sprint 06 the prompt's `PAGE CONTEXT (injected)` block is
**hardcoded empty** — `system-prompt.ts:63-66` literally says "(no page context this
turn)" and "Do not claim to see anything on the student's screen." The content script
(`/extension/src/content/index.ts`) is **strictly read-only and only relays messages**:
its header documents the locked DOM policy and notes it "adds no host-page read." This
sprint is the **first time Calyxa reads the host page at all**.

Locked decisions from `/CLAUDE.md` and `/docs/CLAUDE.md` that drive it:
- **DOM policy: content script reads only. No mutations to host page DOM.** The
  extractor **reads** visible text and math nodes; it writes nothing to the host page.
  The overlay's `<calyxa-overlay>` shadow host (ADR-002) remains the only DOM the
  extension owns, and the extractor **excludes** it from what it reads (the overlay must
  never read its own UI back as "page content").
- **Overlay strategy: shadow DOM.** Unchanged — the overlay still lives in its closed
  shadow root; this sprint adds reading the *light* DOM, not writing it.
- **All API keys server-side.** No new keys this sprint; the extractor and `PageContext`
  carry no secret and no new SDK ships to the bundle.
- **Free tier limits enforced server-side.** Untouched — page context does not gate.

### Reconciliation with `/docs/PLAN.md` (read before Task 1) — extraction path + scope
There are **two** divergences to record here, the same way Sprint 06 recorded its split
from PLAN in ADR-010.

**(a) Stable path is DOM extraction, not screen capture.** This sprint's brief is titled
"**Screen capture** + content extraction," but **PLAN §2.6** is explicit: *"Primary path
is NOT screen capture — it's read-only DOM extraction"* of visible text, MathML
(`<math>`), and LaTeX source (KaTeX/MathJax expose it in
`<annotation encoding="application/x-tex">`, `data-*`, `aria-label`). The DOM path "needs
no capture permission, no permission prompt, and produces clean, high-confidence
structured math directly" — it is the **stable V1 content path**. The
`chrome.tabs.captureVisibleTab` → **Mathpix OCR / Claude vision** route is the **beta**
image-equation path, gated behind the server feature flag `features.image_capture` and
explicitly only *beta* in PLAN §1's acceptance ("Text + LaTeX stable; image equations
beta; diagrams/video post-V1"). This sprint therefore **ships the stable DOM path** and
**defers the beta capture/OCR path** (no `captureVisibleTab`, no `activeTab`/capture
permission, no `/extract/equation` route, no Mathpix/vision) to its own sprint. The
brief's "Text + LaTeX extraction" line is exactly the stable path. ADR-012 records this.

**(b) Scope — extract + inject now; annotations and persistence deferred.** PLAN §2.5/§2.6
bundle the full content feature: extraction **+ element rects for annotation**, the §2.5
**JSON output envelope** that carries `annotations`, and **URL hashing + `page_domain`
persistence** into the `sessions` table. This sprint takes the **next crisp slice** — read
the page, inject it, let the tutor reference it — and **defers**:
- the **annotation layer** (element rects / `bbox` / `targetSelector` / overlay
  highlighting): still **no consumer** (output stays plain text — ADR-008), so the
  extractor reads text + equations only and carries no rects,
- the **beta image-OCR capture path** (see (a)),
- **page-context persistence**: URL hashing (`page_url_hash`), `page_domain` analytics,
  and any record of what the student studies — the **learning/DB sprint** (no tables yet,
  ADR-009; page context is **ephemeral** this sprint),
- the §2.5 **JSON output envelope** (`say`/`annotations`/`assessment`) — still no
  consumer (ADR-008).

Keeping the slice to extract→inject makes the acceptance crisp ("ask about the equation
on your screen; the tutor references it") and leaves the annotation sprint a focused
rects-and-rendering problem against a page-context seam that already works. This split is
recorded in **ADR-012**.

### Page-context-never-persisted model (read before Tasks 2–3, 5–6)
Page content reveals what a student studies (PLAN §2.7 treats the visited URL as
sensitive), so this sprint treats it the way ADR-011 treats audio — **ephemeral by
construction**: (1) the extractor runs in the content script and hands `PageContext`
straight into the AI turn payload; (2) `/api/ai/turn` injects it into the prompt and
**writes nothing** — no migration, no DB write (the learning tables do not exist —
ADR-009); (3) nothing stores the page text, and **URL hashing / `page_domain`** (PLAN
§2.7) is **not** done this sprint (it lands with the `sessions` table). ADR-013 records
this and Task 4 asserts `/api/ai/turn` still writes nothing on a turn carrying page
context.

### Page-context budget + truncation model (read before Tasks 2, 5)
PLAN §2.5's per-turn budget gives **page context ~1,500 tokens**, "truncated to the
equations/text nearest the student's focus." This sprint enforces a **bounded
`PageContext`** structurally on **both** sides: the extractor caps what it reads
(per-field char caps + a max number of equations) so a giant page can never push a
multi-megabyte body through messaging, and `renderPageContext()` on the server applies
the **authoritative** caps again before the string reaches the prompt (the client cap is
a courtesy; the server cap is the budget guarantee, mirroring how the freemium gate is
server-authoritative). Equation extraction is prioritised over raw page text (equations
are the high-value signal); raw text is truncated first when over budget.

### Extraction-correctness model (read before Tasks 5, 7)
The extractor is a set of **per-renderer adapters** over a single read pass (PLAN §2.6
"extractor adapters per renderer"; MathJax/KaTeX expose LaTeX inconsistently across
versions — that is the named blocker/risk in PLAN §2.10 Sprint 2). It reads, in priority
order: **MathML** `<math>` nodes; **LaTeX source** from KaTeX
(`<annotation encoding="application/x-tex">`), MathJax v3 (`mjx-container` +
`script[type="math/tex"]`), and `data-*`/`aria-label` carriers; and **visible text**
(`innerText` of the main content, capped). It **excludes the `<calyxa-overlay>` host** so
the overlay never reads itself. When extraction finds **nothing** (e.g. canvas/image-only
math), `PageContext` is empty and the prompt falls back to the Sprint 05 wording ("ask the
student to describe or type the problem") — never a hallucinated read. Task 7 verifies
across the **5 representative site types** PLAN §2.10 names (KaTeX, MathJax, MathML,
plain-text, and an image-only page that correctly yields empty context).

## Execution model
A **single code session** owns this sprint end to end, worked **strictly in order
(1 → 7)**. The dependency chain is real: the `PageContext` type + renderer + prompt
injection (Task 2) must exist before the route accepts it (Task 3); the route must accept
and be tested (Task 4) before the extension has a server that consumes page context; the
extractor + types (Task 5) must exist before the content script can wire capture into the
turn (Task 6); manual cross-site E2E + acceptance (Task 7) is last. Respect the per-task
**scope** lines as a focus discipline, but it is one session — no handoff.

This sprint **does** touch `/web/lib/ai/*` and `/web/app/api/ai/turn/route.ts` — the AI
turn that Sprint 06 deliberately reused unchanged is now **extended** to accept page
context (ADR-013). It **does** touch the content script (`src/content/index.ts`) and adds
a new `pageExtractor.ts` — this is the sprint that turns on host-page reads. The overlay
changes are **minimal and presentational** (a small "reading your page" indicator). The
**popup, auth, session, freemium gate, voice routes/lib, and the Claude client's model
call** are **reused unchanged**.

## Files in scope

### Task 1 (planning / docs) creates or edits:
```
/docs/adr/ADR-012-page-context-extraction.md   ← new — read-only DOM extraction is the stable path; screen-capture/OCR beta deferred; brief-vs-PLAN §2.6 divergence; annotations deferred
/docs/adr/ADR-013-page-context-injection.md    ← new — page context injected per-turn into /api/ai/turn (extends the Sprint 05 seam); ephemeral, never persisted; bounded/truncated
/CLAUDE.md                                       ← edit one line: Current sprint → Sprint 07 — Screen capture + content extraction
/docs/CLAUDE.md                                  ← edit one line: Current phase → Phase 1, Sprint 7
/docs/sprint-07-plan.md                          ← this file
```

### Web — page-context model + prompt injection (Task 2) creates / edits:
```
/web/lib/ai/page-context.ts      ← new — PageContext type + renderPageContext(ctx) with the §2.5 caps (per-field char caps, max equations, equations-before-text truncation); server-side budget authority
/web/lib/ai/system-prompt.ts     ← edit — buildSystemPrompt(profile, pageContext?) fills the PAGE CONTEXT slot from renderPageContext(); keeps the "(no page context)" fallback + "never invent" rule when empty
/web/lib/ai/claude.ts            ← edit — runTutorTurn({ messages, pageContext? }) threads pageContext into buildSystemPrompt; model call/budget otherwise unchanged
```

### Web — AI turn route (Task 3) edits:
```
/web/app/api/ai/turn/route.ts    ← edit — parse + validate + cap an OPTIONAL pageContext field; pass to runTutorTurn; absent pageContext behaves exactly as Sprint 05/06 (back-compat); no DB write
```

### Test (Task 4) edits:
```
/web/tests/ai-turn.test.ts       ← edit — add: page context reaches the prompt (the tutor can reference it), turn WITHOUT pageContext still works (back-compat), oversized/garbage pageContext is rejected/truncated not crashed, bearer still required, no DB write on a page-context turn
```

### Extension — extractor + types (Task 5) creates / edits:
```
/extension/src/content/pageExtractor.ts  ← new — read-only DOM extraction (MathML + LaTeX/KaTeX/MathJax + visible text); per-renderer adapters; excludes <calyxa-overlay>; bounded; no mutation; no chrome.*
/extension/src/types/messages.ts         ← edit — add PageContext type (mirrors /web/lib/ai/page-context.ts) + add optional pageContext to AiTurnPayload; keep all existing types + comments
```

### Extension — wire capture on overlay open (Task 6) creates / edits:
```
/extension/src/content/index.ts    ← edit — capture PageContext via pageExtractor on overlay open (onMount); hold at module scope; include in sendAiTurn payload; still relay-only, still excludes the shadow host; no mutation
/extension/src/overlay/Overlay.tsx ← edit — minimal presentational "reading your page" indicator (e.g. a chip showing N equations detected); knows nothing about chrome.* or extraction internals
/extension/src/overlay/Overlay.css ← edit — style for the page-context indicator chip, shadow-root-scoped (on .mm-overlay/children, never :host; ADR-002)
/extension/src/overlay/mount.tsx   ← edit — thread the captured page-context summary into <Overlay …/> (extend the mountOverlay options)
```

## Files explicitly out of scope
```
/extension/src/popup/*           (sign-in/launcher unchanged — Sprint 04)
/extension/src/overlay/VoiceController.ts (voice capture unchanged — Sprint 06)
/extension/src/background/index.ts (worker relays AI_TURN unchanged — pageContext rides inside the existing AI_TURN payload, no new message type)
/web/app/api/voice/*             (voice proxies unchanged — Sprint 06)
/web/lib/voice/*                 (Whisper/ElevenLabs/latency unchanged — Sprint 06)
/web/app/api/session/*           (session lifecycle + freemium gate unchanged)
/web/app/api/auth/*              (bearer/cookie auth unchanged — Sprint 04)
/web/lib/auth/bearer.ts          (reused as-is; the route imports it, does not change it)
/web/lib/ai/profile.ts           (hardcoded profile unchanged — ADR-009)
/supabase/migrations/*           (NO migration this sprint — page context is ephemeral; no tables, no URL-hash persistence)
/packages/*                      (shared package extraction still deferred)
/docs/PLAN.md                    (the DOM-vs-capture divergence is recorded in ADR-012, not by editing PLAN this sprint)
/extension manifest permissions  (DOM read needs none; activeTab/captureVisibleTab is the deferred beta path — no permission added)
```

Also out of scope this sprint (no pre-empting later work):
- **Beta image-equation capture.** `chrome.tabs.captureVisibleTab`, the `activeTab`/
  capture permission, `OffscreenCanvas` crop, the `/extract/equation` route, **Mathpix
  OCR** and **Claude vision** fallback, and the `features.image_capture` flag gating —
  the **screen-capture/OCR sprint** (PLAN §2.6 beta path; ADR-012).
- **The annotation layer.** Element rects, `bbox`, `targetSelector`, overlay highlighting
  of on-page math — still no consumer; output stays plain text (ADR-008). The extractor
  reads no rects this sprint.
- **The §2.5 JSON output envelope** (`say`/`annotations`/`assessment`) — deferred
  (ADR-008/ADR-010); replies stay plain conversational text.
- **Page-context / URL persistence.** URL normalisation + `SHA-256(salt‖url)` →
  `sessions.page_url_hash`, `page_domain` analytics, and `detected_topic` — the
  **learning/DB sprint** (no tables yet, ADR-009). Nothing about the page is stored.
- **Voice-streaming work** (sentence-level overlap, VAD, the live-audio port relay) —
  the voice-streaming sprint (ADR-010 follow-up). This sprint touches the AI turn, not
  the voice legs; a captured page context is injected on voice turns too (it rides the
  same `/api/ai/turn`), but no streaming change is made here.
- **The live learning profile / learning model / new tables** — the profile stays
  hardcoded (ADR-009).
- **Model routing/escalation** (Haiku → Sonnet → Opus) — one default model still.
  (Claude vision for OCR is part of the deferred beta capture path, above.)

Do not create any file not listed above. If something seems needed but is not listed,
add it to "What the next sprint needs to know" and ask before creating it.

---

## Task 1 — Page-context extraction + injection ADRs + sprint pointers (planning / docs)

Write two ADRs using the project's ADR format (match ADR-001…ADR-011 exactly):

```
## ADR-0NN: [Title]
**Status:** Decided
**Context:** [why this needed a decision]
**Decision:** [what was chosen]
**Rationale:** [bullets — why]
**Consequences:** [Enables / Requires / Forecloses]
```

ADR-012 — Page context comes from read-only DOM extraction (stable); screen-capture/OCR
is beta and deferred:
- Context: the locked DOM policy lets the content script **read** the host page but never
  mutate it, and the §2.5 prompt has held an empty `PAGE CONTEXT` slot since Sprint 05.
  The brief is titled "**screen capture** + content extraction," but **PLAN §2.6** states
  the **primary path is NOT screen capture — it's read-only DOM extraction** (text +
  MathML + LaTeX), which needs no capture permission and yields clean structured math;
  `captureVisibleTab` → Mathpix/Claude-vision is the **beta** image-equation path, flag-
  gated (`features.image_capture`) and only *beta* in PLAN §1's acceptance. A shape
  decision was needed: build the beta capture/OCR path now (rejected — needs the
  `activeTab`/capture permission, a new backend OCR route, Mathpix + vision, and a server
  feature flag, and PLAN ships it only as *beta*), or **ship the stable DOM path now** and
  defer capture. Annotation (element rects) was also in PLAN's content bundle but has no
  consumer (output is plain text, ADR-008).
- Decision: this sprint extracts page content via **read-only DOM extraction** in the
  content script — **MathML, LaTeX (KaTeX/MathJax), and visible text**, via per-renderer
  adapters, excluding the `<calyxa-overlay>` shadow host, bounded to the §2.5 page-context
  budget. **No screen capture, no capture permission, no OCR, no vision, no annotation
  rects** — those (the beta image path and the annotation layer) are **deferred** to their
  own sprints. The brief-vs-PLAN §2.6 divergence and the stable/beta line are recorded
  here.
- Rationale (bullets): the DOM path is the stable, high-confidence, zero-permission V1
  content path (PLAN §2.6); it needs no manifest permission change and no backend OCR
  route, so it ships behind the existing read-only content script; deferring capture keeps
  the acceptance crisp ("ask about the equation on your screen; the tutor references it")
  and matches PLAN's own *beta* designation for image equations; the annotation layer has
  no consumer yet (ADR-008), so reading rects now would be dead weight; per-renderer
  adapters localise the known MathJax/KaTeX version-inconsistency risk (PLAN §2.10).
- Consequences: Enables — a tutor that references the math on the student's screen, and a
  `PageContext` seam the annotation and beta-capture sprints extend without reshaping.
  Requires — the content script to read but never mutate the host page (DOM policy); the
  extractor to exclude the overlay's own shadow host; bounded extraction (no unbounded
  page text through messaging); this ADR revisited when the beta capture path is built
  (it adds `activeTab`/capture permission, `/extract/equation`, Mathpix + vision, and the
  `features.image_capture` flag). Forecloses — any host-page **mutation**; any screen
  capture / OCR / vision call this sprint; reading annotation rects with no consumer.

ADR-013 — Page context is injected per-turn into `/api/ai/turn` and is never persisted:
- Context: the extracted `PageContext` has to reach the §2.5 prompt's `PAGE CONTEXT` slot.
  The middle leg `/api/ai/turn` was **reused unchanged** through Sprint 06; injecting page
  context now **extends** it. Page content reveals what a student studies (PLAN §2.7 treats
  the URL as sensitive), so we had to decide how it travels and whether it persists.
- Decision: extend `/api/ai/turn` (and `runTutorTurn` / `buildSystemPrompt`) to accept an
  **optional** `pageContext`; it is **captured on overlay open**, rides **inside the
  existing `AI_TURN` payload** (no new message type, no new route, no change to the
  background relay), is **rendered + truncated server-side** to the §2.5 budget by
  `renderPageContext()` (the authoritative cap), injected into the prompt, and then
  **discarded**. **No migration and no DB write** occur on a page-context turn; **URL
  hashing / `page_domain` persistence (PLAN §2.7) is not done this sprint** — page context
  is **ephemeral** (mirroring the audio-never-persisted discipline of ADR-011). A turn
  **without** `pageContext` behaves exactly as Sprint 05/06 (the empty-slot fallback).
- Rationale (bullets): riding the existing `AI_TURN` payload reuses the Sprint 05/06 relay
  + bearer seam rather than standing up a new route/message; an optional field keeps full
  back-compat (voice turns and mic-less turns still work); server-side render+truncate
  makes the §2.5 budget a guarantee, not a client courtesy; not persisting page content
  keeps the sensitive "what is the student studying" signal off every durable surface
  until the DB sprint adds the salted URL hash deliberately.
- Consequences: Enables — a prompt anchored to the student's actual screen content, on
  both text and voice turns, with no new transport. Requires — `renderPageContext()` to
  enforce the page-context budget server-side; the route to treat `pageContext` as
  untrusted input (validate, cap, never crash on garbage); `/api/ai/turn` to keep writing
  nothing to the DB (Task 4 asserts this). Forecloses — persisting page text or the URL
  this sprint; the §2.5 JSON envelope / annotations (still deferred, ADR-008).

Then make two one-line edits:
- /CLAUDE.md: change the "Current sprint" line to
    Sprint 07 — Screen capture + content extraction
- /docs/CLAUDE.md: change "Current phase" from "Phase 1, Sprint 6" to
    "Phase 1, Sprint 7"

Do not change any other line in either CLAUDE.md.

Acceptance gate before Task 2:
  - ADR-012 and ADR-013 exist and follow the ADR format exactly; ADR-012 records the
    brief-vs-PLAN §2.6 stable-DOM-vs-beta-capture divergence; ADR-013 records the
    ephemeral, never-persisted, rides-inside-AI_TURN injection.
  - Both CLAUDE.md sprint-pointer lines are updated and nothing else changed.

---

## Task 2 — Page-context model: type + renderer + prompt injection (web)

Scope: /web/lib/ai (page-context.ts, system-prompt.ts, claude.ts). No route change yet.

/web/lib/ai/page-context.ts (new):
  - `export type PageEquation = { latex?: string; mathml?: string; text?: string }` — one
    on-page equation in whatever form the extractor recovered it.
  - `export type PageContext = { title?: string; text?: string; equations: PageEquation[] }`
    — the bounded per-turn page snapshot (no URL, no rects — ADR-012/ADR-013).
  - `export function renderPageContext(ctx: PageContext): string` — render to the bounded
    string the prompt injects, applying the **§2.5 caps server-side** (the authoritative
    budget): a max number of equations (e.g. `MAX_EQUATIONS ≈ 12`), a per-equation char cap,
    and a page-text char cap, **prioritising equations over raw text** (truncate text first
    when over budget). Return a compact block like "On the student's screen:\n- equation:
    …\n- equation: …\n\nPage text (excerpt): …". Mirror the §2.5 budget-discipline comment
    style already in `system-prompt.ts` (`renderProfileSummary`).
  - Export the caps as named constants so Task 5's client-side caps can reference the same
    intent (the server cap stays authoritative).

/web/lib/ai/system-prompt.ts (edit):
  - `buildSystemPrompt(profile: LearningProfile, pageContext?: PageContext): string`.
  - When `pageContext` is present **and non-empty**, replace the hardcoded
    "(no page context this turn)" / "Do not claim to see anything…" block with
    `renderPageContext(pageContext)` plus the §2.5 "Anchor the session to THIS content.
    Refer to 'the equation on your screen,' not abstractions." wording (PLAN §2.5 lines
    751-755). When absent/empty, **keep the exact Sprint 05 fallback** ("(no page context
    this turn)" + "ask the student to describe or type the problem instead"). The
    HARD RULES "NEVER invent page content you cannot see" line stays in both cases.

/web/lib/ai/claude.ts (edit):
  - `runTutorTurn({ messages, pageContext }: { messages: TurnMessage[]; pageContext?:
    PageContext })` — pass `pageContext` into `buildSystemPrompt`. Model, `MAX_TOKENS`, and
    the single-call shape are otherwise unchanged (ADR-008). Import `PageContext` from
    `./page-context`.

When done, list files created/edited and paste page-context.ts, the changed
buildSystemPrompt, and the changed runTutorTurn.

Acceptance gate before Task 3:
  - `cd web && npm run typecheck && npm run lint` pass.
  - `renderPageContext` enforces the equation/char caps and truncates text before
    equations; an empty `PageContext` renders nothing (callers fall back to the empty-slot
    wording).
  - `buildSystemPrompt(profile)` (no page context) produces the **exact** Sprint 05/06
    prompt (back-compat); `buildSystemPrompt(profile, ctx)` injects the rendered context.

---

## Task 3 — AI turn route: accept + validate page context (web)

Scope: /web/app/api/ai/turn/route.ts only. (The voice routes and `/lib/ai/profile.ts`
are untouched.)

/web/app/api/ai/turn/route.ts (edit):
  - Keep `clientFromBearer` + the existing `parseMessages` gate unchanged (401 on no/bad
    bearer; 400 on bad `messages`). Add a `parsePageContext(body)` that reads an
    **optional** `pageContext`: if absent → `undefined` (turn proceeds exactly as Sprint
    05/06). If present, validate it is the `PageContext` shape and **cap it defensively**
    (max equations, per-field length) — treat it as **untrusted client input** that must
    never crash the route or blow the token budget; on a malformed/oversized
    `pageContext`, either **drop it to `undefined`** (preferred — degrade to no page
    context rather than 400 the whole turn) or 400 with a clear message. Pick drop-to-empty
    so a flaky extractor never blocks a turn; note the choice in a comment.
  - Pass the parsed `pageContext` into `runTutorTurn({ messages, pageContext })`. The
    provider-failure path stays the sanitised 502 ("Tutor is unavailable right now.").
  - **No DB write, no migration** — the route still persists nothing (ADR-013). State this
    in the file header / a comment.

When done, paste the changed route and state explicitly that (a) a turn with no
`pageContext` is byte-for-byte the Sprint 06 behaviour, (b) page context is validated +
capped as untrusted input, (c) the route writes nothing to the database.

Acceptance gate before Task 4:
  - `cd web && next build`, typecheck, lint pass.
  - With a valid bearer: `POST /api/ai/turn` **with** a small `pageContext` returns a
    reply that can reference it; **without** `pageContext` returns the Sprint 06 reply.
  - No/garbage bearer → 401. Bad `messages` → 400. Garbage/oversized `pageContext` does
    not crash the route (degrades to no page context) and never blows the budget.

---

## Task 4 — AI turn test: page-context injection + back-compat + no-persistence (gate)

Scope: /web/tests/ai-turn.test.ts (extend the existing suite; reuse its local
fake-Anthropic backend so no live model call is made and no real `ANTHROPIC_API_KEY` is
needed). Add cases asserting:
1. **Page context reaches the prompt:** with a `pageContext` carrying a known equation,
   `POST /api/ai/turn` causes the fake Anthropic backend to receive a `system` prompt that
   **contains that equation** (the tutor can reference on-screen content) — assert on the
   captured request the fake backend sees.
2. **Back-compat (no pageContext):** a turn with `messages` only still succeeds and the
   captured `system` prompt contains the **empty-slot fallback** wording (unchanged
   Sprint 05/06 behaviour).
3. **Untrusted input:** an oversized / malformed `pageContext` does **not** 500 — the turn
   still returns a reply (degraded to no page context) and the captured prompt is within
   budget (no unbounded page text injected).
4. **Bearer still required:** no/invalid bearer → 401, fake backend **never called**.
5. **No persistence:** a page-context turn writes nothing to the DB (assert as the suite
   already asserts for Sprint 05 turns — no new row; ADR-013).

When done, paste the new/changed cases and the passing output.

Acceptance gate before Task 5:
  - The suite passes: page context is injected into the prompt; turns without it are
    unchanged; garbage page context degrades rather than crashes; bearer gate intact; no
    DB write.
  - No live Anthropic call (the existing local fake backend is reused).

---

## Task 5 — Extension: read-only page extractor + types

Scope: /extension/src/content/pageExtractor.ts (new), /extension/src/types/messages.ts.

/extension/src/content/pageExtractor.ts (new) — the **read-only** DOM extractor
(browser-only; **no `chrome.*`**, **no mutation**, no persistence):
  - `export function extractPageContext(): PageContext` (sync read pass) — gather, via
    **per-renderer adapters**:
    - **MathML:** all `<math>` nodes → `{ mathml }` (and their text as a fallback `text`).
    - **LaTeX:** KaTeX (`<annotation encoding="application/x-tex">`), MathJax v3
      (`mjx-container`, `script[type="math/tex"]`), and `data-*` / `aria-label` carriers →
      `{ latex }`. De-duplicate (KaTeX renders both MathML and the annotation; prefer one).
    - **Visible text:** `innerText` of the main content (e.g. `<main>`/`<article>` if
      present, else `document.body`), collapsed/trimmed.
  - **Exclude the `<calyxa-overlay>` host** (and anything inside it) from every query so
    the overlay never reads its own UI back as page content.
  - **Bound the result** with client-side caps mirroring `page-context.ts` (max equations,
    per-field + total char caps) so a huge page never produces a huge message; the server
    cap stays authoritative (Task 2).
  - Reads only — never sets an attribute, style, or node on the host page (DOM policy).
    Return an **empty** `PageContext` (`{ equations: [] }`) when nothing math-like is found
    (image/canvas-only pages) so the prompt falls back cleanly.

/extension/src/types/messages.ts (edit):
  - Add `PageEquation` + `PageContext` types **mirroring `/web/lib/ai/page-context.ts`**
    (note the source of truth in a comment, like the existing `LatencyTrace` mirror).
  - Extend `AiTurnPayload` to `{ messages: TurnMessage[]; pageContext?: PageContext }` —
    page context rides **inside the existing `AI_TURN` message** (no new `MessageType`).
    Document that page context is a **single bounded snapshot per turn**, captured on
    overlay open, read-only, and **never persisted** (ADR-012/ADR-013). Keep all existing
    types and the comment block.

When done, list files edited and paste `extractPageContext` and the changed
`AiTurnPayload` / new `PageContext` types.

Acceptance gate before Task 6:
  - `cd extension && npm run typecheck` passes; `wxt build` exits 0.
  - `extractPageContext` reads MathML + LaTeX (KaTeX/MathJax) + visible text, excludes the
    `<calyxa-overlay>` host, is bounded, mutates nothing, and imports no `chrome.*`.
  - `AiTurnPayload.pageContext` is optional; no new `MessageType` was added.

---

## Task 6 — Wire capture on overlay open into the AI turn (extension)

Scope: /extension/src/content/index.ts, /extension/src/overlay/{Overlay.tsx,Overlay.css,
mount.tsx}.

/extension/src/content/index.ts (edit):
  - On **overlay open** (in `createShadowRootUi`'s `onMount`, before/at mount), call
    `extractPageContext()` once and hold the result at module scope (re-captured each time
    the overlay opens — a fresh read per open, never stored). The capture runs in the
    content context (the only place with host-DOM access); the overlay never imports the
    extractor.
  - In `sendAiTurn`, include the captured `pageContext` in the `AI_TURN` payload
    (`{ messages, pageContext }`). The background relay and `/api/ai/turn` consume it; **no
    background change** is needed (it forwards the payload as-is).
  - Still **relay-only + read-only**: the extractor reads, `sendAiTurn` relays; the content
    script makes **no host-page mutation** and the extraction **excludes** the shadow host.
  - Pass a small **page-context summary** (e.g. equation count) into `mountOverlay` so the
    overlay can show the indicator without seeing the raw context.

/extension/src/overlay/Overlay.tsx (edit) — **presentational only** (no `chrome.*`, no
extractor import):
  - Accept an optional `pageContext` summary prop (e.g. `{ equationCount: number }` or a
    boolean "context attached"). Render a small **"reading your page" / "N equations on
    screen" chip** so the student knows the tutor can see their screen. No behaviour change
    to `onSend`/voice; if no context was captured, show nothing (or a subtle "type/paste
    your problem" hint matching the prompt fallback).

/extension/src/overlay/Overlay.css (edit) — style the indicator chip, shadow-root-scoped
(on `.mm-overlay`/children, never `:host`; ADR-002). Keep the existing panel layout.

/extension/src/overlay/mount.tsx (edit) — extend `mountOverlay`'s options to thread the
page-context summary into `<Overlay …/>`. Keep React mounting here so the content script
never imports react-dom.

When done, list files edited and describe the full flow (overlay open → content
`extractPageContext` (read-only, excludes shadow host) → held at module scope → included
in `AI_TURN` payload → background relay → `/api/ai/turn` → `renderPageContext` → prompt
`PAGE CONTEXT` slot → Claude references it), and confirm: no host-page mutation, no new
permission, no persistence, page context absent ⇒ Sprint 06 behaviour.

Acceptance gate before Task 7:
  - `wxt build` exits 0; typecheck passes.
  - Opening the overlay on a math page captures page context once; an AI turn carries it
    and the tutor can reference on-screen content; the overlay shows the indicator.
  - The overlay imports no `chrome.*` and no extractor; the content script adds reads only
    (git diff shows extraction + payload wiring, **no host-page mutation**); the
    `<calyxa-overlay>` host is excluded from extraction; no manifest permission added.

---

## Task 7 — Cross-site extraction + reference acceptance (manual)

This is the sprint's headline acceptance: **a student opens the overlay on a math page
and the tutor references the specific content on their screen — with no host-page
mutation, no capture permission, and nothing about the page persisted.**

With `cd web && next dev` running (`ANTHROPIC_API_KEY` set in `/web/.env.local`; voice
keys optional) and the unpacked extension loaded:
  1. Open the popup → sign in with a Sprint 03/04 test account (sign-in unchanged).
  2. **KaTeX site:** open a page that renders math with KaTeX, open the overlay
     (Ctrl+Shift+Y), and ask "what's the first equation on my screen?" → the tutor names
     the actual equation and gives a **Socratic** nudge (not the final answer).
  3. **MathJax site / MathML site / plain-text math site:** repeat across the **5
     representative site types** PLAN §2.10 names; confirm the tutor references real
     on-screen content on each.
  4. **Image/canvas-only math (empty context):** open a page whose math is only an image →
     `PageContext` is empty → the tutor **does not hallucinate** a read; it asks the
     student to type/paste the problem (the empty-slot fallback). This is the boundary the
     beta capture/OCR path (deferred — ADR-012) will later cover.
  5. **Reference quality:** ask a follow-up → the reply stays anchored to the page content
     and prior turns (history is sent each turn).
  6. **Voice turn (if voice keys set):** ask about the on-screen equation **by voice** →
     the spoken reply references it (page context rides the same `/api/ai/turn` on a voice
     turn).
  7. **No mutation:** confirm the host page is byte-for-byte unchanged apart from the
     `<calyxa-overlay>` shadow host (DOM-diff) — extraction reads, never writes; the
     overlay's own shadow content is excluded from what was read.
  8. **No new permission:** confirm the built manifest requests **no** `activeTab` /
     `tabCapture` / capture permission added this sprint (DOM read needs none).
  9. **Nothing persisted:** confirm a page-context turn writes no DB row and stores no page
     text/URL (no migration this sprint; `/api/ai/turn` writes nothing — Task 4 asserts).
  10. **Signed-out:** sign out → a turn shows "not signed in" / the sign-in prompt; no
      anonymous AI call succeeds (the route still 401s) even with page context attached.

---

## Acceptance criteria (full checklist)

- [ ] `npm install` and `turbo run typecheck lint build` pass from the repo root with the
      new web + extension files present
- [ ] `cd web && next build` exits 0; `wxt build` exits 0
- [ ] **No migration this sprint**: `/supabase/migrations` is unchanged; a page-context
      turn writes nothing to the database and persists no page text or URL (ADR-013)
- [ ] **Stable path only**: page content comes from **read-only DOM extraction** (MathML +
      LaTeX/KaTeX/MathJax + visible text); **no** screen capture, OCR, vision, or capture
      permission this sprint (the beta image path is deferred — ADR-012)
- [ ] The content script **reads** the host page but **mutates nothing**; the extractor
      excludes the `<calyxa-overlay>` shadow host; the overlay stays in shadow DOM
- [ ] `PageContext` is **bounded** on both client (extractor caps) and server
      (`renderPageContext` is the authoritative §2.5 budget cap; equations before text)
- [ ] `/api/ai/turn` accepts an **optional** `pageContext`, validates/caps it as untrusted
      input, injects it via `buildSystemPrompt`, and **a turn without it is byte-for-byte
      Sprint 06 behaviour** (back-compat)
- [ ] Page context rides **inside the existing `AI_TURN` payload** — no new `MessageType`,
      no new route, no background-relay change
- [ ] The §2.5 prompt `PAGE CONTEXT` slot is **filled** when context is present and falls
      back to the "never invent / ask them to type it" wording when empty
- [ ] Output stays **plain text** (no JSON envelope, no annotations — ADR-008); no
      annotation rects extracted (no consumer yet)
- [ ] The ai-turn test passes: page context injected into the prompt; no-context turns
      unchanged; garbage page context degrades not crashes; bearer gate intact; no DB
      write — all with no live Anthropic call
- [ ] The tutor **references specific content from the student's page** across the 5
      representative site types; image-only pages yield empty context and no hallucinated
      read (Task 7)
- [ ] `/extension/src/popup/*`, `/extension/src/overlay/VoiceController.ts`, the background
      worker, `/web/app/api/voice/*`, `/web/lib/voice/*`, `/web/app/api/session/*`,
      `/web/app/api/auth/*`, `/web/lib/auth/bearer.ts`, and `/web/lib/ai/profile.ts` are
      untouched
- [ ] No manifest permission added (DOM read needs none); host page unchanged apart from
      the `<calyxa-overlay>` shadow host
- [ ] ADR-012 and ADR-013 exist; both CLAUDE.md sprint pointers updated
- [ ] git log shows commits for this sprint's tasks

---

## Risks

**Reading the host page is a new privilege — DOM-policy drift.** This is the first sprint
that touches the host DOM at all; the easy wrong path is a convenience write (injecting a
highlight, setting an attribute). Mitigation: the extractor is **read-only by
construction** (it queries and reads, never sets); the annotation/highlight layer is
explicitly deferred (ADR-012); Task 7 DOM-diffs the host page to byte-for-byte (apart
from the shadow host); the content-script header's read-only contract is preserved.

**The extractor reading its own overlay.** If extraction runs over the whole document it
can pick up the overlay's shadow content and feed the tutor's own UI back as "page
content." Mitigation: every query **excludes the `<calyxa-overlay>` host** and its
subtree; Task 6/7 verify the captured context contains page math, not overlay text.

**MathJax/KaTeX expose LaTeX inconsistently across versions** (named blocker, PLAN §2.10
Sprint 2). Mitigation: **per-renderer adapters** (KaTeX annotation, MathJax v3
`mjx-container`/`script[type=math/tex]`, MathML, `data-*`/`aria-label`) with MathML/text
fallbacks; Task 7 tests the 5 representative site types; when nothing parses, context is
empty and the prompt falls back rather than guessing.

**Page content is sensitive but un-gated by persistence discipline.** Page math reveals
what a student studies (PLAN §2.7). Mitigation: page context is **ephemeral** — captured
on open, sent over TLS, injected, discarded; **no DB write, no migration, no URL hash**
this sprint (ADR-013); persistence (the salted `page_url_hash`) is a deliberate later
deliverable, not a side effect here. Task 4 asserts no DB write on a page-context turn.

**Unbounded page text blowing the token budget or messaging.** A huge page could push a
massive `innerText` through `chrome.runtime.sendMessage` and the prompt. Mitigation:
**bounded on both sides** — client caps in the extractor, **server-authoritative caps** in
`renderPageContext` (equations prioritised, text truncated first); the §2.5 ~1,500-token
page-context budget is the target.

**Untrusted `pageContext` crashing the route.** The route now takes client-supplied
structured input. Mitigation: `/api/ai/turn` validates + caps `pageContext` and
**degrades to no page context** on anything malformed rather than 500-ing the turn; Task 4
asserts garbage input still returns a reply.

**Building the beta capture/annotation pipeline by reflex.** The brief says "screen
capture," and PLAN bundles capture + OCR + annotation with extraction. Mitigation:
ADR-012 and the out-of-scope list fix the line at the **stable read-only DOM path**;
capture (`captureVisibleTab` + Mathpix/vision + `features.image_capture`) and the
annotation layer are their own sprints.

**Changing `/api/ai/turn`'s contract for voice/text turns.** Sprint 06 reused this route
unchanged; extending it risks breaking voice or mic-less turns. Mitigation: `pageContext`
is **optional**; the no-context path is byte-for-byte Sprint 06 (Task 4 back-compat
assertion); page context rides the existing `AI_TURN` payload so voice turns get it for
free without a voice-leg change.

---

## What the next sprint needs to know

**The tutor can see the student's screen (stable DOM path) and reference it.** A
signed-in extension reads the host page's math read-only on overlay open and injects a
bounded `PageContext` into the same `/api/ai/turn` that powers text and voice; the next
sprints **enrich** this seam, they do not rebuild it.
- **Extraction (ADR-012):** `/extension/src/content/pageExtractor.ts` does read-only
  MathML + LaTeX (KaTeX/MathJax) + text extraction, per-renderer adapters, excludes the
  `<calyxa-overlay>` host, bounded. The **screen-capture/OCR sprint** adds the **beta**
  image-equation path on top: `chrome.tabs.captureVisibleTab` in the worker (image never
  crosses `sendMessage`), `OffscreenCanvas` crop, a new `/extract/equation` route running
  **Mathpix OCR** + **Claude vision** fallback, the `<0.80` confidence "Did I read this
  right?" check, and the server-driven `features.image_capture` flag — all normalising to
  the **same `PageContext` math shape** this sprint defined.
- **Injection (ADR-013):** `/web/lib/ai/page-context.ts` (`PageContext` +
  `renderPageContext`) is the source of truth for the page-context shape + budget;
  `/api/ai/turn` injects it optionally and writes nothing. The **annotation sprint** adds
  element **rects** to the extractor, the §2.5 **JSON output envelope**
  (`say`/`annotations`/`assessment`), and overlay highlighting of on-page math — attaching
  to this `PageContext` seam (extend `PageEquation` with a rect/selector).
- **Persistence (deferred):** page content + URL are **ephemeral** this sprint. The
  **learning/DB sprint** adds the `sessions` table with the **salted `SHA-256(salt‖url)`
  `page_url_hash`** (raw URL never stored), `page_domain` analytics, and `detected_topic`
  (PLAN §2.7) — page context is recorded deliberately there, not as a side effect here.

**Deferred to later sprints (deliberately not built):**
- Beta image-equation **capture + OCR/vision** + `features.image_capture` gating — the
  **screen-capture/OCR sprint** (ADR-012; PLAN §2.6 beta path).
- The **annotation layer** (rects / `bbox` / `targetSelector` / highlighting) and the
  §2.5 **JSON output envelope** — still no consumer (ADR-008); output stays plain text.
- **Page-context / URL persistence** (salted `page_url_hash`, `page_domain`,
  `detected_topic`) — the learning/DB sprint (no tables yet, ADR-009).
- **Voice-streaming** (sentence-level overlap, VAD, live-audio port relay) and the <2.5s
  voice round-trip — the voice-streaming sprint (ADR-010 follow-up). Page context already
  rides voice turns via the shared `/api/ai/turn`.
- The live **learning profile / learning model / new tables** (profile stays hardcoded —
  ADR-009), **model routing/escalation**, and the `/packages` extraction.
