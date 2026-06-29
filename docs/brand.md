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

**Concept:** an abstracted calyx — three to four overlapping leaf/petal shapes arranged radially
around a small central bud, suggesting both a botanical calyx and an opening bloom. Drawn as flat
filled geometric shapes (no stroke outlines, no gradients, no photorealistic leaf detail) so it
survives reduction to 16px favicon size without losing legibility.

**Construction rules:**
- Built on a square aspect ratio (1:1) so it works as a standalone mark (`logomark.svg`, favicon,
  extension icon) independent of the wordmark.
- Single accent color (`--color-accent`) on a transparent or `--color-background` ground for the
  primary mark; an all-neutral-foreground variant for single-color contexts (e.g. embossed/mono
  use) is allowed but not designed this sprint — flag if a surface needs it.
- No drop shadows, no bevels, no outline stroke — flat fill only, consistent with the calm/Linear
  reference.

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

A single green accent, no secondary brand color. Calibrated for **AA text contrast at the role it's
actually used in** (a saturated mid-green that looks vivid usually fails 4.5:1 for text — the values
below are chosen specifically to pass, not just to look on-brand).

| Token | Hex | Role |
|---|---|---|
| `--color-accent` | `#15803D` | Primary actionable green — button/link fill, focus-ring core, active/selected state |
| `--color-accent-foreground` | `#FFFFFF` | Text/icon color on `--color-accent` fill |
| `--color-accent-emphasis` | `#166534` | Accent-colored **text** directly on light backgrounds (links, active nav, emphasis) — darker than `--color-accent` because text needs more contrast than a fill does |
| `--color-accent-subtle` | `#F0FDF4` | Light green tint for badges/banners/selected-row backgrounds; pairs with `--color-accent-emphasis` text, never with `--color-accent-foreground` |
| `--color-accent-fill` | `#15803D` | Stable alias for `--color-accent`'s value. shadcn's vocabulary needs `--color-accent` to mean a hover/highlight tint within `/web` (ADR-018), so anything still needing the original CTA green after that local re-mapping — e.g. shadcn's `--primary` — reads this name, not `--color-accent` |
| `--color-accent-fill-foreground` | `#FFFFFF` | Stable alias for `--color-accent-foreground`'s value, same reason — feeds shadcn's `--primary-foreground` |

**Contrast (calculated, WCAG 2.1 relative-luminance method):**

| Pair | Ratio | Passes |
|---|---|---|
| `--color-accent-foreground` (#FFF) on `--color-accent` (#15803D) | 5.01:1 | AA normal text ✅ |
| `--color-accent-emphasis` (#166534) on `--color-background` (#FFF) | 7.13:1 | AAA ✅ |
| `--color-accent-emphasis` (#166534) on `--color-accent-subtle` (#F0FDF4) | 6.81:1 | AA ✅ (near AAA) |

**Rule:** never put `--color-accent-foreground` text on anything lighter than `--color-accent`
itself — it was validated only against that one fill. Never put raw `--color-accent` as a text
color on white — use `--color-accent-emphasis` for text, `--color-accent` for fills.

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
| `--color-focus-ring` | `#15803D` (= `--color-accent`) | Focus-visible ring on every interactive primitive |

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
- **Logomark** (`logomark.svg`, `viewBox="0 0 64 64"`): three sepal shapes (one straight, two at
  ±42° rotation from a shared base anchor) plus an 8px-radius bud circle offset above and clear of
  the sepals — the negative-space gap between bud and sepals is what reads as "cradled," since the
  whole mark is one flat `--color-accent` fill with no internal stroke or second color. Verified
  legible down to 16px (rendered and visually inspected at 16/32/48/512px before finalizing).
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
  the 1200×630 canvas width.

Usage rule for all of the above: **never recolor the logomark** outside the accent/neutral tokens
defined in §4, and never apply a drop shadow, outline, or gradient to it — flat fill only, per §2.

**First-pass caveat:** this is a from-scratch mark designed and reviewed programmatically (rendered
and visually inspected at multiple sizes), not by a human designer. Per the sprint's own risk note,
a revision is a single-asset swap (`logomark.svg` + regenerate the lockup/icons/OG from it), not a
re-theme — flag here if the direction doesn't land after seeing it in place.
