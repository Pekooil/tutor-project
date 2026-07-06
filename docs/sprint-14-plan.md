# Sprint 14 — Session lifecycle, overlay UX cleanup, and tutor behavior tuning

## Goal
Make a tutoring session feel like **one problem, owned by the tutor** — and make the
overlay around it **clean, legible, and quietly informative**. This is the pre-beta
fix sprint: every item below was found by live use of the Sprint 11–13 surfaces, and
every one lands before the compliance/hardening/store sprints so the beta audits what
we actually ship. By the end:

1. **Sessions are automatic and problem-sized.** A session starts when the student
   sends their first turn (never from the popup), and **Calyxa detects when it is
   over**: the student solves the problem; or answers, declines the follow-up; or
   answers the follow-up correctly on a retry. On detection the tutor says
   **"Now closing tutoring session."**, the recap shows, a **green progress ring
   sweeps the X button** for a few seconds, and the panel closes with the transcript
   cleared. The popup's Start/End controls are **removed** — the popup becomes a
   sign-in + quota display only.
2. **A small solution-progress bar** lives in the composer: how far the student is
   from cracking *this* problem. It fills on correct reasoning steps, eases back a
   little on wrong ones, and reaching max **is** the solved end-condition — the bar
   and the auto-close are the same signal at two granularities.
3. **The title card gets real window controls**: **−** minimizes (today's ✕
   behavior — collapse to pill, session continues), **✕** ends the session (today's
   "End session" button behavior, now with the ring countdown). The old "End
   session" button and the Typing/Voice mode chip are **deleted**; Send becomes an
   **↵ enter-arrow icon button**.
4. **The overview/recap move above the composer** as a compact strip with a green
   auto-dismiss bar (visible a few seconds, then folds away — never blocking the
   transcript), and **profile/concept tags are color-coded by kind**.
5. **The tutor gets concise** — §2.5 Socratic, but short: no more wall-of-text
   explanation bubbles.
6. **Annotations get legible and proactive**: the **outlined box is the primary
   annotation** (circle/arrow are special cases), the model is steered to annotate
   whenever it references visible content, and the layer gains a **collision-free
   label layout** so per-component annotations of one expression never overlap.
7. **Pings fire meaningfully more often** — first-contact level-ups, large in-state
   gains, and "2 of 3 toward closing this gap" streak progress join the two Sprint 13
   kinds, with a per-concept session cap so more never becomes spam.

```
first turn sent ──▶ background auto-starts session (same atomic gate, ADR-007)
   turn N       ──▶ envelope { say, solution_progress, assessment, ... }
                      └─ composer bar eases toward the model's progress (clamped)
   solve / declined follow-up / corrected follow-up
                ──▶ envelope { session: { complete: true, reason } }
                      └─ "Now closing tutoring session." → end POSTed → recap strip
                         → green ring sweeps ✕ (~4s) → panel closes, transcript cleared
   next question──▶ next first turn auto-starts the next session
```

## Context
Sprints 11–13 shipped the adaptive loop and made it visible: per-turn envelope +
FSRS apply (ADR-019/020), the annotation layer (ADR-022/023), and the profile
surfaces — overview, tags, pings, recap (ADR-024/025/026). Live use (Sprint 13
Task 10 and after) surfaced a batch of UX and behavior defects that are cheaper to
fix now than to re-audit later: sessions are manually toggled from the popup, the
overview/recap sit inside the transcript flow, tutor replies run long, annotations
overlap when asked to label each component of an expression, the mode chip and the
Send/End-session buttons read stale, and the two Sprint 13 ping kinds fire too
rarely to feel alive. This sprint fixes all of it in one pass, plus the one filed
Sprint 13 live-find (page context captured at mount instead of panel expand).

### Decisions locked for this sprint (recorded in ADR-027/028/029)
1. **Session-end authority: AI-signaled, client-confirmed.** The model emits
   `session.complete` + `reason` in the envelope when one of the three named
   end-conditions holds; the client runs the visible close (say line → recap → ring
   → close). A pure client heuristic cannot see "declined the follow-up"; the model
   can. The client never ends a session on its own inference.
2. **Solution progress is model-emitted, client-clamped.** Only the model knows how
   many steps a problem has, so `solution_progress` (0–1) rides the envelope; the
   overlay smooths and clamps it (bounded per-turn regression, monotone easing) so
   jitter never thrashes the bar.
3. **Ping loosening is a defined contract, not "ping more".** Exactly three new
   event kinds (below), each computed by the model's own math in `events.ts`
   exactly as ADR-026 demands — the LLM still plays no part in pings.
