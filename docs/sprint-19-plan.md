# Sprint 19 — LLM input-cost reduction (prompt caching + payload trims)

> **Proposed sprint. Renumber to fit your roadmap.** This is the *recommended*
> cost lever from the 2026-07-09 cost analysis: it captures ~60% of session cost
> **on Haiku 4.5, inside the locked stack** (ADR-008 untouched), at ~1 day of
> work. It is the low-risk alternative to a provider migration (see the
> candidate `docs/sprint-24-plan.md` + ADR-038 for that path). The two are not
> mutually exclusive, but **do this one first and measure** — a migration only
> earns its risk if caching + Sprint 16's guardrail still miss the budget.

## Goal
Cut per-turn Claude **input** cost by ~65% (and total session cost ~60%) by
**caching the turn-invariant tutor prefix** and trimming duplicated payload —
with **no model change, no provider change, and no envelope/pedagogy change**.
By the end:

1. **The stable tutor prefix is cached.** The system prompt is reordered into a
   contiguous `stable-prefix → volatile-tail`, an ephemeral `cache_control`
   breakpoint sits on the last stable block, and every tutor call site reads the
   cached prefix (`cache_read_input_tokens > 0`) on turn 2+.
2. **The duplicated 66-key enum is de-duplicated.** `CONCEPT_KEYS` is embedded
   twice in `submit_tutor_turn` (~2,930 tool tokens); it is factored so the list
   serializes once.
3. **History is windowed to the PLAN's 6-8 turns**, not the current 40-message
   safety cap, so the volatile tail stays small.
4. **The win is measured, not assumed** — `cost_analysis.py --api` is re-run
   against the new request shape and the numbers are recorded.

```
BEFORE (per regular turn, ~8,550 input tok, all full-price every turn)
  [ tools 2,930 ][ system: intro+PEDAGOGY | PROFILE* | PAGE* | HARD RULES | OUTPUT FORMAT(+keys*) | CHECK ][ history ]
                                    ^dynamic blocks sit BEFORE the big static ones → nothing caches

AFTER (stable prefix cached ~0.1x on turn 2+)
  [ tools 2,930 | system: intro+PEDAGOGY+HARD RULES+OUTPUT FORMAT+CHECK ]  <cache breakpoint>
  [ system tail: PROFILE* | PAGE* | known-keys* ][ history* ]
    \___________________ cached, ~0.1x _______________________/  \____ full price (small) ____/
  (* = volatile / per-turn)
```

## Context
The cost model built from the real request format (`cost_analysis.py`, repo
root) shows a regular turn is **~8,550 input tok / ~218 output tok**, and that
**~7,050 input tok are identical every turn** (system ~4,100 + forced-tool
schema ~2,930). `web/lib/ai/claude.ts` sets **no `cache_control`**, so this
block is billed at full price on all ~10 regular turns per session. Caching it
(reads ~0.1×) is the single largest, lowest-risk input-cost lever available, and
it stays entirely within the "Anthropic only" locked stack.

The one non-trivial part: caching is a **prefix match**, and today
`buildSystemPrompt` renders the volatile `STUDENT PROFILE` / `PAGE CONTEXT`
blocks (and the per-turn `concept_key` subset) *before* the large static
`OUTPUT FORMAT` block. So the sprint's real work is a **system-prompt reorder**
(stable content first, volatile content last) plus breakpoint placement — see
ADR-037.

