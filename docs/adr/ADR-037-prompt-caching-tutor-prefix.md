## ADR-037: Cache the tutor prefix — reorder the system prompt, keep Haiku

**Status:** Proposed (pending sign-off; does NOT reopen the locked stack)

**Context:** The `cost_analysis.py` model (built 2026-07-09 from the real
request format) found that a regular tutor turn sends **~8,550 input tokens**,
of which **~7,050 are turn-invariant** and resent **uncached on every turn**:
the static system prompt (`intro` + `PEDAGOGY` + `HARD RULES` + `OUTPUT FORMAT`
+ `BEFORE YOU ANSWER`, ~4,100 tok) and the forced-tool schema
(`submit_tutor_turn`, which embeds the 66-key `CONCEPT_KEYS` enum **twice**,
~2,930 tok). Across a ~12-call session that is **~96,000 input tokens** and
**~$0.108** on Haiku 4.5 — and ~85% of the input is the same bytes over and
over. `web/lib/ai/claude.ts` sets **no `cache_control` anywhere**, so none of it
is cached today.

Anthropic prompt caching is a **prefix match**: render order is `tools` →
`system` → `messages`, and any byte change in the prefix invalidates everything
after it. Tools render first, so they cache regardless. But the current
`buildSystemPrompt` (`web/lib/ai/system-prompt.ts:725`) renders the **volatile**
blocks — `STUDENT PROFILE` and `PAGE CONTEXT`, both injected per turn — in the
**middle** of the system prompt, *before* the large static `OUTPUT FORMAT` and
`HARD RULES` blocks. The `assessment.concept_key` key-subset (≤24 keys, varies
with profile + page) is interpolated *inside* the otherwise-static `OUTPUT
FORMAT` block. As written, the dynamic content sits ahead of the biggest static
content, so a naive `cache_control` marker would cache almost nothing.

**Decision:** Enable ephemeral prompt caching on the stable tutor prefix,
**on Haiku 4.5**, with **no provider or model change** (ADR-008 and the locked
"Anthropic only" stack stay intact). Two coupled changes:

1. **Reorder `buildSystemPrompt` into `stable-prefix → volatile-tail`.** The
   turn-invariant blocks (`intro`, `PEDAGOGY`, `HARD RULES`, `OUTPUT FORMAT`
   minus the key-subset, and the `BEFORE YOU ANSWER` checklist) form one
   contiguous prefix. The volatile blocks (`STUDENT PROFILE`, `PAGE CONTEXT`,
   and the `concept_key` key-subset list) move to the **end** of the system
   prompt, after a cache breakpoint. This is the standard "inject dynamic
   context late" caching discipline; the OPENING SCAN / SESSION START additive
   blocks stay where the format switch already appends them (their turn kinds
   are rare and can carry their own breakpoint or none).
2. **Place `cache_control: {type:"ephemeral"}` on the last stable block** (tools
   + stable system cache together, since tools render first) at **every** call
   site: `runTutorTurn`, `runTutorTurnEnvelopeStream`, `runTutorTurnStream`,
   `runSessionStartTool` (claude.ts), and the opening-scan `messages.create`
   (`web/app/api/ai/turn/route.ts`).

**Rationale:**
- Cache reads bill **~0.1×** input. The stable prefix (~7,050 tok) exceeds
  Haiku 4.5's **4,096-token minimum cacheable prefix**, so it will actually
  cache.
- Sessions are ~5 minutes with turns spread across student think-time; the
  default **5-minute TTL** stays warm across consecutive turns (bump to `1h` if
  measurement shows gaps).
- Modelled effect: session input cost **~$0.096 → ~$0.03** (~65-70% off input;
  output unchanged), i.e. total session **~$0.108 → ~$0.04 (~60% reduction)** —
  most of what a provider migration would yield, at a fraction of the risk and
  inside the locked stack. (Re-measure with `cost_analysis.py --api` once wired.)
- Reordering blocks is semantically neutral (the model reads the same content);
  it is a reorder, not a rewrite of the pedagogy.

**Consequences:**
- **Enables:** a large, low-risk input-cost cut with no behavioral-provider risk
  and no architecture reopening. Complements Sprint 16's cost guardrail (which
  caps *aggregate* spend); this lowers *per-turn* cost, so Sprint 16's
  `CLAUDE_TURN_CENTS` estimate should be revised down once caching is live.
- **Requires:** moving the `keySubset` render out of the `OUTPUT FORMAT` block to
  the volatile tail (today it is interpolated mid-block at system-prompt.ts:502);
  the block keeps a one-line pointer ("known keys are listed below") so the
  guidance still reads coherently.
- **Requires:** a silent-invalidator audit of the prefix (no `Date.now()`,
  request IDs, or non-deterministic JSON key order in `system`/`tools`), and a
  runtime assertion that `usage.cache_read_input_tokens > 0` on turn 2+.
- **Requires:** re-running the envelope/annotation/assessment compliance
  regression (the Sprint 14 Task 10 failure family) to confirm the reorder did
  not change model behavior.
- **Forecloses:** nothing — this is reversible (drop the breakpoints) and does
  not touch the provider seam.
