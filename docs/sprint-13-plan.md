# Sprint 13 — Adaptive tutor experience in the overlay (the three UX surfaces)

## Goal
Make the adaptive engine **visible to the student**. Sprints 09–12 built a learning loop
that assesses every turn, updates FSRS per interaction, schedules reinforcement, and
draws on the page — but the student never *sees* any of it. By the end of this sprint,
the surfaces below, all on the Sprint 10 redesigned overlay, show the loop working:

1. **Pre-question profile overview** — a quick "here's where you are" panel (mastery,
   weak spots, due reinforcements) rendered in the overlay **before the student asks
   their first question**;
2. **In-session profile tags** — the tutor's live profile references surfaced as visible
   tags in the transcript (e.g. `[reviewing: factoring]`, `[known gap: sign errors]`),
   **driven by the envelope** the same way annotations are — now including
   **explicit cross-session callbacks**: occasional, specific references to a real prior
   session ("this connects to what you worked through a few sessions ago"), pulled from
   actual session history, never a templated line;
3. **Post-session data-update summary** — a recap of **what actually changed** — mastery
   deltas, misconceptions resolved/added, next reinforcements — built from the session-end
   reconcile over the per-turn `session_interactions` record (the Sprint 11 successor to
   the Sprint 08/09 summariser; see the correction in Context) — now deepened with a
   **recent-trend rollup** (e.g. "3rd session in a row improving on X", only when a
   genuine ≥3-session pattern exists) and a **forward look** (when this session's
   concepts resurface, straight from the FSRS reinforcement schedule);
4. **Real-time event pings** — a transient toast/pill (the existing frosted-glass /
   sage-green language) fired **immediately after an answer**, for exactly **two** event
   types: a **mastery-state improvement** (the FSRS state crosses one of the model's own
   named upward boundaries) and a **misconception resolved** (the 3-correct streak
   completes). Routine mastery ticks stay **silent**; newly *detected* misconceptions are
   logged quietly exactly as today and surface **only** in the end-of-session recap,
   never as a live ping.

One further feature — **confidence-vs-correctness mismatch** detection (fast-but-wrong /
hesitant-but-right) — is **in this sprint as a pending design decision, not an
implementation**: what signal reliably proxies "confidence" and where it would be
captured must be decided first. See "Pending design decision" below; no task builds it
until that decision is made.

```
panel open (no messages yet)
      → GET /api/profile/overview (NEW, read-only: loadProfile + curriculum titles)
      → background → content → Overlay renders the "where you are" card
      → the overview snapshot is ALSO the client-side baseline for end-of-session deltas

turn  → §2.5 envelope { say, annotations[], assessment, profile_tags[] (NEW, incl. the
        callback kind) }
      → route grounds each tag against the profile + prior-session digest it just
        injected (drop, never invent)
      → route ALSO runs the FSRS update prospectively — the SAME input-assembly + pure
        math the off-path apply will run — and derives pings:
          state crosses a named upward boundary → "mastery up" ping
          resolution streak completes           → "misconception resolved" ping
          routine numeric tick / band uptick / NEW misconception → SILENT
      → /api/ai/turn returns { reply, annotations?, profileTags?, pings? }   (additive)
      → background → content → Overlay: tags on the assistant bubble; pings as a
        transient frosted-glass toast

end   → END_SESSION (popup, or the overlay's NEW End-session control)
      → /api/session/end reconciles (existing) → builds recap from the POST-apply tables
        + a recent-trend rollup across the last few sessions + the forward look
        (reinforcement_schedule due dates)
      → { sessionId, endedAt, interactionCount, recap? }             (additive)
      → background broadcasts SESSION_ENDED → content → Overlay renders the recap card
      → deltas = recap current values − the panel-open overview baseline (client-side)
```

