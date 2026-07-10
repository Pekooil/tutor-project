# Provider evaluation — Haiku 4.5 vs GPT-4o-mini

A rigorous A/B harness that runs identical Calyxa tutoring scenarios through
**both** providers using the **real production prompts, schema, and validator**,
then scores reliability, tutoring quality, and cost, and writes a comparison
report with a data-driven migration recommendation.

This module is **eval-only**. It imports production code but never modifies it,
and nothing in production imports this module.

## Run it

```bash
cd web

# Offline pipeline self-test — no API keys. Writes a clearly-labeled SAMPLE
# report from synthetic data so you can see the format and confirm wiring.
npm run eval:mock

# Real A/B run — needs both keys in your environment.
export ANTHROPIC_API_KEY=sk-ant-...      # Haiku 4.5 arm + Opus 4.8 judge
export OPENAI_API_KEY=sk-...             # GPT-4o-mini arm
npm run eval
```

Outputs:

- `eval/report/comparison-<date>.md` — the human-readable report (`…-SAMPLE.md` in mock mode)
- `eval/results/latest.json` — the full raw results (every run, every score)

### Env knobs

| Variable | Default | Effect |
|---|---|---|
| `EVAL_MODE` | `live` if both keys set, else `mock` | Force `live` or `mock`. |
| `EVAL_DATASET` | `dataset` | `b` (or `dataset-b`) runs the alternate scenario set in `dataset-b.ts`; report filename is tagged so trials don't overwrite. |
| `EVAL_NO_JUDGE` | unset | `=1` skips the Opus 4.8 judge (deterministic scoring only, no judge tokens). |
| `EVAL_TURNS_PER_SESSION` | `8` | Cost-per-session multiplier for the savings math. |
| `EVAL_LIMIT` | all | Run only the first N cases (smoke). |

## What it measures

- **Reliability** — tool/function call returned, JSON parse, all required fields
  present, `parseEnvelopeObject` (the production validator) accepts it, retry /
  text-fallback triggered, malformed, crashes.
- **Tutoring quality** — deterministic rules (answer-leak, asked a question,
  closed a solved session, annotation targets copied verbatim from the page,
  chips/fields exclusivity) **plus** an Opus 4.8 judge rubric (Socratic style,
  avoids revealing, engagement, explanation quality, adapts to level,
  misconception handling, summary/annotation quality, critical-regression flag).
- **Performance** — model + total latency, tokens in/out, cache usage, cost per
  request, cost per session.

## How "identical inputs" is guaranteed

Each case in `dataset.ts` is built once and both providers receive the same
`profile`, `messages`, `pageContext`, `sessionStart`, tools, and JSON schema:

- System-prompt **text** is byte-identical (`buildSystemPrompt`). Anthropic
  additionally gets a production cache breakpoint (`buildSystemPromptBlocks`);
  that is a real production feature, reflected in cost, not hidden.
- The tool schema is the **same object** (`ENVELOPE_TOOL` / `SESSION_START_TOOL`
  from `web/lib/ai/claude.ts`).
- Both responses are validated by the **same** `parseEnvelopeObject`.

## Known asymmetries (documented in every report)

- **OpenAI strict mode can't take the production schema.** OpenAI requires every
  property in `required`; Calyxa's schema keeps several optional, so GPT-4o-mini
  runs in non-strict function-calling mode. This is a finding, not a workaround —
  see the report's "Structured-output enforcement" section.
- **Images: N/A.** Production sends page context as text + equations, never
  screenshots, so the eval is text-based (no invented vision path).
- **Answer-leak detection is heuristic;** the judge's `avoids_revealing` is the
  qualitative backstop.

## Files

| File | Role |
|---|---|
| `dataset.ts` | One scenario per category (algebra, geometry, calculus, misconception, follow-up, closing, annotation, session-start, difficult-student, edge-case, malformed). Grow this for more power. |
| `providers.ts` | The provider seam: `runHaiku` / `runGpt`, schema translation, token/cost/latency capture. |
| `metrics.ts` | Deterministic reliability + quality checks (reuses production `saysClosingSentence`). |
| `judge.ts` | Opus 4.8 rubric judge (forced-tool structured output, blind to provider). |
| `pricing.ts` | Per-model token pricing (sourced, editable) + cost math. |
| `report.ts` | Aggregation, regression flagging, savings, recommendation → markdown. |
| `run.ts` | Orchestrator. `mock.ts` | Offline synthetic responses for `eval:mock`. |
| `run.eval.ts` | Vitest entry (`npm run eval`). `../vitest.eval.config.ts` | eval-only config. |

## Extending

Add cases to `DATASET` in `dataset.ts` (use real `@calyxa/curriculum` concept
keys and set `expectations` for scoring). The runner and report adapt to however
many cases exist. If a provider changes pricing, edit `pricing.ts` and re-run —
no other change needed.
