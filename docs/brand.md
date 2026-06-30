# Calyxa — Brand Identity

**Status: locked direction, Sprint 10 execution.** This is the single source of truth for the
Calyxa identity. `/packages/ui/src/theme.css` (Task 3) encodes the palette/type values below as a
Tailwind v4 `@theme`; nothing here is decorative-only — every token cited has a contrast ratio or a
usage rule attached. A brand pivot is an edit to this file + `theme.css` + an asset swap, not a
per-surface rework.

References: **Khan Academy** for warmth and approachability, **Linear / Vercel** for typographic
craft and restraint. The result should read as calm and education-forward — never loud, never
corporate-cold.

---

## 1. Name & concept

**Calyxa**, from *calyx* — the ring of leaves (sepals) that cradles a flower bud before it opens.
The identity is built around that moment: protection, then growth, then opening. A student arrives
closed-off on a problem; the tutor cradles the struggle (never hands over the answer) until
understanding opens on its own. "Growth through learning," not "answers on demand."

## 2. Logomark

**Revised Sprint 10 Task 6 round 3** (Calyxa Overlay.dc.html, the locked design handoff) — replaces
the original three-petal sepal mark below entirely, including its color treatment. The historical
construction record for the retired mark is no longer reproduced here; only its viewBox convention
(64×64, reused so the lockup math in this section didn't need to change) survives.

**Concept:** a single leaf-curl stroke — an open, rounded "C" cradling a small leaf tip and a bud
dot — reading as both a calyx and the brand's own initial. Flat geometric construction (round caps,
no photorealistic leaf detail) so it still survives reduction to 16px favicon size without losing
legibility, but unlike the retired mark it is **not** flat-fill: see the gradient rule below.

**Construction rules:**
- Built on a square aspect ratio (1:1, viewBox `0 0 64 64`) so it works as a standalone mark
  (`logomark.svg`, favicon, extension icon) independent of the wordmark.