4. **Voice latency is NOT this sprint.** The mic cold-start, time-to-first-audio,
   and voice-pinning work is Sprint 15 — it shares no files with this sprint's
   surfaces except `Overlay.tsx`, which is why the decomposition (Task 2) lands
   first there too.

### Reconciliation with `/docs/PLAN.md` (read before Task 1) — what this changes
- **§2.8 freemium semantics shift.** A "session" becomes problem-sized and
  auto-started. The atomic gate (ADR-007), the `start_session` RPC, its lazy 30-day
  reset, and `FREE_SESSION_LIMIT = 10` are all **unchanged** — but 10 free sessions
  now means **10 problems/month**, which is materially tighter than 10 sittings.
  This sprint deliberately does **not** retune the limit: the number is a product/
  cost decision that belongs with Sprint 16's cost-guardrail work, where aggregate
  spend data will exist. Recorded in ADR-027 and in "What the next sprint needs to
  know" so Sprint 16 cannot miss it.
- **Quota is burned on the first turn, never on overlay open.** Opening the panel,
  reading the overview, minimizing — none of it starts a session. The background
  auto-starts only when the first turn of a problem is actually sent. This keeps
  the §2.8 "a started session always corresponds to a counted use" invariant honest
  under auto-start.
- **§2.5 envelope grows two fields** (`solution_progress`, `session`) — additive,
  defensively parsed, absent-tolerant like every ADR-019 field. The wire shape is
  byte-identical when the model omits them.
- **The popup keeps its §2.8 role as a display hint** (remaining quota, degraded
  notice) and loses its session controls. Server-side enforcement is untouched.

### The completion signal and the progress bar are one contract (read before Tasks 3, 5, 6)
`solution_progress` reaching max **is** the "solved" end-condition seen at finer
grain. The model is prompted to score progress on genuine reasoning steps only and
to set `session.complete` with `reason: 'solved'` on the turn the student actually
cracks it — on that turn the client forces the bar to full before the close
choreography. The other two reasons (`'follow-up-declined'`, `'follow-up-corrected'`)
close the session **without** requiring a full bar: bar-max is one path to the end,
not the only one. The bar is **ephemeral overlay state** — reset on session end,
never persisted, not the mastery number and never labeled as such.

### The Overlay monolith is split before the surfaces change (read before Tasks 2, 6)
`Overlay.tsx` is 1,247 lines and owns every piece of overlay state. Five of this
sprint's items land in it (title-card controls, composer bar, insight strip, tag
colors, chip/button deletions), and Sprint 15's voice work lands in it again. Task 2
is a **pure decomposition** — TitleBar, Composer, InsightStrip, Transcript,
PingToasts extracted with **zero behavior change**, gated on the existing build +
tests — so Task 6's changes are local to small files and Sprint 15 inherits the
same seam. This was flagged as the Sprint 12/13 parallel-work blocker; it stops
being one here.

### Ping loosening reverses part of ADR-026's silence — deliberately (read before Task 4)
Sprint 13 kept first-contact transitions and in-state ticks silent on purpose. Live
use shows the result under-fires: sessions end with zero pings even when real
progress happened. The reversal is scoped, not open-ended — three new kinds, each
still computed prospectively from `computeNodeUpdate` (never by the LLM):
- **`mastery-up` gains two transitions**: `unseen->learning` and `unseen->mastered`
  (first contact that lands at a real level now celebrates).
- **`mastery-progress` (new)**: an in-state gain of ≥ **+0.10** mastery in one turn
  while in `learning` or `mastered` — "Progress: {title}".
- **`streak-progress` (new)**: a sound-correct that brings an active misconception
  to `RESOLUTION_STREAK − 1` — "Almost closed: {gap} (2 of 3)".
Newly *detected* misconceptions stay recap-only (that half of ADR-026 stands). The
overlay adds a **per-concept, per-kind session cap** (client-side seen-set) so the
looser thresholds cannot spam. ADR-026 gets an amendment, not a rewrite.

### Annotation legibility is a prompt problem AND a layout problem (read before Tasks 3, 7)
Overlap has two causes and needs both halves: the model annotates every component
of one expression with same-anchor labels (prompt half — steer to the **box** as
the default type, one annotation per distinct region, labels only where they add
information), and the layer places every label at the same offset from its anchor
rect (layout half — a small deterministic collision pass that stacks/offsets labels
with leader lines when their boxes would intersect, clamped to the viewport).
"Proactive" is also prompt-side: annotate whenever the reply references content
that PAGE CONTEXT shows on screen — the ≤3 cap and drop-don't-guess resolution
(ADR-022) are unchanged.

