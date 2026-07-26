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
    // Web → extension session bridge (Part 2). ONLY the production origin may
    // message the extension via chrome.runtime.sendMessage(EXTENSION_ID, …);
    // this is the allowlist Chrome enforces for onMessageExternal. Scoped to
    // calyxa.app deliberately — never a wildcard — so no other site can push a
    // session. The background handler re-checks sender.origin as defense in depth.
    externally_connectable: {
      matches: ['https://calyxa.app/*'],
    },
    // Pinned extension public key → a DETERMINISTIC extension id across both the
    // unpacked-dev load and the store build, so the website's
    // NEXT_PUBLIC_CALYXA_EXTENSION_ID target never drifts.
    //
    // This is the PUBLISHED Chrome Web Store item's own public key, so a local
    // unpacked build and the store build now share one id:
    //   gedmlagmmllpohdkdpeocpbnmofegnbm
    // Verify at any time: the id is the first 128 bits of SHA-256 over this
    // key's DER bytes (base64-decoded), with each of those 32 hex nibbles
    // mapped 0-f → a-p. Chrome shows the same id at chrome://extensions.
    //
    // History (2026-07-25): this slot previously held a locally-generated key
    // deriving to `bmmfbljiipnkbidfnmclaoelgmiaaadi`, which did NOT match the
    // store item — the CWS had already assigned its own id. Because the
    // web→extension auth bridge is addressed BY id, the website was targeting an
    // extension that did not exist and sign-in never propagated (silently: see
    // web/lib/auth/extension-bridge.ts's `if (!EXTENSION_ID) return`). Recovered
    // from the published CRX's CRX3 header and swapped in here, which is what
    // makes NEXT_PUBLIC_CALYXA_EXTENSION_ID a single value for all environments.
    //
    // ⚠️ The matching PRIVATE key still lives only with Darcy / the CWS. This
    // public half does not let anyone sign a build; do NOT commit a .pem here.
    // See docs/release-runbook.md.
    key: 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAxVc2JAsElaPDKoasUJp3ay0IqkRhZlJA4jxH8p5Fv6UCiMU34DwqRsnng0D6LePqoO9Sg8gpaYLKaLO2drTZl6tJRdmXPNXOTae18GCILlsaChxGYeAzYvlVE3PEVTYZ78IIr92dW4FQ9xpvYjBDlk++rqFbZ4V6CcZfcAMglCpbcgHdqu93lYchpXla/zVN1RDhKgFHhQxqBV1UUXzX6IPsJ5bIRTglDNcQUlulTpMgNQb6jPSeufXWxyMeZtP38yiyUrliK27MyP1JzyUJuyQEaM4qPuBn3ParK9edF08itgQLyM1Jq+bNC+oZgyyUaSOwVpDFZaCaACoWxkmxiwIDAQAB',
    host_permissions: [
      '<all_urls>', // content script must run on any page the student visits
      // The single backend origin the background worker's fetch calls in
      // src/lib/api.ts reach (ADR-006): the production custom domain. API_BASE
      // was flipped to https://calyxa.app for the store build (Sprint 19 Task 9)
      // and that is the ONLY origin the shipped extension talks to.
      //
      // The http://localhost:3000/* dev origin was DROPPED for the 0.1.2 CWS
      // submission (Darcy's call) to keep the review footprint minimal — a store
      // build never calls localhost. A developer who reverts API_BASE back to
      // localhost must re-add this line locally (it does not ship).
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
