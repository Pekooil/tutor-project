# Sprint 01 — Monorepo scaffold and extension shell

## Goal
The extension loads in Chrome without errors. The background service worker
wakes and logs its status. The content script injects on any page and
confirms injection. No UI, no AI, no database — just a provably working
foundation that every future sprint builds on.

## Context
This is the first sprint. Nothing exists yet. The repo is created from scratch.

Framework decision (locked): WXT + React + TypeScript.
Rationale documented in /docs/adr/ADR-005-monorepo-tooling.md and
/docs/adr/ADR-001-extension-framework.md (write these during Task 1).

## Agents in this sprint

### Agent 1 — repo-scaffold
Scope: everything EXCEPT /extension
Creates the monorepo skeleton, shared config, and documentation stubs.
Runs first. extension-shell depends on the workspace config it produces.

### Agent 2 — extension-shell
Scope: /extension only
Creates the WXT project, manifest permissions, background service worker,
and content script. Runs after repo-scaffold is complete and committed.

Do NOT run in parallel. extension-shell imports workspace TypeScript config
from the root.

## Files in scope

### repo-scaffold agent creates:
/package.json                          ← root workspace config
/turbo.json                            ← Turborepo pipeline
/tsconfig.base.json                    ← shared TS config all packages extend
/.eslintrc.js                          ← shared ESLint config
/.prettierrc                           ← shared Prettier config
/.gitignore                            ← Node, WXT dist, secrets
/CLAUDE.md                             ← Claude Code working instructions (see template below)
/docs/architecture.md                  ← stub, to be filled during planning phase
/docs/adr/ADR-001-extension-framework.md   ← WXT decision record
/docs/adr/ADR-005-monorepo-tooling.md      ← Turborepo decision record
/docs/sprint-01-plan.md                ← this file

### extension-shell agent creates:
/extension/package.json
/extension/tsconfig.json               ← extends /tsconfig.base.json
/extension/wxt.config.ts              ← manifest permissions, entry points
/extension/src/background/index.ts    ← service worker
/extension/src/content/index.ts       ← content script skeleton
/extension/src/types/messages.ts      ← shared message type definitions

