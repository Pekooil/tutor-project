## ADR-029: Annotation legibility — box-first, proactive, collision-free — and the ADR-026 ping-loosening amendment

**Status:** Decided

**Context:** Two independent live-use defects from Sprint 11–13 land in this sprint
together because they touch the same two surfaces (the annotation layer and the
turn-time event system) and both are "the existing contract under-delivers, tighten
it" fixes rather than new architecture. First: annotations. ADR-022 built a
resolver-and-render pipeline with a drop-don't-guess fallback, but live use asking
the tutor to "annotate each component of x² + 5x + 6" showed two compounding causes
of unreadable output — the model labels every sub-expression with a same-anchor
`circle`/`arrow`, and the render layer places every label at the same fixed offset
from its anchor rect, so labels stack illegibly on top of each other. Second: pings.
ADR-026 deliberately kept `mastery-up` silent on first-contact transitions and never
added an in-state or streak-progress kind, reasoning that routine ticks would feel
like noise — but live use shows the opposite failure: real sessions with genuine
progress end with zero pings, because the two Sprint 13 kinds are both keyed to
boundary-crossing events that don't fire on every session.

**Decision:**

### Part A — annotation legibility (prompt half + layout half)
1. **The outlined box becomes the primary annotation type.** `highlight` renders as a
   clean outlined rounded-rect (stroke, transparent fill) instead of today's thin
   underline-reading translucent rect; `circle`/`arrow` remain available and unchanged
   in rendering, but the prompt now steers the model to reach for the box by default
   and reserve circle/arrow for cases where the shape itself adds meaning (e.g.
   circling a single term vs. arrowing a direction of substitution) — one annotation
   per distinct region, not one per token.
2. **Annotation is proactive, not just reactive to explicit requests.** The prompt
   instructs the model to annotate whenever its reply references content that PAGE
   CONTEXT shows is on screen, not only when the student explicitly asks for a
   pointer. ADR-022's ≤3-per-turn cap and drop-don't-guess resolution are unchanged —
   proactivity governs *when* the model reaches for an annotation, not how many or how
   a target resolves.
3. **A deterministic label-collision pass closes the layout half.** The prompt fix
   alone does not stop two adjacent, correctly-drawn boxes from producing overlapping
   labels; the annotation layer gains a pure function (rects in, placed labels out,
   unit-testable without a browser) that stacks or offsets any labels whose default
   placement would intersect, connecting an offset label to its anchor with a short
   leader line, with all placements clamped to the viewport. This is a pure geometry
   pass over the turn's existing draw list — no new DOM measurement, no change to
   resolution priority or `ttl_ms` behavior.

### Part B — amendment to ADR-026: ping loosening (three new kinds, one contract)
4. **This reverses part of ADR-026's silence, deliberately and by name — not by
   loosening the rule that pings come from the model's own math.** Exactly three new
   kinds, each still computed prospectively by `computeNodeUpdate` in `events.ts`
   (never by the LLM, no envelope field, no grounding gate — ADR-026's structural
   guarantee is unchanged):
   - **`mastery-up` gains two transitions**: `unseen->learning` and
     `unseen->mastered` are added to `MASTERY_UP_TRANSITIONS`. ADR-026 kept
     first-contact transitions silent on the theory that "first contact is not an
     improvement"; live use shows a first-contact result that lands at a real level
     reads to the student as progress worth celebrating, not noise.
   - **`mastery-progress` (new kind)**: fires on an in-state (`learning` or
     `mastered`) single-turn mastery delta of **≥ +0.10** (a named constant, not a
     magic number) — "Progress: {title}". This is the one place ADR-026's "routine
     in-state ticks are silent" rule is narrowed: not every tick pings, only a gain
     large enough to be a real single-turn jump.
   - **`streak-progress` (new kind)**: fires when a sound-correct brings an active
     misconception's streak to `RESOLUTION_STREAK − 1` — "Almost closed: {gap} (2 of
     3)". It is **superseded by `misconception-resolved`** on the completing turn:
     the two never both fire for the same misconception in the same turn.
   Newly *detected* misconceptions remain recap-only — that half of ADR-026's silence
   contract stands unchanged; only the upward-progress side loosens.
5. **A client-side, per-concept-per-kind session cap prevents the wider net from
   becoming spam.** The overlay keeps a seen-set (concept × kind) for the session's
   lifetime; once a given kind has pinged for a given concept, it does not ping again
   for that concept until the next session. This is the enforcement mechanism that
   lets thresholds stay generous without the ping count growing unbounded across a
   long problem.

**Rationale:**
- Splitting the annotation fix into a prompt half and a layout half is required
  because either alone leaves a real failure mode: a prompt-only fix cannot guarantee
  two independently-valid boxes never produce colliding labels; a layout-only fix
  cannot stop the model from drawing eight same-anchor annotations for one expression
  in the first place.
- The box-as-primary decision matches how a human tutor actually gestures at written
  math — circling one term or drawing a substitution arrow are the exceptions, not
  the default — so steering the model toward box-first is also the more legible
  choice, not just the more implementable one.
- Reusing `computeNodeUpdate` for the three new kinds keeps ADR-026's core structural
  guarantee — pings are facts about what the FSRS apply will write, never a claim the
  LLM invented — fully intact; loosening thresholds is a constants change, not an
  architecture change, which is exactly the kind of tuning ADR-026 anticipated
  ("if live use still feels chatty, the fix is a constant in one file").
- Naming the `+0.10` and `RESOLUTION_STREAK − 1` thresholds explicitly (rather than
  leaving them as prompt tone) keeps the amendment falsifiable and testable
  (`events.test.ts`), which a vaguer "ping more" instruction would not be.
- The per-concept-per-kind cap is the deliberate answer to "won't this just become
  the noise ADR-026 tried to avoid?" — it bounds the worst case (a long single-concept
  problem) without reintroducing a blanket silence on genuine progress.

**Consequences:**
- Enables: legible annotations on multi-component expressions without asking the
  model to annotate less; sessions that show real signs of life via pings even when
  no mastery boundary is crossed, addressing the "zero pings on a session with real
  progress" defect directly.
- Requires: the collision pass to be deterministic (same input → same layout, pinned
  in `annotations.test.ts`) so it is trustworthy without visual re-review each time;
  `events.test.ts` to cover all four ping kinds plus the streak-progress /
  misconception-resolved superseding rule plus the degrade-to-no-pings path; the
  overlay's seen-set to be session-scoped only (it resets with the session, per
  ADR-027's lifecycle) and never persisted.
- Forecloses: nothing durable — thresholds, the leader-line style, and the cap's
  granularity (per-concept-per-kind, not global) remain a constants/tuning surface for
  the beta feedback loop, explicitly not a redesign per the sprint's "What the next
  sprint needs to know."
