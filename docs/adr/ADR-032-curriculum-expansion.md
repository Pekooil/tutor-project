## ADR-032: Curriculum expansion to launch scale — six strands, in-concept aliases, the frozen eight, and the prompt's bounded key budget

**Status:** Decided

**Context:** Through Sprint 14 the knowledge graph is the Sprint 09 stopgap:
eight `algebra.*` concepts, one strand, seeded so `KNOWN_CONCEPT_KEYS` and the
turn prompt's key vocabulary had something real to point at while the adaptive
engine (Sprints 09–14) was built. That stopgap was always scoped as a
placeholder ("a real curriculum pass is its own deliverable" — ADR-016's
"what the next sprint needs to know"), and the Sprint 11 audit separately
flagged that `topic.ts` maintains its own hand-written alias table alongside
the concept graph, so adding a concept without a matching alias entry silently
exempts it from topic bias with no build-time signal. Beta cannot launch with
either gap: a student opening Calyxa on a derivative or a triangle-congruence
problem needs the tutor to have a real concept to assess against, and every
concept added from here on needs its aliases to ship in the same place, not a
parallel table someone can forget.

This ADR also settles what the wider graph does to the turn prompt. Today's
prompt affords listing every known key (eight is cheap); enumerating ~70 keys
on every turn is not, and would also work against Sprint 14's conciseness win.

**Decision:**
1. **Six strands, ~70 concepts, per-strand modules.** The graph grows from one
   strand to six: `algebra1`, `geometry`, `algebra2`, `trig-precalc`,
   `calculus`, `prob-stats` — one file per strand under
   `/packages/curriculum/src/concepts/`, concatenated by `concepts/index.ts`
   into the exported `CONCEPTS`/`CONCEPT_KEYS`. Coverage is all core
   high-school math plus AP/intro-college calculus (limits through the
   Fundamental Theorem and its basic applications) — math only, per V1 scope;
   no non-math subject enters the graph. The full inventory is this ADR's
   appendix below — Task 2 transcribes it, it does not invent it.
2. **The eight Sprint 13 keys are frozen — byte-identical.** `key`, `title`,
   `strand`, `prerequisites`, and `difficultyPrior` for the existing eight do
   not change, because live `knowledge_nodes` / `misconceptions` /
   `reinforcement_schedule` rows in dev data reference them by key. A test
   pins all eight before any addition lands. Everything else is additive; new
   prerequisite edges may point at old keys; no migration exists anywhere —
   concept keys are strings in the DB by design (ADR-009/ADR-014), which is
   exactly the seam that lets the graph grow with no schema work.
