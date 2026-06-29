import { defineConfig } from 'vitest/config'

// See packages/learning-model/vitest.config.ts for why this is needed --
// same shared-tsconfig dist-pollution issue, same fix.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
  },
})
