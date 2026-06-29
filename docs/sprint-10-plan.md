# Sprint 10 — Brand identity + design system + UI/UX redesign

## Goal
Give Calyxa a **brand**, **one design language**, the machinery to enforce it across both render
targets, and a **redesigned** (not merely re-skinned) version of every already-built product
surface. By the end:
- a fresh **from-scratch identity** exists — a **botanical/growth logomark** (the name comes from
  *calyx*, the leaves that cradle a bud before it blooms), a wordmark in a **modern geometric sans**,
  a **green** accent over a calm neutral palette, recorded in `/docs/brand.md`;
- a pure shared workspace **`/packages/ui`** owns the **design tokens** (color, type scale, spacing,
  radius, shadow, motion) as a **Tailwind v4 `@theme`** and the **shadow-DOM-safe primitives** the
  overlay needs;
- the **web app** is built on **shadcn/ui** whose theme variables are mapped to those same tokens, so
  web and overlay share **one** palette/type from **one** source;
- every existing surface — **overlay, popup, login, signup, account** — is **redesigned** (layout,
  information architecture, interaction states), then implemented on the new system to **WCAG 2.1 AA**;
- the overlay's Tailwind is compiled **into its shadow root** with preflight contained, upholding
  the locked ADR-002 promise (no style leak in either direction) **without mutating the host DOM**.

```
/docs/brand.md  →  identity: logomark (botanical) + wordmark + green accent + geometric sans + voice
/packages/ui    →  tokens (@theme, light + dark-ready) + shadow-DOM-safe overlay primitives (pure React)
   ├── /web         shadcn/ui mapped to the tokens; layout/login/signup/account REDESIGNED to AA
   └── /extension   tokens compiled INTO the shadow root (preflight contained, no host DOM mutation)
```

The visual direction is **calm and education-forward** — Khan Academy's approachability with the
crisp craft of Linear/Vercel. The aesthetic, palette, type, and logo direction are **locked** (see
Context); this plan specifies them and the sprint designs the concrete assets — no mockups are
produced in the planning session.

This sprint is the **foundation + the redesign of what already exists**. It deliberately **does not**
build the marketing landing page, the analytics dashboard, the study-materials generator,
annotations, onboarding, or any billing UI — each is a later roadmap sprint that **consumes** this
system. The one thing this sprint locks for them is the brand, the tokens, the shadcn baseline, and
the global app shell.

## Context
Through Sprint 09 the **product works end to end** — shadow-DOM overlay, read-only page/LaTeX
extraction, the STT→AI→TTS voice pipeline, the Claude proxy, Supabase auth + RLS, the freemium
session gate, and the full FSRS learning model + curriculum graph. What has never existed is a
**brand or a styling system**:
- `/web` has **no Tailwind, no global stylesheet, no font setup, no component library** —
  `app/layout.tsx` renders a bare `<body>`; `page.tsx` is a 10-line stub; login/signup/account are
  unstyled.
- the extension overlay is styled by a **hand-written `extension/src/overlay/Overlay.css`** with no
  shared tokens; the popup is ad hoc.
- there is **no logo, no palette, no type system, and no shared vocabulary** between the two render
  targets, so they drift with every change.

This is the natural first sprint of the launch roadmap because the landing page, billing UI,
dashboard, and study-materials UI all consume a brand + design system first; building them before it
exists guarantees rework. So the identity + system land first, the existing surfaces are
**redesigned and rebuilt** on it (the hard case being the shadow root), and the new surfaces arrive
already speaking the language.

### Locked direction (decided with Darcy before this plan — drives every task)
- **Aesthetic:** calm, education-forward — **Khan Academy approachability × Linear/Vercel craft**.
- **Scope depth:** **restyle + UX/flow redesign** of the existing surfaces (not a pure re-skin); the
  **marketing landing page is still deferred** to its own sprint.
- **Web components:** **shadcn/ui**, themed via CSS variables **mapped to the `@calyxa/ui` tokens**
  (the shadcn MCP / `vercel:shadcn` skill is the intended build aid).
- **Overlay components:** **custom shadow-DOM-safe primitives** in `@calyxa/ui` (shadcn's heavier,
  document-oriented styling is not used inside the shadow root).
- **Brand:** **from scratch** — a **botanical/growth logomark** (calyx/bud/leaf), a wordmark in a
  **modern geometric sans** (Inter/Geist family), a **green** accent over calm neutrals.
- **Themes:** **light** ships; tokens structured so **dark** is a later flip, not a rewrite.
- **Accessibility:** **WCAG 2.1 AA** is targeted **this sprint** (tokens meet contrast, primitives
  meet keyboard/ARIA/focus); the later compliance sprint formally audits against it.

