# Sprint 14 — Session lifecycle, overlay UX cleanup, and tutor behavior tuning

## Goal
Make a tutoring session feel like **one problem, owned by the tutor** — and make the
overlay around it **clean, legible, and quietly informative**. This is the pre-beta
fix sprint: every item below was found by live use of the Sprint 11–13 surfaces, and
every one lands before the compliance/hardening/store sprints so the beta audits what
we actually ship. By the end:

1. **Sessions are automatic and problem-sized.** A session starts the moment the
   tutor engages with a real problem — either because the student sends a turn, or
   (Task 4/6, added same-day) because the **opening scan** finds one the instant the
   panel expands — never from the popup. **Calyxa detects when it is over**: the
   student solves the problem; or answers, declines the follow-up; or answers the
   follow-up correctly on a retry. On detection the tutor says
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
8. **The panel opens already looking at the problem** (added same-day, ADR-030): the
   instant the panel expands on a page with a real problem, the tutor — with no
   student message yet sent — frames it with an annotation and asks **"Looks like
   you're working on [x]. Is that what you need help with?"**, grounded in the
   student's actual profile and, when genuinely relevant, a real prior session
   ("this connects to the factoring work from a few sessions ago"). This **is** the
   session start (amends item 1 above) — the pre-question overview renders
   alongside it, not instead of it.
9. **Annotation ↔ text is color-linked, and annotations get more frequent still**
   (added same-day, ADR-029 amendment): whenever the tutor's reply names something
   it's also annotating, the exact phrase in the chat bubble and the box on the
   page share one color, so the student can trace "this sentence" to "that box" at
   a glance — and "annotate when it helps" becomes the default expectation, not an
   occasional flourish.

