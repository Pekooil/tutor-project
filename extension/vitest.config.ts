import { defineConfig } from 'vitest/config';
import { WxtVitest } from 'wxt/testing/vitest-plugin';

// Sprint 14 Task 9: `lifecycle.test.ts` is this workspace's first spec to
// import content/index.ts directly (isPlausibleProblem, the opening-scan
// gate) rather than a chrome/WXT-import-free module like annotations.ts or
// Overlay.tsx. content/index.ts uses WXT's auto-imported `#imports` virtual
// module (createShadowRootUi/defineContentScript) at its top, which only
// resolves under WXT's own Vite config -- this plugin wires that up for
// Vitest, per WXT's own documented testing setup. Every other existing spec
// (annotations.test.ts, overlay-display.test.ts) already ran fine with no
// vitest.config.ts at all; this is additive, not a change to how they run.
export default defineConfig({
  plugins: [WxtVitest()],
});
