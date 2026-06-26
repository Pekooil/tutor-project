# Sprint 02 — Overlay shell (no AI)

## Goal
A student presses a keyboard shortcut on any page and a Calyxa overlay
appears, rendered inside a shadow DOM so it is fully isolated from the host
page's CSS. Pressing the shortcut again dismisses it. The overlay is a
placeholder — a single panel that says "Calyxa" — with no AI, no input
handling, and no backend. This sprint proves the one hard part of the UI
foundation: rendering our own UI on arbitrary third-party pages without CSS
bleed in either direction.

## Context
Sprint 01 produced a provably working shell: a content script that injects on
`<all_urls>` and sends a `CONTENT_READY` message, and a background service
worker that logs wakes and inbound messages. This sprint builds the first
visible UI on top of that messaging foundation.

The overlay rendering strategy (shadow DOM) is a locked architecture decision
(see `/CLAUDE.md`), explicitly deferred to this sprint. Task 1 records it as
`/docs/adr/ADR-002-overlay-shadow-dom.md` using the same ADR format as
ADR-001 and ADR-005.

Implementation rests on WXT's `createShadowRootUi` helper (WXT 0.20.27, pinned
in Sprint 01). It mounts a React tree inside an open shadow root attached to a
single extension-owned custom element, and — with `cssInjectionMode: 'ui'` —
injects the overlay's stylesheet **into the shadow root** rather than the page
`<head>`. That is what prevents bleed both directions.

### DOM policy reconciliation (read this before Task 3)
The locked DOM policy is: *the content script reads only — no mutations to host
page DOM.* An overlay must append at least one node, so this sprint clarifies
the policy rather than violating it:

> The content script must not read-modify any node, style, or attribute that
> belongs to the host page. It MAY append exactly one extension-owned host
> element (the shadow host) as the overlay mount point, and must remove it on
> dismissal. The host element carries a shadow root; nothing the overlay does
> is observable in the host page's light DOM.

That single sanctioned append is the only DOM write permitted in this sprint.
ADR-002 documents this reconciliation so it is not re-litigated later.

## Agents in this sprint

### Agent 1 — overlay-ui
Scope: `/extension/src/overlay` only.
Builds the placeholder React overlay component and its shadow-scoped styles,
plus a mount/unmount helper. Pure presentation — imports no `chrome.*` API and
knows nothing about messaging or keyboard shortcuts. Runs first.

### Agent 2 — overlay-wiring
Scope: `/extension/src/content`, `/extension/src/background`,
`/extension/src/types/messages.ts`, `/extension/wxt.config.ts`.
Registers the keyboard command, routes it to the active tab, mounts the
overlay into a shadow root via WXT, and toggles it. Depends on the component
and mount helper that overlay-ui produces.

Do NOT run in parallel. overlay-wiring's content script imports `mountOverlay`
and `Overlay` from `/extension/src/overlay`; that module must exist and build
first.

The ADR and the two CLAUDE.md sprint-pointer edits (Task 1) live in `/docs` and
the repo root — outside both agents' scope. They are done at the
sprint-planning level before the agents start, the same way Sprint 01's ADRs
were a non-extension responsibility.

## Files in scope

### Task 1 (planning / docs) creates or edits:
/docs/adr/ADR-002-overlay-shadow-dom.md   ← new — records the shadow DOM decision
/CLAUDE.md                                 ← edit one line: Current sprint → Sprint 02
/docs/CLAUDE.md                            ← edit one line: Current phase → Phase 1, Sprint 2
/docs/sprint-02-plan.md                    ← this file

### overlay-ui agent creates:
/extension/src/overlay/Overlay.tsx         ← placeholder React component ("Calyxa")
/extension/src/overlay/Overlay.css         ← shadow-scoped styles incl. the :host reset
/extension/src/overlay/mount.tsx           ← createRoot/unmount helpers for the shadow container

### overlay-wiring agent modifies:
/extension/src/types/messages.ts           ← add the TOGGLE_OVERLAY message type
/extension/wxt.config.ts                   ← add the commands block (keyboard shortcut)
/extension/src/background/index.ts         ← chrome.commands.onCommand → message active tab
/extension/src/content/index.ts            ← create shadow-root UI, listen for TOGGLE_OVERLAY, toggle

