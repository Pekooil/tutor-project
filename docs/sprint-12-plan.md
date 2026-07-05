# Sprint 12 — On-screen annotation layer

## Goal
Make the tutor **visibly point at the student's page**. By the end, a student asks about
the quadratic on their screen and the tutor **circles it, highlights the step that
changed, or drops a numbered step-indicator next to it** while it talks — drawn on the
transparent annotation layer inside the shadow-DOM overlay, positioned over the host
page, **tracking the page through scroll and resize**, and **never writing a single node,
attribute, or style to the host DOM**. This is the flagship *visible* feature of the
product, and its defining constraint is the locked DOM policy (ADR-002 + "content script
reads only"): the page is annotated **over**, never **touched**.

```
turn  → §2.5 envelope { say, annotations[], … }        (already produced + validated — ADR-019)
      → /api/ai/turn returns { reply, annotations? }   (NEW — the field finally crosses the wire)
      → background relay → content script
      → resolver: selector | textMatch (equation-registry first) | bbox → live viewport rects
      → AnnotationLayer (transparent SVG, shadow root, pointer-events: none) draws
      → scroll/resize → single rAF-throttled handler re-resolves rects → layer repositions
      → unresolvable anchor → annotation DROPPED (never drawn in a guessed place)
      → next turn / ttl / panel close → cleared; overlay unmount → torn down
```

Acceptance in one line (the brief's): **the tutor can circle/underline/point at the
specific equation on screen; annotations track the page; zero host-DOM writes verified.**
("Underline" is the `highlight` type with a thin weight — the §2.5 schema's five types
`highlight | circle | arrow | label | step-indicator` are the supported vocabulary.)

Annotations are **ephemeral by construction**, like page context (ADR-013) and audio
(ADR-011): produced per turn, drawn, cleared, never persisted. **No migration this
sprint** — `session_interactions` keeps its Sprint 11 shape (it stores `say`, not
`annotations`), and nothing about what was drawn is recorded.

## Context
Sprint 11 closed the adaptive loop and landed the §2.5 envelope: every turn already
returns validated `annotations` server-side. `parseEnvelope`
(`/web/lib/ai/envelope.ts`) validates each annotation structurally (five types, three
target kinds, bbox shape-checked) and drops malformed entries individually; the OUTPUT
FORMAT block in `system-prompt.ts` already teaches the model the exact annotation JSON
shape. The consumer that ADR-008 and ADR-012 said didn't exist **now gets built**.

One correction to Sprint 11's hand-off note ("no prompt/route change needed — the field
is already produced"): the field is produced and **validated**, but
`/web/app/api/ai/turn/route.ts` returns `{ reply: envelope.say }` only — the parsed
`annotations` are **dropped on the floor** before they ever reach the client. So this
sprint does need one small route change (additive: `{ reply, annotations? }`) and real
prompt work (the schema is taught, but *when to annotate and how to target* is not).

Where each piece of the pipeline stands today:
- **Server:** envelope parsed + annotations validated (ADR-019); route returns `reply`
  only; the prompt documents the annotation shape but gives zero targeting guidance —
  and the model **cannot see the DOM or pixels**, so left alone it would emit `selector`s
  and `bbox`es it has no basis for.
- **Wire:** `aiTurn()` (`/extension/src/lib/api.ts`) returns `body.reply`;
  `AiReplyPayload` is `{ reply } | { error }`; the `AI_STREAM` port's `done` message
  carries `reply` only. All three need the optional `annotations` field threaded through.
- **Extension:** `pageExtractor.ts` extracts equations read-only but keeps **no element
  references** (deferred in Sprint 07 — "no rects, no consumer"); the content script owns
  all host-DOM access; the overlay (`Overlay.tsx`) is presentational, imports no
  `chrome.*` and no extractor, and already has a window-CustomEvent bridge precedent
  (`calyxa:toggle-panel`). PLAN §1's file structure already names the missing piece:
  `overlay/AnnotationLayer.tsx — SVG annotation rendering + scroll/resize reposition`.

Note on sprint selection: the Sprint 11 audit sketched Sprint 12 readiness for the
**dashboard** UX; the annotation layer was chosen instead as the flagship visible
feature. Everything the audit prepared (readiness table + gaps list in
`/docs/sprint-11-audit.md`) slides intact to Sprint 13 — nothing here consumes or
invalidates it.

Locked decisions from `/CLAUDE.md` and `/docs/CLAUDE.md` that drive this sprint:
- **DOM policy: content script reads only. No mutations to host page DOM.** This is the
  sprint's defining constraint. The resolver **reads** the host page
  (`querySelector`, text search, `getBoundingClientRect`) exactly as the extractor does;
  every drawn pixel lives inside the `<calyxa-overlay>` shadow root. Task 9 verifies
  zero host-DOM writes with a MutationObserver diff, the Sprint 07 discipline.
- **Overlay strategy: shadow DOM (ADR-002).** ADR-002 chose the shadow root *specifically
  because* it shares the host viewport's coordinate space, "which annotations require" —
  this sprint is the payoff of that decision. The SVG layer renders in the same shadow
  root, full-viewport, `position: fixed`, in host-viewport coordinates.
- **All API keys server-side / free tier server-side:** untouched — annotations ride the
  existing authenticated turn; no new route, no new key, no gating change.

### Reconciliation with `/docs/PLAN.md` (read before Task 1) — what this implements
This sprint **implements PLAN §2.5's annotation instruction format end to end** — the
piece every prior sprint deferred with "no consumer yet":

**(a) The annotation schema — consumed as specified.** §2.5 defines the five types, the
three target kinds (`selector | bbox | textMatch`), `style`, `label`, `step`, `ttl_ms`.
Sprint 11 restored the schema into the envelope + prompt; this sprint builds the three
resolvers, the renderer, and the lifecycle §2.5 specifies: "annotations draw on the
transparent SVG overlay layer in the shadow root, positioned in host-viewport
coordinates and repositioned on scroll/resize via a single handler; tagged with the turn
id; cleared at the end of each turn (or on `ttl_ms` expiry); fully torn down on session
end — leaving the host page byte-for-byte unchanged."

**(b) Element references for annotation targeting — the Sprint 07 deferral.** §2.5's
page-context comment promises "element references available for annotation" and §2.6
names "element geometry (`getBoundingClientRect`) for annotation targeting"; ADR-012
deferred both ("reading rects now would be dead weight — no consumer"). The consumer now
exists, so the extractor starts keeping a **per-capture equation→element registry** —
**in-memory, content-script-side only**. Elements can't serialize, so the registry
**never crosses the messaging boundary and never changes the `PageContext` wire shape**:
the model targets equations by `textMatch` with the exact string page context already
shows it, and the resolver matches that string against the registry to get the precise
live element. This is the sprint's one deliberate narrowing of §2.5: the model is
steered **hard to `textMatch`** because it cannot see the DOM (no valid `selector` to
emit) or pixels (no valid `bbox`); the `selector` and `bbox` resolvers are still
implemented per the schema — `selector` for future extracted-DOM-ref work, `bbox` for
the OCR-beta sprint's image math (ADR-012's deferred path), where coordinates *will*
have a source. Recorded in ADR-022.

**(c) What stays deferred.** True SSE streaming of the envelope (annotations as a
trailing stream event — the §2.5 pipeline diagram's "annotations dispatched as they
complete") stays with the streaming sprint; this sprint dispatches them when the full
reply arrives, which is when the live (non-streaming) path has them anyway. The
mastery dashboard (Sprint 13, per the audit), OCR-beta capture, onboarding, and
embedding matching are untouched.

Recorded in **ADR-022** (the annotation rendering layer: shadow-SVG rendering, resolver
priority with registry-first `textMatch`, drop-don't-guess fallback, per-turn lifecycle,
zero host-DOM writes; consumes ADR-019's envelope field; revisits ADR-008/ADR-012's
"no consumer" deferrals) and **ADR-023** (annotations cross the existing wire
additively — `{ reply, annotations? }` on `/api/ai/turn`, optional field on
`AiReplyPayload` + the `AI_STREAM` `done` message; annotations are **ephemeral, never
persisted** — no migration; the element registry stays in-memory client-side).

### Drop-don't-guess: the anchor-resolution model (read before Tasks 5, 6)
A wrongly-placed annotation is **worse than none** — it would actively mislead the
student ("circle the wrong equation" fails the product harder than "circle nothing").
So resolution is strict, in priority order per target:
1. **`selector`** — `document.querySelector` on the host page (excluding the
   `<calyxa-overlay>` subtree), element must be connected + visible → rect.
2. **`textMatch`, registry first** — normalise the target text (collapse whitespace,
   case-fold) and match it against the captured equations' `latex`/`text` in the
   equation registry → that element's live rect. This is the precise path the prompt
   steers the model onto.
3. **`textMatch`, page search** — a bounded, read-only TreeWalker/Range search for the
   first **visible** occurrence in the host page (again excluding the overlay host) →
   range rect. Bounded exactly like the extractor (never an unbounded whole-DOM scan).
4. **`bbox`** — pass-through viewport coordinates, sanity-clamped to the viewport.

Any target that resolves to nothing — stale selector, paraphrased text the model didn't
copy exactly, an element the SPA removed since capture, an off-screen-only match — is
**dropped silently** (a `console.debug` diagnostic, nothing user-facing): the reply is
unaffected, the other annotations of the turn still draw. This is the "graceful
fallback" of the brief, and Task 8/9 assert it. At re-anchor time (scroll/resize) a
previously-resolved element that has since disconnected re-runs the chain and drops the
same way.

### The layer draws in the shadow root, never the host DOM (read before Tasks 6, 7)
`AnnotationLayer.tsx` renders a **full-viewport, `position: fixed`,
`pointer-events: none`, `aria-hidden` SVG** inside the existing shadow root, stacked
under the tutor panel. Rects arrive already in viewport coordinates
(`getBoundingClientRect`), which is exactly the coordinate space a fixed-position layer
draws in — no offset math. Scroll/resize therefore just means **re-resolving rects**:
one passive `scroll` + `resize` listener (capture-phase, so nested scroll containers are
seen), rAF-throttled, re-resolves the ≤ handful of active annotations and pushes fresh
rects to the layer. Division of labour follows the established seams exactly:
- **`/extension/src/content/annotations.ts`** (new) — the controller. Owns all
  host-DOM **reads** (resolution, re-anchoring), the active-turn annotation set, turn
  tagging, `ttl_ms` timers, and the clear/teardown API. Dispatches resolved draw lists
  to the layer over a window CustomEvent (`calyxa:annotations`), the
  `calyxa:toggle-panel` bridge pattern.
- **`AnnotationLayer.tsx`** — presentational only, like `Overlay.tsx`: no `chrome.*`, no
  host-DOM reads, no resolver import. It receives `{ rect, type, style, label, step }`
  draw instructions and renders SVG shapes. Style colors come from an **allow-list
  mapped to the design system's tokens** (Sprint 10 / ADR-018 — the `theme.css` custom
  properties already injected into the shadow root); an unknown color falls back to the
  default (amber). No new token is added to `/packages/ui`.

### Lifecycle: replace-per-turn, clear-on-close (read before Task 7)
Per §2.5: annotations are tagged with their turn; a new turn's reply **replaces** the
previous turn's drawings (clear-then-draw — the layer never accumulates); `ttl_ms > 0`
expires an individual annotation early (`0` = persist until replaced/cleared). Beyond
§2.5, two product decisions this sprint fixes: **closing the panel clears the layer**
(a dismissed tutor leaves a clean page — same instinct as ephemeral page context), and
**overlay unmount / sign-out tears everything down** (listeners, timers, layer — the
shadow root's removal already guarantees no pixel survives). Voice turns draw too: the
non-streaming voice path has the full reply (and now its annotations) before TTS
playback begins, so the drawing lands as the tutor starts speaking. On the text path the
`AI_STREAM` port's `done` message carries the annotations; they draw when `done` arrives
(the word-by-word animation is a client-side fake over an already-complete reply — no
reason to hold the drawing hostage to it).

## Execution model
A **single code session** owns this sprint end to end, worked **strictly in order
(1 → 9)**. The chain is real: the ADRs fix the drop-don't-guess and never-persisted
decisions (Task 1); the web contract must return annotations + steer the model to
targetable `textMatch` (Task 2) before the extension transport has anything to carry
(Task 3); the equation registry (Task 4) must exist before the resolver can do
registry-first matching (Task 5); the layer (Task 6) needs the resolver's draw-list
shape; end-to-end wiring (Task 7) connects reply → controller → layer for both text and
voice paths; tests (Task 8) gate manual acceptance (Task 9). One session — no handoff.

This sprint **does** touch the annotation seam on both sides: `/web/lib/ai/
{system-prompt,page-context}.ts` + `/web/app/api/ai/turn/route.ts` (prompt guidance +
additive response field), and the extension's transport (`lib/api.ts`,
`background/index.ts`, `types/messages.ts`), extractor (`content/pageExtractor.ts` —
registry only, no new adapter), content script (`content/index.ts`), a new
`content/annotations.ts`, and the overlay (`AnnotationLayer.tsx` + `Overlay.tsx` +
`Overlay.css`). It **does not** touch the learning write/read path (`/web/lib/learning/*`
— apply, scheduler, profile-read, topic are all reused as-is), `envelope.ts` (its
annotation validation is already complete — reused unchanged), `claude.ts`, the voice
pipeline internals, session/auth/freemium routes, `/supabase` (no migration), or
`/packages/*` (curriculum, learning-model, ui all unchanged; the layer consumes existing
theme tokens).

## Files in scope

### Task 1 (ADRs + sprint pointers) creates or edits:
```
/docs/adr/ADR-022-annotation-rendering-layer.md ← new — the annotation layer: shadow-root SVG in host-viewport coords; resolver priority (selector → registry-first textMatch → bounded page search → bbox); drop-don't-guess fallback; replace-per-turn/ttl/clear-on-close lifecycle; zero host-DOM writes. Consumes ADR-019's envelope field; REVISITS ADR-008/ADR-012's "no consumer" deferrals.
/docs/adr/ADR-023-annotations-on-the-wire.md    ← new — annotations ride the existing wire additively ({ reply, annotations? } on /api/ai/turn; optional field on AiReplyPayload + the AI_STREAM done message); annotations are EPHEMERAL — never persisted, no migration, session_interactions unchanged; the equation-element registry is in-memory content-script state and never crosses messaging.
/CLAUDE.md                                       ← edit one line: Current sprint → Sprint 12 — On-screen annotation layer
/docs/CLAUDE.md                                  ← edit one line: Current phase → Phase 2, Sprint 12
/docs/sprint-12-plan.md                          ← this file
/docs/architecture.md                            ← edit: annotation layer live (content resolver + shadow SVG layer); /api/ai/turn response gains optional annotations; nothing new persisted
```

### Task 2 (web — prompt targeting guidance + route returns annotations) edits:
```
/web/lib/ai/system-prompt.ts   ← edit — extend buildEnvelopeOutputFormat with an ANNOTATION GUIDANCE block: annotate ONLY content visible in PAGE CONTEXT; prefer target.kind "textMatch" with text copied EXACTLY from a PAGE CONTEXT equation/excerpt; never fabricate a selector or bbox (you cannot see the DOM or pixels); ≤3 annotations per turn; labels ≤5 words; step-indicator for multi-step walkthroughs; allowed style colors (named allow-list, amber default); omit annotations when nothing on screen applies. Additive lines only — the envelope schema block and every other section are unchanged.
/web/lib/ai/page-context.ts    ← edit — renderPageContext wording only: mark the equations block as annotation-targetable ("each can be annotated by copying its text exactly into a textMatch target"). Caps, types, and truncation order UNCHANGED.
/web/app/api/ai/turn/route.ts  ← edit — return { reply: envelope.say, ...(annotations when present) }: the parsed envelope.annotations (already validated by envelope.ts) are returned to the client instead of dropped; field OMITTED when absent/empty (back-compat: the Sprint 11 wire shape is byte-identical when no annotations exist). persistInteraction UNCHANGED — annotations are not persisted (ADR-023).
```

### Task 3 (extension — transport threads annotations) edits:
```
/extension/src/types/messages.ts   ← edit — mirror Annotation/AnnotationTarget from /web/lib/ai/envelope.ts (by-convention re-declaration, like PageEquation; note the source of truth); AiReplyPayload gains optional annotations. Keep all existing types + comments.
/extension/src/lib/api.ts          ← edit — aiTurn() returns { reply, annotations? } (parsed from the response body) instead of the bare reply string; aiTurnStream untouched (the /api/ai/stream path stays plain text, unwired — ADR-019).
/extension/src/background/index.ts ← edit — handleAiTurn threads annotations onto AiReplyPayload; the AI_STREAM port's `done` message gains optional annotations. Transport only — chunk faking, getTurnContext/stampTurnAnchor (Sprint 11 latency anchors), and every other handler unchanged.
```

### Task 4 (extension — equation-element registry) edits:
```
/extension/src/content/pageExtractor.ts ← edit — extractPageContext() additionally records, per extracted equation, the source Element it was read from, returned alongside the PageContext (e.g. { context, equationElements }). READ-ONLY unchanged; no new adapter; the wire PageContext shape is untouched (elements never serialize / never leave the content script).
/extension/src/content/index.ts         ← edit — hold the registry at module scope next to capturedPageContext, refreshed on every overlay open (same fresh-per-open, never-persisted discipline).
```

### Task 5 (extension — resolver + controller) creates:
```
/extension/src/content/annotations.ts ← new — the annotation controller: resolveTarget (selector → registry-first textMatch → bounded visible-text search → bbox, excluding the <calyxa-overlay> subtree, visibility-checked, drop-don't-guess); showTurnAnnotations(annotations, registry) (replace-per-turn, ttl timers, turn tag); re-anchor on one passive capture-phase scroll+resize listener, rAF-throttled, re-resolving live rects (disconnected elements re-run the chain or drop); clearAnnotations() + teardown(); dispatches resolved draw lists to the layer via the `calyxa:annotations` window CustomEvent. Host-DOM READS only — never a write.
```

### Task 6 (extension — the SVG layer) creates / edits:
```
/extension/src/overlay/AnnotationLayer.tsx ← new (named in PLAN §1's file structure) — presentational SVG layer: full-viewport, position: fixed, pointer-events: none, aria-hidden, stacked under the panel; listens for `calyxa:annotations`; renders the five §2.5 types (highlight = translucent rounded rect — thin weight reads as underline; circle = ellipse outline; arrow = line + marker from the target's edge; label = small pill adjacent to the rect; step-indicator = numbered badge ordered by `step`). No chrome.*, no resolver import, no host-DOM read.
/extension/src/overlay/Overlay.tsx         ← edit — mount <AnnotationLayer /> as a sibling of the panel (mounted whenever the overlay is mounted; independent of panel expanded/collapsed); emit the panel-close signal the controller clears on. Presentational discipline unchanged.
/extension/src/overlay/Overlay.css         ← edit — layer + shape styles, shadow-root-scoped (on classes, never :host — ADR-002); annotation colors map the allow-list to the existing @calyxa/ui theme.css custom properties (no new token).
```

### Task 7 (extension — end-to-end wiring) edits:
```
/extension/src/content/index.ts ← edit — sendAiTurn hands the reply's annotations to the controller (text path: on the port's `done`; voice path: on the AI_TURN response) with the current capture's registry; new turn replaces the previous turn's drawings; panel close → clearAnnotations(); overlay onRemove → teardown(). The overlay still receives only the reply string — annotations flow content-script-side, never through Overlay props.
```

### Task 8 (tests) creates / edits:
```
/web/tests/ai-turn.test.ts        ← edit — route returns annotations when the (mocked) envelope carries them; OMITS the field when none; { reply } always present (back-compat); malformed annotation entries never reach the response (envelope.ts already drops them — assert at the route boundary); a turn with annotations persists the SAME session_interactions row shape as Sprint 11 (annotations not persisted).
/web/tests/envelope.test.ts       ← edit only if a targeting-guidance case is missing — the parseAnnotation coverage from Sprint 11 stands.
/extension/tests/annotations.test.ts ← new — the FIRST extension-workspace unit spec (deliberate; see Task 8): pure resolver logic only — text normalisation + registry matching, resolver priority + drop-on-miss, ttl/replace lifecycle bookkeeping, viewport clamping — with jsdom/stubbed rects, no browser.
/extension/package.json           ← edit — add vitest devDependency + "test" script so `turbo run test` covers the extension workspace (additive; wxt build/typecheck unchanged).
```

### Files explicitly out of scope
```
/web/lib/ai/envelope.ts            (annotation validation is complete — reused as-is)
/web/lib/ai/claude.ts              (runTutorTurn/runTutorTurnStream unchanged; stream path stays format:'text')
/web/lib/learning/**               (apply, scheduler, profile-read, topic — the Sprint 11 loop is untouched)
/web/app/api/ai/stream/route.ts    (still unwired; annotations-over-SSE is the streaming sprint)
/web/app/api/{auth,voice,session}/** (unchanged)
/supabase/**                       (NO migration — annotations are never persisted; ADR-023)
/packages/**                       (curriculum, learning-model, ui unchanged; the layer consumes existing theme tokens)
/extension/src/popup/**            (unchanged)
/extension/src/overlay/VoiceController.ts (voice capture unchanged — annotations ride the existing reply)
/extension/src/content/pageExtractor.ts adapters (registry addition only — no new extraction adapter, no cap change)
/extension manifest permissions    (drawing in our own shadow root needs none)
```
Also out of scope (no pre-empting later roadmap sprints):
- **The mastery dashboard** — now Sprint 13; the Sprint 11 audit's readiness table +
  gaps list (`concept titles`, chart tokens, the mode/confidence persistence decision)
  transfer to its plan untouched.
- **True SSE streaming of the envelope** (annotations as a trailing stream event) — the
  streaming sprint.
- **The beta OCR/capture path** (ADR-012) — when it lands, its image-math coordinates
  make the `bbox` resolver earn its keep; nothing here blocks it.
- **Annotation persistence / session-replay UX** — drawing history is ephemeral; if a
  replay feature ever wants it, that is a deliberate later schema decision (ADR-023).
- **Pointer/laser gestures, freehand drawing, student-drawn annotations** — not in the
  §2.5 vocabulary; out entirely.

Do not create any file not listed above. If something seems needed but is not listed,
add it to "What the next sprint needs to know" and ask before creating it.

---

## Task 1 — Annotation-layer + wire-contract ADRs + sprint pointers (planning / docs)

Write two ADRs in the project format (match ADR-001…ADR-021 exactly: `## ADR-0NN:
[Title]`, then `**Status:** Decided`, `**Context:**`, `**Decision:**`, `**Rationale:**`
bullets, `**Consequences:**` Enables/Requires/Forecloses).

ADR-022 — The annotation rendering layer (shadow-SVG, resolver priority, drop-don't-guess):
- Context: §2.5 specified the annotation format in full; ADR-008/ADR-012 deferred every
  consumer ("output is plain text" / "reading rects now would be dead weight"). Sprint 11
  (ADR-019) restored the envelope, so every turn already carries validated annotations —
  with no renderer. ADR-002 chose the shadow-DOM overlay explicitly because it shares
  the host viewport's coordinate space "which annotations require." A shape decision was
  needed: where resolution runs, how targets anchor, and what happens on a miss —
  against the locked constraint that the host DOM is never written.
- Decision: build the layer per §2.5 — a transparent, full-viewport, fixed-position,
  pointer-events-none SVG **inside the existing shadow root**, drawing in host-viewport
  coordinates. Resolution runs in the **content script** (the only host-DOM-read
  context): `selector` → **registry-first `textMatch`** (exact-normalised match against
  the equations captured at overlay open, giving a precise live element) → bounded
  visible-text search → `bbox` pass-through. An unresolvable target is **dropped, never
  guessed**. Lifecycle: replace-per-turn, `ttl_ms` expiry, clear on panel close, full
  teardown on overlay unmount. The model is steered to `textMatch` with exact
  page-context strings (it cannot see DOM or pixels); `selector`/`bbox` resolvers ship
  per the schema for the paths that will have real sources (extracted DOM refs; OCR
  beta). Revisits ADR-008/ADR-012's deferrals; consumes ADR-019.
- Rationale (bullets): a mis-anchored annotation actively misleads — worse than none, so
  drop-don't-guess is the only safe fallback; the registry makes the common case
  (annotate an extracted equation) precise without inventing selectors; fixed-position +
  `getBoundingClientRect` share one coordinate space, making scroll/resize re-anchoring
  a pure re-read; keeping the resolver in the content script and the layer presentational
  preserves the exact seams every prior sprint held (overlay knows no chrome.*/DOM,
  content owns host reads).
- Consequences: Enables — the flagship visible feature; the OCR-beta and streaming
  sprints attach to a working renderer. Requires — annotations to actually cross the
  wire (ADR-023); the equation registry at capture time; zero-host-DOM-writes
  verification in acceptance. Forecloses — any host-DOM mutation for drawing (locked
  anyway); guessed placement on resolution failure.

ADR-023 — Annotations ride the existing wire, additively, and are never persisted:
- Context: the envelope's annotations are parsed + validated server-side (Sprint 11) but
  `/api/ai/turn` returns `{ reply }` only — Sprint 11's hand-off note believed no route
  change was needed; it was wrong on that one point. A wire decision was needed: how
  annotations reach the extension, and whether anything about them persists.
- Decision: extend the existing response **additively** — `{ reply, annotations? }`,
  field omitted when none (a no-annotation turn is byte-identical to Sprint 11) — and
  thread the optional field through `aiTurn()`, `AiReplyPayload`, and the `AI_STREAM`
  `done` message. No new route, no new message type, no SSE. Annotations are
  **ephemeral**: not persisted (no migration; `session_interactions` unchanged — it
  stores `say` only), and the equation-element registry is in-memory content-script
  state that never crosses the messaging boundary.
- Rationale (bullets): the transport seams (route → api.ts → background → content) have
  carried every prior payload additively — same discipline, zero back-compat risk;
  drawing history has no consumer, so persisting it would be dead weight and a new
  privacy surface (what was highlighted reveals what was studied — the ADR-013 instinct);
  elements can't serialize, so registry-in-content is forced, and it usefully keeps the
  wire shape frozen.
- Consequences: Enables — annotations on both text and voice paths with no protocol
  change. Requires — the route to omit (not null) the field when empty; the extension
  types to mirror envelope.ts by convention. Forecloses — nothing; a replay/persistence
  feature remains a deliberate later schema decision, and annotations-over-SSE remains
  the streaming sprint's.

Then two one-line pointer edits: `/CLAUDE.md` "Current sprint" → `Sprint 12 — On-screen
annotation layer`; `/docs/CLAUDE.md` "Current phase" → `Phase 2, Sprint 12`. Change no
other line in either. Update `/docs/architecture.md` to record the annotation layer
(content resolver + shadow SVG) and the additive turn-response field.

Acceptance gate before Task 2:
  - ADR-022/023 exist in the exact format and record the decisions above (drop-don't-
    guess, registry-first textMatch, additive wire, never-persisted); both CLAUDE.md
    pointers + architecture.md updated.

---

## Task 2 — Web: annotation targeting guidance + the route returns annotations

Scope: `/web/lib/ai/{system-prompt,page-context}.ts`,
`/web/app/api/ai/turn/route.ts`. **No change to envelope.ts** (validation complete) or
`claude.ts`.

  - `system-prompt.ts`: add the ANNOTATION GUIDANCE block to `buildEnvelopeOutputFormat`
    (envelope format only — the `format:'text'` stream path is untouched): annotate only
    what PAGE CONTEXT shows; **prefer `textMatch` with text copied exactly** from a page-
    context equation/excerpt; **never fabricate `selector` or `bbox`** (no DOM/pixel
    visibility); **≤3 annotations per turn**; `label` text ≤5 words; `step-indicator`
    for multi-step walkthroughs; style colors from the named allow-list (document it:
    e.g. `amber | blue | green | red`, amber default); leave `annotations` empty when
    nothing applies (most turns). Additive lines only.
  - `page-context.ts`: `renderPageContext` wording only — flag the equations list as
    annotation-targetable via exact-text `textMatch`. Caps/types/truncation order
    unchanged (the §2.5 budget discipline holds byte-for-byte otherwise).
  - `turn/route.ts`: return `{ reply: envelope.say, ...(envelope.annotations?.length
    ? { annotations: envelope.annotations } : {}) }`. The field is **omitted**, never
    `null`/`[]`, when absent — a no-annotation response is byte-identical to Sprint 11.
    `persistInteraction` and everything else in the route unchanged; note in a comment
    that annotations are deliberately not persisted (ADR-023).

Acceptance gate before Task 3:
  - typecheck + lint + `next build` pass. A mocked envelope with annotations yields
    `{ reply, annotations }`; without, exactly `{ reply }`. The rendered system prompt
    contains the guidance block; the `format:'text'` prompt is unchanged.

---

## Task 3 — Extension: transport threads annotations (types + api + background)

Scope: `/extension/src/{types/messages.ts, lib/api.ts, background/index.ts}`. Transport
only — no behaviour change when annotations are absent.

  - `messages.ts`: mirror `Annotation`/`AnnotationTarget` (+ the type/kind unions) from
    `/web/lib/ai/envelope.ts` — by-convention re-declaration with the source-of-truth
    comment, exactly like `PageEquation`. `AiReplyPayload` success arm becomes
    `{ reply: string; annotations?: Annotation[] }`.
  - `api.ts`: `aiTurn()` returns `{ reply, annotations? }` parsed from the response body
    (callers updated in this task); `aiTurnStream` untouched.
  - `background/index.ts`: `handleAiTurn` forwards `annotations` on the reply payload;
    the `AI_STREAM` port's `done` message gains optional `annotations`. Chunk faking,
    the Sprint 11 turn-context/latency anchors, and all other handlers unchanged.

Acceptance gate before Task 4:
  - `wxt build` exits 0; typecheck passes. A stubbed `{ reply, annotations }` response
    reaches the content script intact on BOTH paths (port `done` + sendMessage reply);
    a `{ reply }`-only response behaves exactly as Sprint 11.

---

## Task 4 — Extension: the equation-element registry (extractor + content)

Scope: `/extension/src/content/{pageExtractor.ts, index.ts}`. Read-only discipline
unchanged; no new adapter; the wire `PageContext` shape untouched.

  - `pageExtractor.ts`: while extracting, record the source `Element` per equation and
    return it alongside the context — e.g. `extractPageContext(): { context: PageContext;
    equationElements: (Element | null)[] }` (parallel to `context.equations`; `null`
    where an adapter had no single element, e.g. the KaTeX text fallback). Elements
    never serialize and never leave the content script.
  - `index.ts`: hold the registry at module scope beside `capturedPageContext`,
    refreshed on every overlay open (fresh-per-open, never cached across opens, never
    persisted — the Sprint 07 discipline verbatim). Update the one call site for the new
    return shape.

Acceptance gate before Task 5:
  - `wxt build` + typecheck pass; on a KaTeX/MathJax/MathML page the registry holds a
    connected Element per extracted equation (spot-check via console); extraction output
    (the wire `PageContext`) is byte-identical to Sprint 11; still zero host-DOM writes.

---

## Task 5 — Extension: resolver + annotation controller (content)

Scope: `/extension/src/content/annotations.ts` (new). Host-DOM **reads only**.

  - `resolveTarget(target, registry)`: the priority chain from the design model —
    `selector` (querySelector excluding the `<calyxa-overlay>` subtree; connected +
    visible only) → registry-first `textMatch` (normalise: collapse whitespace,
    case-fold; match against captured `latex`/`text`) → bounded visible-text search
    (TreeWalker/Range, first visible occurrence, overlay subtree excluded, bounded node
    budget) → `bbox` (viewport-clamped pass-through). Returns a viewport rect or
    `undefined` — **drop, never guess**.
  - `showTurnAnnotations(annotations, registry)`: clear the previous turn's set
    (replace-per-turn), resolve each (≤3 enforced client-side too — defence in depth
    against a prompt miss), start `ttl_ms` timers, tag with a turn id, dispatch the
    resolved draw list via the `calyxa:annotations` CustomEvent.
  - Re-anchoring: ONE passive, capture-phase `scroll` + `resize` listener,
    rAF-throttled, re-resolving the active set's rects (a disconnected element re-runs
    the chain; a fresh miss drops that annotation) and re-dispatching. Listener
    registered only while annotations are active.
  - `clearAnnotations()` (empty dispatch + cancel timers) and `teardown()` (clear +
    remove listeners). `console.debug` diagnostics on drops — nothing user-facing.

Acceptance gate before Task 6:
  - typecheck + `wxt build` pass. Unit-level (Task 8 spec drafted alongside): exact and
    normalised registry matches resolve; a paraphrased/unknown target returns
    `undefined`; the ≤3 cap and replace-per-turn bookkeeping hold; no code path writes
    to the host DOM (review: the module contains no assignment to host nodes).

---

## Task 6 — Extension: the SVG AnnotationLayer (overlay)

Scope: `/extension/src/overlay/{AnnotationLayer.tsx (new), Overlay.tsx, Overlay.css}`.
Presentational only — no `chrome.*`, no resolver import, no host-DOM read.

  - `AnnotationLayer.tsx`: full-viewport `position: fixed` SVG, `pointer-events: none`,
    `aria-hidden="true"`, stacked under the panel. Subscribes to `calyxa:annotations`
    (add/remove the window listener on mount/unmount). Renders the five types:
    `highlight` (translucent rounded rect; thin weight = underline), `circle` (ellipse
    outline with padding), `arrow` (line + SVG marker pointing at the rect's nearest
    edge), `label` (small pill adjacent, auto-flipped to stay in-viewport),
    `step-indicator` (numbered badge, ordered by `step`). A light draw-in transition,
    disabled under `prefers-reduced-motion`.
  - `Overlay.tsx`: render `<AnnotationLayer />` as a sibling of the panel, mounted
    whenever the overlay is mounted (annotations survive collapsing the panel to the
    pill only until close — closing the panel emits the signal the controller clears
    on, per the lifecycle model).
  - `Overlay.css`: layer + shape styles, shadow-root-scoped classes (never `:host` —
    ADR-002); the color allow-list maps to existing `@calyxa/ui` theme custom
    properties; unknown color → amber default.

Acceptance gate before Task 7:
  - `wxt build` + typecheck pass. Dispatching a hand-crafted `calyxa:annotations` event
    from the console draws each of the five types at the given rects; the page beneath
    stays fully interactive (pointer-events verified by clicking a link under a
    highlight); nothing renders outside the shadow root.

---

## Task 7 — Extension: end-to-end wiring (content)

Scope: `/extension/src/content/index.ts`. The overlay's props are unchanged — the
annotations flow content-script-side, never through `Overlay.tsx`.

  - Text path: `sendAiTurn`'s port `done` handler passes `msg.annotations` (when
    present) with the current registry to `showTurnAnnotations` before resolving the
    reply promise.
  - Voice path: the non-streaming `AI_TURN` response's `annotations` go through the same
    call — the drawing lands as TTS playback starts.
  - Lifecycle: each new turn's call replaces the previous drawings (controller
    behaviour); the panel-close signal → `clearAnnotations()`; `onRemove` (overlay
    unmount / sign-out) → `teardown()`.
  - A turn with no annotations changes nothing (no dispatch, no clear-flicker of an
    empty layer — replace only fires when the new turn carries annotations OR the
    controller holds active ones).

