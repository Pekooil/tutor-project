import { defineConfig } from 'wxt';
import tailwindcss from '@tailwindcss/vite';

// Calyxa extension — WXT configuration.
// Sprint 01:
//   - Task 2 created the bare scaffold (entry-points dir, output dir).
//   - Task 3 (this) declares the Manifest V3 permissions below.
//   - Entry points (background, content) are added in Tasks 4–5 under src/.
// Sprint 10 Task 3: registers Tailwind v4 so any entry point that imports
// "tailwindcss" + "@calyxa/ui/theme.css" gets compiled by WXT's Vite build —
// for the overlay (Task 6), that sheet is injected INTO the shadow root via
// the content script's existing cssInjectionMode: 'ui', never the host
// page's <head> (ADR-002, ADR-018).
// See: https://wxt.dev/api/config.html
export default defineConfig({
  // React + TypeScript support.
  modules: ['@wxt-dev/module-react'],
  vite: () => ({
    plugins: [tailwindcss()],
  }),
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
      // Backend origin (Sprint 04 Task 6) so the background worker's fetch
      // calls in src/lib/api.ts are cross-origin-clean. Dev only -- the
      // production origin is added alongside this at launch, not replacing it.
      'http://localhost:3000/*',
    ],
    // Keyboard command (Sprint 02). A custom command, separate from the popup's
    // reserved _execute_action. The key is user-rebindable at
    // chrome://extensions/shortcuts and is verified in Task 5.
    //
    // Avoid Ctrl/Cmd+Shift+M — that is reserved by Chrome (profile switcher),
    // so Chrome refuses to bind it to an extension. Ctrl/Cmd+Shift+Y is free.
    commands: {
      'toggle-overlay': {
        suggested_key: { default: 'Ctrl+Shift+Y', mac: 'Command+Shift+Y' },
        description: 'Toggle the Calyxa overlay',
      },
    },
  },
});
