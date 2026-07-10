import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// Dedicated config for the provider A/B eval (eval/**/*.eval.ts). Kept separate
// from vitest.config.ts so `npm test` (which matches only *.test.ts/*.spec.ts)
// never picks it up — the eval makes real provider calls in live mode and is
// run explicitly via `npm run eval` / `npm run eval:mock`.
export default defineConfig({
  oxc: { jsx: { runtime: 'automatic' } },
  resolve: {
    // Mirror tsconfig's "@/*" → "./*" (same as vitest.config.ts) in case a
    // transitively-imported production module resolves through the alias.
    alias: { '@': fileURLToPath(new URL('.', import.meta.url)) },
  },
  test: {
    include: ['eval/**/*.eval.ts'],
    fileParallelism: false,
    // Long: a live run is dozens of sequential provider + judge round-trips.
    testTimeout: 20 * 60 * 1000,
    hookTimeout: 60 * 1000,
  },
})
