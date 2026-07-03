## ADR-021: Turn-time topic detection biases the profile read; read-time retrievability and due items are surfaced into the prompt

**Status:** Decided

**Context:** `/docs/PLAN.md` §2.3 query 1 — the profile read that drives every turn's STUDENT
PROFILE block — takes a set of page-relevant concept keys as `$2` and orders the profile so those
concepts surface before the merely-weakest ones (`ORDER BY (kn.concept_key = ANY($2)) DESC,
kn.mastery ASC`). ADR-014 shipped query 1 without that join, deferring "no page-relevant join /
topic bias" outright, so `loadProfile` has only ever returned the globally weakest nodes regardless
of what the student is looking at. Separately, Sprint 09 added read-time retrievability decay
(`profile-read.ts` already discounts `mastery` by `retrievability(stability, daysSince)` on every
read), but that decay is invisible to the tutor — the prompt renders a single decayed mastery
number with no signal that a concept is fading or newly due. This sprint's ADR-020 adds the
reinforcement queue that makes "due" a first-class, queryable fact; pairing it with the
still-deferred page-relevant bias closes both gaps from the same read-path change.

**Decision:** Add `detectTopicKeys(pageContext, recentMessages)` — a lightweight, deterministic
keyword/alias match against `@calyxa/curriculum`'s `CONCEPT_KEYS`, run **at turn time** over the
page context already extracted by the content script (ADR-012) and the last few transcript
messages. It makes no model call and adds no persistence: it is a pure function of data the turn
already has in hand. `loadProfile` takes the detected `topicKeys` and implements PLAN §2.3 query
1's page-relevant ordering — those concepts sort first, ahead of weakest-overall — and also runs
query 2 (ADR-020) to attach a `dueForReview` set. Both signals render into the existing STUDENT
PROFILE prompt block: page-relevant concepts appear ordered first as before, and a new line
surfaces "fading / due for review" concepts as a natural opening the tutor may use. No new
page-tracking table, no `page_url_hash`, and no persisted topic/page history are added — topic
detection is recomputed fresh on every turn from already-extracted, read-only page context, in
keeping with the locked DOM policy and ADR-011/012/013's ephemerality guarantees.

**Rationale:**
- The page context this needs is already extracted and already flows into the prompt (ADR-012);
  inferring topic from it at turn time adds a query bias, not a new capture surface or a new
  privacy question — deferring it further to "the privacy sprint" was never actually blocked by
  data collection, only by the query change.
- Biasing an existing read query is strictly additive to `LearningProfile` — `masteryNodes` and
  `activeMisconceptions` are unchanged in shape and in the weakest-first fallback behavior when no
  topic is detected or nothing is due, so every prior consumer of the profile keeps working.
- Surfacing decay and due-ness into the prompt turns a calculation the model already runs
  (retrievability discount) into something the tutor can act on conversationally, rather than a
  silent number that only ever shows up as a slightly lower mastery value.
- A deterministic, in-memory keyword match has no failure mode worse than returning `[]`, which
  reproduces exactly today's weakest-first behavior — there is no new way for this to make the
  profile read fail or degrade the turn.

**Consequences:**
- Enables: a profile the tutor reads as "what's on screen and what's fading," not just "what's
  weakest globally" — directly supporting the sprint's calibration-across-a-session acceptance bar.
- Requires: `reinforcement_schedule` to exist for the due-item half of the signal (ADR-020);
  the turn route to call `detectTopicKeys` and pass its result into `loadProfile`; any future
  addition to `CONCEPT_KEYS` to remain matchable by the same keyword/alias approach without a
  parallel list to maintain.
- Forecloses: nothing — persistent per-page topic history, `page_url_hash`, and any
  cross-session "you were working on X on this page" feature remain explicitly the privacy
  sprint's decision to make, not pre-empted by this turn-time, non-persisted approach.