### Conciseness is a prompt contract with a measurable bound (read before Task 3)
"Be concise" doesn't gate; a bound does. The prompt gets a hard style rule — default
reply ≤ 3 sentences (~60 words); one idea per turn; longer only when the student
explicitly asks for a full explanation — and Task 9 measures median reply length
across a real session against the current baseline. TTS cost and voice latency both
fall out of shorter `say` strings for free (Sprint 15 banks this).

### The filed Sprint 13 live-find lands here (read before Task 5)
Page context is captured at overlay **mount** (page load for a signed-in user), so
on SPA pages (Khan Academy) the capture can run before the exercise renders and the
whole session goes context-blind. The intended discipline was fresh-per-open: Task 5
moves capture (and the Sprint 12 equation-registry refresh) to panel **expand**.

## Execution model
A **single code session** owns this sprint end to end, worked **strictly in order
(1 → 9)**. The chain is real: the ADRs fix the lifecycle/progress/legibility
decisions (Task 1); the decomposition (Task 2) must land green before any surface
changes; the web contract (Task 3) must emit progress + completion before the
extension can thread (Task 5) or render (Task 6) them; ping loosening (Task 4) is
web-only and feeds Task 6's toast rendering; annotation layout (Task 7) depends on
Task 3's prompt half; tests (Task 8) gate manual acceptance (Task 9). One session —
no handoff.

This sprint touches: `/web/lib/ai/{envelope,system-prompt}.ts`, `/web/app/api/ai/
turn/route.ts`, `/web/lib/learning/events.ts`, and on the extension side the
overlay (decomposed), the content script, the background worker, the transport
types, the popup, and `AnnotationLayer.tsx`. It does **not** touch `/supabase` (no
migration — progress and completion are ephemeral), the voice pipeline internals
(`VoiceController.ts`, `/web/app/api/voice/**` — Sprint 15), the learning
read/write path (`apply.ts`, `scheduler.ts`, `profile-read.ts`, `topic.ts` — only
`events.ts` changes), `/packages/curriculum`, `/packages/learning-model`, or the
session/auth routes (`start_session`/`end_session` RPCs and quota are reused
exactly as-is).

## Files in scope

### Task 1 (ADRs + sprint pointers) creates or edits:
```
/docs/adr/ADR-027-problem-sized-sessions.md   ← new — sessions auto-start on first turn / AI-signaled completion (3 named end-conditions, envelope `session` field), client-confirmed close choreography (say line → recap → ring → close+clear); popup demoted to display hint; quota burned on first turn never on open; FREE_SESSION_LIMIT deliberately NOT retuned here (Sprint 16 owns it, with the "10 problems/month" flag). REVISITS ADR-007's manual start (the gate itself is unchanged).
/docs/adr/ADR-028-solution-progress-signal.md ← new — solution_progress on the envelope (model-emitted 0–1, client-clamped: per-turn regression ≤0.2, floor 0.05, monotone easing; forced full on reason 'solved'); ephemeral, never persisted, never conflated with mastery; bar-max ≡ solved but completion ≠ bar-max (the other two reasons close without a full bar).
/docs/adr/ADR-029-annotation-legibility.md    ← new — the outlined box becomes the primary annotation type (circle/arrow special cases); proactive-when-referencing-visible-content prompt stance; deterministic label collision pass in the layer (stack/offset + leader lines, viewport-clamped); ≤3 cap + drop-don't-guess (ADR-022) unchanged. AMENDS ADR-026: the three new ping kinds + the reversal rationale + the client-side session cap.
/CLAUDE.md                                     ← edit one line: Current sprint → Sprint 14 — Session lifecycle, overlay UX cleanup, and tutor behavior tuning
/docs/CLAUDE.md                                ← edit one line: Current phase → Phase 2, Sprint 14
/docs/sprint-14-plan.md                        ← this file
/docs/architecture.md                          ← edit: sessions problem-sized + auto-managed; envelope gains solution_progress + session; overlay decomposed; popup = display only
```

### Task 2 (extension — Overlay decomposition, zero behavior change) creates / edits:
```
/extension/src/overlay/TitleBar.tsx    ← new — title card: logo/wordmark, the (existing) close control, session-state chrome. Pure presentational; props in, callbacks out.
/extension/src/overlay/Composer.tsx    ← new — input row: text input + caret measurement, mic button + level waveform, send control. Owns no session state.
/extension/src/overlay/InsightStrip.tsx← new — the overview/recap host (today they render where Sprint 13 put them; this task only MOVES the JSX into the component — placement changes in Task 6).
/extension/src/overlay/Transcript.tsx  ← new — message list + streaming tokens + profile-tag pills + typing indicator + scroll anchor.
/extension/src/overlay/PingToasts.tsx  ← new — the Sprint 13 toast rendering, extracted as-is.
/extension/src/overlay/Overlay.tsx     ← edit — becomes the state owner + composition root; all extracted JSX replaced by the five components; every piece of state, every handler, every effect KEPT — moved, not rewritten.
/extension/src/overlay/Overlay.css     ← edit — selectors regrouped per component; no visual change (Task 2 gate includes a pixel-level eyeball on a real page).
```