## Files explicitly out of scope
/extension/src/popup/*   (do not touch the Sprint 01 popup)
/web/*                   (Sprint 03)
/supabase/*              (Sprint 03)
/api/*                   (Sprint 04)
/packages/ai/*           (Sprint 05)
/packages/learning/*     (Sprint 07)

Also out of scope this sprint (no pre-empting later work):
- Any AI, STT, or TTS call, or any network request of any kind.
- Overlay content beyond the "Calyxa" placeholder — no chat, no input box,
  no buttons, no resize/drag, no settings.
- Persisting overlay open/closed state. The overlay starts closed on every page
  load; the shortcut toggles it for the lifetime of that page only.
- New manifest permissions. The Sprint 01 set (storage, activeTab, scripting,
  tabs + `<all_urls>`) is sufficient; adding any is a sprint failure.

Do not create any file not listed above. If something seems needed but is not
listed, add it to "What the next sprint needs to know" and ask before creating
it.

---

## Task 1 — Overlay strategy ADR + sprint pointers (planning / docs)

Prompt to use:
  Write /docs/adr/ADR-002-overlay-shadow-dom.md using the project's ADR format
  (the one used by ADR-001 and ADR-005):

    ## ADR-002: [Title]
    **Status:** Decided
    **Context:** [why this needed a decision]
    **Decision:** [what was chosen]
    **Rationale:** [why]
    **Consequences:** [what this forecloses or enables]

  Content to capture:
  - Context: the overlay must render on arbitrary third-party pages with zero
    CSS collision in either direction, while the locked DOM policy keeps the
    content script read-only on the host page. Candidates: light-DOM injection
    with prefixed classes, an <iframe> overlay, or a shadow DOM.
  - Decision: render the overlay in an open shadow root attached to a single
    extension-owned host element, mounted by the content script via WXT's
    createShadowRootUi with cssInjectionMode: 'ui'.
  - Rationale: shadow DOM scopes selectors in both directions; WXT ships a
    first-class helper; full teardown on close leaves zero host-page footprint;
    an <iframe> was rejected because it complicates sharing the page context and
    sizing, and light-DOM prefixing cannot stop inherited properties from
    leaking in.
  - Consequences: enables an isolated React overlay; REQUIRES an explicit reset
    of inherited CSS on :host (see Task 2) because inherited properties still
    cross the shadow boundary through the host element; clarifies the read-only
    DOM policy to permit exactly one appended shadow host; forecloses light-DOM
    and global-stylesheet overlays.

  Then make two one-line edits:
  - /CLAUDE.md: change the "Current sprint" line to
      Sprint 02 — Overlay shell (no AI)
  - /docs/CLAUDE.md: change "Current phase" from "Phase 1, Sprint 1" to
      "Phase 1, Sprint 2"

  Do not change any other line in either CLAUDE.md.

Acceptance gate before Task 2:
  - ADR-002 exists and follows the ADR format exactly.
  - Both CLAUDE.md sprint-pointer lines are updated and nothing else changed.

---

## Task 2 — Overlay component and shadow-scoped styles (overlay-ui agent)

Prompt to use:
  Act as the overlay-ui agent. Scope: /extension/src/overlay only.
  Do not import any chrome.* API and do not reference messaging or shortcuts.

  Create /extension/src/overlay/Overlay.tsx:
  - A function component `Overlay` that renders a single panel containing the
    text "Calyxa". No props required this sprint.
  - Give the root element a stable class (e.g. "mm-overlay") used by the CSS.
  - Position is the overlay's own concern: a fixed panel (e.g. bottom-right),
    not full-screen, so the host page stays visible behind it.

  Create /extension/src/overlay/Overlay.css and import it from Overlay.tsx so
  WXT bundles it into the UI stylesheet (which Task 3 routes into the shadow
  root via cssInjectionMode: 'ui'):
  - Start with a :host reset so inherited properties cannot bleed in:
      :host { all: initial; }
    Then establish the overlay's own base font-family, font-size, line-height,
    and color explicitly. This is REQUIRED — inherited CSS (color, font, etc.)
    pierces the shadow boundary through the host element even though selectors
    do not. Without this, heavy-typography host pages will visibly bleed in.
  - Give the panel an explicit high z-index and position: fixed so it floats
    above host content regardless of the host's stacking contexts.
  - Use only self-contained values — no CSS variables defined on the host page,
    no external fonts, no @import.

  Create /extension/src/overlay/mount.tsx exporting two helpers the content
  script will call from WXT's onMount / onRemove:
    export function mountOverlay(container: HTMLElement): Root
      → creates a React root on `container`, renders <Overlay />, returns the Root
    export function unmountOverlay(root: Root): void
      → calls root.unmount()
  Use react-dom/client (createRoot). Keep these helpers framework-plumbing only.

  When done, list every file created and paste Overlay.tsx and Overlay.css in full.

Acceptance gate before Task 3:
  - `cd extension && npm run typecheck` passes with zero errors.
  - `wxt build` exits 0.
  - Overlay.css begins with a :host reset and sets explicit base typography.

---

## Task 3 — Shadow-root host injection in the content script (overlay-wiring agent)

Prompt to use:
  Act as the overlay-wiring agent. Scope: /extension/src/content/index.ts.

  Extend the Sprint 01 content script. Keep its existing behavior intact: it
  must still log injection and still send CONTENT_READY on main(). Do not remove
  the read-only DOM comment block — instead update it to record the one
  sanctioned exception (the single shadow host), per ADR-002.

  Add shadow-root overlay mounting using WXT's createShadowRootUi:
  - Set `cssInjectionMode: 'ui'` in defineContentScript so the overlay
    stylesheet is injected INTO the shadow root, never the page <head>.
  - In main(), create the UI once with createShadowRootUi(ctx, { ... }):
      - name: a custom element tag, e.g. "calyxa-overlay"
      - position/anchor: append the host element to the document root so it is
        not trapped inside a host-page stacking context
      - onMount(container): call mountOverlay(container) from
        /extension/src/overlay/mount; stash the returned Root
      - onRemove: call unmountOverlay(root) on the stashed Root
    Hold the returned ui handle in a module-scope variable. (A module-scope
    variable is safe in a content script — it persists for the page's lifetime —
    unlike the service worker, where it would not.)
  - Do NOT auto-mount. The overlay starts hidden; Task 4 mounts it on demand.

  Confirm the exact createShadowRootUi signature, option names, and
  cssInjectionMode value against the installed WXT version (0.20.27) before
  relying on them — do not upgrade WXT.

  When done, paste the full content script and state which document node the
  shadow host is appended to.

Acceptance gate before Task 4:
  - `wxt build` exits 0; typecheck passes.
  - Loaded unpacked, the content script still logs injection + CONTENT_READY on
    a normal page (Sprint 01 behavior preserved).
  - No overlay is visible yet (mount is on-demand only).

---

## Task 4 — Keyboard shortcut → toggle plumbing (overlay-wiring agent)

Prompt to use:
  Continue as the overlay-wiring agent. Scope: messages.ts, wxt.config.ts,
  background/index.ts, content/index.ts.

  1) /extension/src/types/messages.ts — extend the union:
       export type MessageType = 'CONTENT_READY' | 'TOGGLE_OVERLAY';
     Leave the CalyxaMessage interface unchanged.

  2) /extension/wxt.config.ts — add a commands block to the manifest (WXT passes
     it through verbatim). Do not touch the permissions arrays.
       commands: {
         'toggle-overlay': {
           suggested_key: { default: 'Ctrl+Shift+M', mac: 'Command+Shift+M' },
           description: 'Toggle the Calyxa overlay',
         },
       }
     Note: this is a custom command, separate from the popup's reserved
     _execute_action. Add a one-line comment that the key is user-rebindable at
     chrome://extensions/shortcuts and is verified in Task 5.

  3) /extension/src/background/index.ts — register a chrome.commands.onCommand
     listener SYNCHRONOUSLY at the top of defineBackground (same MV3 discipline
     as the existing onMessage/onInstalled listeners — listeners must be in
     place before any event fires after a wake). On the 'toggle-overlay'
     command, query the active tab and send it a TOGGLE_OVERLAY message:
       const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
       if (!tab?.id) return;
       try { await chrome.tabs.sendMessage(tab.id, { type: 'TOGGLE_OVERLAY' }); }
       catch { /* page has no content script (chrome://, Web Store) — no-op */ }
     chrome.commands.onCommand only fires in the background, so routing through
     chrome.tabs.sendMessage to the active tab is required. The `tabs`
     permission needed for this already exists from Sprint 01.

  4) /extension/src/content/index.ts — add a chrome.runtime.onMessage listener
     for TOGGLE_OVERLAY that toggles the ui handle from Task 3:
       ui.mounted ? ui.remove() : ui.mount();
     Toggling mount/remove (rather than hiding) keeps zero host-page footprint
     when the overlay is closed, which keeps the DOM policy clean.

  When done, list every file modified and paste the commands block from the
  generated dist manifest.json.