```
panel EXPAND ──▶ capture PageContext + equation registry (fresh, per Task 6)
   │
   ├─ plausible problem found ──▶ opening scan fires (Task 4/6, ADR-030)
   │                                 session STARTS here
   │                                 └─ envelope { say: "is this the one?", annotations,
   │                                               profileTags? }  (no assessment)
   │                                 overview strip renders alongside
   │
   └─ nothing found ──▶ panel opens empty; overview strip only; session waits for
                          the student's first SENT turn (fallback trigger, unchanged)

   turn N       ──▶ envelope { say, solution_progress, assessment, annotations, ... }
                      └─ composer bar eases toward the model's progress (clamped)
                      └─ annotated phrase in `say` + its on-page box share one color
   solve / declined follow-up / corrected follow-up
                ──▶ envelope { session: { complete: true, reason } }
                      └─ "Now closing tutoring session." → end POSTed → recap strip
                         → green ring sweeps ✕ (~4s) → panel closes, transcript cleared
   next question──▶ next opening scan or next sent turn starts the next session
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

### Scope extension (2026-07-05, after Task 2 landed) — the opening scan and color-linked annotations
Darcy asked for two more features while Task 2 (overlay decomposition) was already
in flight. Both are folded in here rather than deferred, because Tasks 1 and 2 are
the only committed work and neither collides with either addition:

1. **The proactive opening scan** (new ADR-030): on panel expand, if the freshly
   captured `PageContext` shows a real problem, the tutor acts first — annotating
   it and asking whether that's the one, grounded in the student's real profile and
   (when genuinely relevant) a real prior session. This is a **new, AI-initiated
   turn kind** with no student message behind it, and it forces a decision Task 1's
   ADR-027 didn't anticipate: opening the panel can now be a real, billable AI call.
   **Darcy's call: open-with-a-detected-problem is now the session start** — not a
   free diagnostic call, not a second quota rule. ADR-027 is **amended** (not
   rewritten) to record the reversal; ADR-030 is the opening scan's own contract.
   This changes the renumbered Task 6 (was Task 5): the auto-start trigger moves
   from "first sent turn only" to "open-with-a-detected-problem, first-sent-turn as
   the fallback when nothing was detected at open."
2. **Color-linked, more-frequent annotations** (ADR-029 amendment, no new ADR): the
   existing "annotate proactively when referencing visible content" guidance
   (Task 3, item 6 above) is tightened from a permission to an expectation, and the
   on-page box now shares a color with the exact phrase in the chat bubble that
   refers to it. This needs **no new envelope field** — a `textMatch` annotation's
   `target.text` is already the exact phrase from PAGE CONTEXT; the client matches
   that same text inside `say` and colors both with one palette slot, assigned
   deterministically per turn. This folds into the existing Tasks 3/7/8 (renumbered
   below) rather than becoming its own task.

Both additions are annotation/lifecycle work — squarely the subsystems this sprint
already owns — so no new sprint, no renumbering of Sprint 15. **Task numbers 3
onward are renumbered** below (Tasks 1–2 are committed and untouched); a new Task 4
carries the opening scan's web contract, and Tasks 6–10 (formerly 5–9) absorb the
extension-side wiring and the color-link rendering.

### Decisions locked for this sprint (recorded in ADR-027/028/029/030)
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
5. **Session start moves to open-with-a-detected-problem** (added same-day, ADR-027
   amendment + ADR-030). The opening scan's AI call is treated as the real first
   move of engagement, not a free look — so it debits quota exactly like any other
   turn that engages with a real problem. The first-sent-turn trigger survives as
   the fallback for the case the opening scan finds nothing.

### Reconciliation with `/docs/PLAN.md` (read before Task 1) — what this changes
- **§2.8 freemium semantics shift.** A "session" becomes problem-sized and
  auto-started. The atomic gate (ADR-007), the `start_session` RPC, its lazy 30-day
  reset, and `FREE_SESSION_LIMIT = 10` are all **unchanged** — but 10 free sessions
  now means **10 problems/month**, which is materially tighter than 10 sittings.
  This sprint deliberately does **not** retune the limit: the number is a product/
  cost decision that belongs with Sprint 16's cost-guardrail work, where aggregate
  spend data will exist. Recorded in ADR-027 and in "What the next sprint needs to
  know" so Sprint 16 cannot miss it.
- **Quota is burned at the moment the tutor engages with a real problem — on open
  when the opening scan finds one, otherwise on the student's first sent turn.**
  (Amended same-day — see the Scope Extension section and ADR-027's amendment.)
  Opening a panel that finds nothing, reading the overview, and minimizing still
  start nothing. This keeps the §2.8 "a started session always corresponds to a
  counted use" invariant honest under both triggers.
- **§2.5 envelope grows two fields** (`solution_progress`, `session`) — additive,
  defensively parsed, absent-tolerant like every ADR-019 field. The wire shape is
  byte-identical when the model omits them. The opening scan reuses the envelope's
  existing tolerance for an assessment-less "opening turn" — no schema change there.
- **The popup keeps its §2.8 role as a display hint** (remaining quota, degraded
  notice) and loses its session controls. Server-side enforcement is untouched.

### The completion signal and the progress bar are one contract (read before Tasks 3, 6, 7)
`solution_progress` reaching max **is** the "solved" end-condition seen at finer
grain. The model is prompted to score progress on genuine reasoning steps only and
to set `session.complete` with `reason: 'solved'` on the turn the student actually
cracks it — on that turn the client forces the bar to full before the close
choreography. The other two reasons (`'follow-up-declined'`, `'follow-up-corrected'`)
close the session **without** requiring a full bar: bar-max is one path to the end,
not the only one. The bar is **ephemeral overlay state** — reset on session end,
never persisted, not the mastery number and never labeled as such.

### The Overlay monolith is split before the surfaces change (read before Tasks 2, 7)
`Overlay.tsx` is 1,247 lines and owns every piece of overlay state. Five of this
sprint's items land in it (title-card controls, composer bar, insight strip, tag
colors, chip/button deletions), and Sprint 15's voice work lands in it again. Task 2
is a **pure decomposition** — TitleBar, Composer, InsightStrip, Transcript,
PingToasts extracted with **zero behavior change**, gated on the existing build +
tests — so Task 7's changes are local to small files and Sprint 15 inherits the
same seam. This was flagged as the Sprint 12/13 parallel-work blocker; it stops
being one here.

### The opening scan is a real turn, not a template (read before Tasks 4, 6, 10)
"Immediately annotate and ask if that's what the student needs" only works if the
tutor actually looked — a canned "I see a problem, need help?" would be worse than
silence. So the opening scan is a genuine `/api/ai/turn` call: it loads the
student's `LearningProfile` biased by `detectTopicKeys(PageContext)` (the Sprint 11
topic-bias read — reused, not rebuilt), reuses the existing `callback` profile-tag
mechanism (ADR-024/026's grounding gate) so any cross-session reference is checked
against real history exactly as strictly as a mid-conversation callback, and emits
one `say` line + an annotation (ADR-029 discipline) + optionally one `callback` tag.
It **never emits `assessment`** — there is nothing to grade yet, which is exactly
the "opening turn, no prior student answer" case `envelope.ts` already tolerates,
so no schema change is needed there. If the call fails, times out, or the model
can't confidently name a problem, the panel opens exactly as it does today —
degrade to silence, never to a wrong guess (ADR-030).

### Ping loosening reverses part of ADR-026's silence — deliberately (read before Task 5)
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

### Annotation legibility is a prompt problem AND a layout problem — now with color-linking (read before Tasks 3, 7, 8)
Overlap has two causes and needs both halves: the model annotates every component
of one expression with same-anchor labels (prompt half — steer to the **box** as
the default type, one annotation per distinct region, labels only where they add
information), and the layer places every label at the same offset from its anchor
rect (layout half — a small deterministic collision pass that stacks/offsets labels
with leader lines when their boxes would intersect, clamped to the viewport).
"Proactive" is also prompt-side: annotate whenever the reply references content
that PAGE CONTEXT shows on screen — the ≤3 cap and drop-don't-guess resolution
(ADR-022) are unchanged. **Added same-day (ADR-029 amendment):** that guidance
tightens from permission to expectation, and each turn's annotations get a
deterministic, order-assigned color from a small fixed palette; when `say`'s
referring phrase reuses an annotation's exact `target.text` (a prompt constraint,
not a new field), `Transcript.tsx` wraps that substring in the matching color —
no match, no color, never a guessed link.

### Conciseness is a prompt contract with a measurable bound (read before Task 3)
"Be concise" doesn't gate; a bound does. The prompt gets a hard style rule — default
reply ≤ 3 sentences (~60 words); one idea per turn; longer only when the student
explicitly asks for a full explanation — and Task 10 measures median reply length
across a real session against the current baseline. TTS cost and voice latency both
fall out of shorter `say` strings for free (Sprint 15 banks this).

### The filed Sprint 13 live-find lands here (read before Task 6)
Page context is captured at overlay **mount** (page load for a signed-in user), so
on SPA pages (Khan Academy) the capture can run before the exercise renders and the
whole session goes context-blind. The intended discipline was fresh-per-open: Task 6
moves capture (and the Sprint 12 equation-registry refresh) to panel **expand** —
and the opening scan (Task 4) fires off that same fresh capture, so both fixes are
one change.

## Execution model
A **single code session** owns this sprint end to end, worked **strictly in order
(1 → 10)**. Tasks 1–2 are already committed (ADRs, then the overlay decomposition);
what follows builds on that green baseline. The chain: the web contract (Task 3)
must emit progress + completion before the opening-scan contract (Task 4) can reuse
its envelope shapes; ping loosening (Task 5) is web-only and independent; the
extension lifecycle + opening-scan wiring (Task 6) needs Task 4's route to call and
depends on Task 3's capture-timing fix; the redesigned surfaces (Task 7) need
Task 6's wiring; annotation layout (Task 8) depends on Task 3's prompt half and
Task 7's color-assignment; tests (Task 9) gate manual acceptance (Task 10). One
session — no handoff.

This sprint touches: `/web/lib/ai/{envelope,system-prompt}.ts`, `/web/app/api/ai/
turn/route.ts`, `/web/lib/learning/events.ts`, and on the extension side the
overlay (decomposed), the content script, the background worker, the transport
types, the popup, and `AnnotationLayer.tsx`. It does **not** touch `/supabase` (no
migration — progress and completion are ephemeral), the voice pipeline internals
(`VoiceController.ts`, `/web/app/api/voice/**` — Sprint 15), the learning
read/write path (`apply.ts`, `scheduler.ts`, `profile-read.ts`, `topic.ts` — reused
as-is by the opening scan; only `events.ts` changes), `/packages/curriculum`,
`/packages/learning-model`, or the session/auth routes (`start_session`/
`end_session` RPCs and quota are reused exactly as-is — only *when* they're called
changes).

## Files in scope

### Task 1 (ADRs + sprint pointers) — LANDED — plus the scope-extension addendum:
```
/docs/adr/ADR-027-problem-sized-sessions.md   ← LANDED, then AMENDED (2026-07-05): the start trigger moves from first-sent-turn to open-with-a-detected-problem; the first-sent-turn check survives as the fallback when the opening scan finds nothing. See the ADR's own "Amendment" section.
/docs/adr/ADR-028-solution-progress-signal.md ← LANDED, unchanged by the scope extension.
/docs/adr/ADR-029-annotation-legibility.md    ← LANDED, then AMENDED (2026-07-05): raises "annotate when referencing visible content" from permission to expectation; adds the color-link mechanism (exact target.text reuse in `say`, client-assigned palette, no new envelope field). See the ADR's own "Amendment" section.
/docs/adr/ADR-030-proactive-opening-scan.md   ← new (2026-07-05) — the opening scan: trigger (panel expand + a detected problem), what it reads (PageContext, topic-biased profile, the callback digest), what it emits (say + annotation + optional callback tag, never assessment), why it counts as the session start, and the degrade-to-silence failure mode.
/CLAUDE.md                                     ← edit one line: Current sprint → Sprint 14 — Session lifecycle, overlay UX cleanup, and tutor behavior tuning
/docs/CLAUDE.md                                ← edit one line: Current phase → Phase 2, Sprint 14
/docs/sprint-14-plan.md                        ← this file
/docs/architecture.md                          ← edit: sessions problem-sized + auto-managed (open-with-problem OR first-send); envelope gains solution_progress + session; the opening scan as a new AI-initiated turn kind; overlay decomposed; popup = display only
```

### Task 2 (extension — Overlay decomposition, zero behavior change) — LANDED:
```
/extension/src/overlay/TitleBar.tsx    ← LANDED — title card: logo/wordmark, the (existing) close control, session-state chrome.
/extension/src/overlay/Composer.tsx    ← LANDED — input row: text input + caret measurement, mic button + level waveform, send control.
/extension/src/overlay/InsightStrip.tsx← LANDED — the overview/recap host (placement changes in Task 7).
/extension/src/overlay/Transcript.tsx  ← LANDED — message list + streaming tokens + profile-tag pills + typing indicator + scroll anchor. (Gains the color-linked highlight rendering in Task 7.)
/extension/src/overlay/PingToasts.tsx  ← LANDED — the Sprint 13 toast rendering, extracted as-is.
/extension/src/overlay/Overlay.tsx     ← LANDED — the state owner + composition root.
/extension/src/overlay/Overlay.css     ← LANDED — selectors regrouped per component.
```

### Task 3 (web — the progress + completion contract; conciseness; annotation steering) edits:
```
/web/lib/ai/envelope.ts        ← edit — TurnEnvelope gains optional solution_progress (number, clamped to [0,1] at parse; non-numeric dropped) and session ({ complete: boolean, reason: 'solved'|'follow-up-declined'|'follow-up-corrected' }; malformed → field dropped, never a guessed close). Additive; every existing field and the degrade-to-plain-text path unchanged.
/web/lib/ai/system-prompt.ts   ← edit — four additive blocks + one style rewrite: (1) SESSION COMPLETION rules — emit session.complete on exactly the three end-conditions, with the closing say line "Now closing tutoring session."; (2) SOLUTION PROGRESS rubric — score genuine reasoning steps, small regression on errors, never jump to 1.0 without a real solve, 1.0 only with reason 'solved'; (3) ANNOTATION GUIDANCE amendments — box ("highlight", outlined-rect) is the DEFAULT type, circle/arrow only when shape adds meaning, one annotation per distinct region, annotate WHENEVER the reply references PAGE CONTEXT content (expectation, not permission — ADR-029 amendment), labels ≤5 words and only when they add information, and — when the reply names something it is also annotating — reuse that annotation's target.text EXACTLY in `say` so the client can color-link it; (4) CONCISENESS — default say ≤3 sentences / one idea per turn; full explanations only on explicit request. Envelope schema block extended for the two new fields.
/web/app/api/ai/turn/route.ts  ← edit — thread solution_progress + session onto the response alongside reply/annotations/tags/pings; fields OMITTED when absent (back-compat byte-identical). persistInteraction UNCHANGED — neither field is persisted (ADR-028).
```

### Task 4 (web — the proactive opening turn) creates / edits:
```
/web/lib/ai/system-prompt.ts   ← edit — a fifth additive block, OPENING SCAN MODE, used only when the request carries no student message: given PAGE CONTEXT + the topic-biased STUDENT PROFILE + the existing priorWork/callback digest, identify the single most likely current problem, emit exactly one say line naming it and asking "is that what you need help with?", an annotation framing it (ADR-029 discipline — box-first, exact target.text), and AT MOST one callback tag when the grounding gate finds a genuinely relevant prior session. NEVER emit assessment (nothing to grade yet — envelope.ts already tolerates this). If no problem is confidently identifiable, the block instructs the model to return an envelope with an empty/whitespace say (the route treats this as "nothing to open with" and the caller degrades to silence).
/web/app/api/ai/turn/route.ts  ← edit — accepts an opening-scan request shape (no `messages`, a `pageContext` required, `opening: true`): loads the profile via the EXISTING topic-biased read path (detectTopicKeys(pageContext) → loadProfile), builds the opening-scan prompt variant, calls Claude, returns { reply, annotations?, profileTags? } — no assessment field ever, and persistInteraction is called with assessment omitted (the existing "opening turn, no prior answer" tolerance). An empty/whitespace say degrades to a { reply: '' } the caller treats as "nothing found." Ownership/entitlement checks reused as-is — the caller (background) is responsible for calling startSession first (ADR-030 Decision 3).
```

### Task 5 (web — ping loosening) edits:
```
/web/lib/learning/events.ts ← edit — TurnPingKind gains 'mastery-progress' + 'streak-progress'; MASTERY_UP_TRANSITIONS gains 'unseen->learning' + 'unseen->mastered'; mastery-progress fires on an in-state (learning|mastered) single-turn mastery delta ≥ +0.10 (threshold a named constant); streak-progress fires when a sound-correct brings an active misconception to RESOLUTION_STREAK − 1 (and is superseded by misconception-resolved on the completing turn — never both). Same prospective computeNodeUpdate discipline, same degrade-to-no-pings, same two indexed reads (no new query).
```

### Task 6 (extension — auto lifecycle + transport + the mount-capture fix + the opening-scan trigger) edits:
```
/extension/src/content/index.ts    ← edit — (a) THE FILED SPRINT 13 FIX: extractPageContext() + the equation-registry refresh move from onMount to the panel-EXPAND signal (fresh-per-open, as intended); minimize/expand re-captures, mount does not. (b) THE OPENING SCAN TRIGGER: immediately after that fresh capture, a pure plausible-problem check (non-empty equations OR a non-trivial text excerpt) decides whether to request an opening scan from the background; no problem found → no request, panel opens exactly as today.
/extension/src/background/index.ts ← edit — (a) a new OPENING_SCAN handler: calls api.startSession (mode 'text', pageDomain from the sender tab) THEN the opening-scan route variant; on success relays { say, annotations?, profileTags? } to the overlay as an ASSISTANT-INITIATED first transcript entry (no preceding student bubble); on any failure (start failure, empty say, network error, timeout) degrades silently — the panel opens with no opening message and no session, exactly as today. (b) handleAiTurn (and the AI_STREAM port's first message) KEEPS its own auto-start check as the FALLBACK trigger, for the case the opening scan found nothing and the student asks a question anyway. (c) On an AI reply whose session.complete is true, POSTs /api/session/end (existing path — recap + SESSION_ENDED broadcast fire exactly as Sprint 13 built) and clears ActiveSession. Popup START_SESSION/END_SESSION handlers kept (messages still valid) but nothing sends START_SESSION anymore.
/extension/src/lib/api.ts          ← edit — aiTurn() surfaces solution_progress + session from the response body; aiTurnStream's done payload likewise; a new openingScan() call (opening: true, pageContext, no messages) mirroring aiTurn's shape. Transport only.
/extension/src/types/messages.ts   ← edit — AiReplyPayload + the stream done message gain optional solutionProgress + session (mirroring envelope.ts by convention, like Annotation/ProfileTag before them); a new OPENING_SCAN request/reply message pair. SessionStatePayload unchanged (popup still displays quota).
/extension/src/popup/main.tsx      ← edit — Start/End session controls and their tab-domain derivation removed; the popup renders sign-in state, remaining quota, and the degraded notice only. No new capability.
```

### Task 7 (extension — the redesigned surfaces + color-linked annotations) edits:
```
/extension/src/overlay/TitleBar.tsx    ← edit — − (minimize: today's ✕ handler — collapse to pill, session continues, recap discipline unchanged) and ✕ (end session: today's End-session handler) with the green conic-gradient progress ring that sweeps ✕ (~4s) during the close choreography; the standalone "End session" button and the Typing/Voice mode chip are DELETED.
/extension/src/overlay/Composer.tsx    ← edit — the solution-progress bar: a thin, low-saturation track inside the composer frame, eased/clamped per ADR-028, forced full on 'solved', reset on session end; Send becomes an icon button (↵ enter-arrow glyph, aria-label="Send"); composer disabled during the close choreography.
/extension/src/overlay/InsightStrip.tsx← edit — overview (pre-question) and recap (post-session) render ABOVE the composer as a compact strip with the green auto-dismiss bar (~6s sweep, then folds to a one-line handle; hover/click re-expands; recap holds through the ring, then folds); color-coded per ProfileTagKind; renders ALONGSIDE the opening scan's message when one fires (ADR-030 Decision 4), not instead of it.
/extension/src/overlay/Transcript.tsx  ← edit — profile-tag pills pick up the same kind→color mapping; the "Now closing tutoring session." turn renders as a normal tutor bubble; the opening scan's reply renders as the FIRST bubble with no preceding student message (a purely presentational allowance — the component already renders a list, this just permits an assistant-first list); NEW — color-linked highlighting: given a turn's assigned annotation-color map (from Overlay.tsx) and its annotations' target.text values, wraps any EXACT substring match of a target.text inside the rendered say in a span colored to match; no match renders as plain text.
/extension/src/overlay/PingToasts.tsx  ← edit — renders the two new kinds; per-concept-per-kind session seen-set (the ADR-029 cap); kind→color mapping shared with the strip.
/extension/src/overlay/Overlay.tsx     ← edit — (a) close-choreography state machine (reply.session.complete → recap wait → ring → collapse + clear transcript + reset bar), wired through the components; transcript clear on choreography completion only (minimize never clears). (b) NEW — a small deterministic per-turn annotation-color assignment (turn's annotations, in order, mapped to a fixed palette of N slots), computed once per turn and passed to both Transcript (for the text-highlight match) and AnnotationLayer (for the box color) as a shared prop — one source of truth for "which color is this turn's second annotation."
/extension/src/overlay/Overlay.css     ← edit — strip placement, progress bar/ring, tag-kind colors mapped to @calyxa/ui custom properties; the color-link highlight span style (underline + tint, not a background block that would fight the bubble's own background).
/packages/ui/src/theme.css             ← edit — ADDITIVE named aliases only: the existing tag-kind aliases (--calyxa-tag-reviewing, --calyxa-tag-gap, --calyxa-tag-due, --calyxa-tag-strength, --calyxa-tag-callback, --calyxa-progress) PLUS a small, separate annotation-color palette (e.g. --calyxa-annot-1 … --calyxa-annot-4) mapped to EXISTING palette tokens — no new colors, no changed values (ADR-018 discipline). The two palettes are deliberately distinct (tag-kind meaning vs. per-turn annotation ordinal) so they never collide visually.
```

### Task 8 (extension — annotation layout engine) edits:
```
/extension/src/overlay/AnnotationLayer.tsx ← edit — (a) "highlight" renders as the PRIMARY box: a clean outlined rounded-rect (stroke, transparent fill) rather than the thin underline-reading translucent rect; circle/arrow renderings unchanged; (b) deterministic label collision pass over each turn's draw list: labels default adjacent to their box; intersecting labels stack/offset with a short leader line to their anchor; placements viewport-clamped; pure function over rects (unit-testable, no DOM measurement beyond the rects already in the draw list); (c) consumes the shared per-turn annotation-color assignment from Overlay.tsx (Task 7) for the box stroke color, UNLESS the annotation carries an explicit style.color (the model's own choice wins when present — additive, not a behavior change to that existing field).
/extension/src/overlay/Overlay.css         ← edit — box + leader-line styles (shadow-root-scoped, classes only — ADR-002).
```

### Task 9 (tests) creates / edits:
```
/web/tests/envelope.test.ts       ← edit — solution_progress parsing (valid / out-of-range clamped / non-numeric dropped); session parsing (all three reasons; malformed dropped — a bad completion NEVER closes a session); absent-fields back-compat.
/web/tests/ai-turn.test.ts        ← edit — route threads solution_progress + session when present, omits when absent; session_interactions row shape unchanged (neither field persisted); NEW — the opening-scan request shape returns { reply, annotations?, profileTags? } with assessment ALWAYS absent, and degrades to an empty reply when the model finds nothing.
/web/tests/events.test.ts         ← new or edit — the two added transitions ping; mastery-progress at ≥ +0.10 in-state (and not below, and not from unseen); streak-progress at RESOLUTION_STREAK − 1; superseded by misconception-resolved on the completing turn; degrade-to-empty preserved.
/extension/tests/annotations.test.ts ← edit — the label collision pass: non-overlapping inputs untouched; same-anchor stacks resolve with zero intersections; viewport clamping; determinism (same input → same layout); NEW — the annotation-color assignment: deterministic order-based mapping, stable across re-renders of the same turn, distinct slots for distinct annotations in one turn.
/extension/tests/lifecycle.test.ts   ← new — pure helpers: the progress clamp/easing reducer (regression bound, floor, forced-full on solved), the close-choreography state machine (complete → recap → ring → closed; minimize during choreography does not clear; composer disabled during ring), and the plausible-problem gate (content/index.ts's pure check: empty PageContext → no scan; equations/excerpt present → scan requested).
/extension/tests/transcript-highlight.test.ts ← new — pure function: given a say string, a turn's annotations (with target.text), and a color assignment, returns the segmented/highlighted output; exact match highlights; near-miss (case/whitespace differs) renders plain; multiple non-overlapping matches each get their own annotation's color.
```

### Files explicitly out of scope
```
/supabase/**                            (NO migration — progress + completion + the opening scan's turn are ephemeral/text-only, same session_interactions shape; ADR-028)
/web/lib/learning/{apply,scheduler,profile-read,topic}.ts  (the FSRS loop AND the topic-biased read are reused as-is by the opening scan; only events.ts changes)
/web/lib/tier/session-gate.ts           (FREE_SESSION_LIMIT deliberately NOT retuned — Sprint 16, ADR-027; the opening scan calls the SAME startSession, no new gate)
/web/app/api/{auth,voice,session}/**    (start/end routes reused as-is; voice is Sprint 15)
/extension/src/overlay/VoiceController.ts (mic cold-start is Sprint 15)
/extension/src/content/{annotations,pageExtractor}.ts (resolver + registry unchanged; layout lives in the layer; the capture-timing fix + the opening-scan gate are content/index.ts only)
/web/lib/ai/{claude,page-context,profile}.ts (unchanged)
/packages/{curriculum,learning-model}/** (Sprint 15 / untouched)
```
Also out of scope (no pre-empting later roadmap sprints):
- **Retuning FREE_SESSION_LIMIT for problem-sized sessions** — Sprint 16's cost
  work owns the number, with real spend data (ADR-027 flags it loudly, now
  including the opening scan as a billable call in that data).
- **Voice latency, mic cold-start, TTS voice pinning** — Sprint 15.
- **Curriculum expansion** — Sprint 15.
- **The confidence-vs-correctness mismatch decision** (Sprint 13 rollover) — still
  pending; nothing here builds it.
- **A persisted ping/event log, session history, annotation replay** — ephemeral
  stays ephemeral (ADR-023/025 instincts).
- **A "free" uncounted opening scan mode** — deliberately foreclosed by ADR-030;
  reopening it later is a deliberate ADR revision, not a toggle.

Do not create any file not listed above. If something seems needed but is not
listed, add it to "What the next sprint needs to know" and ask before creating it.

---

## Task 1 — Lifecycle + progress + legibility ADRs + sprint pointers (planning / docs) — LANDED, amendments owed

Write ADR-027, ADR-028, ADR-029 in the project format (match ADR-001…ADR-026
exactly), covering the decisions in Context — including the three locked
end-conditions verbatim, the quota-semantics flag for Sprint 16, the clamp
constants, the three new ping kinds with thresholds, and the ADR-026 amendment.
Update the sprint pointers and `/docs/architecture.md`.

**Addendum (2026-07-05, after Task 2 landed):** write ADR-030 (new) and amend
ADR-027 + ADR-029 in place (dated "Amendment" sections, not rewrites) per the
Scope Extension section above.

Acceptance gate before Task 2:
  - All three original ADRs read as decisions (context → decision →
    consequences), not summaries; the ADR-026 amendment is cross-referenced from
    ADR-029; pointers updated; no code touched. *(Met — Task 1 landed.)*
Acceptance gate for the addendum, before Task 3:
  - ADR-030 reads as a decision; ADR-027's and ADR-029's amendments are dated,
    additive sections (the original decisions remain readable and correct on
    their own); architecture.md reflects the opening scan as a new turn kind.

---

## Task 2 — Overlay decomposition, zero behavior change (extension) — LANDED

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
    shows pixel-identical behavior. *(Met — Task 2 landed.)*

---

## Task 3 — Web: the progress + completion contract; conciseness; annotation steering

Scope: `envelope.ts`, `system-prompt.ts`, `turn/route.ts`. Additive contract,
prompt blocks per the Files-in-scope annotations.

  - `envelope.ts`: parse discipline mirrors the existing fields — clamp
    `solution_progress` to [0,1]; drop (never default) a malformed `session`; a
    dropped completion is a **non-close**, the safe failure.
  - `system-prompt.ts`: the three end-conditions are spelled out with one worked
    example each (solved; answered-then-declined-follow-up; corrected-follow-up);
    the closing say line is exact: "Now closing tutoring session." The annotation
    guidance block is rewritten to an expectation (not permission) and adds the
    exact-text-reuse instruction for color-linking (ADR-029 amendment) — no new
    field, just a stricter instruction on phrasing `say`.
  - Conciseness rewrite tightens the §2.5 pedagogy block's style rules without
    touching the hard rules (never-give-the-answer discipline unchanged).
  - Route: thread-through only; nothing new persisted; grounding gate (ADR-024)
    untouched.

Acceptance gate before Task 4:
  - Envelope tests (written here, formalized in Task 9) pass; a live
    `/api/ai/turn` call against a dev session shows progress on an ordinary turn,
    a completion on a solved turn, and median say length visibly down; the wire
    shape with both fields absent is byte-identical to Sprint 13; a turn that
    references an annotated term reuses that term's exact text in `say`.

---

## Task 4 — Web: the proactive opening turn

Scope: `system-prompt.ts` (a fifth additive block), `turn/route.ts` (the
opening-scan request/response branch), per the Files-in-scope annotations. Does
**not** touch `envelope.ts` (the opening scan reuses the existing optional-
assessment tolerance verbatim) or the learning read/write path (the topic-biased
`loadProfile` call is reused exactly as Sprint 11 built it).

  - The opening-scan branch is detected by the ABSENCE of a student message, not
    a separate endpoint — same route, same auth/entitlement checks, same
    `persistInteraction` call (with `assessment` omitted).
  - The prompt block is explicit that "is that what you need help with?" must
    name the ACTUAL problem from PAGE CONTEXT, never a generic line; the callback
    tag is optional and subject to the same grounding gate as mid-conversation
    callbacks (ADR-024) — no relevant history, no tag, never an invented one.
  - An empty/whitespace `say` from the model is the model's own way of saying "I
    can't confidently identify a problem here" — the route passes that through
    as-is; the caller (Task 6) is what decides to degrade to silence.

Acceptance gate before Task 5:
  - A live opening-scan call against a dev session with a real problem on the
    page returns a say naming it + an annotation + (when real prior history
    exists) a callback tag, and never an assessment; against a blank page it
    returns an empty say; `persistInteraction` writes an assessment-less row in
    both the "found something" and "found nothing" cases (never skips the row).

---

## Task 5 — Web: ping loosening (learning lib)

Scope: `events.ts` only, per the Files-in-scope annotation. Thresholds as named
constants; the superseding rule (streak-progress never fires on the turn
misconception-resolved fires) explicit.

Acceptance gate before Task 6:
  - `events.test.ts` covers all four kinds + the superseding rule + degrade path;
    a simulated session that would have produced zero Sprint 13 pings produces
    ≥1 under the new thresholds (the fixture that motivated the change).

---

## Task 6 — Extension: auto lifecycle + transport + the mount-capture fix + the opening-scan trigger

Scope: `background/index.ts`, `lib/api.ts`, `types/messages.ts`,
`content/index.ts`, `popup/main.tsx`, per the Files-in-scope annotations.

  - The capture-timing fix and the opening-scan gate are ONE change in
    `content/index.ts`: expand → capture → plausible-problem check → request or
    don't; re-expand re-captures and re-checks; mount does neither.
  - The opening scan calls `startSession` BEFORE the route call, never after or
    in parallel — the `session_interactions` row and the quota debit must agree
    on session membership (ADR-030 Decision 3).
  - Auto-start-on-send survives as the fallback: if the opening scan found
    nothing (or degraded), the student's first sent turn still starts a session
    exactly as the original Task 5 plan specified — checked at turn-send under
    the background's existing turn serialization; a start failure degrades to a
    sessionless turn, never a blocked one.
  - Auto-end reuses the existing end path so the recap + SESSION_ENDED broadcast
    are byte-identical to a popup-triggered end, regardless of which trigger
    started the session.

Acceptance gate before Task 7:
  - On a real page with a problem: expanding the panel creates the session row
    IMMEDIATELY (before any student message) and the opening scan's reply
    appears as the first bubble; on a blank page, expanding creates nothing and
    the first SENT turn creates the row instead; the popup shows quota but has
    no session buttons; on an SPA page, expanding after a client-side navigation
    captures and scans the NEW page's math.

---

## Task 7 — Extension: the redesigned surfaces + color-linked annotations

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
  - The annotation-color assignment (per turn, order-based, from the separate
    annotation palette) is computed once in `Overlay.tsx` and passed to both
    `Transcript` and `AnnotationLayer` — one source of truth, not two
    independent guesses at the same mapping.
  - `Transcript`'s highlight match is exact-substring only; a near-miss (the
    model paraphrased instead of reusing the exact text) renders as plain text —
    silently, not as a broken partial highlight.

Acceptance gate before Task 8:
  - Full lifecycle on a real page reads clean: overview strip folds away on its
    own; tags are color-coded; bar creeps up over a multi-turn solve, eases back
    on a wrong answer, fills on the solve; "Now closing tutoring session." →
    ring → close → transcript gone; − minimizes without ending; AA contrast spot-
    check on the new strip/tags/bar/annotation-palette against `/docs/brand.md`
    pairs; a turn whose annotated term is also named in `say` shows the SAME
    color on the box and the phrase.

---

## Task 8 — Extension: annotation layout engine

Scope: `AnnotationLayer.tsx` + `Overlay.css`, per the Files-in-scope annotations.
The collision pass is a pure exported function (draw-list rects in, placed labels
out) so Task 9 tests it without a browser.

Acceptance gate before Task 9:
  - "Annotate each component of x² + 5x + 6" on a real page yields non-overlapping
    boxes + labels with leader lines where stacked; boxes read as the primary
    vocabulary; circle/arrow still render when the model chooses them; the box
    stroke color matches the shared per-turn assignment unless the model set an
    explicit `style.color`.

---

## Task 9 — Tests (gate)

Scope: per the Files-in-scope annotations. All pure-logic: no browser harness, no
network; the extension specs extend the Sprint 12 vitest setup.

Acceptance gate before Task 10:
  - `turbo run test` green across workspaces; the new specs fail meaningfully when
    their guarded behavior is broken (spot-check by reverting one constant).

---

## Task 10 — Lifecycle + surfaces acceptance (manual)

On a real math page (Khan Academy included, exercising the Task 6 capture fix),
signed in as a real dev user:

  1. Open the panel on a page with a real problem: the session row exists
     IMMEDIATELY (verified in the DB, before any message is sent); the tutor's
     opening message names the actual problem and asks if that's the one; an
     annotation frames it; the overview strip shows alongside it, not instead;
     if real related history exists, a callback line appears.
  2. Open the panel on a blank/non-math page: no session row; no opening
     message; overview strip only (today's behavior, unchanged).
  3. From (1), answer the tutor's question and work the problem across ≥4 turns
     with one deliberate wrong answer: bar advances on sound steps, eases back
     once; replies are short (median say ≤3 sentences across the session); at
     least one ping fires; tags are color-coded; a turn that names an annotated
     term shows the same color on the box and the phrase in the bubble.
  4. Ask the tutor to annotate each component of the expression: boxes, no
     overlaps, labels legible, distinct colors per annotation.
  5. Solve it: "Now closing tutoring session." → recap strip (deltas + next
     reinforcements) → green ring sweeps ✕ → panel closes, transcript cleared.
  6. Reopen on a new problem: fresh session row (via the opening scan again, or
     via first-send if the scan finds nothing); decline the follow-up after
     answering: session closes via reason 'follow-up-declined' with the same
     choreography (bar not full — correct).
  7. − minimizes mid-problem without ending (row still open); re-expand resumes
     with transcript intact and page context + the opening-scan check re-run.
  8. Popup: quota display only; no session controls anywhere.
  9. Voice turn smoke: the voice path carries progress/completion identically
     (latency itself is Sprint 15's business).

Record the median-reply-length before/after numbers and any prompt-tuning residue
in the plan's checklist notes.

## Acceptance criteria (full checklist)

- [ ] ADR-027/028/029 written; ADR-026 amended; ADR-030 written; ADR-027/029 amended for the scope extension; pointers + architecture.md updated
- [ ] Overlay decomposed into TitleBar/Composer/InsightStrip/Transcript/PingToasts with zero behavior change; Overlay.tsx ≲400 lines
- [ ] Envelope carries solution_progress + session; malformed completion drops (never closes); wire back-compat byte-identical when absent
- [ ] Prompt: three end-conditions + exact closing line; progress rubric; box-first annotation guidance now an EXPECTATION; exact-text reuse for color-linking; ≤3-sentence default conciseness
- [ ] The opening scan: fires on panel expand + a detected problem; reads topic-biased profile + callback digest; emits say + annotation + optional grounded callback, NEVER assessment; degrades to silence on failure/nothing-found
- [ ] Session start: opening scan (when it finds a problem) OR first sent turn (fallback) — open/minimize-with-nothing-found never starts; auto-end on completion; popup has no session controls; quota display intact
- [ ] Page context + equation registry captured on panel EXPAND (Sprint 13 live-find fixed); SPA re-expand captures fresh and re-runs the opening-scan check
- [ ] − minimizes (never clears), ✕ ends with green ring (~4s) then close + transcript clear; "End session" button and Typing/Voice chip deleted; Send is the ↵ icon
- [ ] Solution-progress bar: thin/low-saturation in the composer; clamped easing; forced full on 'solved'; reset per session; visually distinct from the strip's auto-dismiss bar
- [ ] Overview/recap render above the composer as the auto-dismissing strip, ALONGSIDE the opening scan's message when one fires; tags color-coded via new theme.css aliases (additive tokens only)
- [ ] Pings: two added transitions + mastery-progress (≥ +0.10 in-state) + streak-progress (streak − 1), superseding rule enforced, per-concept-per-kind session cap client-side
- [ ] Annotations: outlined box primary; label collision pass yields zero overlaps on the each-component fixture; drop-don't-guess + ≤3 cap unchanged; each turn's annotations get a distinct, deterministic palette color shared between the box and any color-linked text span
- [ ] Color-linking: exact target.text match in `say` highlights in the matching annotation's color; a near-miss renders plain text, never a broken guess
- [ ] No migration; nothing new persisted; /api/ai/turn still writes exactly the Sprint 11 row shape (including the opening scan's assessment-less rows)
- [ ] `turbo run typecheck lint build test` green across workspaces; Task 10 manual pass complete with reply-length numbers recorded

## Risks

**The model under- or over-signals completion.** A missed signal strands a session
open (the old manual world, minus the button); a false signal closes mid-problem.
Mitigation: the three conditions are spelled out with worked examples; a malformed
`session` field drops (non-close is the safe failure); ✕ remains the manual end for
a stranded session; Task 10 exercises all three reasons live. If false closes show
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
existing test suite staying green before any surface work begins. *(Landed clean.)*

**Looser pings overshoot into spam.** Mitigation: three defined kinds with named
thresholds (not "ping more"), the per-concept-per-kind session cap, and the
superseding rule; tuning is a constants edit recorded for the beta feedback loop.

**The close choreography races the recap.** SESSION_ENDED (recap) arrives async
from the background while the ring runs. Mitigation: the state machine waits for
the recap (or a short timeout) before starting the ring, so the recap strip is
visible during the sweep; a recap-less end (timeout) still closes cleanly —
Sprint 13's recap-less path already renders sensibly.

**Prompt changes fight each other.** Completion rules, progress rubric, annotation
steering, conciseness, and now the opening-scan mode all land in
`system-prompt.ts` across Tasks 3–4. Mitigation: each task owns its own additive
block (no interleaving within a task), each block is separately eyeballed live at
its own gate, and Task 10 measures the combined effect.

**The opening scan misidentifies the problem, or fires on the wrong page.**
A confidently-wrong "is this the one?" is worse than staying quiet, and it now
costs quota. Mitigation: the prompt requires naming the ACTUAL problem from PAGE
CONTEXT (no generic fallback line); the plausible-problem gate in
`content/index.ts` is a cheap pre-filter (empty PageContext never reaches the
model); an empty/whitespace `say` is an explicit "found nothing" signal the model
is instructed to use rather than guessing; Task 10 exercises the blank-page case
live. If beta shows too many wrong guesses, the fix is prompt-side (a stricter
confidence bar before naming a problem), not a new architecture.

**The opening scan adds a real cost per open, not per session.** Every panel
expand on a page with detected math now triggers a billable call, even if the
student closes it immediately. Mitigation: this was Darcy's explicit call
(ADR-030) — it counts as quota exactly like any turn that engages a real
problem, so it's accounted for, not free; Sprint 16's cost-guard work and the
`FREE_SESSION_LIMIT` retune both inherit this as part of the real metering unit,
flagged explicitly in "What the next sprint needs to know."

## What the next sprint needs to know

**Sessions are problem-sized and tutor-initiated, the overlay is componentized,
and annotations are legible, frequent, and color-linked to the text.** The
envelope now carries `solution_progress` + `session`; a session starts either
because the opening scan found a problem on open or because the student sent a
first turn; the background auto-ends on completion; the popup is a display hint
only; page context captures on expand and immediately feeds the opening-scan
check; annotations are box-first, collision-free, and share a deterministic
color with any exact-matching phrase in the chat; pings fire on four kinds with
a client cap; the overlay lives in five components + a thin state root.

- **Sprint 15 (curriculum + voice)** inherits the decomposition: mic work lands in
  `Composer.tsx`/`VoiceController.ts` without touching the other surfaces; the
  conciseness rewrite already shortened `say`, which the TTS latency work banks;
  the opening scan's prompt block is a fifth precedent (alongside completion,
  progress, annotation, conciseness) for how additive system-prompt blocks are
  structured, if voice work needs its own.
- **Sprint 16 (cost + compliance) MUST revisit `FREE_SESSION_LIMIT`**: 10 free
  problem-sized sessions/month is materially tighter than 10 sittings (ADR-027's
  flag), and the opening scan means a session can now start — and cost — before
  the student sends anything at all. Both facts feed the same retune; the
  cost-guard design's metering unit is "an engaged problem," not "a sent turn."
- **The store/hardening sprints** audit the new surfaces (strip, bar, ring, tag
  colors, the opening-scan message, the annotation palette) — the AA spot-check
  in Task 7 is not the formal audit.
- **The ping thresholds, clamp constants, ring duration, strip dwell, and the
  opening-scan's plausible-problem heuristic** are named constants — beta-
  feedback tuning is a constants pass, not a redesign.
- **The confidence-vs-correctness mismatch decision** (Sprint 13 rollover) is
  still pending, unchanged by this sprint.
- **A "free" opening scan is deliberately foreclosed** (ADR-030) — if beta
  feedback suggests the cost-per-open is too aggressive, that is a reopening of
  ADR-030's Decision 3, not a quiet toggle.