### Task 3 (web — the progress + completion contract; conciseness; annotation steering) edits:
```
/web/lib/ai/envelope.ts        ← edit — TurnEnvelope gains optional solution_progress (number, clamped to [0,1] at parse; non-numeric dropped) and session ({ complete: boolean, reason: 'solved'|'follow-up-declined'|'follow-up-corrected' }; malformed → field dropped, never a guessed close). Additive; every existing field and the degrade-to-plain-text path unchanged.
/web/lib/ai/system-prompt.ts   ← edit — three additive blocks + one style rewrite: (1) SESSION COMPLETION rules — emit session.complete on exactly the three end-conditions, with the closing say line "Now closing tutoring session."; (2) SOLUTION PROGRESS rubric — score genuine reasoning steps, small regression on errors, never jump to 1.0 without a real solve, 1.0 only with reason 'solved'; (3) ANNOTATION GUIDANCE amendments — box ("highlight", outlined-rect) is the DEFAULT type, circle/arrow only when shape adds meaning, one annotation per distinct region, annotate proactively when the reply references PAGE CONTEXT content, labels ≤5 words and only when they add information; (4) CONCISENESS — default say ≤3 sentences / one idea per turn; full explanations only on explicit request. Envelope schema block extended for the two new fields.
/web/app/api/ai/turn/route.ts  ← edit — thread solution_progress + session onto the response alongside reply/annotations/tags/pings; fields OMITTED when absent (back-compat byte-identical). persistInteraction UNCHANGED — neither field is persisted (ADR-028).
```

### Task 4 (web — ping loosening) edits:
```
/web/lib/learning/events.ts ← edit — TurnPingKind gains 'mastery-progress' + 'streak-progress'; MASTERY_UP_TRANSITIONS gains 'unseen->learning' + 'unseen->mastered'; mastery-progress fires on an in-state (learning|mastered) single-turn mastery delta ≥ +0.10 (threshold a named constant); streak-progress fires when a sound-correct brings an active misconception to RESOLUTION_STREAK − 1 (and is superseded by misconception-resolved on the completing turn — never both). Same prospective computeNodeUpdate discipline, same degrade-to-no-pings, same two indexed reads (no new query).
```

### Task 5 (extension — auto lifecycle + transport + the mount-capture fix) edits:
```
/extension/src/background/index.ts ← edit — handleAiTurn (and the AI_STREAM port's first message) auto-starts a session when storage.ActiveSession is empty: same api.startSession call the popup used, mode from the turn (text|voice), pageDomain from the sender tab; on failure the turn proceeds sessionless exactly as today (the route already degrades). On an AI reply whose session.complete is true, the background POSTs /api/session/end (existing path — recap + SESSION_ENDED broadcast fire exactly as Sprint 13 built) and clears ActiveSession. Popup START_SESSION/END_SESSION handlers kept (messages still valid) but nothing sends START_SESSION anymore.
/extension/src/lib/api.ts          ← edit — aiTurn() surfaces solution_progress + session from the response body; aiTurnStream's done payload likewise. Transport only.
/extension/src/types/messages.ts   ← edit — AiReplyPayload + the stream done message gain optional solutionProgress + session (mirroring envelope.ts by convention, like Annotation/ProfileTag before them). SessionStatePayload unchanged (popup still displays quota).
/extension/src/content/index.ts    ← edit — (a) threads the new payload fields to the overlay via the existing reply plumbing; (b) THE FILED SPRINT 13 FIX: extractPageContext() + the equation-registry refresh move from onMount to the panel-EXPAND signal (fresh-per-open, as intended); minimize/expand re-captures, mount does not.
/extension/src/popup/main.tsx      ← edit — Start/End session controls and their tab-domain derivation removed; the popup renders sign-in state, remaining quota, and the degraded notice only. No new capability.
```

