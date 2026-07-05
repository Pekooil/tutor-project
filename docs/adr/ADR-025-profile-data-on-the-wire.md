## ADR-025: Profile data on the wire — one new read-only route, everything else additive

**Status:** Decided

**Context:** ADR-024 decided what the three profile-visibility surfaces are; this ADR
decides how each one physically reaches the overlay. The profile today is injected into
the prompt only — nothing exposes it as a fetchable resource. The envelope
(`/web/lib/ai/envelope.ts`) has no field for a profile reference alongside `say`,
`annotations`, and `assessment`. `/api/session/end` already computes a response
(`{ sessionId, endedAt, interactionCount }`), but the extension's `api.endSession()`
discards it entirely (`Promise<void>`) — so even though the reconcile that would ground a
recap already runs synchronously in that handler, its result never leaves the background
worker. And session lifecycle itself is popup-only today (`START_SESSION`/`END_SESSION`
messages originate from `popup/main.tsx`): the overlay panel — where the recap is
specified to render — has no way to end a session at all, which would make the recap
surface unreachable from the one place it's designed to show up.

**Decision:** Four wire changes, all following the seam discipline ADR-023 established:
1. **`GET /api/profile/overview`** — a new, read-only, bearer-authenticated route that
   serializes `loadProfile`'s output with titles resolved. No gating, no model call, no
   write; a genuinely new endpoint because this is the first surface that needs the profile
   independent of a turn.
2. **`profile_tags` rides the envelope additively** — parsed and grounded per ADR-024,
   then threaded through the turn route's response, `AiReplyPayload`, and the `AI_STREAM`
   `done` message, omitted (never `null`/`[]`) whenever nothing survives grounding — the
   exact `{ reply, annotations? }` pattern ADR-023 set, extended with one more optional
   field.
3. **The recap rides `/api/session/end`'s existing response additively** and is
   **broadcast** to all tabs as a new `SESSION_ENDED` message (mirroring the existing
   `SESSION_STATE` broadcast pattern used for sign-in/sign-out), so that whichever surface
   — popup or overlay — triggers the end, every open tab with a mounted overlay can render
   the recap it was designed for.
4. **The overlay gains an End-session control that sends the existing `END_SESSION`
   message** through content → background, reusing the popup's exact handler, RPC call,
   and storage-clear rather than adding a second code path with its own free-tier
   accounting.

Mastery deltas shown in the recap are computed **client-side**, as `recap value − the
overview snapshot already held in overlay state from panel open` — no baseline row is ever
written or fetched from the server; a session where the student never opened the overview
simply shows absolute values with no delta arrows.

**Rationale:**
- The additive-field-through-the-existing-relay pattern (route → `api.ts` → background →
  content) has now proven itself twice (page context in Sprint 07, the envelope's own
  fields in Sprints 11–12); reusing it for `profile_tags` costs nothing and introduces no
  back-compat risk for turns that carry none.
- A dedicated read-only overview endpoint is simpler and safer than smuggling profile data
  onto `/api/session/start`'s response, which the popup consumes and the overlay does not
  see at all; a GET with no side effects is also trivially cacheable or retryable if a
  later sprint wants that, with no protocol renegotiation.
- Broadcasting the recap mirrors `SESSION_STATE`'s already-proven tab fan-out, so "does the
  overlay show the recap" doesn't depend on which UI surface happened to end the session —
  a real usability requirement once the overlay itself can end sessions too.
- Reusing `END_SESSION` rather than inventing an overlay-specific end path keeps exactly one
  code path responsible for free-tier session accounting; a parallel path would risk the
  two silently drifting (e.g. one incrementing usage and the other not).
- Client-side deltas avoid inventing a server-side "session baseline" concept and the
  persistence question that would come with it — the overview the student already saw is
  the only baseline that needs to exist, and it already lives in memory where it was
  fetched.

**Consequences:**
- Enables: all three surfaces reachable end-to-end with zero breaking changes to any
  existing message or response shape; a recap visible regardless of which surface ends the
  session.
- Requires: the background worker to actually capture (not discard) `/api/session/end`'s
  response body; the overview fetch to degrade to "render nothing" on failure rather than
  blocking the first question; the extension's mirrored types (`ProfileTag`,
  `ProfileOverview`, `SessionRecap`) to stay in sync with their web-side sources by the same
  by-convention-mirror discipline as `Annotation`/`PageEquation`.
- Forecloses: nothing durable — a persisted session-history/recap feature, or a
  server-computed baseline, remain deliberate later decisions the dashboard sprint can make
  with a real migration, not something this sprint backs into by accident.