3. **Aliases move into the concept — the audit's de-drift.** `Concept` gains
   `aliases: readonly string[]` (the student-language phrases topic detection
   should match — e.g. "slope", "SOH CAH TOA", "chain rule", "u-sub", "log
   rules", "unit circle"). A curriculum test fails the build if any concept
   has fewer than two aliases or an empty title. `topic.ts`'s hand-maintained
   alias table is deleted; the detection table is derived from the curriculum
   at import time. This closes the drift class structurally: a concept cannot
   ship without also being reachable by topic detection.
4. **`KNOWN_CONCEPT_KEYS` becomes a re-export of `CONCEPT_KEYS`.** One source
   of truth for the full key list, consumed by `envelope.ts`'s parse-time
   validation (which stays a full-list check — the graph, not the prompt,
   is authoritative for "is this a real key").
5. **The prompt's key vocabulary becomes a bounded relevant subset, capped
   ~24: profile-surfaced nodes ∪ topic-detected keys ∪ due keys ∪ their strand
   neighbors**, in stable/deterministic order. This is a prompt-assembly rule
   only — `envelope.ts` keeps validating against the full ~70-key list, so an
   assessed concept outside the injected subset is kept, not dropped. The
   graph can grow indefinitely without the prompt growing with it 1:1.
6. **Prerequisite edges cross strands where the math actually does**
   (right-triangle trig ← similarity; derivative-as-limit ← limits &
   continuity ← the precalc limits intro; u-substitution ← chain rule +
   antiderivatives), and difficulty priors are set per strand band, with the
   existing eight keeping their current priors unchanged.

**Rationale:**
- A per-strand module layout keeps a ~70-concept graph reviewable (one strand
  per file, checked against this ADR's own inventory-as-checklist appendix)
  instead of one growing monolith.
- Freezing the eight by test, not convention, is the only way "no existing
  key is renamed or removed" survives a large mechanical content pass without
  a careless edit silently orphaning production history.
- Putting aliases on the concept itself (rather than fixing the hand-map
  once) closes the audit's drift class for every future concept too, not just
  the ~70 landing this sprint.
- A bounded, capped prompt subset with full-list parse validation gets the
  best of both: the turn prompt stays cheap and stable in size as the graph
  grows, while a correct assessment is never rejected just because its key
  wasn't in the injected subset.

**Consequences:**
- Enables: a tutor that is not blind to derivatives, triangle congruence, or
  logarithms at beta launch; one source of truth for concept keys, titles,
  and aliases with no parallel table to keep in sync; a graph that can keep
  growing as a data-only edit.
- Requires: Task 2's invariant tests (unique keys, valid/acyclic prerequisite
  edges, nonempty title, ≥2 aliases, prior in range, the eight frozen
  byte-identical) gating every future curriculum change; Task 3's `topic.ts`/
  `types.ts` edits to consume the new `aliases` field and re-exported
  `CONCEPT_KEYS`; Task 4's prompt-assembly change to the bounded-subset rule.
- Forecloses: a hand-maintained alias table anywhere in the codebase; adding
  a concept without an alias (the build fails); non-math strands entering
  this graph before Phase 3 (PLAN's deferred table stands).

---

### Appendix — the concept inventory (Task 2's checklist)

The existing eight (frozen, `algebra1` strand file, unchanged key/title/prior):
1. `algebra.linear-equations.one-variable` — One-variable linear equations
2. `algebra.linear-equations.two-variable` — Two-variable linear equations
3. `algebra.exponents.product-rule` — The product rule for exponents
4. `algebra.exponents.power-rule` — The power rule for exponents
5. `algebra.polynomials.expanding` — Expanding polynomials
6. `algebra.quadratics.factoring` — Factoring quadratics
7. `algebra.quadratics.formula` — The quadratic formula
8. `algebra.inequalities.linear` — Linear inequalities

**algebra1.ts additions:** systems of linear equations; radicals & rational
exponents; absolute value; function notation & graphs; ratios/proportions/
percent.

**geometry.ts (new strand):** angles & parallel lines; triangle congruence;
similarity; right-triangle trig (SOH-CAH-TOA); circles (arcs/angles/area);
area & volume; coordinate geometry & transformations.

**algebra2.ts (new strand):** polynomial division & factor theorem; rational
expressions & equations; exponential functions; logarithms & properties;
sequences & series; complex numbers; systems (nonlinear).

**trig-precalc.ts (new strand):** unit circle & radian measure; trig graphs;
trig identities; trig equations; inverse trig; vectors; limits (intuitive
intro — the precalc/calc bridge).

**calculus.ts (new strand):** limits & continuity (formal); derivative as a
limit; differentiation rules (power/product/quotient); chain rule; implicit
differentiation; applications (related rates, optimization, curve sketching);
antiderivatives & indefinite integrals; definite integrals & FTC;
u-substitution; applications of integration (area between curves, volumes);
intro differential equations.

**prob-stats.ts (new strand):** descriptive statistics; probability rules &
counting; conditional probability; random variables & expected value; normal
distribution basics.

Target: ≈70 concepts across the six strand files above. Exact keys, exact
alias wording, and exact prerequisite edges are Task 2's transcription work,
not this ADR's — this appendix is the checklist Task 2's acceptance gate
checks itself against.
