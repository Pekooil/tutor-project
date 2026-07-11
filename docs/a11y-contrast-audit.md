# A11y contrast audit — Sprint 18 (ADR-044)

**Status: PASS.** Every new token introduced since the Sprint 10 AA baseline —
the Sprint 14 tag-kind + annotation-ordinal palette and the degraded/resting
overlay states — clears its WCAG 2.1 target: **4.5:1** for text, **3:1** for
non-text UI (component boundaries, focus rings, decorative strokes).

## Why this doc exists

jsdom computes no CSS layout or cascade, so `axe-core`'s `color-contrast` rule
is unreliable there. Both automated a11y specs therefore **disable** it:

- `web/tests/axe-web-surfaces.test.ts` (login/signup/account), and
- `extension/tests/a11y-overlay.test.ts` (overlay + popup + Sprint 14/17 surfaces).

Those specs cover the structural rules jsdom *can* evaluate (roles, labels,
names, focus order, aria-\*). Contrast is the one thing they can't — this
manual pass is that gap's coverage, per ADR-044 decision 3 ("a11y coverage
extends to the extension, accepting jsdom's limits … the contrast pass is done
manually against brand.md's AA pairs").

## Method

Ratios below are computed with the WCAG 2.1 relative-luminance method (sRGB,
the same method `brand.md` §4.1/§4.2 and `packages/ui/src/theme.css` use) and
**independently recomputed** for this audit; they agree with the values already
documented in `theme.css` (lines ~154–176) within rounding. Source of truth for
the hexes: `packages/ui/src/theme.css`. Surfaces the overlay actually paints on:
`--color-background` `#FFFFFF` (web) and `--color-surface` `#F7F7F5` (the overlay
panel / popup card).

## 1. Baseline accent + neutral pairs (brand.md §4.1–4.2)

The foundation every new token builds on — restated here so the audit is
self-contained; unchanged since Sprint 10.

| Pair | Ratio | Target | Result |
|---|---|---|---|
| `--color-accent-foreground` `#14532D` on `--color-accent` `#86EFAC` | 6.49:1 | 4.5 (text) | ✅ AA |
| `--color-accent-emphasis` `#166534` on `--color-background` `#FFF` | 7.13:1 | 4.5 (text) | ✅ AAA |
| `--color-accent-emphasis` `#166534` on `--color-accent-subtle` `#F0FDF4` | 6.81:1 | 4.5 (text) | ✅ AA |
| `--color-foreground` `#1C1C1A` on `#FFF` | 17.06:1 | 4.5 (text) | ✅ AAA |
| `--color-muted-foreground` `#6B6B65` on `#FFF` | 5.36:1 | 4.5 (text) | ✅ AA |
| `--color-danger` `#B91C1C` on `#FFF` | 6.47:1 | 4.5 (text) | ✅ AA |

## 2. Sprint 14 tag-kind palette (`--calyxa-tag-*`)

Grounding-tag / status-pin text, rendered on the overlay surface `#F7F7F5`.
Five kinds, four AA-verified hues (two kinds share accent-emphasis).

| Token | Hex | On | Ratio | Result |
|---|---|---|---|---|
| `--calyxa-tag-reviewing` (= accent-emphasis) | `#166534` | `#F7F7F5` | 6.65:1 | ✅ AA |
| `--calyxa-tag-strength` (= accent-emphasis) | `#166534` | `#F7F7F5` | 6.65:1 | ✅ AA |
| `--calyxa-tag-gap` (= danger) | `#B91C1C` | `#F7F7F5` | 6.03:1 | ✅ AA |
| `--calyxa-tag-due` | `#2563EB` | `#F7F7F5` | 4.82:1 | ✅ AA (tightest text pair) |
| `--calyxa-tag-callback` (= muted-foreground) | `#6B6B65` | `#F7F7F5` | 5.00:1 | ✅ AA |

**Reserved (not a regression):** amber was deliberately *not* added as a fifth
tag-kind hue — it measures ~2.97:1 on `--color-surface`, failing the 4.5:1 text
minimum. `theme.css` records this and reserves amber for the annotation layer's
non-text fill/stroke use only (`--calyxa-annot-2`). A real finding, already
handled in design.

## 3. Annotation-ordinal palette (`--calyxa-annot-1..4`)

Per-turn annotation colors. The **`-deep` on `-tint`** pair is the only one used
as *text* (the annotation note label, `.cx-annot-text-annot-N`); the plain
stroke/fill tokens are **non-text** (SVG box/circle/arrow strokes and washes),
held to the 3:1 UI-boundary minimum, not 4.5:1.

| Ordinal | Text: `-deep` on `-tint` | Ratio | Result | Stroke (non-text) vs `#F7F7F5` |
|---|---|---|---|---|
| 1 | `#166534` on `#F0FDF4` | 6.81:1 | ✅ AA text | `#1F9D5B` — ✅ >3:1 |
| 2 | `#8A4106` on `#FBF3E4` | 6.71:1 | ✅ AA text | `#B45309` — ✅ >3:1 |
| 3 | `#2C5288` on `#EFF4FB` | 7.12:1 | ✅ AA text | `#3B6BB0` — ✅ >3:1 |
| 4 | `#7C4370` on `#FAF2F8` | 6.61:1 | ✅ AA text | `#9D5B8F` — 4.52:1 ✅ >3:1 |

## 4. Degraded / resting states

| State | Pair | Ratio | Target | Result |
|---|---|---|---|---|
| **Degraded** (free-limit "on the house" card — popup + overlay) | `--color-accent-emphasis` `#166534` text on `--color-accent-subtle` `#F0FDF4` | 6.81:1 | 4.5 (text) | ✅ AA |
| **Resting** (composer placeholder, "Reading the page…", quota hint) | `--color-muted-foreground` `#6B6B65` on `#F7F7F5` | 5.00:1 | 4.5 (text) | ✅ AA |
| **Resting** (same, on `#FFF`) | `#6B6B65` on `#FFFFFF` | 5.36:1 | 4.5 (text) | ✅ AA |

## 5. Non-text UI (WCAG 1.4.11, 3:1)

| Token | Hex | On | Ratio | Result |
|---|---|---|---|---|
| `--color-focus-ring` | `#15803D` | `#FFFFFF` | 5.02:1 | ✅ (decoupled from accent precisely so it clears 3:1) |
| `--color-border-strong` (input/outline-button edges) | `#79766E` | `#FFFFFF` | 4.54:1 | ✅ |

Note: `--color-border-strong` on `--color-surface` `#F7F7F5` is 4.23:1 — just
under 4.5, but it is a **non-text** boundary (3:1 minimum), and interactive
borders sit against `#FFFFFF` where it is 4.54:1. Non-issue.

## 6. Decorative-only, exempt from contrast

Non-text decoration under WCAG 1.4.3/1.4.11 — never a text or icon color:

- `--color-accent-glow` `#BBF7D0`, `--color-accent-glow-strong` `#4ADE80` — the
  ambient/breathing-glow gradient stops (capsule input bar, mic-pressed fill).
  Where the pressed mic shows an icon, that icon uses `--color-accent-foreground`
  (dark), covered by §1's 6.49:1 pair.
- `--calyxa-progress` (= `#4ADE80`) — the composer's solution-progress bar fill.
- `--calyxa-annot-*-fill` — the translucent annotation washes behind marks.

## Escalation

This manual pass covers the tokens; the automated specs cover structure. If a
future surface needs *automated* contrast proof (true rendered-pixel ratios),
the escalation is a real-browser axe run (Playwright) — flagged in the sprint
plan's risks, deliberately not built here.
