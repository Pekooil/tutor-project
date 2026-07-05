# Sprint 13 — Adaptive tutor experience in the overlay (the three UX surfaces)

## Goal
Make the adaptive engine **visible to the student**. Sprints 09–12 built a learning loop
that assesses every turn, updates FSRS per interaction, schedules reinforcement, and
draws on the page — but the student never *sees* any of it. By the end of this sprint,
three UX surfaces on the Sprint 10 redesigned overlay show the loop working:

1. **Pre-question profile overview** — a quick "here's where you are" panel (mastery,
   weak spots, due reinforcements) rendered in the overlay **before the student asks
   their first question**;
2. **In-session profile tags** — the tutor's live profile references surfaced as visible
   tags in the transcript (e.g. `[reviewing: factoring]`, `[known gap: sign errors]`),
   **driven by the envelope** the same way annotations are;
3. **Post-session data-update summary** — a recap of **what actually changed** — mastery
   deltas, misconceptions resolved/added, next reinforcements — built from the session-end
   reconcile over the per-turn `session_interactions` record (the Sprint 11 successor to
   the Sprint 08/09 summariser; see the correction in Context).

```
panel open (no messages yet)
      → GET /api/profile/overview (NEW, read-only: loadProfile + curriculum titles)
      → background → content → Overlay renders the "where you are" card
      → the overview snapshot is ALSO the client-side baseline for end-of-session deltas

turn  → §2.5 envelope { say, annotations[], assessment, profile_tags[] (NEW) }
      → route grounds each tag against the profile it just injected (drop, never invent)
      → /api/ai/turn returns { reply, annotations?, profileTags? }   (additive)
      → background → content → Overlay renders tags on the assistant bubble

end   → END_SESSION (popup, or the overlay's NEW End-session control)
      → /api/session/end reconciles (existing) → builds recap from the POST-apply tables
      → { sessionId, endedAt, interactionCount, recap? }             (additive)
      → background broadcasts SESSION_ENDED → content → Overlay renders the recap card
      → deltas = recap current values − the panel-open overview baseline (client-side)
```

