import { defineConfig } from 'vitest/config'

// `npm run build` emits compiled .test.js files into dist/ alongside the
// real output (the shared tsconfig.json has no reason to exclude tests --
// see fsrs.test.ts's own header). Left to Vitest's defaults that's at best
// a silent double-run of every test (src/ and a stale dist/ copy) and at
// worst a hard failure when dist/ is stale relative to src/ (tsc's ESM
// output leaves relative imports extension-less, which Node's loader can't
// resolve without a bundler). Scoping discovery to src/ sidesteps both.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
  },
})
