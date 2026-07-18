import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  // tsconfig sets jsx: "preserve" (Next transforms JSX itself), which
  // vite 8's Oxc transform honors and then fails to parse the preserved JSX
  // at import analysis. The override must go through the `oxc` option (the
  // legacy `esbuild` option is ignored on rolldown-vite). Added in Sprint 25
  // Task 10: marketing-sections.test.tsx is the first test to import .tsx
  // component modules directly (SSR smoke renders).
  oxc: { jsx: { runtime: 'automatic' } },
  resolve: {
    // Mirror tsconfig's "@/*" → "./*" so modules that import through the
    // alias resolve under vitest. Added in Sprint 20 Task 10: waitlist.test.ts
    // is the first test to import an app route module directly (the route's
    // service-role client is vi.mock'd, so it can't go over HTTP like the
    // dev-server suites). Rollup alias rules only rewrite "@/..." — scoped
    // packages like @supabase/* and @calyxa/* are untouched.
    alias: {
      '@': fileURLToPath(new URL('.', import.meta.url)),
      // Sprint 24 (ADR-038): the `server-only` guard throws outside an RSC
      // build; alias it to a no-op so tests can import server modules
      // (claude.ts / provider.ts / cost-model.ts) directly. Next's build is
      // untouched — this alias is vitest-only.
      'server-only': fileURLToPath(new URL('./test/stubs/server-only.ts', import.meta.url)),
    },
  },
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
