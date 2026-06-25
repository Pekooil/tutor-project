import { defineConfig } from 'wxt';

// MathMentor extension — WXT configuration.
// Sprint 01 / Task 2: bare scaffold only — no entry points or permissions yet.
//   - Manifest permissions are declared in Task 3.
//   - Entry points (background, content) are added in Tasks 4–5 under src/.
// See: https://wxt.dev/api/config.html
export default defineConfig({
  // React + TypeScript support.
  modules: ['@wxt-dev/module-react'],
  // Entry points live in /extension/src (src/background, src/content, ...).
  entrypointsDir: 'src',
  // Emit the build into /extension/dist (WXT nests per target: dist/chrome-mv3/).
  outDir: 'dist',
});
