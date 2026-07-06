## ADR-027: Problem-sized sessions — auto-start, AI-signaled completion, client-confirmed close

**Status:** Decided

**Context:** Since ADR-007, a session is a manually-toggled span: the popup's Start
button calls `start_session`, the popup's End button (or the overlay's End-session
control, added Sprint 13) calls `end_session`. Live use of the Sprint 11–13 surfaces
(Sprint 13 Task 10 and after) showed this reads stale against what the product
actually is — a session that can span many unrelated problems, ended only when a
student remembers to press a button, while the tutor itself already knows, turn by
turn, whether the *problem in front of the student* is done. The product decision
this sprint locks in is that a session should be **problem-sized**: one session per
problem, starting the moment the student engages and ending the moment the tutor can
see the problem is resolved — without asking the student to manage a button that
tracks a boundary only the tutor can see.

**Decision:**
1. **A session auto-starts on the student's first turn, never from the popup.** The
   background worker's turn handler (`handleAiTurn`, and the `AI_STREAM` port's first
   message) checks `storage.ActiveSession` at turn-send time; if empty, it calls the
   same `api.startSession` the popup used today, lazily and idempotently, under the
   background's existing turn serialization. A start failure degrades to a sessionless
   turn — today's behavior — never a blocked turn. Opening the panel, reading the
   overview, and minimizing create no session; only a sent turn does, which keeps the
   §2.8 invariant "a started session always corresponds to a counted use" honest under
   auto-start.
2. **Session-end authority is AI-signaled, client-confirmed.** The model emits
   `session.complete` + `reason` on the envelope (ADR-028's `solution_progress`
   neighbor field) when one of exactly three end-conditions holds, verbatim:
   - the student **solves the problem**;
   - the student **answers, then declines the follow-up**;
   - the student **answers the follow-up correctly on a retry**.
   A pure client heuristic cannot see "declined the follow-up" — only the model has
   the conversational context to judge it — so the client never ends a session on its
   own inference. It only *confirms* the model's signal by running the visible close:
   the tutor says the exact line **"Now closing tutoring session."**, the background
   POSTs the existing `/api/session/end` (recap + `SESSION_ENDED` broadcast fire
   byte-identical to a popup-triggered end), the recap strip renders, a green
   conic-gradient ring sweeps the ✕ for ~4 seconds, and the panel closes with the
   transcript cleared. A malformed or missing `session` field is a **non-close** — the
   safe failure (ADR-028 formalizes the parse discipline) — leaving ✕ as the manual
   escape hatch for a stranded session.
3. **The popup is demoted to a display hint.** Its Start/End session controls and
   their tab-domain derivation are removed; it renders sign-in state, remaining
   quota, and the degraded notice only. `START_SESSION`/`END_SESSION` background
   handlers are kept (still valid messages, still used internally by the auto-start/
   auto-end paths) — nothing sends `START_SESSION` from the popup anymore.
4. **This REVISITS ADR-007's manual start, not its gate.** The atomic
   `start_session` RPC, its `SECURITY INVOKER` discipline, the lazy 30-day reset, and
   `FREE_SESSION_LIMIT = 10` are all unchanged — only *what triggers the call* moves,
   from a button press to the first turn.
5. **Quota semantics tighten, and this sprint deliberately does not fix it.** A
   session used to span an arbitrary study sitting (however many problems the student
   worked before pressing End); now one session is one problem. 10 free sessions/month
   is therefore materially tighter than 10 sittings — a real product/cost tradeoff,
   but one that needs aggregate spend data this sprint doesn't have. Retuning
   `FREE_SESSION_LIMIT` is explicitly handed to **Sprint 16's cost-guardrail work**,
   flagged here and in "What the next sprint needs to know" so it cannot be missed.

**Rationale:**
- Only the model can see the three end-conditions (a declined follow-up, a corrected
  retry) in real time; a client-side heuristic would need to re-derive conversational
  state the model already has, duplicating logic that can drift from the model's own
  judgment. Emitting the signal on the envelope keeps one source of truth.
- Client-confirmed (rather than client-decided) close keeps the failure mode safe:
  a missed or malformed signal strands a session open — recoverable via the existing
  manual ✕ — instead of a false positive silently ending a problem mid-work.
- Reusing the exact `start_session`/`end_session` RPCs and the `END_SESSION` broadcast
  path means auto lifecycle costs no new server surface and no new race: the atomic
  gate ADR-007 already closed is inherited, not re-solved.
- Deferring the quota renumbering rather than guessing at a new limit avoids
  encoding a product decision (what to charge for problem-sized use) into this sprint
  on no data; flagging it loudly is cheaper than silently shipping a worse free tier.

**Consequences:**
- Enables: a session lifecycle that matches the actual mental model ("one problem"),
  with no button for the student to remember; a popup that is honestly just a status
  display.
- Requires: the background's turn serialization to treat auto-start as idempotent and
  safe to race (two near-simultaneous first turns must not double-start); the envelope
  parser to treat a malformed `session` field as absent, never as a guessed close
  (ADR-028); Task 9's manual acceptance to exercise all three end-conditions and the
  minimize-vs-end distinction live.
- Defers: `FREE_SESSION_LIMIT` renumbering to Sprint 16, which inherits problem-sized
  sessions as its metering unit; nothing else about entitlements or billing changes
  here.
