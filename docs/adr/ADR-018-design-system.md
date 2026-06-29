## ADR-018: Design system — Tailwind v4 tokens in `@calyxa/ui`, shadcn/ui for web mapped to the same tokens, shadow-DOM injection with a no-host-mutation font strategy

**Status:** Decided

**Context:** Through Sprint 09 the product works end to end (overlay, voice pipeline, Claude proxy,
auth/RLS, the full FSRS learning model) but has no brand and no shared styling system. `/web` has no
Tailwind, no global stylesheet, no font setup, and no component library — `app/layout.tsx` renders a
bare `<body>`, and login/signup/account are unstyled. The extension overlay is styled by a
hand-written `extension/src/overlay/Overlay.css` with no shared tokens; the popup is ad hoc. Nothing
ties the two render targets to one visual language, so every future surface would drift further.

This also reopens two recommendations from `/docs/PLAN.md` §2.1 that were never formally reconciled:
**(a)** PLAN recommended Preact + Vite for the overlay to minimize injected bundle size, but ADR-001
(Sprint 01) already specified WXT "to support React + TypeScript," and the extension has depended on
`react`/`react-dom` since Sprint 01 — the Preact line was effectively superseded before this sprint,
just never recorded; **(b)** PLAN recommended Tailwind CSS scoped inside the shadow root from the
start, but it was never installed — `Overlay.css` is hand-written plain CSS. A decision was needed
on how to build the brand + styling layer without re-opening either point, and on how the overlay
(shadow-DOM, third-party host pages, read-only DOM policy) and the web app (first-party Next.js page)
should relate to each other given they cannot safely share one component library.

**Decision:**
1. **Tokens live once, in a pure package.** `/packages/ui` (new) exports `theme.css` — a Tailwind v4
   `@theme` block defining the brand palette (green accent + warm neutral ramp, AA-validated pairs
   per `/docs/brand.md`), type scale (including an overlay system-font-stack token), spacing, radius,
   shadow, and motion (reduced-motion-safe). Light values ship now; a dark selector block is declared
   but not wired to any toggle.
2. **Two component systems, one token source.** The web app (`/web`) adopts **shadcn/ui**, with its
   CSS variables (`--primary`, `--background`, `--ring`, …) **mapped** to the `@calyxa/ui` token
   values in `globals.css` — shadcn supplies velocity and accessible primitives on a first-party
   page. The overlay uses **custom shadow-DOM-safe primitives** built directly in `@calyxa/ui`
   (`Button`, `Field`, `Card`, `Spinner`, `VisuallyHidden`) — shadcn's document-oriented assumptions
   (portals to `document.body`, global CSS variable lookups at `:root`) are unsafe inside a shadow
   root injected into an arbitrary third-party page. Neither side hard-codes a color; both read the
   same token values, so "one brand, two implementations" doesn't drift.
3. **Tailwind v4 in both build pipelines, contained to the shadow root for the overlay.** `/web` adds
   `tailwindcss` + `@tailwindcss/postcss`; `/extension` adds `tailwindcss` + `@tailwindcss/vite`,
   registered in `wxt.config.ts` so the compiled sheet is injected **into the shadow root** via WXT's
   `cssInjectionMode`, not the host page `<head>` — this is PLAN §2.1's original Tailwind
   recommendation, finally implemented, on v4's CSS-first `@theme` rather than a JS config.
4. **React, not Preact, is the recorded renderer for the overlay** — formalizing what ADR-001 already
   implied and Sprint 01–09 already built. This ADR supersedes the PLAN §2.1 Preact/Vite line; it is
   not re-litigated.
5. **No-host-mutation font strategy.** `/web` loads the brand geometric sans (Geist Sans) via
   `next/font` — first-party, fine. The overlay cannot load any web font without either fetching a
   resource in the host page's network context or risking a DOM mutation to inject `@font-face`/
   `<link>`, both against the locked read-only-content-script policy. The overlay instead declares a
   geometric-sans **system-stack** token (`ui-sans-serif, system-ui, -apple-system, …`) and ships the
   logomark + wordmark as **SVG** so the brand letterforms are exact regardless of the runtime font.

**Rationale:**
- A single CSS-variable token source is the only way two different component libraries (shadcn,
  custom primitives) stay visually identical over time without a shared component dependency, which
  the shadow-DOM constraint rules out.
- shadcn on `/web` is a velocity and accessibility win where its document-oriented assumptions are
  harmless (first-party page, real `document.body`); building shadcn-equivalent primitives by hand
  for the overlay would be the constrained case re-litigated for the unconstrained one.
- Tailwind compiled into the shadow root (not the host `<head>`) is the only way to get utility-class
  velocity without violating ADR-002's bidirectional no-leak guarantee — this was already PLAN's
  call, just unbuilt until now.
- Recording the React-over-Preact reality now (rather than re-deciding it) avoids re-opening a
  renderer migration that would touch every overlay file for a bundle-size concern not raised as a
  problem in nine shipped sprints.
- A system-font stack + SVG wordmark is the only font strategy that satisfies the read-only DOM
  policy unconditionally — every alternative (`@font-face` in the shadow root via a `<style>` the
  content script injects, a `<link>` to a hosted font) either mutates host-adjacent DOM or risks
  unreliable shadow-root font loading across arbitrary third-party hosts.

**Consequences:**
- Enables: one brand (`/docs/brand.md`) expressed identically across `/web` and the overlay from one
  token source; `/web` builds on shadcn's accessible component baseline instead of hand-rolling
  inputs/buttons/forms; the overlay gains a real design system without taking on shadcn's
  document-oriented risk inside a shadow root; future surfaces (dashboard, billing, marketing)
  inherit the tokens + shadcn baseline with no further wiring.
- Requires: every new color in either app to be added as a named token in `@calyxa/ui/theme.css`
  first, never hard-coded in a component; `/web/app/globals.css` to keep the shadcn-variable-to-token
  mapping in sync whenever a token is renamed; the overlay's WXT build to keep `cssInjectionMode`
  pointed at the shadow root for any future entry point that renders UI; the PLAN §2.1 Preact/Vite
  line to be read as superseded by this ADR, not as still-open.
- Forecloses: shadcn (or any document-oriented component library) inside the overlay's shadow root;
  any `@font-face`/`<link>` font loading from the content script or overlay bundle; a second,
  divergent color/spacing source in either app; re-litigating React vs. Preact for the existing
  overlay code without a new, concrete problem (not just bundle-size-in-the-abstract) motivating it.