Acceptance gate before Task 5:
  - `wxt build` exits 0; typecheck and lint pass.
  - dist/manifest.json contains commands.toggle-overlay with the suggested_key.
  - dist/manifest.json permissions still contains exactly: storage, activeTab,
    scripting, tabs — and host_permissions exactly: <all_urls>. No additions.

---

## Task 5 — Five-page CSS-bleed verification (manual)

This is the sprint's acceptance criterion. Run `wxt dev`, load the unpacked
extension, and exercise the overlay on five pages chosen to stress CSS
isolation from different directions:

  1. example.com          — near-zero host CSS (control: overlay must look right
                            with nothing to inherit)
  2. en.wikipedia.org     — heavy classic global typography and resets
  3. tailwindcss.com      — utility CSS + Preflight global reset
  4. github.com           — complex app: sticky headers, deep stacking contexts,
                            high z-indices
  5. khanacademy.org      — the real target domain (open a math exercise page)

On EACH page, confirm:
  - The shortcut shows the overlay; the panel reads "Calyxa".
  - The shortcut again removes it; pressing repeatedly toggles cleanly.
  - In DevTools Elements, the overlay lives under a <calyxa-overlay> host
    with a #shadow-root; the overlay's markup is inside the shadow root.
  - No overlay <style> appears in the page <head> (styles are in the shadow root).
  - Overlay typography/color/spacing look identical across all five pages — no
    host font, color, or reset has bled in.
  - The host page is visually unchanged with the overlay open (no layout shift,
    no leaked styles), and unchanged again after the overlay is closed.
  - The overlay floats above host content (verify especially on github.com).
  - chrome://extensions/shortcuts shows "Toggle the Calyxa overlay" with a
    bound key; if Chrome reports the default as unavailable, rebind and note it.

