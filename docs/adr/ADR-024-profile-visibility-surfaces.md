## ADR-024: Three profile-visibility surfaces — display-ephemeral, grounded, server-rendered

**Status:** Decided

**Context:** By Sprint 12 the adaptive loop closes entirely out of view: every turn is
assessed (ADR-019), FSRS updates per interaction and schedules reinforcement (ADR-019/020),
the profile read is biased to what's on screen and fading (ADR-021), and the tutor even
draws on the page (ADR-022/023) — but nothing shows the student that any of this is
happening. The product's core claim (a tutor that adapts to you) has no in-product proof.
The Sprint 11 audit left two relevant openings unresolved: `@calyxa/curriculum`'s `Concept`
has no human-readable display name (gap #1, explicitly deferred to "the dashboard sprint's
first task"), and whether `assessment.confidence`/`mode` should be persisted per turn was
left as "decide in Sprint 12 planning, not silently" — neither sprint decided it. A shape
decision was needed for three surfaces at once (a pre-question overview, in-session
references to the profile, a post-session recap), because building them independently risks
three different answers to the same underlying questions: where profile data becomes
display data, how far the tutor is allowed to claim to "remember" about the student, and
whether any of it needs a new place to live.

**Decision:** Ship three surfaces on the existing Sprint 10 overlay, all **display-
ephemeral** — nothing persisted, no migration:
1. **Pre-question overview** — a serialized read of the same `loadProfile` the turn prompt
   already uses, rendered before the student's first question in a session.
2. **In-session profile tags** — a new envelope field (`profile_tags`) that lets the tutor
   mark specific turns with a structured reference to the profile (`reviewing`,
   `known-gap`, `due-review`, `strength`), rendered as small inline tags on the transcript.
3. **Post-session recap** — a summary of what the session actually changed, read from the
   tables `/api/session/end`'s already-existing reconcile just finished updating.

Display fields are **server-rendered**: every concept key is resolved to a human title
before it crosses the wire, so the extension never imports curriculum data and never
re-derives display text client-side. Tags are held to a stricter bar than plain display,
because a tag is a claim about what the tutor "knows" about the student: each one is
parsed against a fixed schema (drop malformed entries individually, the `parseAnnotation`
discipline), then **grounded** at the route against the exact `LearningProfile` that turn
actually injected into the prompt (a `known-gap` tag must reference a misconception the
profile listed; `reviewing`/`strength` must reference a listed mastery node; `due-review`
must reference a listed due item) — an ungrounded tag is dropped, never rendered, and a
client-side cap (≤2 per turn) is enforced as defense in depth. The audit's deferred
question is decided here: **`mode` and the tutor's own grading `confidence` are not
persisted this sprint** — the tag system is the turn-time surfacing of that signal; a
browsable history of it is left as an explicit, later, additive decision.

**Rationale:**
- A mis-anchored annotation (ADR-022) is worse than none because it actively misleads;
  the same logic applies to profile tags — a fabricated "known gap" the student doesn't
  have is worse for trust than showing nothing, so grounding against the actual injected
  profile is made a hard server-side gate, not a prompt-only ask.
- The route already holds the `LearningProfile` it rendered into that turn's prompt, so
  grounding is a lookup against data already in hand, not a new read or a new round-trip.
- Reading the recap from the post-reconcile tables — after `/api/session/end`'s existing
  awaited `reconcileSession` — makes it structurally impossible for the recap to disagree
  with the real mastery write; there is no second source of truth for it to drift from.
- Resolving display text server-side keeps the curriculum package out of the extension
  bundle and prevents a second, driftable copy of concept names from ever existing on the
  client, mirroring why annotation resolution stays server/content-script-side rather than
  duplicated.
- None of the three surfaces needs a new fact remembered beyond the moment it's shown —
  the overview is a fresh read on each panel open, tags are turn output rendered and
  discarded like `say` itself, and the recap is read once at session end — so treating all
  three as ephemeral follows the same instinct that keeps page context and audio ephemeral
  (ADR-011/012/013) rather than opening a new class of stored data for no addressed need.

**Consequences:**
- Enables: the first in-product, observable proof that the adaptive engine is doing
  anything; the Sprint 14 dashboard inherits working display shapes and curriculum titles
  rather than starting from a raw concept-key surface.
- Requires: `@calyxa/curriculum` to carry titles (this sprint's Task 2); the turn route to
  retain and reuse the profile it already loaded for grounding; the session-end route to
  compute the recap only after reconcile has run.
- Forecloses: persisting per-turn `mode`/tutor `confidence` **this sprint** — the question
  is answered "not now, not silently," and stays explicitly reopenable for whichever future
  sprint wants a session timeline; a tag or overview item ever referencing something outside
  the profile actually injected that turn, which the grounding gate makes structurally
  impossible rather than merely discouraged.
