## ADR-011: Session audio is never persisted — the STT route is an in-memory passthrough

**Status:** Decided

**Context:** The locked rule is "session audio is never persisted; real-time
STT only." We had to decide how to enforce it structurally, not by
convention, for the new STT route, which receives raw mic audio.

**Decision:** `/api/voice/stt` imports no storage/Blob/DB client in its
module; it holds the uploaded audio only as an in-memory buffer passed
straight to Whisper and returns only the transcript, never the audio. No
migration and no DB write occur on a voice turn (the learning tables do not
exist — ADR-009); even the text `student_transcript` is not persisted this
sprint. Text fallback is always available (the unchanged Sprint 05 text
turn) as the degraded path when the mic is unavailable/denied or any voice
leg fails — a voice turn never dead-ends.

**Rationale:**
- Enforcing the rule by module structure (no storage import) is auditable
  and survives refactors, unlike a convention that only a code reviewer
  would catch.
- An in-memory passthrough is the minimal correct STT shape for an
  unpersisted pipeline.
- Returning only text keeps audio off every downstream surface, including
  logs and the database.
- Text fallback guarantees the tutor is reachable even with no mic.

**Consequences:**
- Enables: a compliant audio path and a tutor that always works, voice or
  text.
- Requires: the STT route module to stay free of any storage/Blob/DB import
  (asserted by the Task 4 test); the mic stream stopped and released after
  each utterance.
- Forecloses: any on-disk/Blob/DB audio write; persisting the transcript is
  deferred to the learning sprint.
