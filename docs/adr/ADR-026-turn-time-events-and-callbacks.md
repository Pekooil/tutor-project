## ADR-026: Turn-time event pings, cross-session callbacks, recap depth — and the confidence-mismatch deferral

**Status:** Decided (the confidence-mismatch proxy question within it: deferred, options recorded)

**Context:** The Sprint 13 scope extension (2026-07-05, after ADR-024/025 landed) added four
features on top of the three profile-visibility surfaces: real-time event pings fired
immediately after an answer, explicit cross-session callbacks in the tutor's speech and
tags, a recent-trend rollup + FSRS forward look in the session-end recap, and a
confidence-vs-correctness mismatch detector. The pings have a structural timing problem:
the FSRS apply for a turn runs **off the critical path** (`after()`, ADR-019), so at the
moment the turn response — the only delivery vehicle that is "immediately after the
answer" — is sent, the write it would celebrate has not happened yet. The callbacks have a
structural trust problem: "the tutor remembers my sessions" is the highest-trust claim in
the product, and a fabricated memory is strictly worse than none. And the mismatch feature
has an unresolved measurement problem: nothing captured today is an uncontested proxy for
student confidence.

**Decision:**
1. **Pings are computed by the model's math, never by the LLM.** No envelope field, no
   prompt work, no grounding gate. The per-interaction core of `apply.ts` — read the
   concept's `knowledge_nodes` row + active misconception streaks, assemble the
   observation, call the pure `updateKnowledgeNode` — is extracted into a shared helper
   (`computeNodeUpdate`); `applyInteraction` keeps calling it (write path byte-identical,
   pinned by tests), and a new `events.ts` calls the same helper **read-only, at turn
   time**, to derive prospectively what the apply *will* write. Same inputs → same pure
   function → same result: the prospective outcome cannot drift from the eventual write by
   construction (turns are serialized by the background worker, and the `claimed_at` lease
   arbitrates the one concurrent-reconcile edge). A ping additionally rides the response
   **only when the apply was actually scheduled** — `persistInteraction` now reports
   whether the insert + `after()` hookup happened, so a no-session/foreign-session/
   failed-insert turn suppresses its pings rather than celebrating a write that will never
   land.
2. **Exactly two event kinds, and the silences are a contract, not an accident:**
   - `mastery-up` ⇔ the prospective update crosses a **named upward `MasteryState`
     boundary** (`weak→learning`, `forgotten→learning`, `learning→mastered`,
     `weak/forgotten→mastered`) — `deriveState`'s own thresholds, no new magic number.
   - `misconception-resolved` ⇔ this turn's sound-correct completes an active
     misconception's `RESOLUTION_STREAK` (3) — the apply's own hard rule, checked
     prospectively.
   - Explicitly **silent**: routine in-state mastery ticks; `confidence_band` upticks (the
     band rises mechanically with observation count — pinging it would fire on a schedule,
     not on merit); `unseen→*` transitions (first contact is not an improvement); and
     **newly detected misconceptions** — persisted quietly exactly as before, surfacing
     only in the recap's `misconceptionsAdded`. Celebrating progress in the moment helps;
     interrupting a struggling student with "new gap detected" mid-struggle does the
     opposite. This asymmetry is the recorded pedagogical contract.
   - Ping copy is **qualitative and server-rendered** ("Leveled up: Factoring quadratics",
     "Gap closed: sign errors") — never a number, so even a theoretical
     prospective/actual divergence can never display a wrong figure. Client-side: ≤2 pings
     per turn, at most one `mastery-up` per concept per session.
