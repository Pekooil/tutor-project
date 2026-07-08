## ADR-034: Status pins — the title card as Calyxa's live signal surface

**Status:** Decided

**Context:** By Sprint 14 the overlay had grown three separate transient
surfaces telling the student what the tutor knows or just did: the event-ping
toasts floating above the panel (ADR-026; `misconception-resolved`,
`mastery-up`, `mastery-progress`, `streak-progress`), the per-bubble profile-tag
pills in the transcript (ADR-024; reviewing / known-gap / due-review / strength
/ callback), and the concept text those tags repeated into the chat history.
Three surfaces diluted what is supposed to be the product's headline claim —
that Calyxa visibly adapts to THIS student — and none of them communicated the
tutor's own *teaching* adaptations (switching representations, resizing steps,
adjusting guidance/difficulty/pace) at all. Darcy's direction (2026-07-08):
fold all of it into ONE surface, make it the primary feature and selling point,
and put it where the eye already rests — the title card. Icons only, never
emoji.

**Decision:**

1. **One wire field, one visual surface.** The turn response's separate
   `profileTags` + `pings` fields are REPLACED by a single `pins` array of
   `StatusPin { category, kind, conceptKey, label }` (turn-complete.ts is the
   assembler; the extension and the routes ship together, so this is a clean
   rename with no deprecation window). The extension renders pins in the
   TitleBar as a **dynamic island**: the CalyxaMark + "Calyxa" wordmark cluster
   itself crossfades into the pin's icon + label for ~4s per pin
   (`PIN_DISPLAY_MS`), then back. One pin at a time, FIFO queue, `aria-live`
   polite. PingToasts.tsx and the transcript tag pills are retired outright.

2. **Three signal sources, each honest about provenance, one delivery
   contract.**
   - *Deterministic learning events* (events.ts `computeStatusPins`, the
     ADR-026 machinery renamed): `pattern-broken` (was
     misconception-resolved), `streak-progress`, `concept-understood` (was
     mastery-up), `progress` (was mastery-progress), plus two new kinds —
     `prediction-confirmed` (this turn's flagged misconception matches one
     ALREADY recorded as active: the profile predicted this exact failure
     mode) and `confidence-up` (the student's apparent certainty rose since
     their last recorded interaction on the concept, on a correct answer).
     Same prospective-computation drift-proofing as ADR-026; learning-event
     pins still only ride when the apply was actually scheduled.
   - *Model-emitted signals* (new envelope field `signals`, an array, made a
     REQUIRED tool property so the model fills it every turn — the proven
     compliance lever in this repo; empty allowed): the PRIMARY volume
     driver, because the teaching/guidance/difficulty/independence categories
     can only be judged by the model. Allowlist: teaching-visual /
     teaching-decompose / pace-up / guidance-up / guidance-down /
     difficulty-up / difficulty-down / self-caught / concept-understood /
     confidence-up / prediction-confirmed / **misconception-detected** /
     **pattern-detected** / pattern-broken. Only the allowlisted KIND crosses
     the wire; display copy is a fixed product string keyed by kind
     (turn-complete.ts's `SIGNAL_PINS`), enriched server-side from the turn's
     own grounded assessment for a few kinds (the flagged misconception
     category, the tagged concept title) — a signal can be wrong about the
     tutoring, but it can never *say* anything the product didn't write
     (ADR-024's server-rendered-display rule, extended). The prompt frames
     emission as EXPECTED-not-rare (most turns carry one or two) and adds a
     BEFORE-YOU-ANSWER checklist item; the client's per-session dedupe keeps
     the surface at ~3-6 distinct pins rather than repetitive spam.
   - *Grounded memory* (the ADR-024 grounding gate, re-purposed): grounded
     `callback` and `due-review` profile tags become memory-category pins
     ("Building on a previous session" / "Reviewing: {title}"). The other
     three tag kinds (reviewing / strength / known-gap) become grounding-only
     — nothing renders them anywhere anymore.
   - *One client-derived kind*: `final-step`, fired once per problem the first
     time the eased solution-progress signal (ADR-028) crosses 0.85 on a
     still-open problem. Deterministic; the server never emits it.

3. **Delivery discipline (client, Overlay.tsx).** Priority-sorted
   (`PIN_PRIORITY`: pattern-broken > prediction-confirmed > concept-understood
   > self-caught > … > memory), at most 2 shown per turn (ADR-026's cap kept),
   and at most one pin of a given kind per concept per session
   (`kind:conceptKey` dedupe set; concept-less moves dedupe by kind alone) —
   pattern-broken stays exempt, each completed streak being a distinct real
   event. The queue clears when the recap arrives (the terminal state owns the
   header) and on panel close.

4. **Announcing new gaps — reversed on Darcy's call (2026-07-08).** The
   first cut dropped "New misconception detected" and "Pattern detected" for
   the ADR-026 reason (announcing a new gap mid-struggle can demoralize) and
   kept the *server* from ever auto-computing a pin for a new misconception
   (it still doesn't — the deterministic FSRS path stays silent on new
   gaps). But Darcy wants the full set visible, so both are re-added as
   **model-emitted** signals (`misconception-detected`, `pattern-detected`):
   the model, which reads the whole exchange, decides when surfacing one
   actually helps, and the copy is kept matter-of-fact ("New misconception
   spotted", "Pattern spotted") rather than accusatory.

5. **Iconography and color.** One inline SVG per kind (TitlePin.tsx; 14×14,
   1.5px round-capped strokes, currentColor) — no emoji, no icon library.
   Category → color reuses the existing signal language (ADR-018, no new
   hues): green = achieved (progress / confidence / independence), blue = in
   motion (prediction / teaching / guidance / difficulty), neutral
   muted-foreground = factual history (memory). Amber stays excluded from text
   (the Sprint 14 AA measurement).

**Consequences:** The transcript gets cleaner (bubbles are just the
conversation), the title card becomes the one place adaptation shows, and the
prompt gains a MOVES block + an optional `move` key in the forced-tool schema.
The opening scan's `profileTags` response field still exists on the wire but
nothing consumes it. The old `TurnPing` type is gone from both codebases;
`StatusPin` is declared in web/lib/learning/events.ts and mirrored
by-convention in extension/src/types/messages.ts like every other wire type.
A missed pin is always the safe failure: every source degrades to "no pin,"
never a wrong or invented one.