### Task 6 (extension — the redesigned surfaces) edits:
```
/extension/src/overlay/TitleBar.tsx    ← edit — − (minimize: today's ✕ handler — collapse to pill, session continues, recap discipline unchanged) and ✕ (end session: today's End-session handler) with the green conic-gradient progress ring that sweeps ✕ (~4s) during the close choreography; the standalone "End session" button and the Typing/Voice mode chip are DELETED.
/extension/src/overlay/Composer.tsx    ← edit — the solution-progress bar: a thin, low-saturation track inside the composer frame, eased/clamped per ADR-028, forced full on 'solved', reset on session end; Send becomes an icon button (↵ enter-arrow glyph, aria-label="Send"); composer disabled during the close choreography.
/extension/src/overlay/InsightStrip.tsx← edit — overview (pre-question) and recap (post-session) render ABOVE the composer as a compact strip with the green auto-dismiss bar (~6s sweep, then folds to a one-line handle; hover/click re-expands; recap holds through the ring, then folds); color-coded per ProfileTagKind.
/extension/src/overlay/Transcript.tsx  ← edit — profile-tag pills pick up the same kind→color mapping; the "Now closing tutoring session." turn renders as a normal tutor bubble.
/extension/src/overlay/PingToasts.tsx  ← edit — renders the two new kinds; per-concept-per-kind session seen-set (the ADR-029 cap); kind→color mapping shared with the strip.
/extension/src/overlay/Overlay.tsx     ← edit — close-choreography state machine (reply.session.complete → recap wait → ring → collapse + clear transcript + reset bar), wired through the components; transcript clear on choreography completion only (minimize never clears).
/extension/src/overlay/Overlay.css     ← edit — strip placement, progress bar/ring, tag-kind colors mapped to @calyxa/ui custom properties.
/packages/ui/src/theme.css             ← edit — ADDITIVE named aliases only (e.g. --calyxa-tag-reviewing, --calyxa-tag-gap, --calyxa-tag-due, --calyxa-tag-strength, --calyxa-tag-callback, --calyxa-progress) mapped to EXISTING palette tokens — no new colors, no changed values (ADR-018 discipline).
```

### Task 7 (extension — annotation layout engine) edits:
```
/extension/src/overlay/AnnotationLayer.tsx ← edit — (a) "highlight" renders as the PRIMARY box: a clean outlined rounded-rect (stroke, transparent fill) rather than the thin underline-reading translucent rect; circle/arrow renderings unchanged; (b) deterministic label collision pass over each turn's draw list: labels default adjacent to their box; intersecting labels stack/offset with a short leader line to their anchor; placements viewport-clamped; pure function over rects (unit-testable, no DOM measurement beyond the rects already in the draw list).
/extension/src/overlay/Overlay.css         ← edit — box + leader-line styles (shadow-root-scoped, classes only — ADR-002).
```

### Task 8 (tests) creates / edits:
```
/web/tests/envelope.test.ts       ← edit — solution_progress parsing (valid / out-of-range clamped / non-numeric dropped); session parsing (all three reasons; malformed dropped — a bad completion NEVER closes a session); absent-fields back-compat.
/web/tests/ai-turn.test.ts        ← edit — route threads solution_progress + session when present, omits when absent; session_interactions row shape unchanged (neither field persisted).
/web/tests/events.test.ts         ← new or edit — the two added transitions ping; mastery-progress at ≥ +0.10 in-state (and not below, and not from unseen); streak-progress at RESOLUTION_STREAK − 1; superseded by misconception-resolved on the completing turn; degrade-to-empty preserved.
/extension/tests/annotations.test.ts ← edit — the label collision pass: non-overlapping inputs untouched; same-anchor stacks resolve with zero intersections; viewport clamping; determinism (same input → same layout).
/extension/tests/lifecycle.test.ts   ← new — pure helpers: the progress clamp/easing reducer (regression bound, floor, forced-full on solved) and the close-choreography state machine (complete → recap → ring → closed; minimize during choreography does not clear; composer disabled during ring).
```

### Files explicitly out of scope
```
/supabase/**                            (NO migration — progress + completion are ephemeral; ADR-028)
/web/lib/learning/{apply,scheduler,profile-read,topic}.ts  (the FSRS loop is untouched; only events.ts changes)
/web/lib/tier/session-gate.ts           (FREE_SESSION_LIMIT deliberately NOT retuned — Sprint 16, ADR-027)
/web/app/api/{auth,voice,session}/**    (start/end routes reused as-is; voice is Sprint 15)
/extension/src/overlay/VoiceController.ts (mic cold-start is Sprint 15)
/extension/src/content/{annotations,pageExtractor}.ts (resolver + registry unchanged; layout lives in the layer; the capture-timing fix is content/index.ts only)
/web/lib/ai/{claude,page-context,profile}.ts (unchanged)
/packages/{curriculum,learning-model}/** (Sprint 15 / untouched)
```
Also out of scope (no pre-empting later roadmap sprints):
- **Retuning FREE_SESSION_LIMIT for problem-sized sessions** — Sprint 16's cost
  work owns the number, with real spend data (ADR-027 flags it loudly).
