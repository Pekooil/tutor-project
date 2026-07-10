// Per-model token pricing for the provider A/B eval (eval-only; never imported
// by production). These are USD per 1,000,000 tokens. They are the ONE place a
// price change needs editing — every cost number in the report traces back
// here. Sources are named per constant so they can be re-verified; if a
// provider changes pricing, edit the number and re-run — no other change.
//
// This is intentionally NOT web/lib/tier/cost-model.ts: that file is a flat
// per-turn *budget ceiling* estimate for the live cost guard (CLAUDE_TURN_CENTS
// = 1), deliberately not token-scaled. A migration decision needs real
// token-scaled cost, so the eval computes it from measured `usage` instead.

export type ModelPricing = {
  /** USD per 1M uncached input tokens. */
  inputPerM: number
  /** USD per 1M output tokens. */
  outputPerM: number
  /** USD per 1M tokens read from cache. */
  cacheReadPerM: number
  /** USD per 1M tokens written to cache (0 when the provider charges no write premium). */
  cacheWritePerM: number
}

// Claude Haiku 4.5 (`claude-haiku-4-5`), the model web/lib/ai/claude.ts calls.
// Base $1.00 in / $5.00 out per MTok (Anthropic pricing, current as of the
// claude-api skill catalog, 2026-06). Cache read = 0.1x input = $0.10/MTok.
// Production sets `cache_control: { ttl: '1h' }` (system-prompt.ts), so cache
// WRITES bill at the 1-hour rate = 2.0x input = $2.00/MTok. (5-minute TTL would
// be 1.25x; the eval uses the 1h rate because that is what production writes.)
export const HAIKU_PRICING: ModelPricing = {
  inputPerM: 1.0,
  outputPerM: 5.0,
  cacheReadPerM: 0.1,
  cacheWritePerM: 2.0,
}

// OpenAI GPT-4o-mini (`gpt-4o-mini`). $0.15 in / $0.60 out per MTok; cached
// input billed at 0.5x = $0.075/MTok (OpenAI automatic prompt caching). OpenAI
// charges no separate cache-WRITE premium, so cacheWritePerM is 0. Verify
// against https://openai.com/api/pricing before trusting the savings numbers —
// OpenAI adjusts these periodically.
export const GPT_4O_MINI_PRICING: ModelPricing = {
  inputPerM: 0.15,
  outputPerM: 0.6,
  cacheReadPerM: 0.075,
  cacheWritePerM: 0.0,
}

export type TokenBreakdown = {
  /** Uncached input tokens billed at full input rate. */
  inputTokens: number
  /** Tokens served from cache (Anthropic cache_read / OpenAI cached prompt). */
  cacheReadTokens: number
  /** Tokens written to cache this request (Anthropic cache_creation; ~0 for OpenAI). */
  cacheWriteTokens: number
  /** Output/completion tokens. */
  outputTokens: number
}

/** USD cost of one request from its measured token breakdown. */
export function costUsd(tokens: TokenBreakdown, pricing: ModelPricing): number {
  return (
    (tokens.inputTokens * pricing.inputPerM +
      tokens.cacheReadTokens * pricing.cacheReadPerM +
      tokens.cacheWriteTokens * pricing.cacheWritePerM +
      tokens.outputTokens * pricing.outputPerM) /
    1_000_000
  )
}

// A tutoring session is many turns. The per-session cost = per-turn cost x this.
// Grounded assumption, not a measurement: tune from real session-length data
// (the repo's cost_real.py measures per-session turn counts from a live
// CALYXA_LOG_USAGE stream). Overridable via EVAL_TURNS_PER_SESSION so the
// report's savings math can be re-run against a real figure without a code edit.
export const DEFAULT_TURNS_PER_SESSION = 8