## Files explicitly out of scope
/web/*                (Sprint 03)
/api/*                (Sprint 04)
/supabase/*           (Sprint 03)
/packages/ai/*        (Sprint 05)
/packages/learning/*  (Sprint 07)
/extension/src/overlay/*  (Sprint 02)

Do not create any file not listed above. If something seems like it's needed
but isn't listed, add it to "What the next sprint needs to know" and ask
before creating it.

---

## Task 1 — Monorepo scaffold (repo-scaffold agent)

Prompt to use:
  Act as the repo-scaffold agent. Your scope is everything except /extension.
  Do not create /extension or anything inside it.

  Create the monorepo root with:
  - npm workspaces configured for packages: ["extension", "web", "packages/*"]
  - Turborepo with a basic pipeline (build, lint, typecheck tasks)
  - A root tsconfig.base.json with strict mode on, target ES2022
  - ESLint with @typescript-eslint/recommended
  - Prettier with default config
  - .gitignore covering node_modules, dist, .wxt, .env*, *.local
  - CLAUDE.md using the template in this sprint doc (see below)

  Also write two ADR stubs:
  - /docs/adr/ADR-001-extension-framework.md — documents the WXT decision
  - /docs/adr/ADR-005-monorepo-tooling.md — documents the Turborepo decision

  Use this ADR format:
    ## ADR-00X: [Title]
    **Status:** Decided
    **Context:** [why this needed a decision]
    **Decision:** [what was chosen]
    **Rationale:** [why]
    **Consequences:** [what this forecloses or enables]

  When done, list every file you created. Do not start on /extension.

Acceptance gate before Task 2:
  - npm install runs without errors from the root
  - CLAUDE.md exists and contains all locked decisions
  - Both ADRs exist with the correct format

---

## Task 2 — WXT project init (extension-shell agent)

Prompt to use:
  Act as the extension-shell agent. Your scope is /extension only.
  Do not touch any file outside /extension.

  Initialise a WXT project inside /extension with:
  - React + TypeScript template
  - tsconfig.json that extends /tsconfig.base.json
  - Confirm: running `wxt build` from /extension produces a dist/ folder
    with a valid manifest.json inside it

  Do not add any entry points yet (no background, no content script).
  Just the bare WXT scaffold with a working build.

  When done, list every file created and paste the first 30 lines of the
  generated dist/manifest.json.

Acceptance gate before Task 3:
  - `cd extension && wxt build` exits with code 0
  - dist/manifest.json exists and shows "manifest_version": 3

---

## Task 3 — Manifest permissions (extension-shell agent)

Prompt to use:
  Continue as the extension-shell agent. Scope: /extension only.

  Edit /extension/wxt.config.ts to declare the following Manifest V3
  permissions. Add a comment on each line explaining why it is needed.
  Do not add any permission not on this list.

  Permissions:
  - "storage"          → persists service worker state across wake cycles
  - "activeTab"        → reads the current tab's content on user gesture
  - "scripting"        → injects the content script programmatically
  - "tabs"             → gets the active tab URL for session logging (hashed)

  Host permissions:
  - "<all_urls>"       → content script must run on any page the student visits

  Do NOT add:
  - "tabCapture"       (Sprint 07)
  - "desktopCapture"   (Sprint 07)
  - "notifications"    (not in V1 scope)
  - "history"          (never needed — privacy risk)
  - "cookies"          (not needed — auth uses header tokens)

  After editing, run `wxt build` and paste the "permissions" and
  "host_permissions" arrays from the generated manifest.json.

Acceptance gate before Task 4:
  - Generated manifest contains exactly the 4 permissions listed
  - No unlisted permissions appear in the output

---

## Task 4 — Background service worker (extension-shell agent)

Prompt to use:
  Continue as the extension-shell agent. Scope: /extension/src/background only.

  Create /extension/src/background/index.ts as a WXT background entry point.

  It must:
  1. On chrome.runtime.onInstalled: log "MathMentor SW: installed" and write
     { wakeCount: 0 } to chrome.storage.local
  2. On every wake (top-level module execution): read wakeCount from
     chrome.storage.local, increment it, write it back, and log
     "MathMentor SW: wake #N"
  3. Add a chrome.runtime.onMessage listener that receives messages and logs
     them. Do not handle any specific message types yet — just log and return
     true (keeps the message channel open for async responses later)

  Important MV3 constraints to observe:
  - Service workers are not persistent. Do not assume any in-memory variable
    survives between wake cycles. All state goes to chrome.storage.local.
  - Do not use setInterval or setTimeout at the top level — the service
    worker will be killed and the timer lost.
  - Do not import anything that requires a DOM — service workers have no DOM.

  Create /extension/src/types/messages.ts with:
    export type MessageType = "CONTENT_READY"
    export interface MathMentorMessage {
      type: MessageType
      payload?: unknown
    }

  When done, list every file created or modified.

Acceptance gate before Task 5:
  - `wxt build` still exits 0
  - No TypeScript errors

---

## Task 5 — Content script skeleton (extension-shell agent)

Prompt to use:
  Continue as the extension-shell agent. Scope: /extension/src/content only.

  Create /extension/src/content/index.ts as a WXT content script entry point.

  It must:
  1. Run on all URLs (matches: ["<all_urls>"])
  2. Log "MathMentor content: injected on [hostname]" where hostname is
     window.location.hostname
  3. Send a CONTENT_READY message to the background service worker:
       chrome.runtime.sendMessage({ type: "CONTENT_READY" })
  4. Listen for a response and log it if one arrives

  Constraints:
  - Do not mutate the DOM in any way. No elements added, no styles changed,
    no attributes modified. Read-only access only.
  - Import MathMentorMessage from /extension/src/types/messages.ts
  - Use async/await with a try/catch around sendMessage — the background
    worker may not be awake yet and sendMessage can throw

  When done:
  - List every file created or modified
  - Paste the full content of /extension/src/content/index.ts

Acceptance gate (manual verification steps):
  1. Run `wxt dev` — load the unpacked extension from .wxt/chrome-mv3
  2. Open chrome://extensions — confirm the extension appears with no errors
  3. Navigate to google.com — open the page console — confirm the injection log
  4. Open the background service worker DevTools — confirm the CONTENT_READY
     message is received and logged
  5. Navigate to khanacademy.org — confirm the same logs appear
  6. Open a local PDF in Chrome — confirm the same logs appear

---

## CLAUDE.md template (for Task 1)

Use this exact content for /CLAUDE.md:

  # MathMentor — Claude Code working instructions

  ## Read this file at the start of every session before doing anything else.

  ## Current sprint
  Sprint 01 — Monorepo scaffold and extension shell
  (Update this line at the start of each new sprint)

  ## Locked architecture decisions
  - Extension framework: WXT (not Plasmo, not vanilla MV3)
  - Manifest version: V3 only. Never suggest MV2 patterns.
  - Overlay strategy: shadow DOM (decided in Sprint 02, do not pre-empt)
  - All API keys: server-side only. Never put any key in the extension bundle.
  - Session audio: never persisted. Real-time STT streaming only.
  - Free tier limits: enforced server-side. Client is a display hint only.
  - DOM policy: content script reads only. No mutations to host page DOM.
  - RLS policy: every Supabase table must have RLS before receiving data.

  ## Locked stack
  - Extension: WXT + React + TypeScript
  - Backend: Next.js API routes (Sprint 03+)
  - Database: Supabase — Postgres + Auth + RLS (Sprint 03+)
  - AI: Anthropic Claude API via server-side proxy (Sprint 05+)
  - STT: OpenAI Whisper API (Sprint 06+)
  - TTS: ElevenLabs streaming API (Sprint 06+)

  ## V1 scope — what is NOT built until Phase 3+
  - Firefox support
  - Video frame / diagram understanding
  - B2B / school licensing
  - Parent dashboard
  - Non-math subjects
  - Offline mode
  - Mobile app

  ## Monorepo structure
  /extension    WXT Chrome extension
  /web          Next.js marketing site + mastery dashboard
  /packages     Shared: /ai, /learning, /auth, /types, /utils
  /supabase     Migrations, RLS policies, seed data
  /docs         Architecture doc, ADRs, sprint plans

  ## Agent scoping rules
  When acting as a named agent, only read and modify files within your
  declared scope. If a task requires touching a file outside your scope,
  stop and ask before proceeding.

---

## Acceptance criteria (full checklist)

Run these manually after Task 5 is complete:

- [ ] `npm install` runs without errors from the repo root
- [ ] `cd extension && wxt build` exits with code 0
- [ ] TypeScript compiles with zero errors: `npm run typecheck` from root
- [ ] ESLint passes: `npm run lint` from root
- [ ] dist/manifest.json shows manifest_version 3
- [ ] dist/manifest.json permissions contains exactly: storage, activeTab,
      scripting, tabs
- [ ] dist/manifest.json host_permissions contains exactly: <all_urls>
- [ ] Load unpacked extension in chrome://extensions — zero errors, zero warnings
- [ ] Service worker shows "active" in DevTools → Application → Service Workers
- [ ] Navigate to google.com → page console shows injection log
- [ ] Background SW DevTools shows CONTENT_READY received
- [ ] Navigate to khanacademy.org → same logs
- [ ] Open a local PDF → same logs
- [ ] git log shows at least 2 commits: one for Task 1, one for Tasks 2–5
- [ ] CLAUDE.md exists at repo root with all locked decisions

---

## Risks

**WXT version pinning.** WXT releases frequently. Pin the exact version in
/extension/package.json and do not use ^ or ~. A patch version change mid-sprint
that breaks the build costs half a day.

**chrome.storage.local in service worker.** The MV3 service worker wake cycle
is the #1 source of bugs in Chromium extensions. If the background logs show
wakeCount resetting to 0 unexpectedly, the storage read is happening before the
previous write completes. Use await on every chrome.storage call — no callbacks.

**Content script on PDFs.** Chrome does not inject content scripts into
chrome:// URLs and may behave inconsistently on PDFs depending on the PDF viewer
(native vs. PDF.js). The acceptance criteria test is required — do not skip it.

---

## What the next sprint needs to know
[Fill this in after all acceptance criteria pass and tasks are committed]