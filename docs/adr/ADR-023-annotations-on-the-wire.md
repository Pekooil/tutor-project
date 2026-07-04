## ADR-023: Annotations ride the existing wire additively and are never persisted

**Status:** Decided

**Context:** Sprint 11's envelope work (ADR-019) parses and structurally validates
`annotations` on every turn server-side, but `/api/ai/turn` returns `{ reply: envelope.say }`
only — the parsed annotations are computed and then discarded before they ever reach the
extension. Sprint 11's own hand-off note assumed "no prompt/route change needed — the field is
already produced," which is true of production but not of transport; that assumption was wrong on
the one point that matters for this sprint. Building the rendering layer (ADR-022) therefore
requires a decision on two things at once: how annotations physically reach the content script
across the existing route → api.ts → background → content relay, and whether anything about what
was drawn should be recorded anywhere.

**Decision:** Extend the response **additively**: `/api/ai/turn` returns
`{ reply, annotations? }`, with the field **omitted** (not `null`, not `[]`) whenever no
annotations are present — a no-annotation turn's response is byte-identical to Sprint 11's. The
optional field is threaded through the same seams every prior payload has used: `aiTurn()`'s
return shape, `AiReplyPayload`, and the `AI_STREAM` port's `done` message. No new route, no new
message type, no SSE. Annotations are **ephemeral**: nothing about them is persisted — no
migration, no new column, `session_interactions` keeps its Sprint 11 shape (it stores `say`, not
`annotations`). The equation-element registry that resolution depends on (ADR-022) is in-memory
content-script state, captured fresh on every overlay open and never serialized — it never crosses
the messaging boundary in either direction.

**Rationale:**
- The transport seams from route to content script have carried every prior addition
  additively (page context in Sprint 07, the envelope fields in Sprint 11) — reusing that
  discipline here costs nothing and introduces zero back-compat risk for turns without
  annotations.
- Drawing history has no consumer today; persisting it would be dead weight and would open a new
  privacy surface (what was highlighted reveals what was being studied, the same instinct that
  keeps page context and audio ephemeral under ADR-011/ADR-013) for no product benefit.
- DOM elements cannot serialize, so keeping the registry client-side and out of the wire format is
  forced by the platform, not just a preference — and it usefully keeps `PageContext`'s wire shape
  frozen exactly as Sprint 07 defined it.
- Field omission (rather than `null`/`[]`) keeps the common case — most turns annotate nothing —
  indistinguishable from pre-Sprint-12 traffic at the JSON level.

**Consequences:**
- Enables: annotations on both the text and voice turn paths with no protocol change and no new
  endpoint; a straightforward attach point for the later envelope-over-SSE streaming sprint.
- Requires: the route to treat "no annotations" as field-omission, not an empty/null value; the
  extension's mirrored types (`Annotation`/`AnnotationTarget`) to stay in sync with
  `/web/lib/ai/envelope.ts` by the same by-convention-mirror discipline as `PageEquation`.
- Forecloses: nothing durable — a future replay/persistence feature over drawing history remains
  a deliberate, later schema decision, not something this sprint backs into as a side effect;
  true SSE streaming of annotations remains the streaming sprint's to build.
