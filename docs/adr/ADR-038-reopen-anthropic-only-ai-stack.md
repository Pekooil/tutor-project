## ADR-038: Conditionally reopen "Anthropic only" — permit GPT-4o-mini for the tutor turn

**Status:** Proposed — **requires Darcy's explicit sign-off.** This reopens a
**locked** stack decision and supersedes part of ADR-008. It is NOT decided by
writing this file; it is a request to decide.

**Context:** Cost pressure ahead of public beta. The 2026-07-09 cost analysis
puts a Haiku 4.5 session at **~$0.108**; GPT-4o-mini list pricing ($0.15 in /
$0.60 out per MTok, vs Haiku's $1.00 / $5.00) would put the same token volume at
**~$0.016** — ~85% cheaper. That is the entire appeal, and it is real.

But three facts constrain it:
1. **It breaks a locked decision.** `docs/CLAUDE.md` and `/CLAUDE.md` both lock
   "AI: Anthropic Claude API (server-side proxy only)," and **ADR-008** forecloses
   any non-Anthropic AI call. A model swap to OpenAI is an architecture reopening,
   not a config change.
2. **Most of the savings are available without it.** **ADR-037 / Sprint 19**
   (prompt caching on Haiku) captures ~60% of session cost with very low risk,
   inside the locked stack. And **Sprint 16's guardrail** already caps aggregate
   spend regardless of per-token price. So the *marginal* budget benefit of a
   migration, on top of caching + the cap, is much smaller than the raw 85%.
3. **The capability/quality risk is highest here.** Calyxa's whole tutoring loop
   depends on strict structured output (the forced `submit_tutor_turn` envelope,
   the Sprint 14 Task 10 live-finds, the `nullableEnum` trick that is the
   **opposite** shape under OpenAI strict mode). GPT-4o-mini is a weaker model at
   exactly this; a regression in assessment/annotation compliance degrades the
   product's signature behavior, not just a benchmark.

**Decision (proposed):** Reopen the "Anthropic only" constraint **conditionally
and reversibly**, permitting the *tutor turn* to run on OpenAI GPT-4o-mini
**only if all of the following hold**:
- (a) **Caching first.** ADR-037 (prompt caching, commit `e9cb3bf`) has shipped and been measured, and
  caching + the Sprint 16 guardrail **still miss the beta budget target.** If
  they meet it, this decision stays un-exercised.
- (b) **Behind a provider abstraction.** The migration ships behind a thin
  `TutorProvider` seam so Anthropic and OpenAI are swappable per-env and the
  change is revertible in one flag — not a one-way rip-out of `@anthropic-ai/sdk`.
- (c) **A compliance bar is met.** On a fixed regression eval set, GPT-4o-mini's
  envelope/annotation/assessment compliance and latency are **at least at the
  Haiku baseline** before any traffic is switched.
If any of (a)-(c) fails, the tutor stays on Anthropic and this ADR remains
"proposed, not exercised."

**Rationale:**
- Sequencing caching *before* migration means the cheap, safe lever is proven
  first; migration is only spent if genuinely needed.
- A provider abstraction keeps the decision reversible — the locked stack was
  locked for a reason (one proxy seam, one key path, ADR-008), and a swappable
  seam honors that intent while allowing measurement.
- A compliance gate makes "cheaper" contingent on "not worse for students,"
  which is the only acceptable trade for a tutoring product.

**Consequences:**
- **If exercised (adopted after sign-off):** the locked-stack lines in both
  CLAUDE.md files change from "Anthropic Claude API (server-side proxy only)" to
  name the provider abstraction; ADR-008's "no non-Anthropic AI call" clause is
  superseded *for the tutor turn only* (Whisper STT and ElevenLabs TTS are
  unaffected — they were already OpenAI/3rd-party). The `ANTHROPIC_API_KEY` path
  gains an `OPENAI_API_KEY` sibling, both server-only, both covered by the
  bundle-grep gate.
- **If not exercised:** no code changes; ADR-008 and the locked stack stand;
  Sprint 24's plan sits as a costed, ready contingency.
- **Forecloses nothing prematurely:** the abstraction means either provider can
  be the default, and reverting is a flag flip.

**Open question for sign-off:** Is an ~85%-per-token saving (net much less after
caching + the guardrail) worth reopening a locked architecture decision and
accepting structured-output regression risk on the tutoring envelope? ADR-037's
author's recommendation: **not yet** — ship caching, measure, and only exercise
this if the budget still misses.