Acceptance gate before Task 8:
  - `wxt build` exits 0. Live against `next dev`: a turn whose envelope carries a
    `textMatch` annotation for an on-screen equation draws it aligned to that equation;
    scrolling tracks it; the next turn replaces it; closing the panel clears it; a voice
    turn draws too; a no-annotation turn is visually identical to Sprint 11.

---

## Task 8 — Tests (gate)

Scope: `/web/tests/ai-turn.test.ts` (+ `envelope.test.ts` only if a gap shows),
`/extension/tests/annotations.test.ts` (new), `/extension/package.json`. Reuse the
existing fake-Anthropic backend — **no live model call**. This adds the **first
extension-workspace unit spec** (vitest, jsdom, pure logic only) — a deliberate,
minimal addition so the sprint's riskiest logic (the resolver chain) is not
manual-only; `turbo run test` picks it up automatically.

  1. **Route returns annotations:** a mocked envelope with valid annotations →
     `{ reply, annotations }`; annotations match what `parseEnvelope` validated.
  2. **Back-compat omission:** no/empty annotations → response is exactly `{ reply }`
     (field absent, not null); existing ai-turn cases stay green untouched.
  3. **Malformed entries never cross:** an envelope mixing valid + structurally invalid
     annotations returns only the valid ones (envelope.ts drops the rest — asserted at
     the route boundary).
  4. **Not persisted:** a turn with annotations writes the same `session_interactions`
     row shape as Sprint 11 — no annotation data in any column.
  5. **Resolver priority + drop-on-miss (extension):** selector hit wins; registry
     exact + normalised (whitespace/case) textMatch hits; paraphrased text with no page
     occurrence → `undefined`; disconnected registry element falls through to search
     then drops; bbox clamps to viewport.
  6. **Lifecycle bookkeeping (extension):** replace-per-turn clears the prior set; ttl
     expiry removes one annotation without touching the rest; the ≤3 client-side cap
     holds; teardown cancels timers + listeners.
  7. **Suite hygiene:** the full `/web` suite stays green; `turbo run typecheck lint
     build test` green across workspaces including the new extension test task.