---

## Acceptance criteria (full checklist)

- [ ] `npm install` runs without errors from the repo root
- [ ] `npm run typecheck` from root: zero TypeScript errors
- [ ] `npm run lint` from root: passes
- [ ] `cd extension && wxt build` exits 0
- [ ] dist/manifest.json shows manifest_version 3
- [ ] dist/manifest.json contains commands.toggle-overlay with a suggested_key
- [ ] dist/manifest.json permissions are exactly: storage, activeTab, scripting,
      tabs (no additions this sprint)
- [ ] dist/manifest.json host_permissions are exactly: <all_urls>
- [ ] Load unpacked in chrome://extensions — zero errors, zero warnings
- [ ] chrome://extensions/shortcuts lists "Toggle the Calyxa overlay" bound
- [ ] Shortcut shows the overlay reading "Calyxa"; shortcut again removes it
- [ ] Overlay renders inside a <calyxa-overlay> shadow root (verified in
      Elements), not in the host light DOM
- [ ] No overlay <style> is injected into the page <head>
- [ ] Overlay looks identical on all five test pages — no inherited CSS bleed
- [ ] Host page computed styles unchanged with overlay open and after close
- [ ] Closing the overlay removes the host element — zero residual DOM
- [ ] Content script still logs injection + CONTENT_READY (Sprint 01 intact)
- [ ] Only one DOM node is ever appended to the host page (the shadow host);
      no other host-page node, style, or attribute is modified
- [ ] ADR-002 exists; both CLAUDE.md sprint pointers updated
- [ ] git log shows commits for this sprint's tasks

---

## Risks

**Inherited CSS pierces the shadow boundary.** Shadow DOM scopes *selectors*,
but inherited properties (color, font-family, font-size, line-height,
letter-spacing) still inherit *through* the host element into the shadow tree.
A `:host { all: initial; }` reset plus explicit base typography on the overlay
is mandatory — skipping it is the single most likely cause of "bleed" on
Wikipedia/Tailwind. This is why Task 2 requires it and Task 5 checks it on a
heavy-typography page.

**Keyboard shortcut conflicts.** `Ctrl+Shift+M` is also Chrome DevTools'
device-toolbar toggle (but only when DevTools is focused, so a normal tab is
free) and some sites bind their own keys. Chrome may also refuse a default key
already taken by another extension, registering the command with no key. Task 5
must confirm the binding at chrome://extensions/shortcuts and rebind if needed;
the key is user-rebindable by design.

