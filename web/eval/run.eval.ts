// Vitest is the repo's TS runner (it resolves the workspace imports and the
// tsconfig "@/*" alias that a bare `node` invocation cannot). This file is the
// entry point vitest executes for `npm run eval` / `npm run eval:mock`. It is
// NOT part of `npm test` — vitest.config.ts's default include matches only
// *.test.ts / *.spec.ts, so this *.eval.ts file is picked up only by the
// dedicated vitest.eval.config.ts.
//
// The production AI modules import `server-only`, which throws when imported
// outside a React Server Component. The existing suite mocks it the same way
// (see web/tests/system-prompt.test.ts); vi.mock is hoisted above the imports.

import { test, expect, vi } from 'vitest'

vi.mock('server-only', () => ({}))

// Live runs make ~cases×2 provider calls plus ~cases×2 judge calls; give it room.
test('provider eval: Haiku 4.5 vs GPT-4o-mini', { timeout: 20 * 60 * 1000 }, async () => {
  const { runEval } = await import('./run')
  const { reportPath, results } = await runEval()
  expect(results.cases.length).toBeGreaterThan(0)
  // eslint-disable-next-line no-console
  console.log(`\nReport written to: ${reportPath}\n`)
})