Acceptance gate before Task 9:
  - all of the above pass with no live Anthropic call; `next build` and `wxt build`
    exit 0.

---

## Task 9 — Annotation acceptance (manual)

This is the sprint's headline acceptance: **the tutor circles/underlines/points at the
specific equation on the student's screen; the drawing tracks the page; zero host-DOM
writes.** With `cd web && next dev` (`ANTHROPIC_API_KEY` set) and the unpacked
extension loaded:

  1. **Circle the equation:** on a KaTeX page, ask "which term do I factor first?" → the
     tutor's reply draws on the actual on-screen equation (circle/highlight aligned to
     it, within a few px) while the answer streams. Repeat on MathJax and plain-MathML
     pages (the registry path must hold across renderers).
  2. **Track the page:** scroll up/down (including inside a nested scroll container if
     the page has one) and resize the window → the annotation stays glued to its
     equation, no lag-smear or drift; scrolled off-viewport, it simply isn't visible;
     scrolled back, it's in place.
  3. **Graceful fallback:** on a page where the model targets text that doesn't resolve
     (or an image-only-math page), the reply arrives normally, nothing is drawn, no
     user-facing error — a `console.debug` drop diagnostic only. Never a wrongly-placed
     drawing anywhere in the session.
  4. **Lifecycle:** the next turn replaces the previous drawing; a `ttl_ms` annotation
     expires on its own; closing the panel clears the layer; sign-out/overlay unmount
     leaves zero trace.
  5. **Voice turn:** ask by voice → the annotation lands as the spoken reply starts.
  6. **Page stays usable:** click a link and select text underneath a highlight —
     `pointer-events: none` verified by hand.
  7. **Zero host-DOM writes (the defining constraint):** run a MutationObserver over
     `document.documentElement` (childList + attributes + characterData, subtree) for a
     full multi-turn annotated session → **zero mutation records outside the
     `<calyxa-overlay>` host**. Every drawn pixel lives inside the shadow root.
  8. **Back-compat:** a session on a page with no math (no annotations emitted) is
     indistinguishable from Sprint 11 — same replies, same persistence, same UX.
  9. **Nothing persisted:** inspect `session_interactions` after an annotated session —
     the row shape is Sprint 11's; no annotation data anywhere in the DB.