- **Voice latency, mic cold-start, TTS voice pinning** — Sprint 15.
- **Curriculum expansion** — Sprint 15.
- **The confidence-vs-correctness mismatch decision** (Sprint 13 rollover) — still
  pending; nothing here builds it.
- **A persisted ping/event log, session history, annotation replay** — ephemeral
  stays ephemeral (ADR-023/025 instincts).

Do not create any file not listed above. If something seems needed but is not
listed, add it to "What the next sprint needs to know" and ask before creating it.

---

## Task 1 — Lifecycle + progress + legibility ADRs + sprint pointers (planning / docs)

Write ADR-027, ADR-028, ADR-029 in the project format (match ADR-001…ADR-026
exactly), covering the decisions in Context — including the three locked
end-conditions verbatim, the quota-semantics flag for Sprint 16, the clamp
constants, the three new ping kinds with thresholds, and the ADR-026 amendment.
Update the sprint pointers and `/docs/architecture.md`.

Acceptance gate before Task 2:
  - All three ADRs read as decisions (context → decision → consequences), not
    summaries; the ADR-026 amendment is cross-referenced from ADR-029; pointers
    updated; no code touched.

---

## Task 2 — Overlay decomposition, zero behavior change (extension)

Scope: the five new components + `Overlay.tsx` + `Overlay.css` only. **Move, don't
rewrite**: every state hook stays in `Overlay.tsx`; the components receive props/
callbacks; no handler logic changes; no visual change.

  - Extraction order: PingToasts (most isolated) → InsightStrip → TitleBar →
    Composer → Transcript. After each extraction: `wxt build` + typecheck green.
  - The caret-measurement span, the level-meter rAF loop, and the drag handlers
    move with their JSX but keep their refs in `Overlay.tsx` (passed down) — the
    point is smaller files, not a state redesign.
  - `Overlay.css` regrouped per component with a header comment each; selector
    names unchanged (no visual diff).

Acceptance gate before Task 3:
  - `turbo run typecheck lint build test` green; `Overlay.tsx` under ~400 lines;
    a real page eyeball (open, converse, voice turn, tags, pings, recap, close)
    shows pixel-identical behavior.

---

## Task 3 — Web: the progress + completion contract; conciseness; annotation steering

Scope: `envelope.ts`, `system-prompt.ts`, `turn/route.ts`. Additive contract,
prompt blocks per the Files-in-scope annotations.

  - `envelope.ts`: parse discipline mirrors the existing fields — clamp
    `solution_progress` to [0,1]; drop (never default) a malformed `session`; a
    dropped completion is a **non-close**, the safe failure.
  - `system-prompt.ts`: the three end-conditions are spelled out with one worked
    example each (solved; answered-then-declined-follow-up; corrected-follow-up);
    the closing say line is exact: "Now closing tutoring session."
  - Conciseness rewrite tightens the §2.5 pedagogy block's style rules without
    touching the hard rules (never-give-the-answer discipline unchanged).
  - Route: thread-through only; nothing new persisted; grounding gate (ADR-024)
    untouched.

Acceptance gate before Task 4:
  - Envelope tests (written here, formalized in Task 8) pass; a live
    `/api/ai/turn` call against a dev session shows progress on an ordinary turn,
    a completion on a solved turn, and median say length visibly down; the wire
    shape with both fields absent is byte-identical to Sprint 13.

---

## Task 4 — Web: ping loosening (learning lib)

Scope: `events.ts` only, per the Files-in-scope annotation. Thresholds as named
constants; the superseding rule (streak-progress never fires on the turn
misconception-resolved fires) explicit.

Acceptance gate before Task 5:
  - `events.test.ts` covers all four kinds + the superseding rule + degrade path;
    a simulated session that would have produced zero Sprint 13 pings produces
    ≥1 under the new thresholds (the fixture that motivated the change).

---

## Task 5 — Extension: auto lifecycle + transport + the mount-capture fix