- Painted with one locked gradient — see "Mark gradient" in §4.1 — never a flat fill and never any
  other gradient. This is the brand's **one** sanctioned gradient use; every other accent surface
  (buttons, badges, the overlay's breathing glow) stays flat-fill on the `--color-accent*` tokens
  exactly as before. An all-neutral-foreground flat variant for single-color contexts (e.g.
  embossed/mono use) is allowed but not designed this sprint — flag if a surface needs it.
- No drop shadows, no bevels — otherwise consistent with the calm/Linear reference.

**Clear space:** maintain a minimum clear space around the mark equal to **25% of the mark's
height** on all sides before any other element (text, edge of container, other UI) — keeps the
calyx shape from feeling cropped at small sizes.

**Minimum size:** the standalone logomark must not render below **16px** square (favicon floor).
Below 24px, drop the wordmark from any lockup — at that size the wordmark is illegible and the mark
alone must carry the brand.

**Lockup (logo.svg):** logomark to the left, wordmark to the right, vertically centered, separated
by a gap equal to **0.5×** the mark's height. Minimum lockup width before switching to mark-only:
**120px**.

## 3. Wordmark

Set in the brand geometric sans (§5) at **semibold (600)** weight, lowercase ("calyxa") — lowercase
reads warmer and less corporate than full caps, consistent with the Khan-Academy-warmth reference,
while semibold keeps it crisp rather than soft. Letter-spacing: default (no manual tracking) — the
geometric sans's natural spacing at semibold is already even at small sizes.

Because the overlay cannot load a web font without mutating the host page (see §5 and ADR-018), the
wordmark is shipped as a **static SVG** with the letterforms outlined as paths, not live text. This
is what makes the wordmark render identically in the overlay (system-font environment) and on the
web (real brand font) — the asset carries the exact shape either way.

## 4. Color

### 4.1 Accent — green

A single green accent, no secondary brand color. **Revised post-Sprint-10-Task-6** (overlay/popup
redesign round 2): the original palette below paired a dark fill with white text/icon — a
deliberately calmer "Khan Academy warmth" attempt at a lighter, airier identity (Wispr Flow / Gemini
voice-UI inspired) called for a genuinely lighter green, which a dark fill can't deliver. The fix is
a **light fill + dark text/icon** pattern instead of dark-fill-white-text — light backgrounds are far
more forgiving for AA contrast than dark ones, so this is *more* robust, not less. Calibrated for
**AA text contrast at the role it's actually used in** — the values below are chosen specifically to
pass, not just to look on-brand.

| Token | Hex | Role |
|---|---|---|
| `--color-accent` | `#86EFAC` | Primary actionable green — button/active-state **fill** (light; pair with `--color-accent-foreground`, never white, for text/icons on top) |
| `--color-accent-foreground` | `#14532D` | Text/icon color on `--color-accent` (or any accent-family) fill — dark, not white, per the light-fill pattern above |
| `--color-accent-emphasis` | `#166534` | Accent-colored **text** directly on light/white backgrounds (links, active nav, emphasis) |
| `--color-accent-subtle` | `#F0FDF4` | Light green tint for badges/banners/selected-row backgrounds; pairs with `--color-accent-emphasis` text |
| `--color-accent-glow` | `#BBF7D0` | **Decorative only** — inner stop of the ambient/breathing glow gradient (capsule, Gemini-style input bar). Never used for text/icons; exempt from contrast rules as non-text decoration |
| `--color-accent-glow-strong` | `#4ADE80` | **Decorative only** — outer/mid stop of the same glow gradient, and the "active" fill for a pressed toggle (e.g. the overlay mic while recording) — pair with `--color-accent-foreground` text/icon on top, same dark-on-light rule |
| `--color-accent-fill` | `#86EFAC` | Stable alias for `--color-accent`'s value. shadcn's vocabulary needs `--color-accent` to mean a hover/highlight tint within `/web` (ADR-018), so anything still needing the real brand green after that local re-mapping — e.g. shadcn's `--primary` — reads this name, not `--color-accent` |
| `--color-accent-fill-foreground` | `#14532D` | Stable alias for `--color-accent-foreground`'s value, same reason — feeds shadcn's `--primary-foreground` |

**Contrast (calculated, WCAG 2.1 relative-luminance method):**

| Pair | Ratio | Passes |
|---|---|---|
| `--color-accent-foreground` (#14532D) on `--color-accent` (#86EFAC) | 6.49:1 | AA ✅ (near AAA) |
| `--color-accent-emphasis` (#166534) on `--color-background` (#FFF) | 7.13:1 | AAA ✅ |
| `--color-accent-emphasis` (#166534) on `--color-accent-subtle` (#F0FDF4) | 6.81:1 | AA ✅ (near AAA) |

**Rule:** never put light text/icon (white or near-white) on any accent-family fill — every fill in
this family (`accent`, `accent-glow-strong`, `accent-subtle`) is light enough that only
`--color-accent-foreground`/`--color-accent-emphasis` (dark) read correctly on it. `--color-accent-glow`/
`--color-accent-glow-strong` are decorative-gradient-only — never apply them as a text or icon color.

**Focus ring is intentionally decoupled from `--color-accent` now:** `--color-focus-ring` stays at the
*original* darker green (`#15803D`, see §4.2) because a focus indicator must clear the WCAG 1.4.11
3:1 non-text minimum against the page background, and the new lighter `--color-accent` does not (a
light green ring on a white/light page is barely visible). One token, one job: `--color-accent` is
now the brand's light decorative/fill green; `--color-focus-ring` is whatever green is dark enough to
always be seen.

#### Mark gradient — logomark only

The logomark (§2) is the one surface in the brand that uses a gradient instead of a flat fill — a
locked three-stop linear gradient (`x1=0 y1=0 x2=0.85 y2=1`, i.e. roughly top-left to bottom-right),
drawn from the same green family as the flat accent tokens above but not itself tokenized as a
Tailwind `@theme` value (it's SVG-only — used directly in the `CalyxaMark` primitive and the static
`logo.svg`/`logomark.svg`/`icon.svg` files, never as a CSS utility, so a `--color-*` entry here would
have no consumer):

| Stop | Hex | Position |
|---|---|---|
| Start | `#7BEDAA` | 0% |
| Mid | `#3FD07A` | 50% |
| End | `#1F9D5B` | 100% |

**Rule:** every shipped copy of the mark (`@calyxa/ui`'s `CalyxaMark`, `/web/public/logo.svg`,
`logomark.svg`, `/web/app/icon.svg`, the rasterized extension icons) uses this exact gradient,
generated with a per-instance gradient `id` where the mark can render multiple times in one SVG
namespace (`CalyxaMark` does this via React's `useId`) — never recolored to a flat fill or any other
hex/gradient outside the accent/neutral tokens, per §8's usage rule.

### 4.2 Neutrals — calm, warm-tinted grey (not cold slate)

| Token | Hex | Role |
|---|---|---|
| `--color-background` | `#FFFFFF` | Page/app background |
| `--color-surface` | `#F7F7F5` | Card/panel/popup surface, one step off background |
| `--color-border` | `#E5E3DE` | Decorative hairlines/dividers (paired with spacing/shadow, not the sole boundary cue) |
| `--color-border-strong` | `#79766E` | Interactive-component boundaries (input, outline-button) — meets the 3:1 **non-text** contrast WCAG 1.4.11 requires for UI component boundaries |
| `--color-foreground` | `#1C1C1A` | Primary text |
| `--color-muted-foreground` | `#6B6B65` | Secondary text, hints, placeholders |
| `--color-danger` | `#B91C1C` | Error state (text + icon) |
| `--color-danger-foreground` | `#FFFFFF` | Text on a `--color-danger` fill |
| `--color-focus-ring` | `#15803D` (independent of `--color-accent` — see §4.1) | Focus-visible ring on every interactive primitive |

**Contrast (calculated):**

| Pair | Ratio | Passes |
|---|---|---|
| `--color-foreground` on `--color-background` | 17.06:1 | AAA ✅ |
| `--color-muted-foreground` on `--color-background` | 5.36:1 | AA ✅ |
| `--color-danger` on `--color-background` | 6.47:1 | AA ✅ |
| `--color-border-strong` on `--color-background` | 4.54:1 | exceeds 3:1 non-text minimum ✅ |
| `--color-border` on `--color-background` | 1.28:1 | **decorative only** — do not rely on it as the sole edge of an input or button; those use `--color-border-strong` |

### 4.3 Dark — declared, not enabled

`theme.css` declares a `.dark` (or `[data-theme="dark"]`) block with the same token *names* mapped
to dark-appropriate values, but it is **not wired to any toggle this sprint**. Placeholder dark
values are not finalized here — that is the dark-theme sprint's job; Task 3 only needs the selector
shell to exist so flipping it on later is additive, not a rewrite.

## 5. Type

**Web (`/web`):** **Geist Sans** (Vercel's geometric sans — directly on-brand for the Linear/Vercel
craft reference), loaded via `next/font` so it's self-hosted and first-party (no third-party font
request). Weights used: 400 (body), 500 (medium emphasis/labels), 600 (semibold — headings,
wordmark), 700 (rare, strong emphasis only).

**Overlay (`/extension`):** cannot load any web font — doing so would either fetch a resource into
the host page's network context or require a `<link>`/`@font-face` that risks host DOM mutation,
both against the locked read-only DOM policy. The overlay uses a **system-font stack token**
instead:

```
--font-system-stack: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI",
  Roboto, Helvetica, Arial, sans-serif;
```

This already matches the family the hand-written `Overlay.css` used pre-Sprint-10 (`-apple-system,
BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif`), now formalized as a named
token with `ui-sans-serif`/`system-ui` added first per modern stack convention. It reads as
"geometric-sans-adjacent" on every platform (San Francisco, Segoe UI, Roboto are all geometric/
humanist sans) without ever fetching a font file. The logomark + wordmark are shipped as SVG (§2–3)
specifically so the *brand letterforms* don't depend on this fallback — only body/UI text does.

**Type scale** (both targets share this scale; only the family token differs):

| Token | Size / line-height | Typical use |
|---|---|---|
| `--text-xs` | 12px / 16px | micro-labels, badges |
| `--text-sm` | 14px / 20px | secondary text, form hints, overlay body |
| `--text-base` | 16px / 24px | default body |
| `--text-lg` | 18px / 28px | emphasized body, card titles |
| `--text-xl` | 20px / 28px | section headings |
| `--text-2xl` | 24px / 32px | page headings |
| `--text-3xl` | 30px / 36px | hero/auth-page headings |
| `--text-4xl` | 36px / 40px | wordmark-adjacent display (rare; web only) |

**Weights:** 400 regular (body), 500 medium (labels, nav), 600 semibold (headings, wordmark), 700
bold (rare strong emphasis). The overlay restricts itself to 400/500/600 — at small injected sizes,
700 on a system font reads heavier than intended.

## 6. Spacing, radius, shadow, motion

Tokenized in `theme.css` (Task 3), referenced here for completeness:
- **Spacing:** standard 4px base scale (4/8/12/16/24/32/48/64).
- **Radius:** `--radius-sm` (6px, inputs/buttons), `--radius-md` (10px, cards), `--radius-lg` (16px,
  the overlay panel) — rounded but not pill-shaped; reads calm, not playful.
- **Shadow:** a single soft elevation token (`--shadow-panel`) for the overlay panel and popovers —
  low-opacity, large-blur, no hard edges.
- **Motion:** short durations (150–200ms), ease-out, used for hover/focus/open-close transitions
  only — every motion token has a `prefers-reduced-motion` no-op fallback (animation/transition
  disabled, end-state applied instantly). No motion is load-bearing for comprehension.

## 7. Voice & tone

Calm, encouraging, precise — a patient tutor, not a hype product. Concretely:
- **Never gives the answer.** Copy (button labels, empty/error states, onboarding-adjacent text)
  reflects the Socratic posture: "Let's look at this together," not "Here's the solution."
- **Plain language over jargon.** No "leverage," "unlock," "supercharge." Khan Academy's
  matter-of-fact warmth over SaaS-marketing energy.
- **Short sentences, active voice.** Error messages say what happened and what to do next, not
  apologize at length.
- **Confident, not cute.** No exclamation-point enthusiasm, no emoji in product copy. The craft
  comes from restraint (Linear/Vercel), the warmth from plain, human phrasing (Khan Academy) — the
  two references are a balance, not a 50/50 split per surface.

## 8. Assets (produced in Task 4)

| Asset | Path | Notes |
|---|---|---|
| Logomark + wordmark lockup | `/web/public/logo.svg` | primary lockup, §2–3 rules |
| Logomark only | `/web/public/logomark.svg` | square, for favicon/avatar contexts |
| Favicon | `/web/app/icon.svg` | Next.js auto-favicon convention (file-based metadata, no `layout.tsx` edit needed); identical content to `logomark.svg` |
| OG image | `/web/public/og.png` | 1200×630, social preview; consumed by the (later) marketing sprint |
| Extension icons | `/extension/public/icon/{16,32,48,128}.png` | rasterized from `logomark.svg`; WXT auto-discovers the `icon/<size>.png` convention and populates `manifest.icons` — no `wxt.config.ts` edit needed (verified via `wxt build`) |

**Construction record:**
- **Logomark** (`logomark.svg`, `viewBox="0 0 64 64"`, redesigned Sprint 10 Task 6 round 3): one
  open, rounded-cap stroke curling from (52,37) up and around to (45,51) — the "calyx" — plus a
  small leaf-tip shape (rotated 32° off an anchor at (44,13)) and a 4px-radius bud dot at (40,35)
  sitting in the curl's negative space. All three shapes share the one locked linear gradient (§4.1
  "Mark gradient"), not a flat fill — the only place in the brand a gradient is used. Verified
  legible down to 16px (rasterized via `sharp` at 16/32/48/128px for the extension icons; visually
  inspected at each size before finalizing).
- **Wordmark**: not a separate shipped file — it is real Geist Sans **outlined to vector paths** at
  weight 600 (the brand's locked semibold), not live `<text>`. Outlines were extracted by
  instancing the actual variable Geist Sans binary `next/font/google` resolves to in this repo
  (`fontTools.varLib.instancer` pinned to `wght=600`, glyph contours exported via `SVGPathPen`),
  so the lockup's letterforms are pixel-for-pixel the brand font's real semibold shapes, not an
  approximation — satisfying §3's "carries the exact shape" requirement.
- **Lockup** (`logo.svg`): mark height 64 units, gap = 32 units (0.5× mark height, per §2), wordmark
  cap-height scaled to 0.6× mark height and vertically centered on the mark's bounding-box midline;
  total viewBox `0 0 268.04 64`.
- **OG image**: lockup composed on a `--color-surface` (`#f7f7f5`) ground, centered, scaled to 60% of
  the 1200×630 canvas width. Regenerated from the new `logo.svg` this round (same composition rule,
  unchanged from the original).

Usage rule for all of the above: **never recolor the logomark** outside the gradient defined in
§4.1, and never substitute a flat fill or any other gradient — the locked "Mark gradient" is the
one and only treatment, per §2.

**Provenance:** this mark shipped via a Claude Design handoff (`Calyxa Overlay.dc.html`), not a
from-scratch programmatic generation like the retired mark — Darcy mocked it up in Claude Design and
this sprint implemented it pixel-for-pixel from that source (gradient stops, path geometry, and
viewBox all read directly off the handoff file, not approximated). A revision is still a
single-asset swap (`logomark.svg` + regenerate the lockup/icons/OG from it), not a re-theme — flag
here if the direction doesn't land after seeing it in place.
