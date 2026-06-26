## ADR-001: Extension framework — WXT

**Status:** Decided

**Context:** The Calyxa browser extension needs a Manifest V3 build
toolchain that supports React + TypeScript, fast hot-reload during
development, and a typed manifest. The candidates considered were a
hand-rolled vanilla MV3 build, Plasmo, and WXT.

**Decision:** Use WXT (https://wxt.dev) as the extension framework for
`/extension`.

**Rationale:**
- First-class Manifest V3 support with typed entry points (background,
  content scripts) and an auto-generated manifest.
- Vite-based, giving fast HMR and a familiar React + TypeScript developer
  experience.
- More actively maintained and less locked-in than Plasmo, with an escape
  hatch to raw manifest config via `wxt.config.ts`.
- Avoids the ongoing maintenance cost of a hand-rolled vanilla MV3 build.

**Consequences:**
- Enables: typed background/content entry points, fast dev reload, and a
  single `wxt.config.ts` as the source of truth for manifest permissions.
- Forecloses: MV2 patterns are unsupported and must never be suggested.
- Risk: WXT releases frequently — its version must be pinned exactly in
  `/extension/package.json` (no `^` or `~`) to avoid mid-sprint build
  breakage.