3. **Cross-session callbacks come from real history only.** `loadProfile` gains an
   additive `priorWork` leg: a ≤3-entry digest of the most recent **prior ended** sessions
   touching currently-relevant concepts — `{ conceptKey, sessionsAgo, daysAgo,
   outcomeLine }`, where `outcomeLine` is derived **mechanically** from that session's
   recorded outcomes (a bounded set of phrasings — "went cleanly", "struggled early,
   finished strong" — never free text, so the digest can state what the rows say and
   nothing more). It renders as a PRIOR SESSIONS prompt block; the prompt instructs at
   most **one** callback per conversation, only when genuinely connected, woven into `say`
   with the matching `callback` tag. The ADR-024 grounding gate extends to the `callback`
   kind: a callback tag must reference a listed `priorWork` entry or it is dropped — the
   model cannot surface a session the digest doesn't contain. Cold start / first sessions
   get no block, no instruction, no callbacks.
4. **Recap depth:** the recap gains a **trend rollup** — per touched concept, a
   per-session outcome quality across the last ≈5 ended sessions, emitting a trend line
   **only** on ≥3 consecutive strictly-improving sessions including this one (ambiguity is
   silence; most recaps carrying no trend line is the designed outcome) — and the
   **forward look**: `reinforcement_schedule.due_at` for the touched concepts, reframed as
   student-facing ("comes back Thursday", humanized client-side). The dates shown ARE the
   FSRS schedule, not editorial.
5. **The confidence-vs-correctness mismatch feature is DEFERRED** pending a design
   decision Darcy owns: what signal reliably proxies "confidence," and where it is
   captured. Candidates recorded:
   - **Zero new capture:** `response_latency_ms` (client-measured think-time, persisted
     per interaction since Sprint 11) and `assessment.self_confidence` (the tutor's
     *inference* of the student's apparent certainty). A latency×outcome or
     self_confidence×outcome rule could ship immediately — but latency confounds (reading
     time, page switching) and a model-inferred confidence is a judgement, not a
     measurement.
   - **New capture required:** answer revision (text-input edits before send), hesitation
     patterns, voice prosody — each needs client-side capture, a wire change, and a
     persistence/privacy decision (keystroke-adjacent telemetry is a different consent
     posture than a latency number).
   - **Also open:** where a detected mismatch surfaces (a third ping kind, a recap line,
     tutor-voiced only) and whether "you seemed unsure" reads as insight or surveillance
     to a teenage student.
   No implementation ships without the proxy decision; if undecided by sprint close, this
   section rolls forward as the next sprint's planning input.

**Rationale:**
- Deriving pings from the LLM (an envelope field) would make the product's most factual
  claim — "your mastery state just improved" — hostage to model compliance and grounding
  heuristics; deriving them from the shared FSRS core makes them facts about the write,
  with drift structurally impossible rather than prompt-discouraged.
- The named-boundary threshold reuses the model's own definition of "meaningful": crossing
  a `MasteryState` boundary takes multiple good observations by construction, which is the
  anti-ping-fatigue property (if live use still feels chatty, the fix is a constant in one
  file, not an architecture).
- The mechanical `outcomeLine` bound means even a *grounded* callback cannot embellish —
  the failure mode that matters ("a memory that never happened") is closed at the data
  layer, not the prompt layer.
- The trend rule's strictness (≥3 consecutive, strictly improving, ending at this session)
  makes a trend line earned and rare; a 2-data-point "streak" reads as flattery and is the
  thing the rule exists to prevent.
- Deferring the mismatch feature keeps a genuinely open measurement question from being
  answered implicitly by whatever was easiest to ship.

**Consequences:**
- Enables: live celebration of exactly the model's own milestones; honest cross-session
  memory; a recap that can say "3rd session in a row improving" only when it is true.
- Requires: the `apply.ts` extraction to be behaviour-preserving (pinned by the Task 9
  equivalence tests — prospective outcome == actual write for identical fixtures); the
  prospective compute to stay on the turn's synchronous leg within the Sprint 11 audit's
  budget (two parallel indexed reads for one concept; any failure degrades to no pings,
  never a failed turn).
- Forecloses: nothing durable — a persisted event log ("recent wins" feed), a third ping
  kind for a decided confidence-mismatch, and richer trend analytics all remain additive
  decisions for the dashboard sprint or later, each with its own migration if needed.
