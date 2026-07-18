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
  // WXT's dev server defaults to port 3000 -- the SAME port the Next.js
  // backend (web/, `next dev`) uses, which the extension talks to via the
  // hardcoded API_BASE + host_permissions of http://localhost:3000. When both
  // dev servers run, whichever binds 3000 first wins and the other is pushed
  // off; if WXT wins, every /api/* fetch from the background worker hits WXT's
  // dev server instead of Next and comes back as a 404 with an empty body,
  // surfacing in the popup as "Unexpected end of JSON input" on sign-in. Pin
  // WXT to 3001 so the backend always owns 3000 and the two never collide.
  dev: {
    server: {
      port: 3001,
    },
  },
  vite: () => ({
    plugins: [tailwindcss()],
  }),
  // Entry points live in /extension/src (src/background, src/content, ...).
  entrypointsDir: 'src',
  // Emit the build into /extension/dist (WXT nests per target: dist/chrome-mv3/).
  outDir: 'dist',
  manifest: {
    // Store-review metadata (Sprint 18 Task 6, ADR-044). Before this, WXT
    // derived name/version from package.json (`@calyxa/extension`, `0.0.0`) —
    // not review-ready. These are the real listing values. (package.json's
    // version stays `0.0.0`: it is monorepo-internal, not the shipped manifest
    // version, which this override now owns.)
    name: 'Calyxa — AI math tutor',
    description:
      'A patient AI math tutor for any web page — Calyxa guides you through problems step by step instead of just giving the answer.',
    // Shipped manifest version — the SINGLE source of the release version.
    // Sprint 18 set 0.1.0; Sprint 19 Task 9: 0.1.0 was submitted to CWS with the
    // pre-flip (localhost) API_BASE and then withdrawn, so 0.1.1 was the
    // corrected, prod-pointed resubmission — CWS will not accept a re-upload
    // carrying a version it has already seen. 0.1.2 (2026-07-18) is the
    // public-launch resubmission: redesigned pill overlay + tutorial onboarding,
    // 10-session free cap, per-free-user voice credit cap. The `release` script
    // (package.json) reads this value back out of the BUILT manifest.json to
    // name the artifact `release/calyxa-<version>.zip`, so every future beta
    // build bumps ONLY this line, per docs/release-runbook.md.
    version: '0.1.2',
    // Manifest V3 permissions. Each is justified below; nothing here that the
    // content script + background worker don't use, and deliberately NO
    // tabCapture / desktopCapture (the beta OCR path stays deferred).
    permissions: [
      'storage', // background-worker state across service-worker wake cycles (lib/storage.ts)
      'activeTab', // the current tab on user gesture (the toggle-overlay command relay)
      'scripting', // programmatic content-script injection (MV3)
      // 'tabs' DROPPED (Sprint 18 Task 7, security-review §7.2): background/index.ts
      // reads only sender.tab.url (deriveTabDomain — exposed by <all_urls> host
      // permission, not 'tabs') and tab.id from chrome.tabs.query (id is ungated).
      // CONFIRMED in a live session 2026-07-12: with 'tabs' removed, new sessions
      // still write a non-null page_url_hash and the toggle/broadcast paths still
      // work. Smaller review footprint.
    ],
    host_permissions: [
      '<all_urls>', // content script must run on any page the student visits
      // Backend origins the background worker's fetch calls in src/lib/api.ts
      // reach (ADR-006). Dev localhost + the production origin (calyxa.app,
      // the custom domain on the same Vercel project — the old
      // tutor-project-web.vercel.app alias is being retired from every
      // hardcoded reference, 2026-07-13), ADDED ALONGSIDE (not replacing) the
      // dev one per this sprint's plan.
      // NOTE: api.ts's API_BASE was flipped to the prod origin
      // (https://calyxa.app) for the beta submission build in Sprint 19 Task 9.
      // Both origins stay listed here: prod is what the shipped build calls, and
      // localhost is kept so a dev revert of the API_BASE constant needs no
      // permissions change / re-review.
      'http://localhost:3000/*',
      'https://calyxa.app/*',
    ],
    // Keyboard command (Sprint 02, rebound Sprint 10). A custom command,
    // separate from the popup's reserved _execute_action. The key is
    // user-rebindable at chrome://extensions/shortcuts and is verified in
    // Task 5.
    //
    // Alt+Shift+C ⌥+⇧+C — "C" for Calyxa. Chrome's "Alt" modifier already
    // maps to the physical Option key on macOS, so one suggested_key covers
    // both platforms — no separate `mac` override needed (unlike the old
    // Ctrl/Cmd+Shift+Y). (The in-panel Alt+Shift+V push-to-talk chord this
    // was originally paired with has since been removed in favor of a
    // click-to-record mic button — see Overlay.tsx.)
    commands: {
      'toggle-overlay': {
        suggested_key: { default: 'Alt+Shift+C' },
        description: 'Toggle the Calyxa overlay',
      },
    },
  },
});
