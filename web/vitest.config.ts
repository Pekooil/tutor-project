import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // session.test.ts and ai-turn.test.ts each spawn their own `next dev`
    // (Next.js 16 allows only one dev server per project directory,
    // regardless of port), so test files must run one at a time rather
    // than in vitest's default parallel-file mode.
    fileParallelism: false,
    // This suite makes real round-trips to the hosted Supabase project per
    // test, and some tests chain several session start/end cycles in
    // sequence (Sprint 09 Task 7's fuzzy-collapse and resolution tests do
    // 2 and 5 respectively). The default 5s per-test timeout is fine under
    // light load but flakes under concurrent load (e.g. another `next dev`
    // already running locally) -- this is a slow-network budget, not a
    // correctness signal, so it's raised rather than tuned per-test.
    testTimeout: 30000,
  },
})
