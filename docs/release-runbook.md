# Release runbook — packaging & uploading a Calyxa beta build

The standing, repeatable path for shipping an extension build to the **unlisted**
Chrome Web Store beta. Every future extension update follows this. See **ADR-045**
(unlisted, invite-gated, versioned + rollback-first release pipeline) and **ADR-044**
(the no-secret bundle guarantee this re-runs on the packaged artifact).

## What the pipeline gives you

- **`npm run -w extension zip`** — raw `wxt zip` (WXT's own zipper; also the Firefox
  door WXT keeps open, unused in V1). Not the release path — use `release` below.
- **`npm run -w extension release`** — the real packaging step. It:
  1. runs `wxt build` → `extension/dist/chrome-mv3/` (the exact unpacked build Darcy
     loads in Chrome),
  2. reads the version back out of the **built** `manifest.json` (single source of
     truth — `extension/wxt.config.ts` `manifest.version`),
  3. zips that build into **`extension/release/calyxa-<version>.zip`** with
     `manifest.json` at the zip root (Chrome Web Store's required layout),
  4. **keeps the last 5** `calyxa-*.zip` artifacts and prunes older ones — so the
     previous builds stay addressable on disk for rollback.
- `extension/release/` is **git-ignored** (build output; never committed). Rollback
  relies on the local/archived zips, not on git.

## Release steps

1. **Bump the version.** Edit the ONE line `manifest.version` in
   `extension/wxt.config.ts` (e.g. `0.1.0` → `0.1.1`). This is the single source of
   the release version; nothing else needs touching. (The current first beta is
   **0.1.0** — nothing has shipped, so it is the first released version, not a bump.)

2. **Package.** From the repo root:
   ```
   npm run -w extension release
   ```
   Confirm it prints `→ packaged release/calyxa-<version>.zip` and that the file
   exists at that path.

3. **Prove no secret is in the packaged bytes.** The zip is made verbatim from
   `extension/dist/chrome-mv3/`, so scanning that directory scans exactly what shipped:
   ```
   node scripts/check-no-secrets.mjs
   ```
   It must end with `✓ No provider key value, monitoring DSN, or secret literal found`.
   > Locally only the **literal backstop** runs (no secret values in your shell env) —
   > that is expected. The **value proof** (grepping the bundle for the real key
   > *values*) runs in CI with the keys in the Actions env (`.github/workflows/ci.yml`,
   > ADR-044). A clean local run + the green CI value-scan together are the gate.

4. **Upload to the Chrome Web Store — as UNLISTED.** In the CWS developer dashboard
   (the Calyxa item), upload `extension/release/calyxa-<version>.zip`. Set visibility
   to **Unlisted** (ADR-045 / ADR-006 — install by direct link only, discoverable by
   no one). Fill the store listing (see `docs/store-listing.md`) and the data-safety
   form (see `docs/data-safety-disclosure.md`) — both land in Task 3/Task 7.

5. **Record the version + rollback pointer.** Log the shipped version and keep the
   prior `calyxa-<previous>.zip` addressable (it is, in `extension/release/`, until it
   ages past the last-5 window — archive it elsewhere if you need longer retention).

## Rollback

A bad beta build is rolled back by **re-uploading the previous artifact**:

1. Find the prior good zip in `extension/release/` (or your archive):
   `ls -1t extension/release/calyxa-*.zip`.
2. Re-upload that `calyxa-<previous>.zip` to the CWS dashboard (same unlisted item).
3. Chrome Web Store re-review may apply to the re-uploaded version; the artifact
   itself is unchanged and already passed the no-secret gate when it was first cut.
4. If the previous zip has aged out of the last-5 window, rebuild it: set
   `manifest.version` back to that version in `wxt.config.ts`, re-run
   `npm run -w extension release`, re-run the no-secret gate, upload.

> Keep more than 5 around long-term? Copy the zips you care about out of
> `extension/release/` before they age past the prune window — the pipeline only
> guarantees the **most recent 5** stay on disk.

## Notes

- **`API_BASE` still points at `localhost:3000`** (`extension/src/lib/api.ts`). The
  production origin is already in the manifest's `host_permissions` (Sprint 18), so
  flipping `API_BASE` to `https://calyxa.app` (the project's custom domain — the old
  `tutor-project-web.vercel.app` alias is retired from every hardcoded reference as of
  2026-07-13) for a shipped build is a **one-line constant change, not a permission
  change** — do it before packaging a build meant for testers. (Tracked as a Sprint 19
  launch item.)
- The version in `extension/package.json` (`0.0.0`) is **monorepo-internal** and is
  deliberately NOT the shipped version — `wxt.config.ts` `manifest.version` owns that.
- Cross-platform: `release` uses the system `zip` (present on macOS + the Ubuntu CI
  runners). Darcy packages on macOS; CI only runs the no-secret gate, not `release`.