Acceptance in one line (the brief's, extended): **profile overview renders before the
first question; tags — including real cross-session callbacks — appear inline during
tutoring; pings fire for exactly the two live event types and nothing else; the
end-of-session recap reflects the real mastery write, with trends and a forward look.**
All surfaces live on the Sprint 10 overlay + `@calyxa/ui` tokens, inside the shadow
root — **no host-DOM mutation**, and **nothing new is persisted** (no migration):
overview, tags, pings, and recap are display-ephemeral, the ADR-013/ADR-023 instinct
applied to profile visibility.

## Context
Sprint 12 landed the annotation layer (Tasks 1–9 committed): the tutor draws on the page,
annotations ride the wire additively, and zero host-DOM writes is verified. The adaptive
engine underneath (Sprint 11) closes the loop per turn — envelope → per-turn
`session_interactions` write → per-interaction FSRS → scheduler → topic/due-biased read.
But every part of that loop is invisible: the profile is injected into the *prompt* only,
the assessment is persisted *silently*, and session end reconciles with *no user-facing
output at all*. The student has no way to know the tutor is adapting — which is the
product's core claim.

Where each piece this sprint consumes stands today:
- **Profile read:** `loadProfile` (`/web/lib/learning/profile-read.ts`) already returns
  everything the overview needs — decay-adjusted mastery nodes, active misconceptions,
  and the due-review queue (`dueForReview` with human-readable reasons). It is only ever
  called inside `/api/ai/turn`; no read-only endpoint exposes it.
- **Envelope:** `parseEnvelope` (`/web/lib/ai/envelope.ts`) validates `say` /
  `annotations` / `assessment` / `mode` per §2.5 and degrades safely. It has no
  profile-reference field — the tutor may *say* "we've worked on factoring before," but
  nothing structured marks it. The additive-field pattern (parse → route returns
  optionally → thread through `AiReplyPayload` + the `AI_STREAM` `done` message →
  content script) was proven twice (Sprint 11 assessment, Sprint 12 annotations) and is
  reused verbatim for `profile_tags`.
- **The learning write:** `applyInteraction` (`/web/lib/learning/apply.ts`) runs **off
  the turn's critical path** (`after()`, ADR-019) — so at the moment the turn response is
  sent, the FSRS write for *this* answer has not happened yet. Any "your mastery just
  improved" ping therefore cannot read the write; it must **predict** it. The FSRS math
  (`updateMastery`, `@calyxa/learning-model`) is pure and deterministic, and the model
  already defines the named boundaries a meaningful improvement crosses
  (`MasteryState`: `unseen | learning | weak | mastered | forgotten`); misconception
  resolution is a hard rule (`consecutive_correct` reaching `RESOLUTION_STREAK = 3`).
  The ping design leans entirely on this determinism — see the design section below.
- **Session end:** `/api/session/end` **awaits** `reconcileSession` before responding —
  so by response time, every gradable interaction of the session has been folded into
  `knowledge_nodes`, `misconceptions`, and `reinforcement_schedule`. The response
  (`{ sessionId, endedAt, interactionCount }`) is currently thrown away by the extension
  (`api.endSession` returns `void`). The recap is therefore a **read of tables that are
  already correct at exactly the moment the route responds** — no new write, no timing
  gamble.
- **Session history:** `sessions` + `session_interactions` (per-turn `concept_key`,
  `outcome`, `created_at`, RLS-guarded) already hold everything a cross-session callback
  or a trend rollup needs — the Sprint 11 audit's readiness table said exactly this
  ("Session history / per-turn timeline: already there"). Nothing new is captured.
- **Overlay:** the Sprint 10 redesign (`Overlay.tsx`) has an empty state (header + input,
  no chat area), per-message assistant bubbles, and the full token system — the natural
  homes for the overview card, inline tags, ping toasts, and recap card. Session
  lifecycle is popup-driven today (`START_SESSION`/`END_SESSION` → background); the
  overlay has no session control, which matters for surface 3 (see the lifecycle section
  below).
- **Concept display names:** `Concept` in `@calyxa/curriculum` has no human-readable
  `title` — the Sprint 11 audit's gap #1, explicitly deferred to "the dashboard sprint's
  first task." These surfaces cannot show `algebra.quadratics.factoring` raw, so this
  sprint pulls the title work forward (data-only, additive); the dashboard inherits it.

**Correction to this sprint's brief** (the Sprint 12 "one correction" discipline): the
brief says the recap is "built from the Sprint 08/09 session-end summariser." That
summariser — the separate end-of-session Anthropic call in `/web/lib/ai/summarise.ts` —
was **retired in Sprint 11** (ADR-019): the tutor now assesses every turn inline, and
`/api/session/end` runs a reconcile sweep over the per-turn rows instead of a second
model call. The recap is built from that reconcile's *output* — the post-apply
`knowledge_nodes` / `misconceptions` / `reinforcement_schedule` state plus the session's
`session_interactions` rows. This is strictly better for the brief's own acceptance line:
a recap read from the real tables *cannot* disagree with the real mastery write, whereas
a summariser-derived one could.

### Scope extension (2026-07-05, after Task 1 landed)
Task 1 (ADR-024/025 + pointers) landed against the original three-surface scope. Darcy
then extended the sprint with four features: the **event pings**, the **cross-session
callbacks**, the **recap trend/forward-look additions**, and the **confidence-mismatch
pending decision**. Consequences, recorded here so the plan stays the accurate account:
- A third ADR — **ADR-026** (turn-time event pings + cross-session callbacks + recap
  depth; the prospective-compute decision; the confidence-mismatch deferral) — is owed
  as a **Task 1 addendum**, alongside a matching `architecture.md` touch-up. Written
  before Task 2 starts, so the decision record stays ahead of the code, per convention.
- Two files move from the out-of-scope list into scope, both **behaviour-preserving or
  additive**: `apply.ts` (the per-interaction input-assembly + pure-update call is
  extracted into a shared helper so the ping computation and the real apply run the
  *same* code — the write path's behaviour is pinned byte-identical by tests) and
  `profile-read.ts` (an additive `priorWork` leg for the callback digest; every existing
  leg unchanged).
- The task list grows from 9 to 10 (a new web task for the pings); the old Tasks 5–9
  renumber to 6–10. The natural overrun split point is named in Risks.

Note on sprint selection: the Sprint 11 audit prepared the **mastery dashboard** as the
next frontend sprint, and Sprint 12's plan slid that preparation to Sprint 13. This
sprint takes the overlay UX surfaces instead — they are the in-product proof of the
adaptive claim, and they de-risk the dashboard (titles, display shapes, and the recap
read all transfer). The audit's readiness table + gaps list slide intact to **Sprint 14**;
gap #1 (concept titles) is closed *here*, gap #2 (chart tokens) and the freshness note
still belong to the dashboard.

Locked decisions from `/CLAUDE.md` and `/docs/CLAUDE.md` that drive this sprint:
- **DOM policy: content script reads only. No mutations to host page DOM.** All surfaces
  render inside the `<calyxa-overlay>` shadow root on the existing Sprint 10 system. No
  new host-DOM read is added either — these surfaces consume server data, not page data.
- **All API keys server-side / free tier server-side:** the overview endpoint is a
  read-only, RLS-scoped profile read (no model call, no gating change); tags and pings
  ride the existing authenticated turn; the recap rides the existing session-end call.
- **RLS policy:** no new table (nothing to police); every read in this sprint goes
  through the user-scoped Supabase client (`clientFromBearer`), same as every existing
  route.

### Reconciliation with `/docs/PLAN.md` (read before Task 1) — what this implements
This sprint implements the **user-visible half of §2.3/§2.4's adaptive promise** — the
"student can see what the tutor knows about them" experience the PLAN motivates the
learning model with — using only data prior sprints already persist:

**(a) The profile becomes a student-facing read.** §2.3 query 1 (weakest + page-relevant
nodes) and query 2 (due queue) were built in Sprints 09/11 for the *prompt*. The overview
endpoint is the same `loadProfile` read serialized for *display* — no new query shape,
no new table. Titles come from the curriculum package (audit gap #1, closed here).

**(b) The envelope grows its third consumer-facing field.** §2.5's envelope carried
`say` (Sprint 11), `assessment` (persisted, Sprint 11), `annotations` (drawn, Sprint 12).
`profile_tags` is a deliberate **§2.5 extension in the established ADR-019 spirit** (the
envelope is the structured channel for everything the tutor knows at turn time), validated
with the same drop-don't-default discipline as annotations: a malformed or ungrounded tag
is dropped individually; the reply is never affected.

**(c) The pings are §2.4's model speaking for itself.** The FSRS state labels and the
misconception resolution streak are PLAN §2.4's own constructs; the ping surface renders
the model's named transitions and nothing softer. The LLM plays no part in deciding when
a ping fires (see the design section below) — a deliberate contrast with tags, which are
the *tutor's* references and therefore need the grounding gate.

**(d) What stays deferred.** The mastery dashboard (Sprint 14 — the audit's readiness
table transfers untouched), true SSE streaming of the envelope, cold-start onboarding,
OCR-beta capture, and the embedding match are all untouched. Persisting `mode`/tutor
`confidence` per turn — the audit's "decide in planning, not silently" item — is
**decided here: not persisted.** Tags are turn-time envelope output rendered and
discarded, exactly like annotations; if the Sprint 14 timeline UX wants per-turn
mode/confidence history, *that* plan owns the additive migration (recorded in ADR-024).
The **confidence-vs-correctness mismatch** feature is deferred *within* the sprint
pending its design decision (below) — it ships only if the proxy question is answered in
time, and rolls forward cleanly if not.

Recorded in **ADR-024** (the three profile-visibility surfaces: overview / in-session
tags / post-session recap; all display-ephemeral, nothing persisted, no migration;
tags are profile-grounded — parsed against the tag schema, then cross-checked by the
route against the very profile it injected that turn, drop-don't-invent; display fields
are server-rendered — titles resolve server-side so the extension never re-derives
curriculum data; decides the audit's mode/confidence question as "not persisted"),
**ADR-025** (the wire: a new read-only `GET /api/profile/overview`; `profile_tags`
additive on the envelope, the turn response, `AiReplyPayload`, and the `AI_STREAM`
`done` message; the recap additive on the `/api/session/end` response and broadcast to
tabs as a new `SESSION_ENDED` message; the overlay gains an End-session control that
reuses the existing popup END_SESSION path; mastery deltas are computed client-side
against the panel-open overview snapshot — no baseline is ever persisted), and
**ADR-026** (Task 1 addendum, owed before Task 2: turn-time event pings computed by the
shared FSRS input-assembly + pure update, never by the LLM; the two-event-only /
silent-ticks / quiet-new-misconceptions asymmetry; cross-session callbacks from a real
prior-session digest with the grounding gate extended to them; recap trend + forward
look; the confidence-mismatch proxy decision deferred with its options recorded).

### Grounded tags, never invented (read before Tasks 4, 8)
A fabricated tag is the tag system's misplaced-annotation: `[known gap: sign errors]`
attached to a student who has never made a sign error actively misinforms — worse than
no tag. So tags pass **three gates**, in order:
1. **Schema parse** (`envelope.ts`): `kind` ∈ `reviewing | known-gap | due-review |
   strength | callback`; `concept_key` ∈ `CONCEPT_KEYS` or null; `label` a non-empty
   string (the route truncates to ~30 chars); structurally invalid entries dropped
   individually, like `parseAnnotation`.
2. **Grounding check** (`turn/route.ts`): the route *holds the profile it just rendered
   into the prompt* — a `known-gap` tag must reference an injected active misconception
   (concept-key match, or category/label overlap with one); `reviewing`/`strength` must
   reference an injected mastery node; `due-review` must reference an injected
   `dueForReview` item; a `callback` must reference an entry in the injected
   prior-session digest (below). An ungrounded tag is dropped with a `console.debug` —
   the model cannot surface a "memory" the profile read didn't actually contain.
3. **Client cap** (defence in depth): ≤2 tags per turn enforced overlay-side too.

The prompt steers the model the same way Sprint 12 steered annotation targeting: tag
**only** what the STUDENT PROFILE block shows, ≤2 per turn, most turns none, `label` ≤4
words in student-friendly phrasing (the concept's short title, not its key).

### Callbacks come from real history, at low frequency (read before Tasks 4, 8)
The cross-session callback is the tag system's highest-trust move — "the tutor remembers
my sessions" — and therefore the one with the worst fabrication failure mode. So the
material is real by construction: `loadProfile` gains an additive **`priorWork`** leg — a
compact digest (≤3 entries) of the student's most recent *prior* sessions touching the
concepts relevant now: `{ conceptKey, sessionsAgo, daysAgo, outcomeLine }`, where
`outcomeLine` is derived mechanically from that session's `session_interactions` rows
("struggled early, finished strong", "went cleanly", "kept hitting sign errors" — a
bounded set of derived phrasings, not free text). It renders as a new **PRIOR SESSIONS**
block in the system prompt, additive to the STUDENT PROFILE structure (the ADR-009 seam
discipline). The prompt instructs: reference a prior session **at most once per
session**, only when the connection is genuine, weave it into `say` naturally, and emit
the matching `callback` tag — never reference a session PRIOR SESSIONS doesn't list. The
grounding gate (above) enforces the last rule server-side. A student with no prior
sessions gets no block, no instruction, no callbacks — cold start reads exactly as today.

### Pings are computed by the model's math, never by the LLM (read before Tasks 5, 7, 8, 9)
The two live events are **facts about the FSRS write**, so the LLM has no say in them —
no envelope field, no prompt work, no grounding gate needed. The route computes them.
The complication is timing: the real apply runs **off the critical path** (`after()`,
ADR-019), so the write hasn't happened when the response — the only delivery vehicle
that is "immediately after the answer" — is sent. The design resolves this with a
**prospective compute that cannot drift from the eventual write**:
- `apply.ts`'s per-interaction core — read the concept's `knowledge_nodes` row + active
  misconception streaks, assemble the observation (timing, outcome, reasoning), call the
  pure `updateMastery` — is **extracted into a shared helper**. `applyInteraction` keeps
  calling it (write path byte-identical, pinned by tests); a new `events.ts` calls the
  same helper read-only to derive what the apply *will* do. Same inputs → same pure
  function → same result; turns are serialized by the background worker and the previous
  turn's apply lands in the seconds between turns (the Sprint 11 design bar), so the
  inputs the route reads are the inputs the apply will read.
- **Mastery-improved ping** ⇔ the prospective update crosses a **named upward
  `MasteryState` boundary**: `weak → learning`, `forgotten → learning`,
  `learning → mastered`, `weak/forgotten → mastered`. These are `deriveState`'s own
  thresholds — the model's definition of "meaningful," not a new magic number.
  Explicitly **not** ping-worthy: any mastery change that stays inside a state (the
  routine tick, silent by requirement); `unseen → learning` (first contact is not an
  improvement); and `confidence_band` upticks (the band rises mechanically with
  observation count — pinging it would fire on a schedule, not on merit).
- **Misconception-resolved ping** ⇔ this turn's correct outcome completes the
  resolution streak (`consecutive_correct` reaching `RESOLUTION_STREAK = 3`) for an
  active misconception on the assessed concept — the apply's own hard rule, checked
  prospectively from the streak the route reads.
- **The asymmetry is deliberate**: a **newly detected** misconception is *never* pinged.
  It is persisted quietly by the apply exactly as today and surfaces only in the recap's
  `misconceptionsAdded` — celebrating progress in the moment helps; interrupting a
  struggling student with "new gap detected" mid-struggle does the opposite. This costs
  zero new work: it is the existing behaviour, now stated as a contract.
- **Delivery + copy:** `pings` rides the turn response additively
  (`{ reply, annotations?, profileTags?, pings? }`, field omitted when none — the
  ADR-023/025 pattern), through `AiReplyPayload` and the `done` message. Ping copy is
  **qualitative and server-rendered** ("Leveled up: Factoring quadratics",
  "Gap closed: sign errors") — never a number, so a theoretical prospective/actual
  divergence can't surface a wrong figure. Text path: the toast shows when `done`
  arrives; voice path: at TTS playback start (riding the existing
  `onVoicePlaybackStart` moment). Client-side: ≤2 pings per turn, and at most one
  mastery-improved ping per concept per session (a state that oscillates across a
  boundary doesn't re-celebrate).
- **Cost:** the prospective compute runs only on gradable assessments and needs two
  small indexed reads for **one** concept (its node row, its active misconception
  streaks), run in parallel — the same order of work the Sprint 11 audit already
  budgeted for the turn's synchronous leg. A compute failure degrades to "no ping this
  turn," never a failed reply.

### Recap depth: the trend rollup and the forward look (read before Task 6)
Two additions to the recap, both reads of existing tables:
- **Recent trend:** for each concept this session touched, `recap.ts` reads the
  student's last few (≈5) *ended* sessions' `session_interactions` for that concept and
  computes a per-session outcome quality. A trend line is emitted **only** when ≥3
  consecutive sessions — including this one — show genuine improvement; anything
  ambiguous emits nothing. Most recaps have no trend line; that is the point ("3rd
  session in a row improving on factoring" should feel earned, not templated).
- **Forward look:** the recap's existing `nextReviews` (reinforcement_schedule `due_at`
  per touched concept) is reframed as the student-facing forward look — "Factoring
  quadratics comes back Thursday" — with the due phrasing humanized client-side. The
  data was already in the recap spec; this addition is presentation plus the explicit
  acceptance that the dates shown ARE the FSRS schedule, not editorial.

### Pending design decision — confidence-vs-correctness mismatch (decision before implementation)
**Status: OPEN — Darcy decides; no task implements this until decided.** The feature:
detect when a student's confidence doesn't match their correctness (fast/no-revision but
wrong; hesitant/revised but right) and surface it. What must be decided first is **what
signal reliably proxies "confidence," and where that signal is captured**:
- **Already captured, persisted per interaction (Sprint 11):** `response_latency_ms`
  (client-measured think-time); `assessment.self_confidence` (the *tutor's inference* of
  the student's apparent certainty — low/med/high/unknown); `assessment.
  reasoning_quality` (sound/shallow/none). A latency×outcome or
  self_confidence×outcome mismatch rule could ship with **zero new capture** — but
  latency confounds (reading time, page switching) and a model-inferred confidence is
  itself a judgement, not a measurement.
- **Not captured anywhere today:** answer **revision** (text-input edits before send),
  hesitation patterns, voice prosody. Any of these would need new client-side capture,
  a wire change, and a persistence/privacy decision (keystroke-adjacent telemetry is a
  different consent posture than a latency number) — real scope, not a detail.
- **Also open:** where a detected mismatch surfaces (a third ping kind? a recap line?
  tutor-voiced only?) and whether being told "you seemed unsure" reads as insight or as
  surveillance to a teenage student.

If the proxy decision lands early enough, the implementation slots in as an ADR-recorded
extension of Task 5 (a third, clearly-named event kind) and/or Task 6 (a recap line);
if not, the decision record and options roll to the next sprint's planning input as-is.
The checklist carries this as an explicit gate either way.

### Display data is server-rendered and ephemeral (read before Tasks 3, 5, 6, 7)
The server resolves every concept key to its curriculum `title` before anything crosses
the wire — overview items, grounded tags, pings, and recap entries all arrive
display-ready. The extension renders; it never imports `@calyxa/curriculum` (no
curriculum data in the bundle, no drift between two copies). And none of the surfaces
persists anything:
- the **overview** is fetched fresh on each panel open (the `capturedPageContext`
  fresh-per-open discipline, applied to profile data) and held in overlay state only;
- **tags** are envelope output, rendered and gone with the transcript (the transcript
  sent back to `/api/ai/turn` remains pure `role`/`content` — tags never re-enter the
  prompt or the wire request);
- **pings** are computed, shown for a few seconds, and discarded — no event log, no
  history (a "recent events" feed would be a dashboard-sprint schema decision);
- the **recap** rides one response, is shown once, and is discarded on panel close.
  Mastery deltas are computed **client-side**: `delta = recap value − the overview
  snapshot from panel open`. No baseline row, no snapshot table; if the student never
  saw the overview this session, the recap degrades to absolute values (no arrows).

### The surfaces in the overlay lifecycle (read before Tasks 7, 8)
- **Overview:** rendered in the chat area when the panel is expanded and no messages
  exist yet ("before the first question" — the Sprint 10 empty state's upgrade).
  Requested via a new `GET_PROFILE_OVERVIEW` message (content → background → the new
  endpoint). A cold-start user gets the calibrating variant ("I'm still getting to know
  you — ask your first question"); a fetch failure renders nothing (the Sprint 10 empty
  state, unchanged) — the overview never blocks asking a question.
- **Tags:** committed with the assistant message they belong to — text path: when the
  port's `done` arrives (with the word-by-word fake, tags appear as the bubble commits);
  voice path: when the reply commits after TTS playback (tags don't pre-announce what
  the tutor hasn't said yet).
- **Pings:** a transient toast above the panel's chat area (or anchored to the panel
  edge), in the established frosted-glass style (`bg-background/85` +
  `backdrop-blur` + border tokens) with the sage-green accent for the celebratory
  moment; auto-dismisses after ~4s; `aria-live="polite"`; entry/exit animation
  suppressed under `prefers-reduced-motion`. Text: on `done`; voice: on playback start.
  Pings never block or overlap the input row.
- **Recap + the End-session control:** session end is popup-only today, which would make
  the recap unreachable in the one place it's designed to render. So the overlay panel
  gains **one new control** (an "End session" affordance in the header area): it sends
  the existing `END_SESSION` message through content → background — the same handler,
  RPC, and storage-clear the popup uses, no parallel path. The background's
  `handleEndSession` now captures the route's `recap` and **broadcasts** a new
  `SESSION_ENDED` message to all tabs (the `broadcastToAllTabs` SESSION_STATE pattern);
  the content script forwards it as a `calyxa:session-recap` window CustomEvent (the
  `calyxa:toggle-panel` bridge); the overlay renders the recap card in the chat area.
  A popup-triggered end reaches the same broadcast, so an open panel shows the recap
  regardless of which surface ended the session. If no panel is open, the recap is
  simply not seen — ephemeral by design, accepted (ADR-025).
  Panel close ≠ session end: closing the panel still just clears annotations
  (Sprint 12 behaviour); the session — and the free-tier accounting — is only ended by
  an explicit END_SESSION from either surface.

## Execution model
A **single code session** owns this sprint end to end, worked **strictly in order
(1 → 10)**. The chain is real: the ADRs fix the grounded-tags / nothing-persisted /
server-rendered-display / prospective-ping decisions (Task 1 + its addendum); curriculum
titles (Task 2) must exist before any server response can render them (Tasks 3–6); the
overview endpoint (Task 3), the tag+callback contract (Task 4), the ping computation
(Task 5), and the recap with trend/forward-look (Task 6) are the four server halves,
built before the extension transport threads them (Task 7); the overlay surfaces
(Task 8) consume the transport; tests (Task 9) gate manual acceptance (Task 10). One
session — no handoff.

This sprint **does** touch `@calyxa/curriculum` (data-only titles), the web AI lib
(`envelope.ts`, `system-prompt.ts` — additive), the learning lib
(`apply.ts` — behaviour-preserving extraction of the per-interaction core;
`profile-read.ts` — additive `priorWork` leg; new `events.ts` + `recap.ts`), three
routes (`/api/ai/turn` additive response fields; `/api/session/end` additive response
field; `/api/profile/overview` new), and the extension's transport
(`types/messages.ts`, `lib/api.ts`, `background/index.ts`), content script
(`content/index.ts`), and overlay (`Overlay.tsx`, `Overlay.css` if needed). It **does
not** touch the FSRS math or scheduler (`@calyxa/learning-model`, `scheduler.ts` —
their thresholds and rules are *consumed*, never changed), the annotation layer
(`annotations.ts`, `AnnotationLayer.tsx`, resolver, prompt targeting guidance), the
voice pipeline internals, session/auth/freemium logic (the End-session control reuses
the existing handler), `/supabase` (**no migration**), or `/packages/ui`.

## Files in scope

### Task 1 (ADRs + sprint pointers) — LANDED — plus the scope-extension addendum:
```
/docs/adr/ADR-024-profile-visibility-surfaces.md ← landed — the three surfaces (overview / tags / recap); display-ephemeral, nothing persisted, no migration; grounded tags (schema parse → route grounding against the injected profile → client cap; drop-don't-invent); server-rendered display fields (titles resolve server-side); DECIDES the Sprint 11 audit's mode/confidence question: not persisted.
/docs/adr/ADR-025-profile-data-on-the-wire.md    ← landed — GET /api/profile/overview (new read-only route); profile_tags additive on envelope + turn response + AiReplyPayload + AI_STREAM done; recap additive on /api/session/end response + SESSION_ENDED broadcast; overlay End-session control reuses the popup END_SESSION path; deltas computed client-side against the panel-open overview snapshot (never persisted).
/CLAUDE.md                                        ← landed — Current sprint → Sprint 13 — Adaptive tutor experience in the overlay
/docs/CLAUDE.md                                   ← landed — Current phase → Phase 2, Sprint 13
/docs/architecture.md                             ← landed — Sprint 13 section + ADR index entries

--- addendum (write before Task 2; the scope extension's decision record) ---
/docs/adr/ADR-026-turn-time-events-and-callbacks.md ← new — event pings computed by the shared FSRS input-assembly + pure update (prospective == eventual write by construction), NEVER by the LLM; ping ⇔ named upward MasteryState transition or resolution-streak completion ONLY (ticks silent, band upticks silent, unseen→learning silent, new misconceptions quiet-until-recap — the asymmetry as a contract); cross-session callbacks from the priorWork digest with the grounding gate extended to a `callback` tag kind; recap trend (≥3-session rule) + forward look; the confidence-mismatch proxy decision DEFERRED with candidates recorded (latency / tutor-inferred self_confidence / uncaptured revision telemetry).
/docs/architecture.md                               ← edit — extend the Sprint 13 section: pings, callbacks, trend/forward look; ADR-026 in the index.
/docs/sprint-13-plan.md                             ← this update
```

### Task 2 (curriculum — concept display titles) edits:
```
/packages/curriculum/src/concepts.ts      ← edit — Concept gains `title` (human-readable, e.g. "Factoring quadratics") and `strandLabel` (e.g. "Quadratics"); all 8 entries filled; data-only, accessors unchanged (getConcept already exposes the full Concept). Closes Sprint 11 audit gap #1, pulled forward from the dashboard sprint.
/packages/curriculum/src/concepts.test.ts ← edit — every concept has a non-empty title + strandLabel; keys/graph untouched (existing cases stay green).
```

### Task 3 (web — the profile overview endpoint) creates:
```
/web/app/api/profile/overview/route.ts ← new — GET, clientFromBearer auth (401 when signed out); calls loadProfile(supabase) (no topicKeys — this is the user-level "where you are", not a page-biased read); serializes display-ready: { calibrating, mastery: [{ conceptKey, title, mastery, state, confidenceBand }], weakSpots: [{ conceptKey, title, category, description }], dueForReview: [{ conceptKey, title, reason }] } — titles via getConcept(...).title, unknown keys fall back to the key. calibrating=true ⇔ loadProfile returned the empty profile. Read-only: no model call, no write, no free-tier interaction.
```

### Task 4 (web — the tag + callback contract: envelope + prompt + profile read + route) edits:
```
/web/lib/ai/envelope.ts           ← edit — additive: ProfileTagKind ('reviewing'|'known-gap'|'due-review'|'strength'|'callback'), ProfileTag { kind, conceptKey: string|null, label }; TurnEnvelope gains profileTags?; parseProfileTag mirrors parseAnnotation's drop-don't-default discipline (invalid kind/empty label → entry dropped; concept_key outside CONCEPT_KEYS → null, entry kept); array capped at 2 at parse time. Everything else byte-identical.
/web/lib/learning/profile-read.ts ← edit — additive priorWork leg: for the concepts in the profile/topic set, the most recent PRIOR sessions touching them → ≤3 digest entries { conceptKey, sessionsAgo, daysAgo, outcomeLine } with outcomeLine derived mechanically from that session's outcomes (bounded phrasings, not free text). Every existing leg (nodes, misconceptions, topic bias, due) unchanged; no priorWork when no prior sessions (cold start identical to today).
/web/lib/ai/profile.ts            ← edit — LearningProfile gains priorWork?: PriorWorkItem[] (one source of truth for the type, the dueForReview convention).
/web/lib/ai/system-prompt.ts      ← edit — additive PROFILE TAGS block in buildEnvelopeOutputFormat (envelope format only; the format:'text' stream path untouched): tag ONLY what the STUDENT PROFILE / PRIOR SESSIONS blocks show; ≤2 per turn, most turns none; kinds documented with when-to-use; label ≤4 words, student-friendly; known-gap only for a listed active misconception; due-review only for a listed due item; callback only for a listed prior-session entry, AT MOST ONCE PER SESSION, only when genuinely connected, woven into `say` naturally. Plus the additive PRIOR SESSIONS block rendering priorWork. The §2.5 schema block, annotation guidance, and every other section unchanged.
/web/app/api/ai/turn/route.ts     ← edit — ground each parsed tag against the LearningProfile this very request injected (known-gap ↔ activeMisconceptions, reviewing/strength ↔ masteryNodes, due-review ↔ dueForReview, callback ↔ priorWork; ungrounded → dropped, console.debug); resolve grounded tags' conceptKey → title into the label context; return additively { reply, annotations?, ...(grounded tags when present ? { profileTags } : {}) } — field OMITTED when none (a no-tag turn is byte-identical to Sprint 12). persistInteraction UNCHANGED — tags are not persisted (ADR-024).
```

### Task 5 (web — turn-time event pings) creates / edits:
```
/web/lib/learning/events.ts    ← new — computeTurnPings(supabase, userId, assessment, timing): two parallel indexed reads for the ONE assessed concept (its knowledge_nodes row; its active misconceptions' consecutive_correct streaks), then the SAME shared per-interaction core the apply uses, read-only, to derive: mastery-up ping ⇔ named upward MasteryState transition (weak→learning, forgotten→learning, learning→mastered, weak/forgotten→mastered; unseen→learning and band changes explicitly excluded); resolved ping ⇔ a correct outcome completing RESOLUTION_STREAK. Returns display-ready pings [{ kind: 'mastery-up'|'misconception-resolved', conceptKey, title, label }] or none. Any failure → no pings (never fails the turn).
/web/lib/learning/apply.ts     ← edit — extract the per-interaction core (read node + streaks → assemble observation → call pure updateMastery → derive resulting state) into a shared helper consumed by BOTH applyInteraction and events.ts; export/share RESOLUTION_STREAK. The write path's behaviour is BYTE-IDENTICAL — no logic change, pinned by Task 9's equivalence tests. claimed_at lease, scheduler call, misconception matching all untouched.
/web/app/api/ai/turn/route.ts  ← edit — on a gradable assessment, run computeTurnPings synchronously (bounded, parallel, one concept) and return { ..., ...(pings when present ? { pings } : {}) } additively; field OMITTED when none. The off-critical-path applyInteraction call is UNCHANGED — the pings predict it, they don't replace it.
```

### Task 6 (web — the session-end recap + trend + forward look) creates / edits:
```
/web/lib/learning/recap.ts        ← new — buildSessionRecap(supabase, userId, sessionId): reads the session's session_interactions (concept keys touched, per-key outcome counts), the sessions row (started_at/ended_at window), then the POST-reconcile state for the touched keys: knowledge_nodes (mastery decay-adjusted via retrievability, the profile-read convention), misconceptions created or resolved within the session window (created_at / status+updated_at), reinforcement_schedule rows (due_at) for the touched keys. PLUS the trend rollup: per touched concept, per-session outcome quality across the last ≈5 ended sessions; a trend entry ONLY on ≥3 consecutive improving sessions including this one. Returns { concepts: [{ conceptKey, title, turns, correct, incorrect, mastery, state }], misconceptionsAdded: [...], misconceptionsResolved: [...], nextReviews: [{ conceptKey, title, dueAt }], trends: [{ conceptKey, title, sessions, line }] } or undefined when the session had no gradable interactions. Read-only; titles server-side (Task 2).
/web/app/api/session/end/route.ts ← edit — AFTER the awaited reconcileSession (already in place), call buildSessionRecap and return { sessionId, endedAt, interactionCount, ...(recap ? { recap } : {}) }. A recap failure is logged and the field omitted — it never fails an already-successful end (the route's existing reconcile posture). End/reconcile logic UNCHANGED.
```

### Task 7 (extension — transport threads all payloads) edits:
```
/extension/src/types/messages.ts   ← edit — mirror ProfileTag/ProfileTagKind (incl. callback) + declare ProfileOverview, SessionRecap (incl. trends), and TurnPing (by-convention re-declaration with source-of-truth comments, like Annotation); AiReplyPayload gains profileTags? and pings?; new MessageTypes GET_PROFILE_OVERVIEW (content → background; reply { overview } | { error }) and SESSION_ENDED (background → tabs broadcast; { recap? }). All existing types + comments kept.
/extension/src/lib/api.ts          ← edit — getProfileOverview(): GET /api/profile/overview via authorizedFetch; endSession() returns the response body's recap (was fire-and-forget void) — storage clear unchanged.
/extension/src/background/index.ts ← edit — handle GET_PROFILE_OVERVIEW (api.getProfileOverview, error-shaped like every other reply); handleAiTurn + the AI_STREAM done message thread profileTags AND pings (exactly the Sprint 12 annotations threading); handleEndSession captures the recap and broadcasts SESSION_ENDED to all tabs (broadcastToAllTabs pattern) — popup- and overlay-initiated ends both flow through it. All other handlers unchanged.
```

### Task 8 (extension — the overlay surfaces + wiring) edits:
```
/extension/src/content/index.ts  ← edit — sendAiTurn resolves { reply, tags?, pings? } (port done + AI_TURN response both carry them; annotations handling unchanged); new onLoadOverview callback (sends GET_PROFILE_OVERVIEW); new onEndSession callback (sends END_SESSION); SESSION_ENDED listener → `calyxa:session-recap` window CustomEvent. Registry/annotation/lifecycle code untouched.
/extension/src/overlay/Overlay.tsx ← edit — (1) overview card in the empty expanded state via onLoadOverview (mastery bars ≤5, weak spots ≤3, due ≤3; calibrating variant; silent-degrade on error; the snapshot retained as the delta baseline); (2) messages become a local display type { role, content, tags? } — tags render as small pills on assistant bubbles (≤2, client cap; callback tags visually consistent with the rest), history passed to onSend stripped back to role/content; (3) ping toast: frosted-glass pill (existing bg-background/85 + backdrop-blur + border + sage-green accent tokens), auto-dismiss ~4s, aria-live polite, motion-safe animation only, ≤2 per turn, at most one mastery-up per concept per session (client dedupe map); text turns show on done, voice turns on playback start; (4) recap card on `calyxa:session-recap` (per-concept mastery + delta arrows vs the baseline when present, absolute otherwise; misconceptions resolved/added; TRENDS when present; forward look with humanized due phrasing) + the End-session header control (onEndSession). All on existing tokens/primitives; AA; onSend's return type change threaded through handleSubmit/handleMicStop.
/extension/src/overlay/Overlay.css ← edit only if a utility can't express a style — shadow-root-scoped classes, tokens only (no new token; ADR-018/ADR-002 discipline).
```

### Task 9 (tests) creates / edits:
```
/web/tests/envelope.test.ts        ← edit — profile-tag parse: valid tags (all five kinds) parse; invalid kind/empty label dropped individually; unknown concept_key nulled; >2 capped; envelope without tags unchanged.
/web/tests/ai-turn.test.ts         ← edit — grounded tags returned additively; ungrounded tags (incl. a callback naming a session absent from priorWork) filtered at the route; pings: a state-crossing gradable turn returns a mastery-up ping, an in-state tick returns NONE, a band-only uptick returns NONE, a streak-completing correct returns a resolved ping, a streak-2 correct returns NONE, a newly-flagged misconception returns NO ping; fields omitted when none (response byte-identical to Sprint 12); tags/pings never persisted (session_interactions row shape unchanged).
/web/tests/learning-events.test.ts ← new — the EQUIVALENCE pin: for identical DB fixtures, computeTurnPings' prospective state/streak outcome equals what applyInteraction actually writes (same shared core, asserted end-to-end); apply.ts's write-path behaviour is unchanged by the extraction (existing apply cases stay green untouched).
/web/tests/profile-overview.test.ts ← new — 401 signed out; display-ready shape with titles; calibrating for a fresh user; no writes.
/web/tests/session.test.ts         ← edit — session end returns a recap reflecting post-reconcile state (a gradable session yields concepts + nextReviews; misconception add/resolve within the window appears); TREND: 3 improving sessions → trend entry, 2 → none, non-monotone → none; recap omitted for an empty session; recap failure doesn't fail the end; existing end/reconcile cases stay green.
/extension/tests/overlay-display.test.ts ← new — pure display logic (vitest, jsdom, the Sprint 12 test-infrastructure precedent): delta computation vs a baseline (present/absent), the ≤2 client tag cap, history-stripping (tags never re-enter the TurnMessage[] sent to onSend), the ping dedupe map (one mastery-up per concept per session; ≤2 per turn).
```

### Files explicitly out of scope
```
/web/lib/learning/{scheduler,topic}.ts                     (scheduler + topic bias consumed as-is)
/web/lib/learning/apply.ts BEHAVIOUR                       (in scope for the shared-core extraction ONLY — write-path behaviour byte-identical, pinned by tests)
/web/lib/ai/{claude,page-context}.ts                       (turn execution + page context unchanged)
/web/lib/ai/system-prompt.ts annotation guidance            (Sprint 12's block untouched — Task 4 adds sibling blocks only)
/web/app/api/{auth,voice,session/start}/**                  (unchanged; session/start's reconcile sweep stays)
/extension/src/content/{annotations,pageExtractor}.ts       (annotation layer + extraction untouched)
/extension/src/overlay/{AnnotationLayer.tsx,VoiceController.ts,mount.tsx}  (unchanged)
/extension/src/popup/**                                     (popup keeps its session controls; no redesign)
/supabase/**                                                (NO migration — nothing new persisted; ADR-024/026)
/packages/{ui,learning-model}/**                            (tokens/primitives consumed as-is; FSRS math + its state/band thresholds consumed, never changed)
```
Also out of scope (no pre-empting later roadmap sprints):
- **The mastery dashboard** — now Sprint 14; the Sprint 11 audit's readiness table +
  remaining gaps (chart tokens, freshness semantics) transfer to its plan; titles are
  closed here.
- **Persisting `mode` / tutor `confidence` per turn** — decided *against* this sprint
  (ADR-024); the Sprint 14 timeline UX re-opens it with its own migration if wanted.
- **Confidence-vs-correctness mismatch IMPLEMENTATION** — gated on the pending design
  decision above; ships this sprint only if the proxy question is decided in time,
  otherwise the decision record rolls forward.
- **A persisted event log / "recent events" feed** — pings are shown once and
  discarded; an event history is a dashboard-sprint schema decision.
- **True SSE streaming of the envelope**, **cold-start onboarding**, **OCR-beta
  capture**, **embedding matching** — unchanged, their own sprints.
- **Session history / recap persistence** — the recap is computed at end time from live
  tables and shown once; a browsable session-history UX is a dashboard-sprint decision.

Do not create any file not listed above. If something seems needed but is not listed,
add it to "What the next sprint needs to know" and ask before creating it.

---

## Task 1 — Profile-visibility + wire ADRs + sprint pointers (planning / docs) — LANDED, addendum owed

The original Task 1 (ADR-024/025, both CLAUDE.md pointers, architecture.md) **landed**.
The scope extension adds an addendum, to be completed **before Task 2**:

  - **ADR-026** in the project format, recording: the pings are computed by the shared
    FSRS input-assembly + pure update — prospectively at turn time, identically to the
    eventual off-path apply — never by the LLM; ping ⇔ a named upward `MasteryState`
    transition or a completed resolution streak, and nothing else (routine ticks,
    band upticks, `unseen → learning`, and newly detected misconceptions are all
    explicitly silent — the detection asymmetry is a recorded pedagogical contract, not
    an accident); cross-session callbacks come from the `priorWork` digest (real
    history, mechanical outcome lines) with the grounding gate extended to the
    `callback` tag kind and a ≤1-per-session frequency instruction; the recap gains the
    ≥3-session trend rule + the FSRS forward look; the confidence-vs-correctness proxy
    decision is deferred with its candidates and open questions recorded (persisted
    latency / tutor-inferred self_confidence / uncaptured revision telemetry + the
    capture/privacy implications of each).
  - `architecture.md`: extend the Sprint 13 section (pings, callbacks, trend/forward
    look) and add ADR-026 to the index.

Acceptance gate before Task 2:
  - ADR-024/025/026 exist in the exact format; ADR-026 records the two-event-only
    contract, the prospective-compute decision, the callback grounding, and the
    confidence-mismatch deferral; architecture.md + both CLAUDE.md pointers current.

---

## Task 2 — Curriculum: concept display titles (packages)

Scope: `/packages/curriculum/src/{concepts.ts, concepts.test.ts}`. Data-only, additive —
the Sprint 11 audit's gap #1, pulled forward.

  - Add `title` and `strandLabel` to `Concept` and fill all 8 entries with
    student-facing names (e.g. `algebra.quadratics.factoring` → title "Factoring
    quadratics", strandLabel "Quadratics"; `algebra.linear-equations.one-variable` →
    "One-variable linear equations", "Linear equations"). Keys, prerequisites,
    difficulty priors, and every accessor unchanged.
  - Test: every concept has a non-empty `title` + `strandLabel`; existing graph/key
    cases green.

Acceptance gate before Task 3:
  - `turbo run typecheck lint test` green including `@calyxa/curriculum`; `getConcept`
    returns titles for all 8 keys; no key or edge changed.

---

## Task 3 — Web: the profile overview endpoint (web API)

Scope: `/web/app/api/profile/overview/route.ts` (new). Read-only.

  - GET; `clientFromBearer` auth (401 `Not signed in.` otherwise — the codebase's
    standard shape). Call `loadProfile(auth.supabase)` with **no** `topicKeys` — the
    overview is "where you are overall," not a page-biased read (the turn keeps its
    bias; this endpoint deliberately doesn't take page input).
  - Serialize display-ready (titles via `getConcept`, fall back to the raw key for an
    unknown one — never 500 on curriculum drift): `calibrating` (true ⇔ the empty
    profile), `mastery` (the profile's node order — weakest first — with title, mastery
    0–1, state, confidenceBand), `weakSpots` (active misconceptions with title +
    category + description), `dueForReview` (title + the existing human-readable
    `reason`).
  - No write, no model call, no free-tier interaction, no cache header (fresh per
    request — the audit's freshness note).

Acceptance gate before Task 4:
  - typecheck + lint + `next build` pass. Signed out → 401. A seeded user gets titles +
    decay-adjusted mastery matching `loadProfile`'s values; a fresh user gets
    `calibrating: true` with empty lists.

---

## Task 4 — Web: the tag + callback contract (envelope + prompt + profile read + route grounding)

Scope: `/web/lib/ai/{envelope.ts, profile.ts, system-prompt.ts}`,
`/web/lib/learning/profile-read.ts`, `/web/app/api/ai/turn/route.ts`. All additive; the
`format:'text'` stream path and the Sprint 12 annotation guidance are untouched.

  - `envelope.ts`: `ProfileTag { kind, conceptKey, label }` with the five kinds
    (including `callback`); `parseProfileTag` per the design model (drop invalid entries
    individually, null unknown concept keys, cap 2 at parse); `TurnEnvelope.profileTags?`
    — omitted when the model sent none/invalid-only.
  - `profile-read.ts`: the additive `priorWork` leg — ≤3 digest entries for the
    student's most recent prior sessions touching currently-relevant concepts, with
    mechanically derived `outcomeLine`s (a bounded set of phrasings computed from that
    session's outcome counts — never free text, so the digest can't editorialize).
    Every existing leg unchanged; empty for cold start.
  - `profile.ts`: `LearningProfile.priorWork?` (one source of truth).
  - `system-prompt.ts`: the PROFILE TAGS block (five kinds, when-to-use, ≤2 per turn,
    most turns none, labels ≤4 words) + the PRIOR SESSIONS block rendering `priorWork`
    + the callback instruction: **at most once per session**, only when genuinely
    connected, reference the specific listed session naturally in `say`, emit the
    matching `callback` tag, never reference a session the block doesn't list.
  - `turn/route.ts`: the grounding gate — filter tags against the injected profile
    (per-kind rules, now including callback ↔ priorWork; `console.debug` on a drop);
    return `{ reply, annotations?, profileTags? }` with the field **omitted** (never
    null/`[]`) when nothing survives. `persistInteraction` unchanged — a comment notes
    tags are deliberately not persisted (ADR-024).

Acceptance gate before Task 5:
  - typecheck + lint + `next build` pass. A mocked envelope with a grounded tag (each
    kind) yields `{ reply, …, profileTags }`; an ungrounded tag — including a callback
    naming a session absent from priorWork — is filtered; no tags → the response is
    byte-identical to Sprint 12; the rendered envelope prompt contains both new blocks;
    a cold-start profile renders no PRIOR SESSIONS block; the text-format prompt is
    unchanged.

---

## Task 5 — Web: turn-time event pings (learning lib + route)

Scope: `/web/lib/learning/events.ts` (new), `/web/lib/learning/apply.ts`
(extraction only), `/web/app/api/ai/turn/route.ts`. The write path's behaviour is
**byte-identical** — this task adds a read-only predictor, not a second writer.

  - `apply.ts`: extract the per-interaction core (node read + streak read → observation
    assembly → pure `updateMastery` → derived state) into a shared helper;
    `applyInteraction` calls it exactly as before (claimed_at lease, scheduler call,
    misconception matching all untouched); share `RESOLUTION_STREAK`.
  - `events.ts`: `computeTurnPings` — gradable assessments only; two parallel indexed
    reads for the one assessed concept; the shared core run read-only; emit
    `mastery-up` **only** on the named upward state transitions (unseen→learning and
    band changes excluded), `misconception-resolved` **only** on a correct outcome
    completing the streak. Display-ready output (titles from Task 2); any failure →
    no pings, never a failed turn; `console.debug` diagnostics.
  - `turn/route.ts`: run `computeTurnPings` synchronously on gradable turns; return
    `pings?` additively (omitted when none). The off-path `applyInteraction` call is
    unchanged — the ping predicts the write, it never replaces or waits for it.

Acceptance gate before Task 6:
  - typecheck + lint + `next build` pass. Against fixtures: a state-crossing turn
    yields exactly one mastery-up ping; an in-state tick yields none; a band-only
    uptick yields none; streak 2→3 yields the resolved ping, 1→2 yields none; a newly
    flagged misconception yields none; the prospective outcome equals what
    `applyInteraction` then actually writes for the same fixture (spot-checked here,
    pinned properly in Task 9); all existing apply behaviour unchanged.

---

## Task 6 — Web: the session-end recap + trend + forward look (learning lib + route)

Scope: `/web/lib/learning/recap.ts` (new), `/web/app/api/session/end/route.ts`.
Read-only recap; end/reconcile behaviour unchanged.

  - `recap.ts`: `buildSessionRecap` per the Files-in-scope spec. Touched concepts come
    from the session's `session_interactions` rows (gradable outcomes only); mastery is
    read decay-adjusted (the `retrievability` convention from `profile-read.ts`);
    misconceptions added/resolved are bounded to the session's `started_at`–`ended_at`
    window; `nextReviews` reads `reinforcement_schedule` for the touched keys (the
    forward look — the dates shown ARE the FSRS schedule). **Trend rollup:** per
    touched concept, session-level outcome quality across the last ≈5 ended sessions;
    a `trends` entry **only** on ≥3 consecutive improving sessions including this one —
    non-monotone or short histories emit nothing. Titles server-side. Returns
    `undefined` for a session with no gradable interactions.
  - `session/end/route.ts`: after the existing awaited `reconcileSession`, build the
    recap and return it additively; a recap failure logs and omits the field (the
    route's established best-effort posture). Nothing about ending/reconciling changes.

Acceptance gate before Task 7:
  - typecheck + lint + `next build` pass. A session with gradable turns returns a recap
    whose mastery values match a direct post-reconcile `knowledge_nodes` read and whose
    `nextReviews` match `reinforcement_schedule`; three improving sessions on a concept
    yield a trend entry and two don't; an empty session returns the Sprint 11 response
    byte-identically; a forced recap error still ends the session cleanly.

---

## Task 7 — Extension: transport threads overview + tags + pings + recap

Scope: `/extension/src/{types/messages.ts, lib/api.ts, background/index.ts}`. Transport
only — no behaviour change when the new fields are absent.

  - `messages.ts`: mirror `ProfileTag` (five kinds) + declare `ProfileOverview`,
    `SessionRecap` (incl. `trends`), and `TurnPing` (source-of-truth comments, the
    `PageEquation` convention); `AiReplyPayload` gains `profileTags?` **and** `pings?`;
    add `GET_PROFILE_OVERVIEW` + `SESSION_ENDED` message types with payload shapes.
  - `api.ts`: `getProfileOverview()`; `endSession()` parses and returns the body
    (recap included) instead of discarding it — the storage clear and error handling
    unchanged.
  - `background/index.ts`: `GET_PROFILE_OVERVIEW` handler; `profileTags` + `pings`
    threaded on both reply paths (the `done` message + `AI_REPLY`), exactly like
    annotations; `handleEndSession` broadcasts `SESSION_ENDED { recap? }` to all tabs
    after a successful end. Everything else unchanged.

Acceptance gate before Task 8:
  - `wxt build` exits 0; typecheck passes. Stubbed responses reach the content script:
    an overview via `GET_PROFILE_OVERVIEW`; `profileTags` and `pings` on both turn
    paths; a `SESSION_ENDED` broadcast with the recap after an end from EITHER the
    popup or a content-sent `END_SESSION`. Absent fields → Sprint 12 behaviour exactly.

---

## Task 8 — Extension: the overlay surfaces (content + overlay)

Scope: `/extension/src/content/index.ts`, `/extension/src/overlay/Overlay.tsx`
(+ `Overlay.css` only if needed). Sprint 10 tokens/primitives; shadow root only; the
overlay's chrome.*-free discipline holds (all I/O via the callback props).

  - `content/index.ts`: `sendAiTurn` resolves `{ reply, tags?, pings? }` (annotations
    handling on both paths unchanged); `onLoadOverview` / `onEndSession` callbacks;
    `SESSION_ENDED` listener → `calyxa:session-recap` CustomEvent (registered once,
    like the panel-close listener).
  - `Overlay.tsx` — overview: on first expand with no messages, call `onLoadOverview`;
    render the "where you are" card (mastery bars ≤5 with titles, weak spots ≤3, due
    ≤3); calibrating variant for a fresh user; render nothing on error; keep the
    snapshot as the delta baseline. Tags: local display message type carries `tags?`;
    assistant bubbles render ≤2 small pills (`[reviewing: Factoring quadratics]`,
    `[from a previous session: …]` — one visual language for all five kinds, existing
    tokens); the history handed to `onSend` is stripped to `role`/`content`; text path
    commits tags with the bubble at `done`, voice path when the reply commits after
    playback. **Pings:** the frosted-glass toast per the lifecycle section — existing
    `bg-background/85` + `backdrop-blur` + border + sage-green accent tokens, ~4s
    auto-dismiss, `aria-live="polite"`, motion-safe entry only, ≤2 per turn, one
    mastery-up per concept per session (dedupe map in overlay state); shown at `done`
    (text) / playback start (voice); never occludes the input row. Recap: on
    `calyxa:session-recap`, render the recap card (per-concept mastery with delta
    arrows when a baseline exists, absolute otherwise; misconceptions resolved/added;
    **trend lines** when present; the **forward look** with humanized due phrasing —
    "comes back Thursday") in the chat area; the End-session control in the header
    calls `onEndSession` (disabled while a turn is in flight). AA throughout;
    `aria-live` behaviour of the chat area unchanged.

Acceptance gate before Task 9:
  - `wxt build` exits 0. Live against `next dev`: opening the panel as a returning user
    shows the overview before any question; a turn whose profile matches yields an
    inline tag; answering well enough to cross a state boundary fires exactly one
    mastery-up toast and routine answers fire none; End session from the overlay
    renders the recap with deltas, trends (when the fixture history supports one), and
    the forward look; a fresh user sees calibrating → no tags → no pings → no-gradable
    recap omitted; closing the panel does NOT end the session; nothing renders outside
    the shadow root.

---

## Task 9 — Tests (gate)

Scope: per the Files-in-scope list. Reuse the fake-Anthropic backend — **no live model
call**; the extension spec follows the Sprint 12 vitest/jsdom pure-logic precedent.

  1. **Tag parse (envelope):** valid tags (all five kinds) parse; bad kind / empty
     label dropped individually; unknown `concept_key` nulled; >2 capped; tag-free
     envelopes unchanged.
  2. **Tag grounding (route):** grounded tags returned; a tag referencing a
     concept/misconception NOT in the injected profile is filtered — including a
     `callback` naming a session absent from `priorWork`; field omitted when none
     (byte-identical response); tags never appear in the persisted
     `session_interactions` row.
  3. **Ping thresholds (route):** state-crossing → mastery-up ping; in-state tick →
     none; band-only uptick → none; `unseen → learning` → none; streak 2→3 → resolved
     ping; streak 1→2 → none; newly flagged misconception → **no** ping; fields
     omitted when none; pings never persisted.
  4. **Prospective/actual equivalence (learning-events):** for identical fixtures,
     `computeTurnPings`' predicted state/streak outcome equals what `applyInteraction`
     then writes; the apply extraction changed no write-path behaviour (existing apply
     cases green untouched).
  5. **Overview route:** 401 signed out; display-ready shape with curriculum titles;
     calibrating for a fresh user; no writes.
  6. **Recap:** reflects post-reconcile state (mastery values match `knowledge_nodes`,
     `nextReviews` match `reinforcement_schedule`); misconception added/resolved inside
     the session window appears, outside it doesn't; **trend:** 3 improving sessions →
     entry, 2 → none, non-monotone → none; omitted for a no-gradable session; a recap
     failure doesn't fail the end; existing session cases green.
  7. **Overlay display logic (extension):** delta arithmetic with/without a baseline;
     the ≤2 client tag cap; history-stripping (tags never enter the outbound
     `TurnMessage[]`); the ping dedupe map (one mastery-up per concept per session,
     ≤2 per turn).
  8. **Suite hygiene:** full `/web` suite green; `turbo run typecheck lint build test`
     green across workspaces.

Acceptance gate before Task 10:
  - all of the above pass with no live Anthropic call; `next build` and `wxt build`
    exit 0.

---

## Task 10 — Adaptive-experience acceptance (manual)

This is the sprint's headline acceptance: **the overview renders before the first
question; tags — including a real cross-session callback — appear inline; pings fire
for exactly the two event types and nothing else; the recap reflects the real mastery
write, with trends and the forward look.** With `cd web && next dev`
(`ANTHROPIC_API_KEY` set) and the unpacked extension loaded, as a returning user with
real history:

  1. **Overview before the first question:** open the panel → the "where you are" card
     shows mastery (titled, weakest first), weak spots, and due reinforcements —
     matching a direct `loadProfile`/DB read — before anything is typed.
  2. **Tags during tutoring:** work a concept the profile lists → `[reviewing: …]`
     appears on the tutor's bubble; with a seeded active misconception, a
     `[known gap: …]` appears only when the profile actually lists it; with a seeded due
     item, `[due review: …]` accompanies the "let's revisit…" opening. Voice turns tag
     too (committed with the reply after playback).
  3. **Cross-session callback:** with real prior-session history on a concept, at most
     one turn in the session references that specific prior work concretely (woven into
     the reply, `callback` tag attached) — and the referenced session actually exists in
     `session_interactions`. A user with no prior sessions gets none.
  4. **Pings — the two events and only the two events:** answer correctly until a
     concept crosses a state boundary → exactly one frosted-glass mastery-up toast, at
     that moment (text: with the reply; voice: as speech starts). Complete a
     misconception's 3-correct streak → the resolved toast. Routine answers (mastery
     moves, no boundary) → **no** toast. Make an error that flags a NEW misconception →
     **no** toast; it appears later in the recap's "added" list. Repeat-cross the same
     boundary in one session → no second celebration.
  5. **No invented memory:** across the session, no tag, callback, or ping ever
     references a concept, gap, or session absent from the injected profile / real
     history (spot-check server logs for grounding drops — drops are fine, fabrications
     are the failure).
  6. **Recap reflects the real write:** End session from the overlay → the recap's
     mastery values match `knowledge_nodes` post-reconcile, deltas match the overview
     baseline, resolved/added misconceptions match the `misconceptions` table, the
     forward look's dates match `reinforcement_schedule`, and a trend line appears only
     with a genuine ≥3-session improving history (verify against the sessions table).
     Ending from the popup with the panel open shows the same recap.
  7. **Cold start:** a fresh user sees the calibrating overview, no tags, no callbacks,
     no pings, and a recap-less end — nothing errors, nothing blocks the first question.
  8. **Lifecycle discipline:** closing the panel does NOT end the session (annotations
     clear, session continues); End-session is the only session-ending control in the
     overlay; free-tier accounting unchanged (one session consumed per START/END pair).
  9. **Nothing persisted, nothing mutated:** `session_interactions` rows are
     shape-identical to Sprint 12 (no tag/ping/overview/recap data anywhere in the DB);
     the Sprint 12 MutationObserver check on a full session with all surfaces active
     shows zero host-DOM mutations outside `<calyxa-overlay>`.
  10. **Back-compat:** a page/turn where no surface has data (no profile, no tags, no
      pings, no recap) is indistinguishable from Sprint 12 — same replies, same
      annotations, same persistence.

---

## Acceptance criteria (full checklist)

**Sprint status: IN PROGRESS — Task 1 landed (ADR-024/025 + sprint pointers +
architecture.md); scope extended 2026-07-05 with four features (pings, callbacks,
recap trend/forward-look, confidence-mismatch pending decision) — ADR-026 still owed
as the Task 1 addendum; Task 2 landed (`@calyxa/curriculum` titles + strandLabels);
Tasks 3–10 not started.** (Update this line as tasks land, per the Sprint 09–12
convention.)

- [ ] `turbo run typecheck lint build test` passes from root; `cd web && next build`
      and `cd extension && wxt build` both exit 0
- [ ] `@calyxa/curriculum` concepts carry `title` + `strandLabel` (audit gap #1 closed);
      keys/edges/accessors unchanged
- [ ] `GET /api/profile/overview` exists: read-only, bearer-auth'd, display-ready
      (titles server-side), calibrating for fresh users, no free-tier interaction
- [ ] the envelope carries `profile_tags` additively (five kinds incl. `callback`);
      tags pass all three gates (schema parse, route grounding against the injected
      profile — callbacks against `priorWork`, client ≤2 cap) and are **never
      invented** — an ungrounded tag is dropped, never rendered
- [ ] cross-session callbacks pull from **real** session history via the additive
      `priorWork` digest (mechanical outcome lines, ≤3 entries), surface **at most once
      per session**, and read as specific ("a few sessions ago you…"), never templated;
      cold start gets none
- [ ] **pings fire for exactly two event types** — a named upward `MasteryState`
      transition, a completed misconception-resolution streak — and for **nothing
      else**: routine mastery ticks, band upticks, first-contact transitions, and
      newly detected misconceptions are all silent (new misconceptions surface only in
      the recap); the prospective compute is the apply's own shared core, and Task 9
      pins prospective == actual
- [ ] `/api/ai/turn` returns `profileTags` and `pings` additively (fields omitted when
      none — such turns are byte-identical to Sprint 12); neither is **ever persisted**
- [ ] `apply.ts`'s write-path behaviour is **byte-identical** after the shared-core
      extraction (existing apply tests green untouched); the FSRS math, scheduler, and
      state/band thresholds in `@calyxa/learning-model` are consumed, never changed
- [ ] `/api/session/end` returns the recap additively, built AFTER the reconcile from
      the post-apply tables — the recap **cannot** disagree with the real mastery write;
      it now includes the **trend rollup** (≥3 consecutive improving sessions only —
      most recaps have none) and the **forward look** (dates straight from
      `reinforcement_schedule`); omitted for no-gradable sessions; a recap failure never
      fails the end
- [ ] the overview renders in the overlay before the first question; tags render inline
      on assistant bubbles (text + voice paths); pings render as transient
      frosted-glass/sage-green toasts (≤2 per turn, one mastery-up per concept per
      session, reduced-motion-safe, `aria-live` polite); the recap renders on session
      end from either the overlay's new End-session control or the popup
      (`SESSION_ENDED` broadcast) — all on Sprint 10 tokens, inside the shadow root, AA
- [ ] deltas are computed client-side against the panel-open overview snapshot; no
      baseline, tag, ping, overview, or recap data is persisted anywhere (**no
      migration**)
- [ ] the **confidence-vs-correctness mismatch** feature has an explicit recorded
      decision status: either Darcy decided the confidence proxy (and the ADR-recorded
      extension shipped under Tasks 5/6), or the decision + options rolled forward to
      the next sprint's planning input — it was **not** implemented without the
      decision, and **not** silently dropped
- [ ] the scheduler, topic bias, annotation layer, voice internals,
      auth/freemium/session logic, `/supabase`, and `/packages/ui` are untouched;
      `loadProfile`'s existing legs are unchanged (the `priorWork` leg is additive)
- [ ] the web suite covers tag parse/grounding/omission/non-persistence, ping
      thresholds + the prospective/actual equivalence pin, the overview route, and the
      recap incl. trend conservatism; the extension spec covers delta/cap/stripping/
      ping-dedupe logic — no live Anthropic call
- [ ] manual acceptance (Task 10) observed: overview-before-first-question, honest tags
      + a real callback, the two-events-only ping asymmetry, recap-matches-DB with
      trends + forward look, cold start, lifecycle discipline, nothing persisted, zero
      host-DOM writes, back-compat
- [ ] ADR-024/025/026 exist (ADR-024 decides the audit's mode/confidence question
      against persistence; ADR-025 records the additive wire + END_SESSION reuse;
      ADR-026 records the two-event ping contract, the prospective-compute design, the
      callback grounding, and the confidence-mismatch deferral); both CLAUDE.md
      pointers + architecture.md updated; git log shows a commit per task

---

## Risks

**The model fabricates profile references.** The failure mode that matters most: a
`[known gap: …]` for a gap the student doesn't have — or a "remember a few sessions
ago…" about a session that never happened — destroys trust in exactly the feature meant
to build it. Mitigation: three gates, and the decisive one — route-side grounding
against the very profile (and prior-session digest) injected that turn — is
deterministic server code, not prompt hope; the callback's raw material is mechanically
derived from real rows, so even a grounded callback can't embellish beyond the bounded
`outcomeLine` phrasings; Task 10 watches a full session for a single fabrication. A
dropped honest tag costs almost nothing; an invented one is the bug.

**A ping claims something the write doesn't do.** The prospective compute runs before
the off-path apply; a divergence would celebrate a level-up that didn't land.
Mitigation: both run the *same* extracted core over the *same* rows — divergence
requires the inputs to change in the milliseconds between the route's read and the
apply's read, which the serialized-turns model doesn't produce (and the `claimed_at`
lease arbitrates the one concurrent-reconcile edge); ping copy is qualitative (never a
number), so even a theoretical divergence can't display a wrong figure; Task 9's
equivalence test pins the shared core end-to-end.

**Ping fatigue / cheapened celebrations.** If toasts fire often, they become noise and
the "leveled up" moment stops meaning anything. Mitigation: the thresholds are the
model's *named* state boundaries (crossing one takes multiple good observations by
construction), band upticks and first-contact transitions are excluded, and the client
dedupes per concept per session; if live use still feels chatty, the fix is threshold
tightening in one place (`events.ts`) — a constant, not an architecture.

**Synchronous ping reads on the voice hot path.** The turn's synchronous leg was
deliberately budgeted small (Sprint 11 audit). Mitigation: gradable turns only; two
small indexed reads for one concept, in parallel (the audit's own `Promise.all`
pattern); a slow/failed compute degrades to no ping without delaying the reply — worst
case the toast for that turn is lost, never the turn.

**Callbacks read as creepy instead of caring.** "I remember your sessions" is the
product promise, but a teenager may experience an overly specific recall as
surveillance. Mitigation: ≤1 per session, prompt-steered to warm and brief, sourced
only from the ≤3-entry digest (never a full history dump); if Task 10 tone-checks
poorly, the fix is prompt phrasing + digest wording — the plumbing stands.

**Trend false positives.** "3rd session in a row improving" that isn't true — or is
technically true on 2 data points — reads as flattery. Mitigation: the ≥3-consecutive-
sessions-including-this-one rule is strict and conservative by spec (ambiguity emits
nothing); Task 9 asserts the 2-session and non-monotone cases stay silent; most recaps
carrying no trend line is the designed outcome, not a failure.

**The apply extraction silently changes write behaviour.** Refactoring the proven
per-interaction core is the sprint's only touch of the learning write path.
Mitigation: extraction-only (no logic edits), the existing apply test cases must pass
untouched, and the Task 9 equivalence test exercises the shared core from both callers;
if the extraction fights the code's shape, the fallback is `events.ts` duplicating the
few lines with a pinned cross-test — uglier but equally safe — recorded in "What the
next sprint needs to know" if taken.

**The recap disagrees with the DB.** Would fail the sprint's acceptance line.
Mitigation: structurally prevented — the recap is *read from* the post-reconcile tables
after the already-awaited `reconcileSession`, in the same request; there is no second
source of truth to drift from. The only soft spot is decay-adjustment timing (seconds),
which is invisible at display precision.

**The overview baseline is missing or stale for deltas.** A student who skips the
overview (or whose panel re-opened mid-session) has no/old baseline. Mitigation: the
recap degrades to absolute values with no delta arrows — correct, just less rich; the
baseline refreshes on every panel open; never persisted, so there is nothing to go stale
across sessions.

**`onSend`'s return-type change ripples through the overlay.** The transport seam's one
breaking-ish edit (string → `{ reply, tags?, pings? }`). Mitigation: the seam has
exactly two consumers (`handleSubmit`, `handleMicStop`), both updated in the same task;
the empty-reply guard keys on `reply` unchanged; Task 9's stripping test pins the
history-out shape so tags can't leak into the wire request.

**The End-session control changes session UX.** New control, popup parity questions.
Mitigation: it sends the *existing* `END_SESSION` message — one handler, one RPC, one
storage-clear for both surfaces; the popup is untouched; panel close explicitly does not
end the session (Task 10 item 8 verifies the free-tier accounting is unchanged).

**A recap broadcast to no listener.** Session ended with no panel open → the recap is
never seen. Accepted (ADR-025): the recap is ephemeral display data, not a record; the
dashboard sprint is the home for browsable history if wanted.

**The confidence-mismatch decision stalls the sprint.** It must not: every other
feature is independent of it. Mitigation: it is gated as a decision, not a task — the
checklist accepts either outcome (decided-and-shipped or rolled-forward-with-options);
nothing in Tasks 2–10 waits on it.

**Sprint size (10 tasks, four late additions).** This is now the largest sprint since
Sprint 10. Mitigation: the four server halves (Tasks 3–6) are independent of each other
once Task 2 lands, so slippage is visible early; if it overruns, the natural split is
the web contract (Tasks 1–6) as one sprint and the extension surfaces (Tasks 7–10) as
the next — the same seam Sprint 10 used — flagged, not assumed.

**Curriculum titles as another hand-maintained parallel.** The audit already flagged the
topic-alias table's drift risk; titles could drift the same way. Mitigation: titles live
*inside* each `Concept` entry (single source, not a parallel map), and the Task 2 test
fails the build on any entry missing one — drift is structurally louder than the alias
case.

---

## What the next sprint needs to know

**The adaptive loop is now visible in-product — and audible in the moment.** The overlay
shows where the student stands before they ask, tags the tutor's live profile references
during the session (grounded — never invented), celebrates the model's own named
milestones as they happen (two event types only; everything else stays silent), calls
back to real prior sessions occasionally, and recaps the real mastery write — with
trends and the FSRS forward look — at session end. All of it is display-ephemeral: no
new table, no migration, nothing persisted. What attaches next:

- **Dashboard sprint (Sprint 14):** the Sprint 11 audit's readiness table transfers as
  its planning input, now improved: **concept titles exist** (`@calyxa/curriculum` —
  gap #1 closed here); the overview/recap serialization shapes, the trend rollup, and
  the ping event definitions are working precedents for the dashboard's mastery, due-
  queue, and history views. Still open from the audit: chart colors as named
  `@calyxa/ui` tokens; `(session_id, turn_index)` as display order not identity;
  per-request-fresh reads (no cache masking the reconcile).
- **The confidence-vs-correctness mismatch decision** either shipped (check ADR-026's
  amendment) or rolls to Sprint 14's planning input with the options recorded: persisted
  latency and tutor-inferred `self_confidence` need zero new capture; revision/hesitation
  telemetry needs new client capture plus a privacy/consent posture decision. Do not
  implement it without the proxy decision.
- **Mode/tutor-confidence persistence** was decided **against** here (ADR-024). If the
  dashboard's session timeline wants "socratic vs direct" or grading-confidence
  history, that is one additive migration + two insert fields — its plan owns the call.
- **A persisted event log** (ping history, "recent wins" feed) deliberately doesn't
  exist — pings are shown once and discarded. If the dashboard wants a wins feed, that
  is an additive schema decision then.
- **Session history / recap persistence** deliberately not built: the recap is computed
  live and shown once. A browsable history is an additive schema decision then — and a
  privacy call, same instinct as ADR-023.
- **The grounding gate is reusable**: any future envelope field that references student
  state (hints-used, streaks, goals) should pass the same route-side check against the
  injected profile before it reaches a screen.
- **The shared per-interaction core** (`apply.ts` ↔ `events.ts`) is now the single place
  the FSRS observation is assembled — future turn-time predictions (e.g. a
  confidence-mismatch event, if decided) should call it, not re-derive it.
- **Streaming sprint (if pursued):** tags and pings join annotations as trailing SSE
  events after the `say` deltas; the overlay commits them with the bubble exactly as
  today — only the transport leg changes.
- **The overview endpoint is dashboard-shaped**: `GET /api/profile/overview` is the
  overlay-sized read; the dashboard will want richer variants (full history, per-strand
  grouping) — extend or sibling it, don't overload it silently.
