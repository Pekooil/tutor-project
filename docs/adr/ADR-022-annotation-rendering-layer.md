## ADR-022: The annotation rendering layer — shadow-root SVG, resolver priority, drop-don't-guess

**Status:** Decided

**Context:** `/docs/PLAN.md` §2.5 specified the full annotation instruction format (five types,
three target kinds — `selector` / `bbox` / `textMatch` — style, label, step, ttl) from the start,
but every prior sprint deferred its consumer: ADR-008 kept output as plain text ("no consumer"),
and ADR-012 explicitly declined to extract element rects for the same reason ("reading rects now
would be dead weight — no consumer"). Sprint 11 (ADR-019) restored the §2.5 JSON envelope, and
`envelope.ts` already parses and structurally validates `annotations` on every turn — the consumer
this sprint builds has, since Sprint 11, had validated data waiting for it with nowhere to go.
Separately, ADR-002 chose the shadow-DOM overlay specifically because it "shares the host
viewport's coordinate space, which annotations require" — that decision's payoff was deferred
until now. A shape decision was needed: where target resolution runs, how the three target kinds
anchor to a live, scrolling page, and — critically — what happens when a target can't be resolved,
given the locked constraint that the host DOM is never mutated.

**Decision:** Build the annotation layer per §2.5: a transparent, full-viewport, fixed-position,
`pointer-events: none` SVG rendered **inside the existing shadow root**, drawing in host-viewport
coordinates. Target resolution runs in the **content script** (the only context with host-DOM
read access), in strict priority order per target: `selector` (querySelector, excluding the
`<calyxa-overlay>` subtree) → **registry-first `textMatch`** (an in-memory equation→element
registry captured alongside `PageContext` at overlay-open time, matched by normalised exact text)
→ a bounded visible-text search (fallback `textMatch` path) → `bbox` (viewport-clamped
pass-through). A target that resolves to nothing at any step is **dropped, never guessed** — no
annotation is ever drawn in an inferred or approximate location. Lifecycle: each turn's
annotations **replace** the previous turn's; `ttl_ms` expires individual annotations early;
closing the panel clears the layer; unmounting the overlay (sign-out) fully tears it down. Because
the model cannot see the DOM or pixels, it is steered by prompt guidance toward `textMatch` with
text copied exactly from `PAGE CONTEXT`; the `selector` and `bbox` resolvers are still implemented
per the §2.5 schema for the sources that will eventually supply them (future extracted DOM refs;
the deferred OCR-beta image path). This revisits ADR-008's and ADR-012's "no consumer" deferrals
and consumes ADR-019's envelope field.

**Rationale:**
- A mis-anchored annotation is worse than none — it would actively mislead the student ("circle
  the wrong equation" fails harder than showing nothing) — so drop-don't-guess is the only
  fallback consistent with the product's trust bar.
- Registry-first `textMatch` makes the common case (annotate an equation the extractor already
  captured) precise without asking the model to invent a CSS selector or pixel coordinates it has
  no way to know.
- `getBoundingClientRect` and a fixed-position layer share one coordinate space by construction,
  so scroll/resize re-anchoring is a pure re-read of live rects, not a coordinate-transform
  problem.
- Keeping resolution in the content script and the layer purely presentational preserves the
  seam every prior sprint held: the overlay imports no `chrome.*` and no DOM-read logic, and the
  content script remains the sole host-DOM-read context.
- Per-renderer registry capture reuses the extractor's existing read pass (ADR-012) rather than
  adding a second DOM traversal.

**Consequences:**
- Enables: the flagship visible feature — the tutor can point at, circle, or underline the
  specific content on the student's screen while it talks. Gives the OCR-beta and envelope-
  streaming sprints a working renderer to attach to rather than building one from scratch.
- Requires: annotations to actually cross the wire from `/api/ai/turn` to the extension (ADR-023);
  the equation-element registry to be captured fresh on every overlay open; a verified zero-host-
  DOM-write guarantee as part of acceptance (a MutationObserver diff over a full annotated
  session).
- Forecloses: any host-DOM mutation for drawing (already locked policy, reaffirmed here for the
  annotation path specifically); guessed or approximated placement when a target fails to
  resolve — a resolution failure is always a silent drop, never a best-effort draw.
