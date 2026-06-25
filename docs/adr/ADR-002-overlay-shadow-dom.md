## ADR-002: Overlay rendering — Shadow DOM via WXT createShadowRootUi

**Status:** Decided

**Context:** MathMentor renders its tutoring overlay on top of arbitrary
third-party pages the student is already viewing. The overlay must not inherit
the host page's styles, and its own styles must not leak onto the host page —
zero CSS collision in either direction, on pages whose CSS we do not control.
This has to hold alongside the locked DOM policy, under which the content
script is read-only on the host page. The options considered were light-DOM
injection with prefixed class names, an `<iframe>` overlay, and a shadow DOM.

**Decision:** Render the overlay inside an open shadow root attached to a
single extension-owned host element. The content script mounts it with WXT's
`createShadowRootUi` using `cssInjectionMode: 'ui'`, which injects the
overlay's stylesheet into the shadow root rather than the page `<head>`.

**Rationale:**
- Shadow DOM scopes selectors in both directions — host rules do not match
  inside the overlay, and overlay rules do not match the host page.
- WXT ships `createShadowRootUi` as a first-class helper, so the shadow host,
  style injection, and React mount/unmount are handled for us on the pinned
  WXT version (0.20.27).
- Mounting and removing the single host element gives full teardown on close,
  leaving zero footprint in the host page when the overlay is hidden.
- An `<iframe>` overlay was rejected: it complicates sharing the page context
  and sizing the panel to its content. Light-DOM prefixing was rejected: class
  prefixes cannot stop inherited properties (color, font, line-height) from
  leaking in.

**Consequences:**
- Enables: a fully isolated React overlay rendered on any page, with styles
  contained to the shadow root.
- Requires: an explicit reset of inherited CSS on `:host` (`all: initial`) plus
  explicit base typography, because inherited properties still cross the shadow
  boundary through the host element even though selectors do not.
- Clarifies the read-only DOM policy: the content script may append exactly one
  extension-owned shadow host as the overlay mount point (removed on
  dismissal), and must still never read-modify any node, style, or attribute
  belonging to the host page.
- Forecloses: light-DOM overlays and any global / page-level stylesheet
  injection.
