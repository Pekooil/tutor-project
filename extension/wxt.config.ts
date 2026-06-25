import { defineConfig } from 'wxt';

// MathMentor extension — WXT configuration.
// Sprint 01:
//   - Task 2 created the bare scaffold (entry-points dir, output dir).
//   - Task 3 (this) declares the Manifest V3 permissions below.
//   - Entry points (background, content) are added in Tasks 4–5 under src/.
// See: https://wxt.dev/api/config.html
export default defineConfig({
  // React + TypeScript support.
  modules: ['@wxt-dev/module-react'],
  // Entry points live in /extension/src (src/background, src/content, ...).
  entrypointsDir: 'src',
  // Emit the build into /extension/dist (WXT nests per target: dist/chrome-mv3/).
  outDir: 'dist',
  // Manifest V3 permissions (Task 3). Each line is justified; do not add any
  // permission that is not listed in the sprint plan.
  manifest: {
    permissions: [
      'storage', // persists service worker state across wake cycles
      'activeTab', // reads the current tab's content on user gesture
      'scripting', // injects the content script programmatically
      'tabs', // gets the active tab URL for session logging (hashed)
    ],
    host_permissions: [
      '<all_urls>', // content script must run on any page the student visits
    ],
  },
});
