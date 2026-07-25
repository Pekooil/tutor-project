import type { CSSProperties } from 'react'

// Notebook Studio design tokens — every value here is a `var()` reference into
// `@calyxa/ui/theme.css`, never a literal. The design handoff lists hexes only so
// the mapping can be verified; the shipped tokens are the source of truth, which
// is also what makes the studio theme-aware for free (the toggle stamps
// `data-theme="dark"` on <body> and theme.css's dark block re-points these).
//
// `--studio-card` / `--studio-hover` are the two values the token set does not
// already name; they are defined once in globals.css under `.cx-studio`, derived
// from `--color-background` / `--color-foreground` so they follow the theme.

export const T = {
  bg: 'var(--color-background)',
  card: 'var(--studio-card)',
  surface: 'var(--color-surface)',
  hover: 'var(--studio-hover)',
  border: 'var(--color-border)',
  borderStrong: 'var(--color-border-strong)',
  /** A VISIBLE frame, for a card sitting on another card.
   *
   *  `border` is invisible in dark mode (measured 1.19–1.47:1 against the surfaces
   *  either side). That is fine where a card sits on the page — the background
   *  step separates it — but a card-on-card has no step to lean on, and the drop
   *  shadow that carries it in light mode does nothing on a dark surface. Use
   *  `frame` whenever a bordered box sits inside another bordered box. */
  frame: 'var(--studio-frame)',
  ink: 'var(--color-foreground)',
  /** Secondary body text — dimmer than `ink`, but still real body copy, unlike
   *  `muted` which is for labels and metadata.
   *
   *  Measured on the raised why-note surface in dark: `ink` is 10.86:1 (bright
   *  enough to shout), `muted` only 4.23:1 (under the 4.5:1 AA floor for text at
   *  this size). This lands at 7.6:1 — visibly softer without dropping below the
   *  bar. It is theme.css's own chip-text token, not a bespoke grey. */
  inkSoft: 'var(--calyxa-chip-text)',
  muted: 'var(--color-muted-foreground)',
  danger: 'var(--color-danger)',

  accent: 'var(--color-accent)',
  onAccent: 'var(--color-accent-foreground)',
  accentInk: 'var(--color-accent-emphasis)',
  accentSubtle: 'var(--color-accent-subtle)',
  focus: 'var(--color-focus-ring)',

  // Annotation ordinals ("Meadow", ADR-029). 1 = solid/correct, 2 = the
  // misconception amber, 3 = the flashcards blue / due-for-review.
  a1: 'var(--calyxa-annot-1)',
  a1Tint: 'var(--calyxa-annot-1-tint)',
  a1Edge: 'var(--calyxa-annot-1-tint-border)',
  a1Deep: 'var(--calyxa-annot-1-deep)',
  a2: 'var(--calyxa-annot-2)',
  a2Tint: 'var(--calyxa-annot-2-tint)',
  a2Edge: 'var(--calyxa-annot-2-tint-border)',
  a2Deep: 'var(--calyxa-annot-2-deep)',
  a3: 'var(--calyxa-annot-3)',
  a3Tint: 'var(--calyxa-annot-3-tint)',
  a3Edge: 'var(--calyxa-annot-3-tint-border)',
  a3Deep: 'var(--calyxa-annot-3-deep)',

  // Ordinal-coloured TEXT ON A NEUTRAL SURFACE (a card, or `--color-surface`).
  //
  // The `-deep` values above are the right ink only ON THE MATCHING TINT — that
  // is the single pairing ADR-029 AA-verified, and theme.css gives the annotation
  // ordinals no dark variant at all, so `-deep` stays a dark hue in dark mode.
  // Put it on a dark card and it measures ~2.5:1.
  //
  // These two route through tokens theme.css DOES flip, so they stay legible in
  // both themes: accent-emphasis is #166534 → #86efac, and the watch tone is
  // #92400e → #fde68a. Use `aNDeep` on a tint; use these anywhere else.
  ink1: 'var(--color-accent-emphasis)',
  ink2: 'var(--calyxa-ping-watch-text)',
} as const

// Shadows from the handoff. `--shadow-panel` is the brand's one named shadow and
// covers the popover; the rest are the same ink at lighter weights.
export const SHADOW = {
  pill: '0 1px 2px rgb(15 23 42 / 0.06)',
  card: '0 2px 8px rgb(15 23 42 / 0.05)',
  note: '0 4px 14px rgb(15 23 42 / 0.08)',
  flashcard: '0 6px 20px rgb(15 23 42 / 0.08)',
  popover: 'var(--shadow-panel)',
  // The extension's ambient-pill breathing glow, on the accent-glow tokens.
  composer:
    '0 0 0 1px color-mix(in srgb, var(--color-accent-glow-strong) 18%, transparent), 0 0 26px color-mix(in srgb, var(--color-accent-glow-strong) 30%, transparent)',
} as const

/** Motion routed through theme.css's duration tokens, which already zero
 *  themselves under `prefers-reduced-motion: reduce`. */
export const MOTION = {
  fast: 'var(--motion-duration-fast)',
  base: 'var(--motion-duration-base)',
  ease: 'var(--motion-ease-out)',
} as const


export const eyebrow: CSSProperties = {
  fontSize: 10.5,
  fontWeight: 700,
  letterSpacing: '0.12em',
  textTransform: 'uppercase',
}

export const cardBox: CSSProperties = {
  background: T.card,
  border: `1px solid ${T.border}`,
  borderRadius: 14,
}

/** The accent-filled action button (brand rule: light fill, dark text — never
 *  light text on an accent fill). */
export const accentButton: CSSProperties = {
  background: T.accent,
  color: T.onAccent,
  border: 'none',
  borderRadius: 12,
  fontWeight: 700,
  cursor: 'pointer',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 8,
  textDecoration: 'none',
}

export const ghostButton: CSSProperties = {
  background: T.card,
  color: T.ink,
  border: `1px solid ${T.border}`,
  borderRadius: 12,
  fontWeight: 600,
  cursor: 'pointer',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 8,
  textDecoration: 'none',
}

export const pill: CSSProperties = {
  borderRadius: 999,
  fontWeight: 600,
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  whiteSpace: 'nowrap',
}

/** The three ordinal "sets" the design names — tint fill, tint border, deep
 *  text — used for status chips, flags and result states. */
export const ORDINAL = {
  green: { background: T.a1Tint, border: `1px solid ${T.a1Edge}`, color: T.a1Deep },
  amber: { background: T.a2Tint, border: `1px solid ${T.a2Edge}`, color: T.a2Deep },
  blue: { background: T.a3Tint, border: `1px solid ${T.a3Edge}`, color: T.a3Deep },
  neutral: { background: T.card, border: `1px solid ${T.border}`, color: T.muted },
  danger: {
    background: 'color-mix(in srgb, var(--color-danger) 8%, var(--color-background))',
    border: '1px solid color-mix(in srgb, var(--color-danger) 35%, transparent)',
    color: T.danger,
  },
} as const

export type OrdinalKey = keyof typeof ORDINAL
