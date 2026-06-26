## ADR-008: Claude runs behind a server-side proxy — text-only this sprint

**Status:** Decided

**Context:** The locked stack puts the AI behind a server-side proxy only,
and all keys stay server-side — the extension must never hold the
`ANTHROPIC_API_KEY`. We also had to decide the output shape for this first
AI sprint, given that the §2.5 JSON envelope (`say`/`annotations`/
`assessment`) has no consumer yet: there is no annotation layer, and
`assessment` only matters once it can be persisted, which it cannot be
before the learning tables exist. Candidates for output were full §2.5 JSON
now (rejected — a parser with no consumer, and `annotations` need page
extraction that is also out of scope), or plain text now with the JSON
envelope added when the voice/annotation sprint actually needs it.

**Decision:** A new `POST /api/ai/turn` route in `/web` holds the
`ANTHROPIC_API_KEY`, authenticates with the Sprint 04 bearer
(`clientFromBearer`, 401 if not signed in), assembles the §2.5 system prompt
plus the hardcoded profile, calls Claude (`claude-haiku-4-5-20251001`, the
PLAN §2.1 default) via `@anthropic-ai/sdk` server-side, and returns plain
text (`{ reply }`). The extension reaches it overlay → content script →
background worker → backend. The voice pipeline and the JSON output
envelope are deferred to the voice sprint.

**Rationale:**
- No provider key in the extension bundle — the route is the only place
  `ANTHROPIC_API_KEY` is read.
- Reuses the Sprint 04 bearer/RLS seam instead of standing up a second auth
  path for AI calls.
- Plain text avoids building a JSON parser with no consumer this sprint.
- One default model keeps the first AI turn simple; model routing/escalation
  is a later concern.
- The background worker stays the sole network-egress context, consistent
  with the Sprint 04 extension architecture.

**Consequences:**
- Enables: a working text tutor today, and a stable prompt-assembly + proxy
  seam that the voice sprint extends without reshaping.
- Requires: a server-only `ANTHROPIC_API_KEY` env var (never `NEXT_PUBLIC_`);
  the bundle-grep gate from Sprint 04 is extended to cover it.
- Forecloses: any direct extension→Anthropic call — `@anthropic-ai/sdk` is
  never imported in `/extension`.