Acceptance in one line (the brief's): **profile overview renders before the first
question; tags appear inline during tutoring; the end-of-session recap reflects the real
mastery write.** All three surfaces live on the Sprint 10 overlay + `@calyxa/ui` tokens,
inside the shadow root — **no host-DOM mutation**, and **nothing new is persisted**
(no migration): overview, tags, and recap are display-ephemeral, the ADR-013/ADR-023
instinct applied to profile visibility.

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
- **Session end:** `/api/session/end` **awaits** `reconcileSession` before responding —
  so by response time, every gradable interaction of the session has been folded into
  `knowledge_nodes`, `misconceptions`, and `reinforcement_schedule`. The response
  (`{ sessionId, endedAt, interactionCount }`) is currently thrown away by the extension
  (`api.endSession` returns `void`). The recap is therefore a **read of tables that are
  already correct at exactly the moment the route responds** — no new write, no timing
  gamble.
- **Overlay:** the Sprint 10 redesign (`Overlay.tsx`) has an empty state (header + input,
  no chat area), per-message assistant bubbles, and the full token system — the natural
  homes for the overview card, inline tags, and recap card. Session lifecycle is
  popup-driven today (`START_SESSION`/`END_SESSION` → background); the overlay has no
  session control, which matters for surface 3 (see the lifecycle section below).
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

Note on sprint selection: the Sprint 11 audit prepared the **mastery dashboard** as the
next frontend sprint, and Sprint 12's plan slid that preparation to Sprint 13. This
sprint takes the overlay UX surfaces instead — they are the in-product proof of the
adaptive claim, and they de-risk the dashboard (titles, display shapes, and the recap
read all transfer). The audit's readiness table + gaps list slide intact to **Sprint 14**;
gap #1 (concept titles) is closed *here*, gap #2 (chart tokens) and the freshness note
still belong to the dashboard.

Locked decisions from `/CLAUDE.md` and `/docs/CLAUDE.md` that drive this sprint:
- **DOM policy: content script reads only. No mutations to host page DOM.** All three
  surfaces render inside the `<calyxa-overlay>` shadow root on the existing Sprint 10
  system. No new host-DOM read is added either — these surfaces consume server data, not
  page data.
- **All API keys server-side / free tier server-side:** the overview endpoint is a
  read-only, RLS-scoped profile read (no model call, no gating change); tags ride the
  existing authenticated turn; the recap rides the existing session-end call.
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

**(c) What stays deferred.** The mastery dashboard (Sprint 14 — the audit's readiness
table transfers untouched), true SSE streaming of the envelope, cold-start onboarding,
OCR-beta capture, and the embedding match are all untouched. Persisting `mode`/tutor
`confidence` per turn — the audit's "decide in planning, not silently" item — is
**decided here: not persisted.** Tags are turn-time envelope output rendered and
discarded, exactly like annotations; if the Sprint 14 timeline UX wants per-turn
mode/confidence history, *that* plan owns the additive migration (recorded in ADR-024).

Recorded in **ADR-024** (the three profile-visibility surfaces: overview / in-session
tags / post-session recap; all display-ephemeral, nothing persisted, no migration;
tags are profile-grounded — parsed against the tag schema, then cross-checked by the
route against the very profile it injected that turn, drop-don't-invent; display fields
are server-rendered — titles resolve server-side so the extension never re-derives
curriculum data; decides the audit's mode/confidence question as "not persisted") and
**ADR-025** (the wire: a new read-only `GET /api/profile/overview`; `profile_tags`
additive on the envelope, the turn response, `AiReplyPayload`, and the `AI_STREAM`
`done` message; the recap additive on the `/api/session/end` response and broadcast to
tabs as a new `SESSION_ENDED` message; the overlay gains an End-session control that
reuses the existing popup END_SESSION path; mastery deltas are computed client-side
against the panel-open overview snapshot — no baseline is ever persisted).

### Grounded tags, never invented (read before Tasks 4, 7)
A fabricated tag is the tag system's misplaced-annotation: `[known gap: sign errors]`
attached to a student who has never made a sign error actively misinforms — worse than
no tag. So tags pass **three gates**, in order:
1. **Schema parse** (`envelope.ts`): `kind` ∈ `reviewing | known-gap | due-review |
   strength`; `concept_key` ∈ `CONCEPT_KEYS` or null; `label` a non-empty string (the
   route truncates to ~30 chars); structurally invalid entries dropped individually,
   like `parseAnnotation`.
2. **Grounding check** (`turn/route.ts`): the route *holds the profile it just rendered
   into the prompt* — a `known-gap` tag must reference an injected active misconception
   (concept-key match, or category/label overlap with one); `reviewing`/`strength` must
   reference an injected mastery node; `due-review` must reference an injected
   `dueForReview` item. An ungrounded tag is dropped with a `console.debug` — the model
   cannot surface a "memory" the profile read didn't actually contain.
3. **Client cap** (defence in depth): ≤2 tags per turn enforced overlay-side too.

The prompt steers the model the same way Sprint 12 steered annotation targeting: tag
**only** what the STUDENT PROFILE block shows, ≤2 per turn, most turns none, `label` ≤4
words in student-friendly phrasing (the concept's short title, not its key).

### Display data is server-rendered and ephemeral (read before Tasks 3, 5, 6)
The server resolves every concept key to its curriculum `title` before anything crosses
the wire — overview items, grounded tags, and recap entries all arrive display-ready.
The extension renders; it never imports `@calyxa/curriculum` (no curriculum data in the
bundle, no drift between two copies). And none of the three surfaces persists anything:
- the **overview** is fetched fresh on each panel open (the `capturedPageContext`
  fresh-per-open discipline, applied to profile data) and held in overlay state only;
- **tags** are envelope output, rendered and gone with the transcript (the transcript
  sent back to `/api/ai/turn` remains pure `role`/`content` — tags never re-enter the
  prompt or the wire request);
- the **recap** rides one response, is shown once, and is discarded on panel close.
  Mastery deltas are computed **client-side**: `delta = recap value − the overview
  snapshot from panel open`. No baseline row, no snapshot table; if the student never
  saw the overview this session, the recap degrades to absolute values (no arrows).

### The three surfaces in the overlay lifecycle (read before Tasks 6, 7)
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
(1 → 9)**. The chain is real: the ADRs fix the grounded-tags / nothing-persisted /
server-rendered-display decisions (Task 1); curriculum titles (Task 2) must exist before
any server response can render them (Tasks 3–5); the overview endpoint (Task 3), the tag
contract (Task 4), and the recap (Task 5) are the three server halves, built before the
extension transport threads them (Task 6); the overlay surfaces (Task 7) consume the
transport; tests (Task 8) gate manual acceptance (Task 9). One session — no handoff.

This sprint **does** touch `@calyxa/curriculum` (data-only titles), the web AI lib
(`envelope.ts`, `system-prompt.ts` — additive), three routes (`/api/ai/turn` additive
response field; `/api/session/end` additive response field; `/api/profile/overview` new),
a new `/web/lib/learning/recap.ts`, and the extension's transport
(`types/messages.ts`, `lib/api.ts`, `background/index.ts`), content script
(`content/index.ts`), and overlay (`Overlay.tsx`, `Overlay.css` if needed). It **does
not** touch the learning write path (`apply.ts`, `scheduler.ts`, FSRS math), the
annotation layer (`annotations.ts`, `AnnotationLayer.tsx`, resolver, prompt targeting
guidance), `profile-read.ts` (`loadProfile` is consumed as-is), the voice pipeline
internals, session/auth/freemium logic (the End-session control reuses the existing
handler), `/supabase` (**no migration**), or `/packages/{ui,learning-model}`.

## Files in scope

### Task 1 (ADRs + sprint pointers) creates or edits:
```
/docs/adr/ADR-024-profile-visibility-surfaces.md ← new — the three surfaces (overview / tags / recap); display-ephemeral, nothing persisted, no migration; grounded tags (schema parse → route grounding against the injected profile → client cap; drop-don't-invent); server-rendered display fields (titles resolve server-side); DECIDES the Sprint 11 audit's mode/confidence question: not persisted.
/docs/adr/ADR-025-profile-data-on-the-wire.md    ← new — GET /api/profile/overview (new read-only route); profile_tags additive on envelope + turn response + AiReplyPayload + AI_STREAM done; recap additive on /api/session/end response + SESSION_ENDED broadcast; overlay End-session control reuses the popup END_SESSION path; deltas computed client-side against the panel-open overview snapshot (never persisted).
/CLAUDE.md                                        ← edit one line: Current sprint → Sprint 13 — Adaptive tutor experience in the overlay
/docs/CLAUDE.md                                   ← edit one line: Current phase → Phase 2, Sprint 13
/docs/sprint-13-plan.md                           ← this file
/docs/architecture.md                             ← edit: profile overview endpoint (read-only); envelope carries profile_tags; session end returns a recap; the three overlay surfaces; nothing new persisted
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

### Task 4 (web — the profile-tag contract: envelope + prompt + route) edits:
```
/web/lib/ai/envelope.ts        ← edit — additive: ProfileTagKind ('reviewing'|'known-gap'|'due-review'|'strength'), ProfileTag { kind, conceptKey: string|null, label }; TurnEnvelope gains profileTags?; parseProfileTag mirrors parseAnnotation's drop-don't-default discipline (invalid kind/empty label → entry dropped; concept_key outside CONCEPT_KEYS → null, entry kept); array capped at 2 at parse time. Everything else byte-identical.
/web/lib/ai/system-prompt.ts   ← edit — additive PROFILE TAGS block in buildEnvelopeOutputFormat (envelope format only; the format:'text' stream path untouched): tag ONLY what the STUDENT PROFILE block shows; ≤2 per turn, most turns none; kinds documented with when-to-use; label ≤4 words, student-friendly; known-gap only for a listed active misconception; due-review only for a listed due item. The §2.5 schema block, annotation guidance, and every other section unchanged.
/web/app/api/ai/turn/route.ts  ← edit — ground each parsed tag against the LearningProfile this very request injected (known-gap ↔ activeMisconceptions, reviewing/strength ↔ masteryNodes, due-review ↔ dueForReview; ungrounded → dropped, console.debug); resolve grounded tags' conceptKey → title into the label context; return additively { reply, annotations?, ...(grounded tags when present ? { profileTags } : {}) } — field OMITTED when none (a no-tag turn is byte-identical to Sprint 12). persistInteraction UNCHANGED — tags are not persisted (ADR-024).
```

### Task 5 (web — the session-end recap) creates / edits:
```
/web/lib/learning/recap.ts        ← new — buildSessionRecap(supabase, userId, sessionId): reads the session's session_interactions (concept keys touched, per-key outcome counts), the sessions row (started_at/ended_at window), then the POST-reconcile state for the touched keys: knowledge_nodes (mastery decay-adjusted via retrievability, the profile-read convention), misconceptions created or resolved within the session window (created_at / status+updated_at), reinforcement_schedule rows (due_at) for the touched keys. Returns { concepts: [{ conceptKey, title, turns, correct, incorrect, mastery, state }], misconceptionsAdded: [...], misconceptionsResolved: [...], nextReviews: [{ conceptKey, title, dueAt }] } or undefined when the session had no gradable interactions. Read-only; titles server-side (Task 2).
/web/app/api/session/end/route.ts ← edit — AFTER the awaited reconcileSession (already in place), call buildSessionRecap and return { sessionId, endedAt, interactionCount, ...(recap ? { recap } : {}) }. A recap failure is logged and the field omitted — it never fails an already-successful end (the route's existing reconcile posture). End/reconcile logic UNCHANGED.
```

### Task 6 (extension — transport threads all three payloads) edits:
```
/extension/src/types/messages.ts   ← edit — mirror ProfileTag/ProfileTagKind + declare ProfileOverview and SessionRecap (by-convention re-declaration with source-of-truth comments, like Annotation); AiReplyPayload gains profileTags?; new MessageTypes GET_PROFILE_OVERVIEW (content → background; reply { overview } | { error }) and SESSION_ENDED (background → tabs broadcast; { recap? }). All existing types + comments kept.
/extension/src/lib/api.ts          ← edit — getProfileOverview(): GET /api/profile/overview via authorizedFetch; endSession() returns the response body's recap (was fire-and-forget void) — storage clear unchanged.
/extension/src/background/index.ts ← edit — handle GET_PROFILE_OVERVIEW (api.getProfileOverview, error-shaped like every other reply); handleAiTurn + the AI_STREAM done message thread profileTags (exactly the Sprint 12 annotations threading); handleEndSession captures the recap and broadcasts SESSION_ENDED to all tabs (broadcastToAllTabs pattern) — popup- and overlay-initiated ends both flow through it. All other handlers unchanged.
```

### Task 7 (extension — the three overlay surfaces + wiring) edits:
```
/extension/src/content/index.ts  ← edit — sendAiTurn resolves { reply, tags? } (port done + AI_TURN response both carry profileTags; annotations handling unchanged); new onLoadOverview callback (sends GET_PROFILE_OVERVIEW); new onEndSession callback (sends END_SESSION); SESSION_ENDED listener → `calyxa:session-recap` window CustomEvent. Registry/annotation/lifecycle code untouched.
/extension/src/overlay/Overlay.tsx ← edit — (1) overview card in the empty expanded state via onLoadOverview (mastery bars ≤5, weak spots ≤3, due items ≤3; calibrating variant; silent-degrade on error; the snapshot retained as the delta baseline); (2) messages become a local display type { role, content, tags? } — tags render as small pills on assistant bubbles (≤2, client cap), history passed to onSend stripped back to role/content; (3) recap card on `calyxa:session-recap` (per-concept mastery + delta arrows vs the baseline when present, misconceptions resolved/added, next reviews) + the End-session header control (onEndSession). All on existing tokens/primitives; AA (contrast, aria-labels, reduced-motion-safe); onSend's return type change threaded through handleSubmit/handleMicStop.
/extension/src/overlay/Overlay.css ← edit only if a utility can't express a style — shadow-root-scoped classes, tokens only (no new token; ADR-018/ADR-002 discipline).
```

### Task 8 (tests) creates / edits:
```
/web/tests/envelope.test.ts        ← edit — profile-tag parse: valid tags parse; invalid kind/empty label dropped individually; unknown concept_key nulled; >2 capped; envelope without tags unchanged.
/web/tests/ai-turn.test.ts         ← edit — grounded tags returned additively; ungrounded tags (concept/misconception NOT in the injected profile) filtered at the route; field omitted when none (response byte-identical to Sprint 12); tags never persisted (session_interactions row shape unchanged).
/web/tests/profile-overview.test.ts ← new — 401 signed out; display-ready shape with titles; calibrating for a fresh user; read-only (no writes observed).
/web/tests/session.test.ts         ← edit — session end returns a recap reflecting post-reconcile state (a gradable session yields concepts + nextReviews; misconception add/resolve within the window appears); recap omitted for an empty session; recap failure doesn't fail the end; existing end/reconcile cases stay green.
/extension/tests/overlay-display.test.ts ← new — pure display logic (vitest, jsdom, the Sprint 12 test-infrastructure precedent): delta computation vs a baseline (present/absent), the ≤2 client tag cap, history-stripping (tags never re-enter the TurnMessage[] sent to onSend).
```

### Files explicitly out of scope
```
/web/lib/learning/{apply,scheduler,profile-read,topic}.ts  (the loop is read, not touched; loadProfile consumed as-is)
/web/lib/ai/{claude,page-context}.ts                       (turn execution + page context unchanged)
/web/lib/ai/system-prompt.ts annotation guidance            (Sprint 12's block untouched — Task 4 adds a sibling block only)
/web/app/api/{auth,voice,session/start}/**                  (unchanged; session/start's reconcile sweep stays)
/extension/src/content/{annotations,pageExtractor}.ts       (annotation layer + extraction untouched)
/extension/src/overlay/{AnnotationLayer.tsx,VoiceController.ts,mount.tsx}  (unchanged)
/extension/src/popup/**                                     (popup keeps its session controls; no redesign)
/supabase/**                                                (NO migration — nothing new persisted; ADR-024)
/packages/{ui,learning-model}/**                            (tokens/primitives consumed as-is; FSRS untouched)
```
Also out of scope (no pre-empting later roadmap sprints):
- **The mastery dashboard** — now Sprint 14; the Sprint 11 audit's readiness table +
  remaining gaps (chart tokens, freshness semantics) transfer to its plan; titles are
  closed here.
- **Persisting `mode` / tutor `confidence` per turn** — decided *against* this sprint
  (ADR-024); the Sprint 14 timeline UX re-opens it with its own migration if wanted.
- **True SSE streaming of the envelope**, **cold-start onboarding**, **OCR-beta
  capture**, **embedding matching** — unchanged, their own sprints.
- **Session history / recap persistence** — the recap is computed at end time from live
  tables and shown once; a browsable session-history UX is a dashboard-sprint decision.

Do not create any file not listed above. If something seems needed but is not listed,
add it to "What the next sprint needs to know" and ask before creating it.

---

## Task 1 — Profile-visibility + wire ADRs + sprint pointers (planning / docs)

Write two ADRs in the project format (match ADR-001…ADR-023 exactly: `## ADR-0NN:
[Title]`, then `**Status:** Decided`, `**Context:**`, `**Decision:**`, `**Rationale:**`
bullets, `**Consequences:**` Enables/Requires/Forecloses).

ADR-024 — The three profile-visibility surfaces (display-ephemeral, grounded, server-rendered):
- Context: the Sprint 11 loop closes invisibly; the product's adaptive claim has no
  in-product proof. The audit left two relevant openings: concept display titles
  (gap #1) and the persist-mode/confidence question ("decide in planning"). A shape
  decision was needed: where profile visibility comes from, how the tutor's references
  are kept honest, and whether any of it persists.
- Decision: three surfaces on the Sprint 10 overlay — pre-question overview (a
  serialized `loadProfile` read), in-session tags (a new envelope field), post-session
  recap (a read of the post-reconcile tables) — all display-ephemeral (nothing persisted,
  no migration), all display fields server-rendered (curriculum titles never ship in the
  extension bundle). Tags pass three gates: schema parse (drop-don't-default per entry),
  route-side grounding against the exact profile injected that turn (drop-don't-invent),
  client-side ≤2 cap. Mode/tutor-confidence: **not persisted** (the tags ARE the
  turn-time surfacing; a timeline history is Sprint 14's own migration decision).
- Rationale (bullets): a fabricated "known gap" misinforms worse than silence — the
  annotation layer's drop-don't-guess contract applies to displayed memory too; the
  route already holds the injected profile, so grounding is a lookup, not a new read;
  reading the recap from post-reconcile tables makes disagreement with the real write
  structurally impossible; ephemerality follows ADR-013/ADR-023 — display data with no
  consumer beyond the moment is not a new privacy surface.
- Consequences: Enables — the in-product proof of adaptivity; Sprint 14's dashboard
  inherits titles + display shapes. Requires — curriculum titles (Task 2); the wire
  (ADR-025). Forecloses — persisted per-turn mode/confidence *this sprint* (explicitly
  re-openable in Sprint 14); tags that reference anything outside the injected profile.

ADR-025 — Profile data on the wire (one new read-only route; everything else additive):
- Context: the profile reaches only the prompt; the session-end response is discarded by
  the extension; the envelope has no profile-reference field. A wire decision was needed
  for all three surfaces, plus a session-lifecycle one: the recap renders in the overlay,
  but only the popup can end a session.
- Decision: `GET /api/profile/overview` (new, read-only, bearer-auth'd, no gating);
  `profile_tags` rides the envelope → turn response → `AiReplyPayload` → `AI_STREAM`
  `done` additively (field omitted when none — the ADR-023 pattern verbatim); the recap
  rides `/api/session/end`'s existing response additively and is broadcast to tabs as
  `SESSION_ENDED`; the overlay gains an End-session control that sends the existing
  `END_SESSION` message (no parallel path, no session-logic change); deltas are computed
  client-side against the panel-open overview snapshot, which is never persisted.
- Rationale (bullets): the additive-field pattern is proven twice on this exact seam;
  one read-only endpoint is cheaper and safer than smuggling profile data onto
  session/start (whose response is popup-consumed, not overlay-consumed); broadcasting
  the recap mirrors SESSION_STATE's existing fan-out so popup- and overlay-initiated
  ends behave identically; reusing END_SESSION keeps free-tier accounting in exactly one
  code path.
- Consequences: Enables — all three surfaces with zero protocol breaks; a recap for
  whichever surface ends the session. Requires — the background to capture (not
  discard) the end response; the overview fetch to degrade silently. Forecloses —
  nothing; a persisted session-history/recap remains a deliberate later decision.

Then the pointer edits: `/CLAUDE.md` "Current sprint" → `Sprint 13 — Adaptive tutor
experience in the overlay`; `/docs/CLAUDE.md` "Current phase" → `Phase 2, Sprint 13`.
Change no other line in either. Update `/docs/architecture.md` per the Files-in-scope
note.

Acceptance gate before Task 2:
  - ADR-024/025 exist in the exact format and record the decisions above (grounded
    tags, nothing-persisted, server-rendered display, mode/confidence decided against,
    END_SESSION reuse); both CLAUDE.md pointers + architecture.md updated.

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

## Task 4 — Web: the profile-tag contract (envelope + prompt + route grounding)

Scope: `/web/lib/ai/{envelope.ts, system-prompt.ts}`, `/web/app/api/ai/turn/route.ts`.
All additive; the `format:'text'` stream path and the Sprint 12 annotation guidance are
untouched.

  - `envelope.ts`: `ProfileTag { kind, conceptKey, label }` with the four kinds;
    `parseProfileTag` per the design model (drop invalid entries individually, null
    unknown concept keys, cap 2 at parse); `TurnEnvelope.profileTags?` — omitted when
    the model sent none/invalid-only.
  - `system-prompt.ts`: the PROFILE TAGS block in `buildEnvelopeOutputFormat` — tag only
    what the STUDENT PROFILE block shows; kind semantics (`reviewing` = a listed concept
    being practiced again; `known-gap` = a listed active misconception; `due-review` = a
    listed due item; `strength` = a listed strong node, sparingly); ≤2 per turn, most
    turns none; label ≤4 words, plain language.
  - `turn/route.ts`: the grounding gate — the route already holds the `LearningProfile`
    it rendered; filter tags against it (per-kind rules above; `console.debug` on a
    drop); return `{ reply, annotations?, profileTags? }` with the field **omitted**
    (never null/`[]`) when nothing survives. `persistInteraction` unchanged — a comment
    notes tags are deliberately not persisted (ADR-024).

Acceptance gate before Task 5:
  - typecheck + lint + `next build` pass. A mocked envelope with a grounded tag yields
    `{ reply, …, profileTags }`; an ungrounded tag is filtered; no tags → the response
    is byte-identical to Sprint 12; the rendered envelope prompt contains the block; the
    text-format prompt is unchanged.

---

## Task 5 — Web: the session-end recap (learning lib + route)

Scope: `/web/lib/learning/recap.ts` (new), `/web/app/api/session/end/route.ts`.
Read-only recap; end/reconcile behaviour unchanged.

  - `recap.ts`: `buildSessionRecap` per the Files-in-scope spec. Touched concepts come
    from the session's `session_interactions` rows (gradable outcomes only); mastery is
    read decay-adjusted (the `retrievability` convention from `profile-read.ts`);
    misconceptions added/resolved are bounded to the session's `started_at`–`ended_at`
    window; `nextReviews` reads `reinforcement_schedule` for the touched keys. Titles
    server-side. Returns `undefined` for a session with no gradable interactions.
  - `session/end/route.ts`: after the existing awaited `reconcileSession`, build the
    recap and return it additively; a recap failure logs and omits the field (the
    route's established best-effort posture). Nothing about ending/reconciling changes.

Acceptance gate before Task 6:
  - typecheck + lint + `next build` pass. A session with gradable turns returns a recap
    whose mastery values match a direct post-reconcile `knowledge_nodes` read and whose
    `nextReviews` match `reinforcement_schedule`; an empty session returns the Sprint 11
    response byte-identically; a forced recap error still ends the session cleanly.

---

## Task 6 — Extension: transport threads overview + tags + recap

Scope: `/extension/src/{types/messages.ts, lib/api.ts, background/index.ts}`. Transport
only — no behaviour change when the new fields are absent.

  - `messages.ts`: mirror `ProfileTag` (+ kind union) from `envelope.ts`; declare
    `ProfileOverview` / `SessionRecap` mirroring the route payloads (source-of-truth
    comments, the `PageEquation` convention); `AiReplyPayload` gains `profileTags?`;
    add `GET_PROFILE_OVERVIEW` + `SESSION_ENDED` message types with payload shapes.
  - `api.ts`: `getProfileOverview()`; `endSession()` parses and returns the body
    (recap included) instead of discarding it — the storage clear and error handling
    unchanged.
  - `background/index.ts`: `GET_PROFILE_OVERVIEW` handler; `profileTags` threaded on
    both reply paths (the `done` message + `AI_REPLY`), exactly like annotations;
    `handleEndSession` broadcasts `SESSION_ENDED { recap? }` to all tabs after a
    successful end. Everything else unchanged.

Acceptance gate before Task 7:
  - `wxt build` exits 0; typecheck passes. Stubbed responses reach the content script:
    an overview via `GET_PROFILE_OVERVIEW`; `profileTags` on both turn paths; a
    `SESSION_ENDED` broadcast with the recap after an end from EITHER the popup or a
    content-sent `END_SESSION`. Absent fields → Sprint 12 behaviour exactly.

---

## Task 7 — Extension: the three overlay surfaces (content + overlay)

Scope: `/extension/src/content/index.ts`, `/extension/src/overlay/Overlay.tsx`
(+ `Overlay.css` only if needed). Sprint 10 tokens/primitives; shadow root only; the
overlay's chrome.*-free discipline holds (all I/O via the callback props).

  - `content/index.ts`: `sendAiTurn` resolves `{ reply, tags? }` (annotations handling
    on both paths unchanged); `onLoadOverview` / `onEndSession` callbacks;
    `SESSION_ENDED` listener → `calyxa:session-recap` CustomEvent (registered once,
    like the panel-close listener).
  - `Overlay.tsx` — overview: on first expand with no messages, call `onLoadOverview`;
    render the "where you are" card (mastery bars ≤5 with titles, weak spots ≤3, due
    ≤3); calibrating variant for a fresh user; render nothing on error; keep the
    snapshot as the delta baseline. Tags: local display message type carries `tags?`;
    assistant bubbles render ≤2 small pills (`[reviewing: Factoring quadratics]`
    styling on existing tokens); the history handed to `onSend` is stripped to
    `role`/`content`; text path commits tags with the bubble at `done`, voice path when
    the reply commits after playback. Recap: on `calyxa:session-recap`, render the
    recap card (per-concept mastery with delta arrows when a baseline exists, absolute
    otherwise; misconceptions resolved/added; next reviews with due dates) in the chat
    area; the End-session control in the header calls `onEndSession` (disabled while a
    turn is in flight). AA throughout; animations reduced-motion-safe; `aria-live`
    behaviour of the chat area unchanged.

Acceptance gate before Task 8:
  - `wxt build` exits 0. Live against `next dev`: opening the panel as a returning user
    shows the overview before any question; a turn whose profile matches yields an
    inline tag on the tutor's bubble; End session from the overlay renders the recap
    with deltas vs the overview; a fresh user sees calibrating → no tags → no-gradable
    recap omitted; closing the panel does NOT end the session; nothing renders outside
    the shadow root.

---

## Task 8 — Tests (gate)

Scope: per the Files-in-scope list. Reuse the fake-Anthropic backend — **no live model
call**; the extension spec follows the Sprint 12 vitest/jsdom pure-logic precedent.

  1. **Tag parse (envelope):** valid tags parse; bad kind / empty label dropped
     individually; unknown `concept_key` nulled; >2 capped; tag-free envelopes
     unchanged.
  2. **Tag grounding (route):** grounded tags returned; a tag referencing a
     concept/misconception NOT in the injected profile is filtered; field omitted when
     none (byte-identical response); tags never appear in the persisted
     `session_interactions` row.
  3. **Overview route:** 401 signed out; display-ready shape with curriculum titles;
     calibrating for a fresh user; no writes.
  4. **Recap:** reflects post-reconcile state (mastery values match `knowledge_nodes`,
     `nextReviews` match `reinforcement_schedule`); misconception added/resolved inside
     the session window appears, outside it doesn't; omitted for a no-gradable session;
     a recap failure doesn't fail the end; existing session cases green.
  5. **Overlay display logic (extension):** delta arithmetic with/without a baseline;
     the ≤2 client cap; history-stripping (tags never enter the outbound
     `TurnMessage[]`).
  6. **Suite hygiene:** full `/web` suite green; `turbo run typecheck lint build test`
     green across workspaces.

Acceptance gate before Task 9:
  - all of the above pass with no live Anthropic call; `next build` and `wxt build`
    exit 0.

---

## Task 9 — Adaptive-experience acceptance (manual)

This is the sprint's headline acceptance: **the overview renders before the first
question; tags appear inline during tutoring; the end-of-session recap reflects the real
mastery write.** With `cd web && next dev` (`ANTHROPIC_API_KEY` set) and the unpacked
extension loaded, as a returning user with real history:

  1. **Overview before the first question:** open the panel → the "where you are" card
     shows mastery (titled, weakest first), weak spots, and due reinforcements —
     matching a direct `loadProfile`/DB read — before anything is typed.
  2. **Tags during tutoring:** work a concept the profile lists → `[reviewing: …]`
     appears on the tutor's bubble; with a seeded active misconception, a
     `[known gap: …]` appears only when the profile actually lists it; with a seeded due
     item, `[due review: …]` accompanies the "let's revisit…" opening. Voice turns tag
     too (committed with the reply after playback).
  3. **No invented memory:** across the session, no tag ever references a concept or
     gap absent from the injected profile (spot-check server logs for grounding drops —
     drops are fine, fabrications are the failure).
  4. **Recap reflects the real write:** End session from the overlay → the recap's
     mastery values match `knowledge_nodes` post-reconcile, deltas match the overview
     baseline, resolved/added misconceptions match the `misconceptions` table, next
     reviews match `reinforcement_schedule`. Ending from the popup with the panel open
     shows the same recap.
  5. **Cold start:** a fresh user sees the calibrating overview, no tags, and a
     recap-less end — nothing errors, nothing blocks the first question.
  6. **Lifecycle discipline:** closing the panel does NOT end the session (annotations
     clear, session continues); End-session is the only session-ending control in the
     overlay; free-tier accounting unchanged (one session consumed per START/END pair).
  7. **Nothing persisted, nothing mutated:** `session_interactions` rows are
     shape-identical to Sprint 12 (no tag/overview/recap data anywhere in the DB); the
     Sprint 12 MutationObserver check on a full session with all three surfaces shows
     zero host-DOM mutations outside `<calyxa-overlay>`.
  8. **Back-compat:** a page/turn where no surface has data (no profile, no tags, no
     recap) is indistinguishable from Sprint 12 — same replies, same annotations, same
     persistence.

---

## Acceptance criteria (full checklist)

**Sprint status: IN PROGRESS — Task 1 landed (ADR-024/025 + sprint pointers +
architecture.md); Tasks 2–9 not started.** (Tasks 1–9 below; update this line as tasks
land, per the Sprint 09–12 convention.)

- [ ] `turbo run typecheck lint build test` passes from root; `cd web && next build`
      and `cd extension && wxt build` both exit 0
- [ ] `@calyxa/curriculum` concepts carry `title` + `strandLabel` (audit gap #1 closed);
      keys/edges/accessors unchanged
- [ ] `GET /api/profile/overview` exists: read-only, bearer-auth'd, display-ready
      (titles server-side), calibrating for fresh users, no free-tier interaction
- [ ] the envelope carries `profile_tags` additively; tags pass all three gates (schema
      parse, route grounding against the injected profile, client ≤2 cap) and are
      **never invented** — an ungrounded tag is dropped, never rendered
- [ ] `/api/ai/turn` returns `profileTags` additively (field omitted when none — a
      no-tag turn is byte-identical to Sprint 12); tags are **never persisted**
- [ ] `/api/session/end` returns the recap additively, built AFTER the reconcile from
      the post-apply tables — the recap **cannot** disagree with the real mastery write;
      omitted for no-gradable sessions; a recap failure never fails the end
- [ ] the overview renders in the overlay before the first question; tags render inline
      on assistant bubbles (text + voice paths); the recap renders on session end from
      either the overlay's new End-session control or the popup (`SESSION_ENDED`
      broadcast) — all on Sprint 10 tokens, inside the shadow root, AA,
      reduced-motion-safe
- [ ] deltas are computed client-side against the panel-open overview snapshot; no
      baseline, tag, overview, or recap data is persisted anywhere (**no migration**)
- [ ] the learning write path, annotation layer, voice internals, auth/freemium/session
      logic, `/supabase`, and `/packages/{ui,learning-model}` are untouched;
      `loadProfile` is consumed as-is
- [ ] the web suite covers tag parse/grounding/omission/non-persistence, the overview
      route, and the recap; the extension spec covers delta/cap/stripping logic — no
      live Anthropic call
- [ ] manual acceptance (Task 9) observed: overview-before-first-question, honest tags,
      recap-matches-DB, cold start, lifecycle discipline, nothing persisted, zero
      host-DOM writes, back-compat
- [ ] ADR-024/025 exist (ADR-024 decides the audit's mode/confidence question against
      persistence; ADR-025 records the additive wire + END_SESSION reuse); both
      CLAUDE.md pointers + architecture.md updated; git log shows a commit per task

---

## Risks

**The model fabricates profile references.** The failure mode that matters most: a
`[known gap: …]` for a gap the student doesn't have destroys trust in exactly the
feature meant to build it. Mitigation: three gates, and the decisive one — route-side
grounding against the very profile injected that turn — is deterministic server code,
not prompt hope; the prompt still steers ("tag only what the STUDENT PROFILE shows");
Task 9 watches a full session for a single fabrication. A dropped honest tag costs
almost nothing; an invented one is the bug.

**Tag clutter cheapens the transcript.** Mitigation: ≤2 per turn at parse AND client;
"most turns none" in the prompt; tags are visually small pills, not headers; if Task 9
still shows noise, tightening is a prompt edit, not a schema change.

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
breaking-ish edit (string → `{ reply, tags? }`). Mitigation: the seam has exactly two
consumers (`handleSubmit`, `handleMicStop`), both updated in the same task; the
empty-reply guard keys on `reply` unchanged; Task 8's stripping test pins the
history-out shape so tags can't leak into the wire request.

**The End-session control changes session UX.** New control, popup parity questions.
Mitigation: it sends the *existing* `END_SESSION` message — one handler, one RPC, one
storage-clear for both surfaces; the popup is untouched; panel close explicitly does not
end the session (Task 9 item 6 verifies the free-tier accounting is unchanged).

**A recap broadcast to no listener.** Session ended with no panel open → the recap is
never seen. Accepted (ADR-025): the recap is ephemeral display data, not a record; the
dashboard sprint is the home for browsable history if wanted.

**Curriculum titles as another hand-maintained parallel.** The audit already flagged the
topic-alias table's drift risk; titles could drift the same way. Mitigation: titles live
*inside* each `Concept` entry (single source, not a parallel map), and the Task 2 test
fails the build on any entry missing one — drift is structurally louder than the alias
case.

---

## What the next sprint needs to know

**The adaptive loop is now visible in-product.** The overlay shows where the student
stands before they ask, tags the tutor's live profile references during the session
(grounded — never invented), and recaps the real mastery write at session end. All of it
is display-ephemeral: no new table, no migration, nothing persisted. What attaches next:

- **Dashboard sprint (Sprint 14):** the Sprint 11 audit's readiness table transfers as
  its planning input, now improved: **concept titles exist** (`@calyxa/curriculum` —
  gap #1 closed here); the overview/recap serialization shapes are working precedents
  for the dashboard's mastery + due-queue views. Still open from the audit: chart colors
  as named `@calyxa/ui` tokens; `(session_id, turn_index)` as display order not
  identity; per-request-fresh reads (no cache masking the reconcile).
- **Mode/tutor-confidence persistence** was decided **against** here (ADR-024). If the
  dashboard's session timeline wants "socratic vs direct" or grading-confidence
  history, that is one additive migration + two insert fields — its plan owns the call.
- **Session history / recap persistence** deliberately not built: the recap is computed
  live and shown once. A browsable history is an additive schema decision then — and a
  privacy call, same instinct as ADR-023.
- **The grounding gate is reusable**: any future envelope field that references student
  state (hints-used, streaks, goals) should pass the same route-side check against the
  injected profile before it reaches a screen.
- **Streaming sprint (if pursued):** tags join annotations as trailing SSE events after
  the `say` deltas; the overlay commits them with the bubble exactly as today — only the
  transport leg changes.
- **The overview endpoint is dashboard-shaped**: `GET /api/profile/overview` is the
  overlay-sized read; the dashboard will want richer variants (full history, per-strand
  grouping) — extend or sibling it, don't overload it silently.
