## ADR-028: Solution-progress signal — model-emitted, client-clamped, ephemeral

**Status:** Decided

**Context:** ADR-027 makes a session problem-sized, but a session-level signal alone
is coarse — the student gets no feedback on *how far into the problem* they are until
the tutor decides the whole thing is done. Sprint 14 adds a finer-grained twin at the
turn level: a solution-progress value the composer can render as a small bar. Only
the model knows how many reasoning steps a given problem actually has (the client has
no problem-structure model to count against), so the signal has to be model-emitted —
which immediately raises the same risk every model-emitted number does: turn-to-turn
jitter that erodes trust faster than no signal at all.

**Decision:**
1. **`solution_progress` (0–1) rides the envelope**, emitted by the model on every
   gradable turn, scored against a rubric: genuine reasoning steps only (not turn
   count, not message length), a small regression on a wrong step, and — critically —
   never jumping to 1.0 without a real solve; 1.0 is reserved for the turn the
   `session.complete` reason is `'solved'` (ADR-027).
2. **The client clamps, the model does not self-regulate.** Parsing follows the
   existing envelope discipline (ADR-019's per-field degrade): a non-numeric value is
   dropped, an out-of-range value is clamped to `[0, 1]`. On top of the parse clamp,
   the overlay applies bounded per-turn regression (a wrong step can ease the bar back
   by at most a fixed step, not reset it to zero), a floor (the bar never reads as
   fully empty once a real attempt has started), and monotone easing on the way up
   (the bar animates toward the new value rather than jumping) — so a single noisy
   turn cannot thrash the display even if the model's own number does.
3. **Bar-max is the fine-grained view of one end-condition, not a fourth one.**
   Reaching progress 1.0 **is** the `'solved'` end-condition seen at finer grain — on
   that turn the client forces the bar to full before running the close choreography.
   The other two reasons (`'follow-up-declined'`, `'follow-up-corrected'`) close the
   session **without** requiring a full bar: bar-max is one path to the end, not the
   only one, so the client never waits on progress to trust a non-`'solved'`
   completion.
4. **The signal is ephemeral overlay state.** It resets to its floor on session end
   (auto or manual), is never persisted (no migration, no `session_interactions`
   column — this stays entirely client-side plus the wire field), and is never
   conflated with or labeled as mastery: it measures progress on *this problem*, not
   the student's standing on the concept, and the composer never shows it as a
   percentage.

**Rationale:**
- A model-emitted number is the only option (the client has no way to independently
  measure "how much of this problem is left"), but trusting it verbatim would let one
  noisy turn undo the point of showing progress at all — the clamp/floor/easing
  contract is what actually earns the student's trust in the bar, not the model's
  raw output.
- Tying bar-max to exactly one end-condition (`'solved'`) rather than requiring it for
  all three keeps the progress bar and the session lifecycle honestly independent
  signals that happen to coincide on one path — a declined or corrected follow-up is a
  legitimate, complete session even if the bar never filled.
- Keeping the signal unlabeled and unpersisted avoids a second, competing "progress"
  number next to mastery, which is the metric the profile-visibility surfaces
  (ADR-024/025) already own; a percentage or a stored history would invite exactly
  that confusion.

**Consequences:**
- Enables: a per-turn sense of "how close am I" that composes with the session-level
  completion signal instead of duplicating it; students get finer feedback without any
  new persistence or server round-trip.
- Requires: the envelope parser to clamp/drop `solution_progress` per ADR-019's
  existing per-field discipline (formalized in Task 8's `envelope.test.ts`); the
  overlay's clamp/easing logic to be a pure, testable reducer (`lifecycle.test.ts`)
  so the regression bound and forced-full-on-`'solved'` behavior are pinned, not
  just eyeballed.
- Forecloses: nothing durable — a persisted per-problem progress history, or a
  richer step-counted rubric, remain open for a later sprint if the qualitative bar
  proves insufficient; today's constants (regression bound, floor) are named and
  tunable without an architecture change.
