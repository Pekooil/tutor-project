import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // session.test.ts and ai-turn.test.ts each spawn their own `next dev`
    // (Next.js 16 allows only one dev server per project directory,
    // regardless of port), so test files must run one at a time rather
    // than in vitest's default parallel-file mode.
    fileParallelism: false,
  },
})