---

## Acceptance criteria (full checklist)

**Sprint status: IN PROGRESS — Tasks 1–8 landed; Task 9's server-side half verified live
(2026-07-04: real-model turns emit textMatch annotations copied exactly from page
context, ≤3, no fabricated selector/bbox; no-annotation turn wire-identical to Sprint 11;
annotated gradable turn persists the Sprint 11 row shape with no annotation data);
browser-side half (items 1–8: draw/track/fallback/lifecycle/voice/pointer-events/
MutationObserver/back-compat UX) still to be observed by hand.** (Tasks 1–9 below;
update this line as tasks land, per the Sprint 09/10/11 convention.)

- [ ] `turbo run typecheck lint build test` passes from root (now including the
      extension's new test task); `cd web && next build` and `cd extension && wxt build`
      both exit 0
- [ ] `/api/ai/turn` returns the envelope's validated `annotations` **additively**
      (`{ reply, annotations? }`, field omitted when none — a no-annotation response is
      byte-identical to Sprint 11); annotations are **never persisted** (no migration;
      `session_interactions` unchanged — ADR-023)
- [ ] the model is **steered to `textMatch` with exact page-context strings** (≤3 per
      turn, no fabricated selectors/bboxes) via additive prompt guidance; the
      `format:'text'` stream-path prompt is untouched
- [ ] the extractor keeps a **per-capture equation→element registry**, in-memory
      content-script-side only — the wire `PageContext` shape is unchanged and elements
      never cross messaging
- [ ] the resolver implements all three §2.5 target kinds in priority order (`selector`
      → registry-first `textMatch` → bounded visible-text search → `bbox`), excludes the
      `<calyxa-overlay>` subtree, and **drops unresolvable targets — never guesses**
- [ ] annotations draw on a **transparent SVG layer inside the shadow root**
      (full-viewport, fixed, `pointer-events: none`, `aria-hidden`), rendering all five
      §2.5 types with colors mapped to existing `@calyxa/ui` tokens
- [ ] annotations **track scroll and resize** via one passive rAF-throttled handler
      re-resolving live rects; disconnected anchors re-resolve or drop
- [ ] lifecycle holds: **replace-per-turn**, `ttl_ms` expiry, clear on panel close, full
      teardown on overlay unmount/sign-out; voice turns draw too
- [ ] **zero host-DOM writes verified** (Task 9's MutationObserver diff: no mutation
      outside the `<calyxa-overlay>` host across a full annotated session)
- [ ] the web suite covers route-returns/omits/filters-malformed/doesn't-persist; the
      new extension spec covers resolver priority, drop-on-miss, and lifecycle — all
      with no live Anthropic call
- [ ] the learning loop, voice internals, session/auth/freemium, `/supabase`, and
      `/packages/*` are untouched; `envelope.ts` reused unchanged
- [ ] manual acceptance (Task 9) observed: circle-the-equation across three renderers,
      scroll/resize tracking, graceful fallback, lifecycle, voice, page-usable-beneath,
      zero host-DOM writes, back-compat, nothing persisted
- [ ] ADR-022/023 exist (ADR-022 revisits ADR-008/ADR-012's "no consumer" deferrals;
      ADR-023 records additive-wire + never-persisted); both CLAUDE.md pointers +
      architecture.md updated; git log shows a commit per task

---

## Risks

**A wrongly-placed annotation misleads the student.** The failure mode that matters most:
circling the wrong equation is worse than circling nothing. Mitigation: drop-don't-guess
is the resolver's contract (ADR-022); registry-first matching makes the common case
precise; visibility + connectedness checks gate every draw and every re-anchor; Task 8
asserts the drop paths and Task 9 watches a full session for a single misplaced drawing.

**Host-DOM-write drift under rendering pressure.** The tempting shortcut when a rect is
awkward (inline `scroll-margin`, a marker attribute, wrapping a text node for a range
rect) is a host mutation. Mitigation: the resolver module contains reads only (Task 5's
review gate); all drawing is SVG in the shadow root; Task 9's MutationObserver diff is
the hard verification — the sprint fails its own acceptance if a single record appears.

**The model paraphrases instead of copying, so `textMatch` misses.** LaTeX especially
("x^2+3x" vs "x² + 3x"). Mitigation: the prompt demands exact copies from PAGE CONTEXT
(which the model was *given* — it never needs to invent the string); normalisation
(whitespace/case) absorbs cheap drift; the bounded page-text search is the second
chance; a residual miss drops gracefully. If Task 9 shows systematic misses, the fix is
prompt phrasing or normalisation depth — not a schema change.

**Scroll re-anchoring jank.** Re-resolving on every scroll frame could stutter on heavy
pages. Mitigation: ≤3 annotations per turn (prompt + client cap) keeps re-resolution
trivially cheap; one passive capture-phase listener, rAF-throttled; the listener exists
only while annotations are active; rects come from `getBoundingClientRect` on
already-resolved elements (no re-search on the hot path — the chain re-runs only when an
element disconnects).

**Host-page CSS transforms break fixed-position coordinates.** A transform/filter on
`<html>`/`<body>` makes `position: fixed` position against that element instead of the
viewport (rare, but real). Mitigation: accept the degraded case this sprint — the
viewport-clamp keeps drawings sane, and a detectable mismatch (computed transform on the
root) can simply suppress annotations on that page (a drop, consistent with the fallback
contract). Named here so Task 9 doesn't mistake it for a resolver bug; a general fix is
post-V1.

**SPA pages mutate between capture and draw.** The registry's elements can disconnect
(framework re-render) between overlay open and the turn's reply. Mitigation:
connectedness is checked at draw AND re-anchor time; a disconnected anchor falls through
to the text search (the content is usually still on the page, in a new node) or drops;
the registry refreshes on every overlay open.

**The prompt over-annotates and clutters the page.** Mitigation: "≤3, most turns none"
in the guidance block, and the controller enforces the cap client-side; the per-turn
replace means clutter can never accumulate; if Task 9 still shows noise, tightening is a
prompt edit.

**First extension test infrastructure.** Adding vitest to the extension workspace
touches its package.json + the turbo pipeline. Mitigation: kept deliberately minimal
(one spec file, jsdom, pure functions only — no WXT/browser harness); `wxt build` and
typecheck gates are unchanged; if the setup fights the sprint, the fallback is moving
the pure resolver helpers' coverage to code review + Task 9 and recording that in "What
the next sprint needs to know" — not skipping the logic's design for testability.

---

## What the next sprint needs to know

**The tutor now draws on the page.** Every turn's envelope annotations cross the wire
additively, resolve against the live page in the content script (registry-first
`textMatch`), and render on the shadow-root SVG layer with scroll/resize tracking and
drop-don't-guess fallback — zero host-DOM writes, nothing persisted. What attaches next:

- **Dashboard sprint (Sprint 13):** unchanged by this sprint — the Sprint 11 audit's
  readiness table and gaps list (`/docs/sprint-11-audit.md`: concept display `title`s in
  `@calyxa/curriculum`, chart colors as named `@calyxa/ui` tokens, the decision on
  persisting `mode`/`confidence` for the timeline, `(session_id, turn_index)` as display
  order not identity) transfer intact as its planning input.
- **Streaming sprint (if pursued):** annotations become a **trailing SSE event** after
  the `say` deltas (§2.5's pipeline diagram); the layer + controller consume them
  unchanged — only the transport leg changes.
- **OCR-beta capture sprint (ADR-012):** image-math coordinates finally give the `bbox`
  resolver a real source; it is already implemented and viewport-clamped — the beta path
  plugs in without touching the layer.
- **Annotation persistence / session replay:** deliberately not built (ADR-023). If a
  replay UX ever wants drawing history, that is an additive schema decision then — and a
  privacy call (what was highlighted reveals what was studied).
- **Host-transform pages:** annotations may suppress/degrade on pages with root-level
  CSS transforms (named risk, accepted this sprint); a general fix is post-V1.
- **Extension tests exist now:** `/extension/tests` runs under `turbo run test`
  (vitest, pure logic only). Extend it rather than re-litigating whether the extension
  workspace is testable.