**Commands fire in the background, not the page.** `chrome.commands.onCommand`
is delivered to the service worker only. The overlay lives in the content
script, so the background must `chrome.tabs.sendMessage` the active tab.
`sendMessage` throws on pages with no content script (chrome://, the Web Store,
some PDFs) — the call must be wrapped in try/catch and no-op, or the SW logs
errors.

**Service-worker statelessness (carried from Sprint 01).** Do not store overlay
open/closed state in the background — the SW is killed between events and any
in-memory flag is lost. The toggle source of truth is the content script's
module-scope `ui` handle, which is safe because the content script's context
lives as long as the page.

**Host stacking contexts can trap a fixed overlay.** A host ancestor with
`transform`, `filter`, or `will-change` creates a containing block that a
`position: fixed` descendant is trapped inside. Appending the shadow host as a
direct child of the document root (not deep in host markup) plus a top-tier
z-index avoids this. github.com is the Task 5 page that stresses it.

**WXT API drift.** `createShadowRootUi`, its option names, and
`cssInjectionMode` are version-specific. WXT is pinned to 0.20.27 (Sprint 01
risk note). Confirm the signature against the installed version and do not
bump WXT mid-sprint — a patch bump that changes the UI API costs a day.

---

## What the next sprint needs to know

Sprint 02 is functionally complete: Task 5 passed on all five pages (overlay
renders, shadow-root isolated, zero CSS bleed, no `<head>` style leak). Git
commits for the sprint are still outstanding.

**Overlay is now an extension point, not a feature.** The shell is done; future
sprints replace the placeholder, they don't rebuild the plumbing.
- The overlay UI lives in `/extension/src/overlay` — `Overlay.tsx` (the
  placeholder panel), `Overlay.css` (shadow-scoped styles), `mount.tsx`
  (`mountOverlay`/`unmountOverlay` React-root helpers). To build real UI, swap
  the contents of `<Overlay>`; the isolation and mount/unmount plumbing stay.
- The content script (`/extension/src/content/index.ts`) creates the shadow-root
  UI once via WXT `createShadowRootUi` (`cssInjectionMode: 'ui'`), host element
  `<calyxa-overlay>` appended to the document root, and holds the `ui` handle
  in a module-scope variable (`overlayUi`). Safe at module scope because the
  content script context lives for the page's lifetime.

**Toggle / messaging flow** (extend, don't replace):
- `toggle-overlay` manifest command → `chrome.commands.onCommand` (background) →
  `chrome.tabs.sendMessage(activeTab, { type: 'TOGGLE_OVERLAY' })` → content
  script `onMessage` runs `ui.mounted ? ui.remove() : ui.mount()`.
- New message types go in the `MessageType` union in
  `/extension/src/types/messages.ts`. Commands are delivered to the SW only, so
  anything tab-facing must be relayed like this (uses the existing `tabs`
  permission — no new permissions were added this sprint).

**CSS isolation contract (ADR-002) — read before styling the overlay.** WXT
auto-injects `:host { all: initial !important }`. Because it is `!important`,
inherited/base properties (font, color, size) must be set on a child element
(e.g. `.mm-overlay`), **never on `:host`** — a `:host` declaration is silently
overridden. The content script stays read-only on the host page except the one
sanctioned shadow host it appends and removes.

**Keyboard-shortcut gotcha (cost us real debugging time — onboarding note).**
Chrome applies a command's `suggested_key` **only on first install**, never on
reload/update. The original default `Ctrl/Cmd+Shift+M` is reserved by Chrome
(profile switcher) and was refused, so the command stayed unbound even after the
default was corrected to `Ctrl/Cmd+Shift+Y`. Fix: assign the key at
`chrome://extensions/shortcuts`, or remove + re-add the extension for a clean
install. The background now ships `warnIfToggleShortcutUnbound()`, which logs a
warning when the command has no bound key so this can never fail silently again.

**Loose ends carried forward:**
- Verbose diagnostic `console.log`s remain in the toggle chain (background +
  content) from live debugging — candidates for a cleanup pass. The
  `warnIfToggleShortcutUnbound()` warning is intentional and should stay.
- `wxt dev` exits when `wxt.config.ts` changes (it restarts the server) and on
  some hot reloads — expect to relaunch it; and reload any open test tab after an
  extension reload, since Chrome does not re-inject content scripts into existing
  tabs.
- Still no AI, network, or persistence — the overlay is a static placeholder.
  Sprint 03 is web + Supabase (Next.js, RLS), per the locked roadmap.