### Reconciliation with `/docs/PLAN.md` (read before Task 1) — renderer + styling
PLAN §2.1 made two recommendations this sprint reconciles with what shipped:

**(a) "Preact + Vite" for the overlay → the extension shipped on React.** `extension/package.json`
depends on `react`/`react-dom` + `@wxt-dev/module-react`; the overlay is React. This sprint **does
not re-litigate the renderer** — it styles what is built. Consequence: the `@calyxa/ui` primitives
are plain presentational React, consumed by the overlay (React 19 via WXT); the web app is React 19
via Next, on shadcn. ADR-018 records this so the Preact line in PLAN stops reading as open.

**(b) "Tailwind CSS, scoped inside the shadow root" → now actually adopted, on v4.** PLAN always
specified Tailwind with preflight contained in the shadow root; it was never installed. This sprint
adopts **Tailwind v4** (CSS-first `@theme`, `@tailwindcss/postcss` for Next, `@tailwindcss/vite` for
the WXT/Vite overlay build), which makes shared-token-as-CSS clean: one `theme.css` in `/packages/ui`
feeds both pipelines, and shadcn's theme variables are mapped to those token values.

### Two component systems, one token source (read before Tasks 3, 5–7)
Web uses **shadcn/ui**; the overlay uses **custom `@calyxa/ui` primitives**. This is deliberate: the
overlay lives in a shadow root injected into arbitrary third-party pages, where shadcn's
document-oriented assumptions (portals to `document.body`, global CSS variable lookups, heavier
dependencies) are awkward and risk leakage; the web app, on a first-party page, benefits from
shadcn's velocity and accessibility. The drift risk this creates is neutralised by making the
**design tokens the single source of truth**: `@calyxa/ui/theme.css` defines the palette/type/spacing
once, the overlay primitives use those Tailwind utilities directly, and shadcn's CSS variables
(`--primary`, `--background`, `--ring`, …) are **mapped to the same token values** in `/web`'s
`globals.css`. One palette, two component implementations, zero hard-coded color on either side.

### Fonts in the shadow root must not mutate the host DOM (read before Tasks 3, 6)
The web app loads the brand geometric sans via `next/font` (first-party, fine). The **overlay
cannot**: declaring an `@font-face` in the host document or `<link>`-ing a font would **mutate the
host page DOM**, violating the locked read-only-content-script policy, and `@font-face` reliability
inside a shadow root across arbitrary hosts is not guaranteed. Decision: the **overlay uses a
geometric-sans *system stack*** (`ui-sans-serif, system-ui, …`) declared as a token, so it stays
on-brand-adjacent with **no host DOM mutation and no font-load flash**; the **logomark and wordmark
are shipped as SVG**, so they carry the exact brand letterforms regardless of the runtime font. The
web app gets the real brand font; the overlay gets a faithful system fallback. Recorded in ADR-018.