Scope: `background/index.ts`, `lib/api.ts`, `types/messages.ts`,
`content/index.ts`, `popup/main.tsx`, per the Files-in-scope annotations.

  - Auto-start is **lazy and idempotent**: checked at turn-send under the
    background's existing turn serialization; a start failure degrades to a
    sessionless turn (today's behavior), never a blocked turn.
  - Auto-end reuses the existing end path so the recap + SESSION_ENDED broadcast
    are byte-identical to a popup-triggered end.
  - The capture-timing fix: expand → `extractPageContext()` + registry refresh;
    re-expand re-captures; mount does not capture.

Acceptance gate before Task 6:
  - On a real page: first sent turn creates the session row (verified in the DB);
    opening/minimizing the panel creates nothing; a solved problem auto-ends and
    the recap arrives; the popup shows quota but has no session buttons; on an SPA
    page, expanding after a client-side navigation captures the NEW page's math.

---

## Task 6 — Extension: the redesigned surfaces

Scope: the five components + `Overlay.tsx` + `Overlay.css` + the additive
`theme.css` aliases, per the Files-in-scope annotations.

  - The close choreography is a small explicit state machine (idle → completing →
    ring → closed) in `Overlay.tsx`; the ring is CSS (conic-gradient sweep, ~4s);
    transcript clear happens exactly once, at choreography completion; minimize
    never clears.
  - The strip's auto-dismiss bar and the composer's progress bar are visually
    distinct by design (ADR-028): strip = brighter green, transient, attention-
    grabbing; composer bar = thin, low-saturation, persistent. Mastery bars stay
    in the overview panel only.
  - Tag-kind colors come from the new aliases; nothing hard-codes a hex.

Acceptance gate before Task 7:
  - Full lifecycle on a real page reads clean: overview strip folds away on its
    own; tags are color-coded; bar creeps up over a multi-turn solve, eases back
    on a wrong answer, fills on the solve; "Now closing tutoring session." →
    ring → close → transcript gone; − minimizes without ending; AA contrast spot-
    check on the new strip/tags/bar against `/docs/brand.md` pairs.

---

## Task 7 — Extension: annotation layout engine

Scope: `AnnotationLayer.tsx` + `Overlay.css`, per the Files-in-scope annotations.
The collision pass is a pure exported function (draw-list rects in, placed labels
out) so Task 8 tests it without a browser.

Acceptance gate before Task 8:
  - "Annotate each component of x² + 5x + 6" on a real page yields non-overlapping
    boxes + labels with leader lines where stacked; boxes read as the primary
    vocabulary; circle/arrow still render when the model chooses them.

---

## Task 8 — Tests (gate)

Scope: per the Files-in-scope annotations. All pure-logic: no browser harness, no
network; the extension specs extend the Sprint 12 vitest setup.

Acceptance gate before Task 9:
  - `turbo run test` green across workspaces; the new specs fail meaningfully when
    their guarded behavior is broken (spot-check by reverting one constant).

---

## Task 9 — Lifecycle + surfaces acceptance (manual)

On a real math page (Khan Academy included, exercising the Task 5 capture fix),
signed in as a real dev user:

  1. Open the panel: no session row; overview strip above the composer, folds
     itself away.
  2. Ask a question (text): session auto-starts (row verified); progress bar
     seeds low.
  3. Work the problem across ≥4 turns with one deliberate wrong answer: bar
     advances on sound steps, eases back once; replies are short (median say ≤3
     sentences across the session); at least one ping fires; tags are color-coded.
  4. Ask the tutor to annotate each component of the expression: boxes, no
     overlaps, labels legible.
  5. Solve it: "Now closing tutoring session." → recap strip (deltas + next
     reinforcements) → green ring sweeps ✕ → panel closes, transcript cleared.
  6. Reopen and start a second problem: fresh session row; decline the follow-up
     after answering: session closes via reason 'follow-up-declined' with the same
     choreography (bar not full — correct).
  7. − minimizes mid-problem without ending (row still open); re-expand resumes
     with transcript intact and page context re-captured.
  8. Popup: quota display only; no session controls anywhere.
  9. Voice turn smoke: the voice path carries progress/completion identically
     (latency itself is Sprint 15's business).

Record the median-reply-length before/after numbers and any prompt-tuning residue
in the plan's checklist notes.

## Acceptance criteria (full checklist)

- [ ] ADR-027/028/029 written; ADR-026 amended; pointers + architecture.md updated
- [ ] Overlay decomposed into TitleBar/Composer/InsightStrip/Transcript/PingToasts with zero behavior change; Overlay.tsx ≲400 lines
- [ ] Envelope carries solution_progress + session; malformed completion drops (never closes); wire back-compat byte-identical when absent
- [ ] Prompt: three end-conditions + exact closing line; progress rubric; box-first proactive annotation guidance; ≤3-sentence default conciseness
- [ ] Sessions auto-start on first turn only (open/minimize never starts); auto-end on completion; popup has no session controls; quota display intact
- [ ] Page context + equation registry captured on panel EXPAND (Sprint 13 live-find fixed); SPA re-expand captures fresh
- [ ] − minimizes (never clears), ✕ ends with green ring (~4s) then close + transcript clear; "End session" button and Typing/Voice chip deleted; Send is the ↵ icon
- [ ] Solution-progress bar: thin/low-saturation in the composer; clamped easing; forced full on 'solved'; reset per session; visually distinct from the strip's auto-dismiss bar
- [ ] Overview/recap render above the composer as the auto-dismissing strip; tags color-coded via new theme.css aliases (additive tokens only)
- [ ] Pings: two added transitions + mastery-progress (≥ +0.10 in-state) + streak-progress (streak − 1), superseding rule enforced, per-concept-per-kind session cap client-side
- [ ] Annotations: outlined box primary; label collision pass yields zero overlaps on the each-component fixture; drop-don't-guess + ≤3 cap unchanged
- [ ] No migration; nothing new persisted; /api/ai/turn still writes exactly the Sprint 11 row shape
- [ ] `turbo run typecheck lint build test` green across workspaces; Task 9 manual pass complete with reply-length numbers recorded

## Risks

**The model under- or over-signals completion.** A missed signal strands a session
open (the old manual world, minus the button); a false signal closes mid-problem.
Mitigation: the three conditions are spelled out with worked examples; a malformed
`session` field drops (non-close is the safe failure); ✕ remains the manual end for
a stranded session; Task 9 exercises all three reasons live. If false closes show
up in beta, the fix is prompt-side tightening, not architecture.

**Progress-bar jitter erodes trust.** A bar that whipsaws teaches students to
ignore it. Mitigation: client clamp (bounded regression, monotone easing) is the
contract, not a hope; the rubric tells the model what progress *means*; the bar is
deliberately small and unlabeled (no percentages to argue with).

**Quota semantics tighten silently.** Problem-sized sessions make 10/month feel
much smaller; a beta tester hits the wall in one sitting. Mitigation: flagged in
ADR-027 and handed to Sprint 16 by name; degradation (not lockout) already softens
the wall; the popup still shows remaining quota honestly.

**The decomposition regresses something subtle.** 1,247 lines of interleaved state
moving into five files is the sprint's mechanical risk. Mitigation: move-don't-
rewrite discipline, per-extraction build gates, the Task 2 pixel eyeball, and the
existing test suite staying green before any surface work begins.

**Looser pings overshoot into spam.** Mitigation: three defined kinds with named
thresholds (not "ping more"), the per-concept-per-kind session cap, and the
superseding rule; tuning is a constants edit recorded for the beta feedback loop.

**The close choreography races the recap.** SESSION_ENDED (recap) arrives async
from the background while the ring runs. Mitigation: the state machine waits for
the recap (or a short timeout) before starting the ring, so the recap strip is
visible during the sweep; a recap-less end (timeout) still closes cleanly —
Sprint 13's recap-less path already renders sensibly.

**Prompt changes fight each other.** Completion rules, progress rubric, annotation
steering, and conciseness all land in `system-prompt.ts` in one task. Mitigation:
one task owns the file (no interleaving), each block is additive and separately
eyeballed live at the Task 3 gate, and Task 9 measures the combined effect.

## What the next sprint needs to know

**Sessions are problem-sized, tutor-owned, and the overlay is componentized.**
The envelope now carries `solution_progress` + `session`; the background auto-
starts/ends; the popup is a display hint only; page context captures on expand;
annotations are box-first with a collision-free layout; pings fire on four kinds
with a client cap; the overlay lives in five components + a thin state root.

- **Sprint 15 (curriculum + voice)** inherits the decomposition: mic work lands in
  `Composer.tsx`/`VoiceController.ts` without touching the other surfaces; the
  conciseness rewrite already shortened `say`, which the TTS latency work banks.
- **Sprint 16 (cost + compliance) MUST revisit `FREE_SESSION_LIMIT`**: 10 free
  problem-sized sessions/month is materially tighter than 10 sittings (ADR-027's
  flag). It also inherits the global cost-guard design with per-problem sessions
  as the metering unit.
- **The store/hardening sprints** audit the new surfaces (strip, bar, ring, tag
  colors) — the AA spot-check in Task 6 is not the formal audit.
- **The ping thresholds, clamp constants, ring duration, and strip dwell** are
  named constants — beta-feedback tuning is a constants pass, not a redesign.
- **The confidence-vs-correctness mismatch decision** (Sprint 13 rollover) is
  still pending, unchanged by this sprint.
