## ADR-019: Structured JSON output envelope on the turn, per-turn `session_interactions` persistence, and per-interaction FSRS

**Status:** Decided

**Context:** `/docs/PLAN.md` §2.5 always specified a single-JSON-object turn response — `say`,
`annotations[]`, `mode`, and an `assessment` of the student's last answer keyed to a concept.
ADR-008 overrode this to plain text, deferring the envelope "to the voice sprint," and ADR-013
fixed the corresponding write side: "the turn writes nothing" to the database, with all learning
state updated only at session end. Sprint 09's ADR-016 then ran the full §2.4 FSRS model at
**session-end granularity**, off a *separate* summariser Anthropic call that re-reads the whole
transcript to reconstruct per-concept observations the tutor had already implicitly formed while
responding — and named the reinstatement condition explicitly: reviving per-turn persistence "so
FSRS can run on its native per-interaction cadence" was considered and rejected *at that time*
because it would reverse ADR-013 and reopen the per-turn `assessment` envelope ADR-008 deferred.
ADR-016 also recorded the direct cost of staying at session-end granularity: `response_latency_ms`
has no per-turn source, so the lucky-guess sub-guard that depends on it is off. Both of ADR-016's
named preconditions for revisiting — a persisted per-turn row and a structured per-turn assessment
— are things this sprint can now build together, rather than the second Anthropic call continuing
indefinitely to redo work the tutor's own turn already does.

**Decision:** Adopt the §2.5 JSON envelope (`say`, `annotations?`, `mode`, `assessment?`) on
`/api/ai/turn` — the live, non-streaming path the overlay actually calls. `buildSystemPrompt` takes
a `format: 'envelope' | 'text'` parameter; the turn route requests `'envelope'` and parses it
defensively, degrading any malformed or plain-text model output to `{ say: <raw text> }` so a bad
envelope never blanks the tutor. The still-unwired streaming path (`runTutorTurnStream`,
`/api/ai/stream`) keeps `format: 'text'` and is otherwise untouched. The turn route persists exactly
one `session_interactions` row per gradable turn — text only, no audio (ADR-011 upheld) — carrying
the envelope's `assessment` and a real `response_latency_ms` supplied by the client. This is a
direct, explicit **reversal of ADR-013**. FSRS then runs **per interaction**, off the critical path
(`waitUntil`, guarded by `applied_to_profile` for idempotency) rather than at session end, restoring
the third lucky-guess sub-guard ADR-016 had to omit. The separate end-of-session summariser Anthropic
call is **retired**: `/api/session/end` no longer re-derives observations from the transcript, and
instead reconciles any interactions whose off-critical-path apply did not complete before the
session ended.

**Rationale:**
- The tutor already forms an assessment of the student's last answer while composing its response;
  persisting that judgement is strictly cheaper and more faithful than a second model call that
  re-reads the entire transcript afterward to reconstruct the same thing.
- A real per-turn `response_latency_ms` is the one signal ADR-016 could not produce at session-end
  granularity — restoring it completes the guess-discounting design PLAN §2.4 specifies rather than
  running it permanently degraded.
- Per-interaction apply closes the adaptive loop **within** a session: a concept answered well early
  in a session reads back calibrated on a later turn of the same session, which session-end-only
  updates cannot do.
- Keeping the insert on the critical path but the FSRS/scheduler write off it (via `waitUntil`)
  preserves voice-turn latency — the expensive part of the original session-end design (a second
  Anthropic call) is eliminated entirely, not added to per turn.
- Landing the envelope on the non-streaming path, not the unwired SSE path, matches where the
  overlay actually sends turns today; a single JSON object cannot be token-streamed without leaking
  raw JSON to the user, so envelope-over-real-streaming is correctly left as a distinct, later
  problem rather than solved speculatively here.
- Defensive parsing (degrade-to-`{ say }`) preserves the reliability discipline ADR-015's
  summariser already established for structured model output — a malformed response degrades
  gracefully, it never throws or blanks the reply.

**Consequences:**
- Enables: a tutor that assesses, records, and recalibrates every turn instead of only at session
  end; a real `response_latency_ms` signal restoring the third lucky-guess sub-guard; the `annotations`
  field the later annotation-rendering sprint needs, produced with no further prompt work.
- Requires: `session_interactions` to exist (this sprint's migration); the turn route to know a
  real, owned `sessionId` (the extension must thread it — this sprint's Task 7); `applied_to_profile`
  to gate every apply so the off-critical-path write and the session-end reconcile sweep never
  double-apply; ADR-016's per-observation FSRS/misconception logic to be called per interaction
  instead of per summary, unchanged in its own logic.
- Forecloses: nothing it does not explicitly defer — annotation *rendering*, true envelope-over-SSE
  streaming, and the mastery dashboard remain later sprints that consume this envelope and this
  per-turn record rather than needing to change them.