### Identity is locked in direction, designed in execution (read before Tasks 1, 4)
The brand *decisions* are fixed (botanical logomark, green accent, geometric sans, calm neutrals,
Khan×Linear references). The concrete *assets* — the logomark SVG, the exact green + neutral ramp
(AA-validated), the chosen font(s) — are designed during the sprint and centralised in
`/docs/brand.md` + `/packages/ui/src/theme.css`, so they are one re-tune to adjust. No mockups are
produced in the planning session (Darcy's call); if a direction misses, it is a centralised edit,
not a per-surface rework — the Sprint 09 "named, cited, centralised constants" discipline applied to
brand.

Recorded in **ADR-018** (brand + design system: Tailwind v4 + `@calyxa/ui` tokens/overlay-primitives;
shadcn/ui for web mapped to the same tokens; shadow-DOM injection with contained preflight and a
no-host-mutation font strategy; light-now/dark-ready; WCAG AA targeted; React-as-built reconciliation
of PLAN §2.1).

### What ships vs what defers (read before Task 1)
**Ships now:** the brand identity (logomark + wordmark + favicon/extension icons + `/docs/brand.md`);
`/packages/ui` (tokens + overlay primitives); Tailwind v4 + shadcn wired into `/web`; Tailwind into
the shadow-DOM overlay; the **global web app shell**; a **UX/flow redesign** of the existing surfaces;
and the **redesigned, rebuilt** overlay, popup, login, signup, and account — all to **WCAG AA**.

**Defers (consumes this system later, do not build here):**
- **Landing / marketing page** — its own sprint. `web/app/page.tsx` stays a stub; it inherits the
  global shell only.
- **Analytics dashboard**, **study-materials generator**, **annotations**, **onboarding**, **billing
  / upgrade UI** — their own sprints; each consumes the tokens + shadcn + shell.
- **Dark theme enablement**, **visual-regression/Storybook tooling**, and the **formal full a11y
  audit** — tokens are dark-ready and AA-targeted now; enabling dark, the screenshot tooling, and the
  formal audit are later.

## Execution model
A **single code session** owns this sprint end to end, worked **strictly in order (1 → 9)**. The
chain is real: the ADR + brand spec fix scope and identity (Task 1); the UX redesign spec (Task 2)
defines what the implementation builds, so it precedes any surface code; the token/theme package +
shadcn + both build pipelines (Task 3) must exist before any surface uses a utility; the logomark +
assets (Task 4) need the locked font/green from Task 3; the overlay redesign (Task 6) is the hard
case (shadow-DOM injection, no leak, no host-font mutation) and is implemented before the easier web
surfaces (Task 7); QA (Task 8) and tests (Task 9) gate manual acceptance. One session — no handoff.

This sprint **does** touch the extension overlay + popup (presentation only), the `/web` app shell +
auth/account pages, `wxt.config.ts` and the Next/PostCSS Tailwind + shadcn setup, brand assets, and
the monorepo wiring for `/packages/ui`. It **does not** touch any API route, the AI/voice/learning
libraries, the content script's extraction logic, the background worker's messaging, the Supabase
migrations/policies, or auth logic. No behavior changes — only how it looks and how the surfaces are
laid out/navigated.

## Files in scope

### Task 1 (brand + design-system ADR + sprint pointers) creates or edits:
```
/docs/brand.md                       ← new — identity source of truth: logomark concept (botanical/calyx) + usage, wordmark, green accent + neutral ramp (AA targets), geometric-sans type system, voice/tone, light + dark-ready notes, overlay system-font fallback rationale
/docs/adr/ADR-018-design-system.md   ← new — brand + Tailwind v4 + @calyxa/ui tokens/overlay-primitives; shadcn/ui for web mapped to the same tokens; shadow-DOM injection (preflight contained) + no-host-DOM-mutation font strategy; light-now/dark-ready; WCAG AA targeted; React-as-built reconciliation (supersedes PLAN §2.1 Preact line)
/CLAUDE.md                           ← edit one line: Current sprint → Sprint 10 — Brand identity + design system + UI/UX redesign
/docs/CLAUDE.md                      ← edit one line: Current phase → Phase 2, Sprint 10
/docs/sprint-10-plan.md              ← this file
/docs/architecture.md                ← edit: /packages/* now includes ui (tokens + overlay primitives); note Tailwind v4 + shadcn (web) + shadow-DOM injection as the styling layer
```

### Task 2 (UX audit + flow/IA redesign spec — docs) creates:
```
/docs/design/ux-redesign-sprint10.md ← new — per-surface redesign spec (overlay, popup, login, signup incl. age-gate/consent, account): current-state friction, redesigned information architecture + interaction flow, and the full state set (empty/loading/error/success/disabled). Wireframe-level prose + ASCII/markdown structure; no code. This is what Tasks 6–7 implement.
```

### Task 3 (token/theme package + shadcn + both build pipelines) creates / edits:
```
/packages/ui/package.json            ← new — name @calyxa/ui, type module, exports ./theme.css + primitives; repo-standard build/typecheck/lint/test scripts
/packages/ui/tsconfig.json           ← new — extends /tsconfig.base.json
/packages/ui/src/theme.css           ← new — Tailwind v4 @theme: green accent + neutral ramp (AA-validated pairs), geometric-sans families incl. the overlay SYSTEM-STACK token, type scale, spacing/radius/shadow/motion (reduced-motion-safe). Light values now; dark layer declared, not enabled.
/packages/ui/src/index.ts            ← new — public surface (primitives added in Task 5)
/web/package.json                    ← edit — add @calyxa/ui + tailwindcss + @tailwindcss/postcss + shadcn deps (class-variance-authority, clsx, tailwind-merge, lucide-react)
/web/components.json                 ← new — shadcn config (style, RSC, Tailwind paths, alias)
/web/lib/utils.ts                    ← new — cn() (clsx + tailwind-merge) for shadcn
/web/postcss.config.mjs              ← new — @tailwindcss/postcss
/web/app/globals.css                 ← new — @import "tailwindcss" + @import "@calyxa/ui/theme.css"; shadcn CSS variables (--primary/--background/--ring/…) MAPPED to the @calyxa/ui tokens; base bg/typography
/web/app/layout.tsx                  ← edit — import globals.css; load the brand geometric sans via next/font; base theme on <html>/<body>
/web/tsconfig.json                   ← edit — path aliases for @calyxa/ui + shadcn (@/components, @/lib)
/extension/package.json              ← edit — add @calyxa/ui + tailwindcss + @tailwindcss/vite
/extension/wxt.config.ts             ← edit — register @tailwindcss/vite in the WXT vite config
/extension/tsconfig.json             ← edit — path alias for @calyxa/ui
/turbo.json                          ← edit only if needed — fan out typecheck/lint/build/test to /packages/ui
```
The root `/package.json` already declares `workspaces: ["extension","web","packages/*"]` — no edit.

### Task 4 (brand assets — logomark, wordmark, icons) creates:
```
/web/public/logo.svg                 ← new — the botanical logomark + wordmark (lockup)
/web/public/logomark.svg             ← new — mark only (square, for favicon/avatars)
/web/app/icon.svg (+ favicon)        ← new — Next favicon from the logomark
/web/public/og.png (or og route)     ← new — social/open-graph image using the identity (used later by marketing; created here so the identity is complete)
/extension/public/icon/{16,32,48,128}.png ← new/edit — extension icons from the logomark (referenced by the WXT manifest)
/docs/brand.md                       ← edit — embed/reference the produced assets + usage rules
```

### Task 5 (shared shadow-DOM-safe overlay primitives) creates / edits:
```
/packages/ui/src/primitives/Button.tsx        ← new — variants/sizes, focus-visible ring, AA contrast, disabled/loading
/packages/ui/src/primitives/Field.tsx          ← new — label + control + hint/error, accessible association (htmlFor/aria-describedby)
/packages/ui/src/primitives/Card.tsx             ← new — surface container
/packages/ui/src/primitives/Spinner.tsx           ← new — honours prefers-reduced-motion
/packages/ui/src/primitives/VisuallyHidden.tsx     ← new — sr-only helper
/packages/ui/src/index.ts                       ← edit — export primitives + prop types
```
Pure presentational React, token-driven, shadow-DOM-safe (no portals to `document.body`, no global
lookups). These serve the **overlay**; the web app uses shadcn equivalents on the same tokens.

### Task 6 (implement overlay + popup redesign) edits:
```
/extension/src/overlay/Overlay.tsx   ← edit — implement Task 2's redesign on @calyxa/ui primitives + Tailwind utilities + the logomark; AA (keyboard, aria, focus-visible, contrast); transports/props UNCHANGED
/extension/src/overlay/Overlay.css   ← REMOVED (or reduced to shadow-root injection bootstrap only)
/extension/src/overlay/mount.tsx     ← edit only if needed — ensure the compiled Tailwind sheet injects INTO the shadow root (WXT cssInjectionMode), preflight contained, overlay system-font token applied at the root
/extension/src/popup/*               ← edit — restyle/redesign the popup on the same system
```

### Task 7 (implement web surfaces redesign) edits:
```
/web/components/ui/*                          ← new — shadcn components added as needed (button, input, label, card, form, …), themed by the mapped tokens
/web/app/login/page.tsx                       ← edit — implement the redesign on shadcn; accessible form (AA)
/web/app/signup/page.tsx                      ← edit — same; age-gate/consent UI redesigned + restyled, NO logic change
/web/app/(dashboard)/account/page.tsx          ← edit — redesign + restyle
/web/app/(dashboard)/account/logout-button.tsx ← edit — shadcn Button
/web/app/(dashboard)/layout.tsx                ← new — minimal authed app shell (logomark, nav slot, container) the dashboard sprint extends
```
`web/app/page.tsx` (marketing) inherits the global shell only — **not** rebuilt this sprint.

### Files explicitly out of scope
```
/web/app/page.tsx                 (marketing CONTENT deferred — inherits the shell only)
/web/app/api/**                   (no route touched — presentation only)
/web/lib/** except the new lib/utils.ts  (ai/auth/learning/voice/tier/supabase/consent untouched)
/extension/src/{background,content,types,lib}/**  (messaging, extraction, transports unchanged)
/packages/{learning-model,curriculum}/**          (untouched)
/supabase/**                      (no migration, no policy change)
```
Also out of scope (no pre-empting later roadmap sprints):
- **Landing/marketing page, analytics dashboard, study-materials generator, annotations,
  onboarding, billing/upgrade UI** — each its own sprint.
- **Dark theme enablement, visual-regression/Storybook tooling, the formal full a11y audit** —
  dark-ready + AA-targeted now; enabling/auditing later.

Do not create any file not listed above. If something seems needed but is not listed, add it to
"What the next sprint needs to know" and ask before creating it.

---

## Task 1 — Brand spec + design-system ADR + sprint pointers (planning / docs)

  - `/docs/brand.md`: the identity source of truth. Record the **logomark concept** (botanical —
    calyx/bud/leaf abstracted; "growth through learning") + usage/clear-space rules; the **wordmark**
    (modern geometric sans); the **palette** — a **green** accent + calm neutral ramp with **named**
    roles (background/surface/foreground/muted/accent/danger/focus-ring) and **AA contrast targets**
    per pair; the **type system** (families incl. the overlay system-stack fallback, scale, weights);
    **voice/tone**; and the **light + dark-ready** note. References: Khan Academy (warmth) + Linear/
    Vercel (craft).
  - ADR-018 in the project format (`## ADR-018: [Title]`, `**Status:** Decided`, `**Context:**`,
    `**Decision:**`, `**Rationale:**` bullets, `**Consequences:**` Enables/Requires/Forecloses),
    recording: Tailwind v4; `@calyxa/ui` tokens + shadow-DOM-safe overlay primitives; **shadcn/ui for
    web mapped to the same tokens**; shadow-DOM injection with contained preflight; the **no-host-DOM-
    mutation overlay font strategy** (system stack + SVG wordmark); light-now/dark-ready; **WCAG AA**
    targeted; the **React-as-built** reconciliation of PLAN §2.1.
  - Pointer edits: `/CLAUDE.md` "Current sprint" → `Sprint 10 — Brand identity + design system +
    UI/UX redesign`; `/docs/CLAUDE.md` "Current phase" → `Phase 2, Sprint 10`; `/docs/architecture.md`
    `/packages` + styling-layer note. Change no other lines.

Acceptance gate before Task 2:
  - `/docs/brand.md` + ADR-018 exist and capture the locked direction (incl. shadcn-web/custom-overlay
    split, the font strategy, AA, and the PLAN reconciliation); both CLAUDE.md pointers + architecture
    updated.

---

## Task 2 — UX audit + flow/IA redesign spec (planning / docs)

Scope: `/docs/design/ux-redesign-sprint10.md` (new). No code — this defines what Tasks 6–7 build.

  - Audit each existing surface — **overlay**, **popup**, **login**, **signup (incl. age-gate +
    consent)**, **account** — for current friction (layout, hierarchy, discoverability, error
    handling, empty/loading states).
  - For each, specify the **redesigned** information architecture + interaction flow and the **full
    state set** (empty / loading / error / success / disabled), wireframe-level (markdown prose +
    structure diagrams). Call out where the redesign changes layout/flow vs. only visuals — but **no
    behavior/logic changes** (forms post the same; age-gate/consent rules unchanged).
  - Keep it implementable: every redesigned surface maps to the primitives (overlay) / shadcn (web)
    that Tasks 5–7 will use.

Acceptance gate before Task 3:
  - the spec covers all five surfaces with redesigned IA/flow + complete state sets; no proposed
    change alters behavior/logic; each surface's redesign is expressible in the chosen component
    system.

---

## Task 3 — Token/theme package + shadcn + both build pipelines (packages + both apps)

Scope: `/packages/ui/*`, `/web/{package.json, components.json, lib/utils.ts, postcss.config.mjs,
app/globals.css, app/layout.tsx, tsconfig.json}`, `/extension/{package.json, wxt.config.ts,
tsconfig.json}`, `/turbo.json` (only if needed). Keep `/packages/ui` **pure**.

  - **Encode the brand as tokens first:** `/packages/ui/src/theme.css` = Tailwind v4 `@theme` with the
    green accent + neutral ramp (**AA-validated** foreground/background pairs), the geometric-sans
    families **including the overlay system-stack token**, type scale, spacing/radius/shadow/motion
    (reduced-motion-safe). Light values now; declare the dark layer **without enabling** a switch.
  - `/packages/ui/package.json`: `@calyxa/ui`, `"type": "module"`, `exports` for `./theme.css` + the
    primitives entry; repo-standard scripts so `turbo run …` fans out.
  - **Web wiring:** add deps; init **shadcn** (`components.json`, `lib/utils.ts` `cn()`); `globals.css`
    imports Tailwind + the theme and **maps shadcn's CSS variables to the `@calyxa/ui` tokens**;
    `app/layout.tsx` imports `globals.css` and loads the brand geometric sans via `next/font`; path
    aliases (`@calyxa/ui`, `@/components`, `@/lib`).
  - **Extension wiring:** add deps; register `@tailwindcss/vite` in `wxt.config.ts`; ensure the overlay
    entry imports the theme so WXT compiles a sheet injected **into the shadow root**; path alias.
  - `npm install` from root; confirm `turbo run typecheck build` discovers `/packages/ui` and both
    apps build.

Acceptance gate before Task 4:
  - `turbo run typecheck lint build` includes `/packages/ui` + both apps and exits 0; a token-driven
    utility renders in `next dev` **and** inside the shadow root; a shadcn component renders on the
    web using the **mapped** token colors (not shadcn defaults); the theme resolves under `tsc`,
    `next build`, and the WXT build.

---

## Task 4 — Brand assets: logomark, wordmark, icons (design / assets)

Scope: `/web/public/*`, `/web/app/icon.svg` (+ favicon), `/extension/public/icon/*`, `/docs/brand.md`
(embed). Uses the locked font + green from Task 3.

  - Design the **botanical/growth logomark** (calyx/bud/leaf abstracted — clean, scalable, legible at
    16px) and the **wordmark** lockup in the brand geometric sans; export **SVG** (so the overlay
    carries exact letterforms regardless of runtime font).
  - Produce the **favicon / Next `icon.svg`**, the **extension icons** (16/32/48/128 PNG referenced by
    the WXT manifest), and an **OG image** using the identity (created now so the brand is complete;
    consumed by the marketing sprint).
  - Document usage + clear-space + min-size rules in `/docs/brand.md`.

Acceptance gate before Task 5:
  - logomark + wordmark SVGs exist and render crisply down to favicon size; extension icons wired in
    the manifest; `next build` picks up `icon.svg`; brand.md documents usage.

---

## Task 5 — Shared shadow-DOM-safe overlay primitives (packages)

Scope: `/packages/ui/src/primitives/*`, `/packages/ui/src/index.ts`. Pure presentational React — no
I/O, no chrome.*, no portals to `document.body`, no app imports.

  - Build the set the overlay needs: **Button** (variants/sizes, `focus-visible` ring, disabled/
    loading), **Field** (label + control + hint/error, accessible association), **Card**, **Spinner**
    (reduced-motion-safe), **VisuallyHidden**. Token-driven; **AA** contrast on every variant; no
    hard-coded color.
  - Export components + prop types. Keep them shadow-DOM-safe (render in place, no global state).

Acceptance gate before Task 6:
  - typecheck + lint pass; primitives render in isolation (Task 9 covers smoke + a11y tests); Button +
    Field imported from `@calyxa/ui` render inside the overlay.

---

## Task 6 — Implement overlay + popup redesign (extension)

Scope: `/extension/src/overlay/{Overlay.tsx, Overlay.css, mount.tsx}`, `/extension/src/popup/*`. The
**hard case** — done before the web surfaces.

  - Implement **Task 2's overlay redesign** on `@calyxa/ui` primitives + utilities + the logomark:
    redesigned layout/IA + all states; AA (keyboard, `aria`, `focus-visible`, contrast). **No behavior
    change** — transports (`onSend`/`onTranscribe`/`onSynthesize`) + props untouched.
  - Delete `Overlay.css` (or reduce to shadow-root injection bootstrap). Confirm the compiled Tailwind
    sheet injects **into the shadow root** (preflight contained) and the **overlay system-font token**
    is applied at the root — **no host DOM mutation, no host font fetch**.
  - Implement the popup redesign on the same system.

Acceptance gate before Task 7:
  - `wxt build` exits 0; the overlay renders the redesign on the new tokens inside the shadow root; on
    a real third-party page styles do **not** leak out and host styles do **not** bleed in; the
    overlay uses its system-font stack (no host DOM mutation); transports/behavior unchanged.

---

## Task 7 — Implement web surfaces redesign (web)

Scope: `/web/components/ui/*` (shadcn), `/web/app/login`, `/web/app/signup`,
`/web/app/(dashboard)/account/*`, `/web/app/(dashboard)/layout.tsx`. **No logic change.**

  - Add shadcn components as needed (themed by the mapped tokens). Implement **Task 2's redesign** for
    login, signup (incl. the age-gate/consent UI — redesigned + restyled, not rewired), and account;
    add a **minimal authed app shell** (`(dashboard)/layout.tsx`: logomark + nav slot + container) the
    dashboard sprint extends. AA throughout (labels, error association, focus order, contrast).
  - `web/app/page.tsx` (marketing) is **not** rebuilt — inherits the global shell only.

Acceptance gate before Task 8:
  - `next build` exits 0; login/signup/account render the redesign on shadcn + mapped tokens, are
    keyboard-navigable, AA-contrast; signup's age-gate/consent still functions; the existing web test
    suite still passes.

---

## Task 8 — Visual + UX + responsive + no-leak + AA QA (both targets)

Scope: cross-surface review; token/utility-level fixes only (no new surfaces).

  - **One language:** overlay, popup, login, signup, account consistent in spacing, type scale, accent
    use, focus styling, logomark treatment.
  - **UX redesign realised:** each surface matches the Task 2 spec (IA, flow, all states).
  - **Responsive:** web surfaces lay out mobile → desktop; the overlay behaves at its injected sizes.
  - **No-leak sweep:** open the overlay on several aggressive real pages (heavy CSS, resets, dark
    sites); confirm bidirectional isolation and no host DOM/font mutation.
  - **AA:** run an automated check (e.g. axe) on the web surfaces; verify contrast on the green accent
    pairs, keyboard reachability, focus visibility, and `prefers-reduced-motion` on both targets.

Acceptance gate before Task 9:
  - all checks pass; fixes are token/utility-level only.

---

## Task 9 — Tests (gate)

Scope: new `/packages/ui/**/*.test.tsx` (pure, fast) + an axe check on `/web` surfaces + the existing
`/web` suite (must stay green). No live network.

  1. **Theme tokens stable:** the exported `@theme` exposes the expected named token set + the overlay
     system-font token; a snapshot guards renames/removals.
  2. **Primitive render + a11y:** Button (variants + disabled/loading) and Field (with error/hint)
     render and apply token classes; Field associates label↔control + error via `aria-describedby`.
  3. **Reduced-motion + sr-only:** Spinner respects `prefers-reduced-motion`; VisuallyHidden hides
     visually but stays readable.
  4. **Web AA smoke:** an axe-core check on the redesigned login/signup/account surfaces reports no
     critical violations.
  5. **Web back-compat:** the full existing `/web` suite passes unchanged (the redesign changed no
     logic).
  6. **Build graph:** `turbo run typecheck lint build test` green across all workspaces.

Acceptance gate before Task 10:
  - `@calyxa/ui` suite passes in isolation; the axe check is clean; the `/web` suite passes unchanged;
    the full turbo pipeline is green; `next build` + `wxt build` exit 0.

---

## Task 10 — Manual UI/UX acceptance (manual)

With `cd web && next dev` and the unpacked extension loaded in Chrome:
  1. **Overlay on real pages:** open on 3 real math pages (Khan-style page, a PDF viewer, a heavily-
     styled site). It renders the redesign + logomark, is legible, styles do **not** leak to the host,
     host styles do **not** bleed in, and **no font/DOM is injected into the host**.
  2. **Popup:** matches the overlay's language.
  3. **Auth flow:** signup (incl. age-gate/consent), login, logout render the redesign, are keyboard-
     navigable, show accessible field errors — **with no behavior change** (accounts create, sessions
     work).
  4. **Account page:** renders the redesign; logout works.
  5. **Responsive:** web surfaces hold mobile → desktop.
  6. **Reduced motion:** with OS reduce-motion on, animations are suppressed on both targets.
  7. **Brand check:** logomark/wordmark/favicon/extension icons render crisply; the green accent + type
     read as the intended calm, education-forward identity.
  8. **No regressions:** a full tutoring session (open overlay → voice/text turn → end session) works
     exactly as before — presentation/layout only changed.

---

## Acceptance criteria (full checklist)

**Sprint status: PLANNED — not started.**

- [ ] `npm install` + `turbo run typecheck lint build test` pass from root with the new `/packages/ui`
      workspace present
- [ ] `cd web && next build` and `cd extension && wxt build` both exit 0
- [ ] a from-scratch **brand** exists — botanical logomark + wordmark + favicon + extension icons +
      `/docs/brand.md` — green accent over calm neutrals, modern geometric sans, Khan×Linear direction
- [ ] `/packages/ui` owns the tokens (Tailwind v4 `@theme`, light + dark-ready, AA-validated pairs,
      overlay system-font token) + shadow-DOM-safe primitives; **web uses shadcn/ui mapped to the same
      tokens** — one palette/type from one source
- [ ] the overlay's Tailwind compiles **into the shadow root** with preflight contained; on real
      third-party pages styles do **not** leak out, host styles do **not** bleed in, and **no host DOM
      or font is mutated/injected** (ADR-002 + read-only DOM policy upheld)
- [ ] the existing surfaces are **redesigned** (per the Task 2 spec) and rebuilt — overlay, popup,
      login, signup, account — with **no behavior change** (transports, form posts, age-gate/consent
      unchanged)
- [ ] **WCAG 2.1 AA** targeted: token contrast pairs pass, primitives + surfaces are keyboard-
      reachable with visible focus and correct ARIA, `prefers-reduced-motion` honoured; an axe check on
      the web surfaces is clean
- [ ] light theme ships; tokens are structured so **dark** is a later flip (not enabled)
- [ ] marketing page, dashboard, study-materials generator, annotations, onboarding, and billing UI
      are **not** built — each remains its own roadmap sprint that consumes this system
- [ ] no API route, no `/web/lib/*` (except the new `lib/utils.ts`), no content/background logic, no
      Supabase migration/policy, and no auth logic changed — presentation/layout only
- [ ] the `@calyxa/ui` suite + axe check pass and the existing `/web` suite passes unchanged; the full
      turbo pipeline is green
- [ ] manual acceptance (Task 10) observed: overlay no-leak/no-mutation on real pages, redesigned auth
      flow with no behavior change, responsive, reduced-motion, brand renders, full tutoring session
      still works
- [ ] `/docs/brand.md` + ADR-018 exist; both CLAUDE.md pointers + architecture.md updated; git log
      shows commits per task

---

## Risks

**Tailwind preflight leaking onto host pages.** Preflight is a global reset; escaping the shadow root
would restyle third-party pages — a direct ADR-002 violation. Mitigation: compile + inject the sheet
**into** the shadow root (WXT `cssInjectionMode`), preflight contained; Tasks 8/10 sweep real
aggressive pages for bidirectional leakage.

**Host-page CSS bleeding into the overlay.** High-specificity host rules + inheritance can reach into
a shadow root for some properties. Mitigation: shadow root + contained preflight + token defaults
(incl. the system-font token) on the overlay root neutralise inheritance; verified in Task 10.

**Font strategy regressions.** Loading a web font for the overlay would mutate the host DOM (policy
violation) or flash; a wrong system stack looks off-brand. Mitigation: overlay uses a geometric-sans
**system stack** token + **SVG** wordmark (exact letterforms); web uses the real font via `next/font`.
Recorded in ADR-018; checked in Task 10.

**Two component systems drifting (shadcn vs custom).** Web on shadcn + overlay on custom primitives
can diverge. Mitigation: the **tokens are the single source** — shadcn's CSS variables are **mapped**
to `@calyxa/ui` tokens, neither side hard-codes color; Task 8 verifies one language across both.

**shadcn + Tailwind v4 + React 19 + Next 16 setup friction.** A new toolchain combination. Mitigation:
Task 3 is wiring-only with its own gate (a mapped-token shadcn component rendering green-on-brand)
before any surface code; the shadcn MCP / `vercel:shadcn` skill is the build aid.

**AA contrast on a green accent.** Saturated green often fails text contrast on light backgrounds.
Mitigation: `/docs/brand.md` fixes **AA-validated pairs** (e.g. accent reserved for fills with
sufficiently dark green for text); axe + manual contrast checks in Tasks 8–9.

**Larger scope than a pure re-skin.** "Restyle + UX redesign + from-scratch identity + shadcn + AA"
is a big sprint (10 tasks). Mitigation: the UX spec (Task 2) front-loads decisions so implementation
is mechanical; if it overruns, the natural split is identity+tokens+shadcn (Tasks 1–5) as one sprint
and the surface redesigns (Tasks 6–10) as the next — flagged, not assumed.

**Silent behavior change during a redesign.** Rebuilding forms/controls can alter behavior (form
posts, age-gate, voice controls). Mitigation: "no logic change" is a per-task constraint; Task 9
keeps the `/web` suite green; Task 10 reconfirms a real tutoring session + auth flow end to end.

**Logomark subjectivity.** A from-scratch mark may miss on the first pass. Mitigation: direction is
locked (botanical/calyx, green, geometric); the asset is centralised (SVG + brand.md), so iteration
is a single-asset swap, not a re-theme.

---

## What the next sprint needs to know

**There is now a brand and one design language, sourced from `/packages/ui` + `/docs/brand.md`.**
Tokens are a Tailwind v4 `@theme`; the overlay uses pure shadow-DOM-safe primitives; the web app uses
**shadcn/ui mapped to the same tokens**; the identity (botanical logomark, green, geometric sans)
lives in `/docs/brand.md` with SVG assets. The next roadmap sprints **consume** this:
- **Landing/marketing sprint:** build `web/app/page.tsx` on shadcn + tokens + the logomark/OG asset;
  the global shell + fonts are already set.
- **Dashboard sprint:** build the analytics views on shadcn; **extend the `(dashboard)/layout.tsx`
  shell** added here; add chart colors as **named tokens** in `theme.css`, never hard-coded.
- **Study-materials sprint:** flashcard/practice/chart UIs use the same tokens (chart palette as
  tokens) + shadcn.
- **Billing sprint:** the upgrade/pricing UI uses shadcn + the marketing tokens.
- **Compliance/security/a11y sprint:** this sprint **targeted** WCAG AA; that sprint runs the
  **formal full audit** and may add visual-regression tooling (Storybook + screenshots) over
  `/packages/ui` + the surfaces.
- **Dark theme** is structured but **not enabled** — flipping it on is a later isolated change in
  `theme.css` + shadcn's dark variables + a toggle, not a rewrite.
- **The UX redesign spec** (`/docs/design/ux-redesign-sprint10.md`) is the record of *why* the
  surfaces are laid out as they are — extend it, don't re-derive it, when those surfaces change.
- **The brand assets/palette/type** chosen in Tasks 1/4 are centralised; a brand pivot is a
  `/docs/brand.md` + `theme.css` + asset-swap edit, not a per-surface rework.
```
