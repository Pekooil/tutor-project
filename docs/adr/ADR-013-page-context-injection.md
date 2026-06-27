## ADR-013: Page context is injected per-turn into `/api/ai/turn` and is never persisted

**Status:** Decided

**Context:** The extracted `PageContext` has to reach the §2.5 prompt's
`PAGE CONTEXT` slot. The middle leg `/api/ai/turn` was reused unchanged
through Sprint 06; injecting page context now extends it. Page content
reveals what a student studies (PLAN §2.7 treats the URL as sensitive), so
we had to decide how it travels and whether it persists.

**Decision:** Extend `/api/ai/turn` (and `runTutorTurn` / `buildSystemPrompt`)
to accept an optional `pageContext`; it is captured on overlay open, rides
inside the existing `AI_TURN` payload (no new message type, no new route, no
change to the background relay), is rendered + truncated server-side to the
§2.5 budget by `renderPageContext()` (the authoritative cap), injected into
the prompt, and then discarded. No migration and no DB write occur on a
page-context turn; URL hashing / `page_domain` persistence (PLAN §2.7) is
not done this sprint — page context is ephemeral (mirroring the
audio-never-persisted discipline of ADR-011). A turn without `pageContext`
behaves exactly as Sprint 05/06 (the empty-slot fallback).

**Rationale:**
- Riding the existing `AI_TURN` payload reuses the Sprint 05/06 relay +
  bearer seam rather than standing up a new route/message.
- An optional field keeps full back-compat (voice turns and mic-less turns
  still work).
- Server-side render+truncate makes the §2.5 budget a guarantee, not a
  client courtesy.
- Not persisting page content keeps the sensitive "what is the student
  studying" signal off every durable surface until the DB sprint adds the
  salted URL hash deliberately.

**Consequences:**
- Enables: a prompt anchored to the student's actual screen content, on
  both text and voice turns, with no new transport.
- Requires: `renderPageContext()` to enforce the page-context budget
  server-side; the route to treat `pageContext` as untrusted input
  (validate, cap, never crash on garbage); `/api/ai/turn` to keep writing
  nothing to the DB (Task 4 asserts this).
- Forecloses: persisting page text or the URL this sprint; the §2.5 JSON
  envelope / annotations (still deferred, ADR-008).
