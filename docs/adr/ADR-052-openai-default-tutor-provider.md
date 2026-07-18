## ADR-052: OpenAI GPT-4o-mini becomes the default tutor + study-kit provider; Anthropic retained as the in-tree backup

**Status:** Accepted (2026-07-17) — **Darcy's explicit sign-off**, the decision
ADR-038 said would be required. Supersedes ADR-038's "Anthropic stays the
default" and reverses the 2026-07-10 "stay on Haiku" decision. Amends the
locked-stack "AI: Anthropic Claude API" line (CLAUDE.md / docs/CLAUDE.md).

**Context:** ADR-038 conditionally permitted a GPT-4o-mini migration behind a
provider seam, gated on (a) an eval proving envelope-compliance + latency
parity and (b) Darcy's hands-on quality sign-off. Both gates have now been
passed on the `feat/tutor-gpt-4o-mini` testbed (worktree, 2026-07-17):

- **Eval (5 synthetic fixtures, live, both providers):** GPT-4o-mini met or
  beat Haiku 4.5 on every compliance row (envelope valid 100/100, assessment
  100/100, annotation grounded 80–100 vs 80, chips 100/100, session-close
  80/80, no-fabrication 100/100) and on latency in the final runs (p50 ~3.3s
  vs ~5.8s; p95 ~5.0s vs ~15.2s on the last sweep; across runs GPT's p50 was
  consistently lower, its p95 comparable).
- **Measured cost (real sessions, `cost_real.py`):** Haiku **$0.073/session**
  mean (p90 $0.105, 56% cache hit) vs GPT-4o-mini **$0.011/session** (64%
  cache hit) — ≈85% model-cost reduction. Voice (ElevenLabs) dominates total
  session cost either way and is unchanged.
- **Prompt hardening, live-verified on the testbed** (all in
  `tutor-openai.ts`, regression-guarded by the EVAL_LIVE-gated
  `tests/tutor-eval/repro-leak.test.ts`): page-grounding rules after a
  wrong-problem live-find (the few-shot-as-fake-history leak, 8/12 → 0/12);
  a first-reply rule (engage + annotate the on-screen problem, 6/6); a
  trailing per-turn system reminder that fixed chips-by-default (0/3 → 3/3)
  and a misgrading defect (GPT rejecting a CORRECT final answer 3/3 → 0/3;
  Haiku accepted 2/2 — recompute-then-literal-compare is load-bearing);
  session-close discipline incl. a ban on "want to try another one?" offers.

**Decision:**

1. **OpenAI GPT-4o-mini is the DEFAULT provider** for the tutor turn (all
   three routes via the ADR-038 `TutorProvider` seam) **and** for study-kit
   generation (its own `STUDY_KIT_PROVIDER` switch in
   `web/lib/study/generate.ts`, deliberately independent). `TUTOR_PROVIDER`
   unset or `openai` → OpenAI.
2. **Anthropic (Haiku 4.5) is RETAINED in-tree as the backup**, not removed:
   `claude.ts` and `@anthropic-ai/sdk` stay; `TUTOR_PROVIDER=anthropic` /
   `STUDY_KIT_PROVIDER=anthropic` is the instant, env-only rollback; the eval
   harness needs both providers to keep producing the comparison table. Git
   branches `anthropic-haiku-backup` (last Haiku-default commit) and
   `feat/tutor-gpt-4o-mini` (the migration testbed) also remain.
3. **STT stays OpenAI Whisper; TTS stays ElevenLabs** (provider-neutral,
   untouched). The extension needs **no changes** for the provider choice —
   model selection is entirely server-side.
4. The OpenAI-strict tool schemas stay **derived at runtime** from claude.ts's
   Anthropic tools (`openai-schema.ts`) — one source of truth; any future
   `ENVELOPE_TOOL` change must re-run the live eval + repro suite (the three
   OpenAI prompt boosts and the trailing reminder are tuned against today's
   schema).

**Consequences:**

- Deploying this to Vercel flips production to GPT-4o-mini (the default is in
  code; prod has `TUTOR_PROVIDER` unset). `OPENAI_API_KEY` already exists in
  prod (Whisper). Rollback is setting `TUTOR_PROVIDER=anthropic` — no deploy.
- The cost model's `claude_turn` estimate follows the flag (both providers
  currently resolve to the 1¢/turn ledger floor; the floor now overcharges
  GPT turns ~7× — a Phase-3 retune candidate, see the conversion handoff).
- Known accepted quality deltas vs Haiku (measured, mitigated, monitored):
  GPT needed explicit prompt machinery for annotation rate, chips, close
  discipline, page grounding, and answer verification — all now in place and
  test-guarded; residual model variance on answer-grading is the main thing
  to watch in live telemetry (`turn_latency` / session-close behavior).
- The Sprint 19 privacy disclosure (ADR-046) already lists OpenAI as a
  processor (Whisper STT); tutor-turn text now also flows to OpenAI — the
  `/privacy` processor wording should be re-checked before the next store
  submission.
