## ADR-015: Session state is written by one end-of-session summariser call; the turn path still persists nothing

**Status:** Decided

**Context:** The live graph needs a write signal, but the §2.5 per-turn
`assessment` (JSON output envelope) is deferred (ADR-008) and
`/api/ai/turn` writes nothing (ADR-013). We had to decide how the
per-session learning signal is produced and how the transcript reaches the
write without reversing ADR-013 or reviving the envelope.

**Decision:** At session end, run one Anthropic summariser call (a second
SDK call site confined to `/web/lib/ai`, ADR-008) over the conversation
transcript → a structured `SessionSummary` (concepts + outcomes + optional
misconception, constrained to `KNOWN_CONCEPT_KEYS`) → a minimal apply
writes `knowledge_nodes`/`misconceptions`. `/api/ai/turn` still writes
nothing and per-turn `session_interactions` are not persisted. The
transcript reaches `/api/session/end` by riding the existing `AI_TURN`
relay: the background worker already receives the full running transcript
every turn, so it caches the latest in `chrome.storage.session` (in-memory,
cleared on end) and forwards it on `END_SESSION` — no new message type, no
per-turn DB write. The write is idempotent via `end_session`'s open→ended
transition (a repeat end is a 404 no-op). A summariser failure degrades —
the session still ends.

**Rationale:**
- One end-of-session call avoids reviving the deferred per-turn envelope
  and keeps replies plain text (ADR-008).
- Reading the transcript (already held client-side and relayed each turn)
  needs no new transport.
- The open→ended guard gives idempotency without an `applied_to_profile`
  ledger.
- Best-effort apply keeps a flaky summariser from blocking session end.
- The audio-never-persisted discipline is intact (text transcript only —
  ADR-011).

**Consequences:**
- Enables: durable cross-session learning with no per-turn write and no
  new route/message.
- Requires: the worker to cache the running transcript ephemerally
  (cleared on end, never to disk/DB); the summariser to be the only new
  write trigger; `/api/ai/turn` to keep writing nothing (Task 7 asserts).
- Forecloses: per-turn `session_interactions` and the §2.5 JSON envelope
  this sprint (still deferred, ADR-008); any audio persistence.