### Decisions locked for this sprint (ADR-037)
1. **Stay on Haiku 4.5; no provider/model change.** This sprint does not reopen
   ADR-008 or the locked stack. (That is ADR-038 / Sprint 24's job, if ever.)
2. **Reorder, don't rewrite.** Block *order* changes so the stable prefix is
   contiguous; block *content* (pedagogy, envelope contract, guidance) is
   byte-identical. This is what keeps the behavioral risk near zero.
3. **One breakpoint, on the last stable system block.** Tools render first and
   cache with it. Max 4 breakpoints exist; one is enough here.
4. **Measure before/after.** Cache effectiveness is proven by
   `cache_read_input_tokens`, not assumed; the dollar delta is recorded from
   `cost_analysis.py --api`, not from this doc's estimate.

### Reconciliation with Sprint 16 (read before Task 1)
Sprint 16's cost guardrail caps **aggregate daily spend**; this sprint lowers
**per-turn cost**. They compose: after caching lands, Sprint 16's
`CLAUDE_TURN_CENTS` estimate constant (`web/lib/tier/cost-model.ts`) is revised
down to the cached rate so the guard stays budget-accurate. Sprint 16 explicitly
put `web/lib/ai/*` out of scope precisely so a prompt/model change like this one
lives in its own sprint — this is that sprint.

## Execution model
A **single code session**, worked in order (1 → 5). ADR-037 fixes the reorder +
breakpoint decision (Task 1); the reorder (Task 2) must land before the
breakpoints reference the new stable block (Task 3); the schema de-dupe + history
window (Task 4) are independent trims; verification + regression (Task 5) gate
acceptance. No handoff.

## Files in scope

### Task 1 (ADR + pointers)
```
/docs/adr/ADR-037-prompt-caching-tutor-prefix.md ← new (written)
/CLAUDE.md, /docs/CLAUDE.md                       ← edit one line: Current sprint → Sprint 19
/docs/architecture.md                             ← edit: tutor prefix is cached (stable/volatile split)
/docs/sprint-19-plan.md                           ← this file
```

### Task 2 (system-prompt reorder — the load-bearing change)
```
/web/lib/ai/system-prompt.ts ← edit — split buildSystemPrompt output into a
  STABLE prefix (intro, PEDAGOGY, HARD RULES, OUTPUT FORMAT sans key-subset,
  BEFORE YOU ANSWER) and a VOLATILE tail (STUDENT PROFILE, PAGE CONTEXT,
  known-keys list). Move the concept-key subset render out of buildEnvelopeOutputFormat
  into the tail; leave a one-line "known keys are listed below" pointer in OUTPUT
  FORMAT. Expose the split so claude.ts can place a breakpoint on the last stable
  block (e.g. return { stable: string, volatile: string } or an ordered block list).
  OPENING SCAN / SESSION START blocks are appended after the tail as today.
```

### Task 3 (cache_control at every tutor call site)
```
/web/lib/ai/claude.ts          ← edit — pass system as content blocks with
  cache_control:{type:'ephemeral'} on the last STABLE block, for runTutorTurn,
  runTutorTurnEnvelopeStream, runTutorTurnStream, runSessionStartTool. Tools cache
  with the prefix (rendered first) — no extra marker needed, but keep the tool array
  serialization deterministic. Default 5-min TTL; note the 1h option.
/web/app/api/ai/turn/route.ts  ← edit — same breakpoint on the opening-scan
  messages.create system.
```

### Task 4 (payload trims — secondary levers)
```
/web/lib/ai/claude.ts          ← edit — de-duplicate the CONCEPT_KEYS enum in
  ENVELOPE_TOOL: reference it once via a shared const already imported (it is), and
  if the JSON size is the concern, prefer emitting the enum once. (Do NOT prune the
  VALID key set — envelope.ts still validates against the full 66; this is about not
  paying for the same 66-key list twice in the schema wire form.)
/web/lib/ai/turn-request.ts    ← edit (optional) — tighten the resent history window
  toward PLAN §2.5's 6-8 turns (below MAX_MESSAGES=40) so the volatile tail is small;
  MAX_MESSAGES stays as the hard safety cap.
```

### Task 5 (verify + regression — gate)
```
/web/tests/prompt-cache.test.ts ← new — assert the stable prefix is byte-stable
  across two turns with different profile/page (the cache-key invariant); assert no
  Date.now()/uuid/non-deterministic ordering leaks into system/tools.
/web/tests/envelope-compliance.test.ts ← new or edit — the Sprint 14 Task 10 family:
  assessment present on non-opening turns, annotations when say names page content,
  chips/signals shape — proving the REORDER did not change behavior.
  (Manual: a live turn shows usage.cache_read_input_tokens > 0 on turn 2+.)
```

### Explicitly out of scope
```
Any provider/model change (that is ADR-038 / Sprint 24, gated separately)
web/lib/ai/envelope.ts semantics (parsing/validation unchanged)
The learning read/write path, voice pipeline, Sprint 16's guardrail internals
```

## Task acceptance gates
- **Task 2:** `buildSystemPrompt` output for the same turn is unchanged *in
  content* (a snapshot diff shows only block ORDER moved + the key-subset relocated
  to the tail); typecheck passes.
- **Task 3:** a live regular turn returns `cache_creation_input_tokens > 0` on
  turn 1 and `cache_read_input_tokens ≈ prefix size` on turn 2; a forced profile
  change between turns does NOT drop the read (proves the volatile tail is after the
  breakpoint).
- **Task 4:** `submit_tutor_turn` serialized schema is smaller; envelope.ts still
  validates a `concept_key` from anywhere in the full 66-key set.
- **Task 5:** compliance suite green; `cost_analysis.py --api` re-run shows the new
  per-session input cost recorded in the sprint summary.

## Acceptance criteria (full checklist)
- [ ] ADR-037 written; pointers + architecture.md updated; locked stack untouched
- [ ] System prompt reordered into stable-prefix → volatile-tail; key-subset moved to tail
- [ ] `cache_control` on the last stable block at all tutor call sites incl. opening scan
- [ ] `cache_read_input_tokens > 0` on turn 2+ (live), and a profile change doesn't bust it
- [ ] 66-key enum de-duplicated in the tool schema; full 66-key validation preserved
- [ ] History window tightened toward 6-8 turns (MAX_MESSAGES stays the hard cap)
- [ ] Envelope/annotation/assessment compliance suite green (reorder proven behavior-neutral)
- [ ] `cost_analysis.py --api` re-run; new per-session cost recorded; Sprint 16 `CLAUDE_TURN_CENTS` flagged for downward revision

## Cost lever comparison (recorded for the decision)
| Lever | Provider/model | Est. session cost | Behavioral risk | Effort | Reversible | Reopens locked stack |
|---|---|---|---|---|---|---|
| Today (no caching) | Haiku 4.5 | ~$0.108 | — | — | — | — |
| **This sprint (caching + trims)** | **Haiku 4.5** | **~$0.04 (~60% off)** | **very low** | **~1 day** | **yes** | **no** |
| Migration (Sprint 24 candidate) | GPT-4o-mini | ~$0.016 (~85% off) | high | ~4-5 days | partial | yes (ADR-038) |

Caching captures the majority of the migration's savings without leaving
Anthropic, changing model capability, or reopening ADR-008. Do this first.

## Risks
**The reorder changes model behavior.** Mitigation: it is a reorder of
byte-identical blocks, not a rewrite; the envelope-compliance suite (the Sprint 14
Task 10 failure family) is the gate; ship behind the same forced-tool schema that
already guarantees shape.

**The cache silently never hits** (a `Date.now()`, a per-request id, or
non-deterministic JSON ordering in the prefix). Mitigation: the prefix-stability
test asserts byte-identity across turns; a runtime check logs when
`cache_read_input_tokens` is 0 on turn 2+.

**5-minute TTL expires between slow turns.** Mitigation: sessions are ~5 min with
turns closer than that; if measurement shows gaps, switch the breakpoint to `ttl:"1h"`
(one-line change) — the doubled write cost still pays off within a session.

**Moving the key-subset out of OUTPUT FORMAT weakens its adjacency to the
guidance.** Mitigation: keep a one-line in-block pointer; the keys were always a
render-time splice, and the tail is still in the same system prompt the model reads
in full.

## What the next sprint needs to know
**Per-turn Claude input cost is ~65% lower and cached.** The system prompt now has
a stable-prefix / volatile-tail contract — **any new turn-invariant instruction goes
in the stable prefix; anything per-turn goes in the tail after the breakpoint**, or
caching regresses. Sprint 16's `CLAUDE_TURN_CENTS` should be revised to the cached
rate. If the budget target is met by caching + the Sprint 16 guardrail, the GPT-4o-mini
migration (Sprint 24 / ADR-038) can stay un-greenlit.
