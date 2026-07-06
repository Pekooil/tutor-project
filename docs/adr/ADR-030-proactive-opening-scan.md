## ADR-030: The proactive opening scan — screen-read-on-open, cross-session recall, immediate annotation

**Status:** Decided

**Context:** Every surface built through Sprint 13 is reactive: the tutor speaks
only after the student sends a turn. Live use suggested a stronger opening move —
when the student opens the panel on a page with a real problem, the tutor should
notice it immediately, frame it with an annotation, ask whether it's what the
student needs help with, and ground that opening line in what the tutor actually
knows about the student (relevant history, related prior sessions) rather than a
generic hello. This is the first AI-initiated turn in the product: no student
message triggers it, PAGE CONTEXT + the student's profile do.

**Decision:**
1. **The trigger is panel expand, not mount** — reusing Sprint 14 Task 5's capture
   discipline (`extractPageContext()` + the equation registry refresh already
   fire on expand). Immediately after that capture, if the resulting `PageContext`
   contains a plausible problem (non-empty equations or a non-trivial excerpt),
   the content script requests an **opening scan** from the background instead of
   waiting for the student to type.
2. **The opening scan is a real, non-templated AI call** — a new turn kind, not a
   canned line. It reads: the fresh `PageContext`, the student's `LearningProfile`
   loaded with `detectTopicKeys(PageContext)` bias (the Sprint 11 topic-bias read
   path — reused, not rebuilt), and the existing `callback` mechanism's prior-
   session digest (ADR-024/026 — reused for its cross-session grounding, not
   re-implemented). It emits: exactly one `say` line naming the detected problem
   and asking if that's what the student needs help with, an annotation framing
   it (subject to ADR-029's box-first, exact-target-text discipline), and — only
   when the grounding gate finds a genuinely relevant one — a `callback` profile
   tag referencing real prior work on this topic. **It never emits `assessment`**
   — there is nothing to assess yet, exactly the "opening turn, no prior student
   answer" case `envelope.ts` already tolerates (no schema change needed there).
3. **Opening-with-a-detected-problem is now the session start** (amends ADR-027's
   Decision 1 — see that ADR's own amendment). The background calls
   `api.startSession` at the moment the opening scan fires, before the call to
   `/api/ai/turn`, so the scan's own turn is `session_interactions` row #1 for
   that session (assessment-less, exactly as the schema already allows). If
   `PageContext` shows no plausible problem, nothing fires and no session starts
   — the student's first *sent* turn remains the fallback trigger (widened, not
   replaced; see ADR-027's amendment).
4. **The pre-question profile overview renders alongside the opening scan's
   reply, not instead of it.** `InsightStrip`'s overview (Sprint 13/14) and the
   opening scan's `say` + annotation are two different surfaces answering two
   different questions ("where do I generally stand" vs. "is this the problem you
   want help with right now") and both show on open when a problem is detected.
5. **Degrade to silence, never to a wrong guess.** If the opening scan's call
   fails, times out, or the model declines to identify a problem confidently, the
   panel opens exactly as it does today (overview only, empty transcript,
   student-initiated) — the scan is a strict addition on a successful path, never
   a blocking gate on opening the extension.

**Rationale:**
- Reusing `detectTopicKeys` + the `callback` mechanism rather than building a
  parallel "find related history" path keeps one source of truth for cross-
  session grounding — the same drop-don't-invent discipline ADR-024 established
  for tags applies here without new grounding logic to get wrong.
- Making the opening scan a real call (not a template) is what lets it name the
  *actual* problem on screen and reference *actual* prior sessions — a templated
  "Looks like you have a problem, need help?" would not deliver what Darcy asked
  for and would train students to ignore it.
- Treating open-with-a-detected-problem as the session start (rather than a free
  diagnostic call) keeps exactly one quota-accounting rule in the product instead
  of two: every billable AI call that engages with a real problem counts, whether
  it was triggered by opening or by typing. A "free scan, real session only on
  reply" split would need its own quota bookkeeping for a call that already looks
  and costs like a turn.
- Gating on a *detected problem* (not every open) keeps the scan from firing
  needlessly on a blank tab or a non-math page, where it would have nothing
  correct to say and would cost quota for no value.

**Consequences:**
- Enables: an opening experience that matches what a human tutor walking up to a
  desk would do — notice the problem, point at it, ask if that's the one — with
  cross-session memory grounded exactly as strictly as mid-conversation callbacks
  already are.
- Requires: the background to call `startSession` before the opening-scan turn
  (not after, and not skippable) so the quota debit and the `session_interactions`
  row agree on session membership; the content script to gate the request on a
  real `PageContext` signal, not on "panel expand" alone; the same envelope parse
  path (`assessment` optional) to cover a turn with no student input.
- Forecloses: a free/uncounted "look but don't charge" scan mode — if that is
  ever wanted later (e.g. to reduce beta friction), it is a deliberate reopening
  of this ADR's Decision 3, not a client-side toggle.
