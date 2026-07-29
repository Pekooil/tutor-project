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
  /** The second glass weight — strips, bands and the rail. */
  cardSoft: 'var(--studio-card-soft)',
  topbar: 'var(--studio-topbar)',
  /** The four raised steps, brightest first: composer + flip-card face (0),
   *  why-note + chat bubble (2), ghost button (3), inner row fill (4). */
  raised: 'var(--studio-raised)',
  raised2: 'var(--studio-raised-2)',
  raised3: 'var(--studio-raised-3)',
  raised4: 'var(--studio-raised-4)',
  field: 'var(--studio-field)',
  row: 'var(--studio-row)',
  surface: 'var(--color-surface)',
  hover: 'var(--studio-hover)',
  border: 'var(--color-border)',
  borderStrong: 'var(--color-border-strong)',
  /** An in-card rule. Lighter than a card edge — see RULE below. */
  hairline: 'var(--studio-hairline)',
  /** A meter's unfilled groove. */
  track: 'var(--studio-track)',
  /** The neutral (non-status) chip fill. */
  chip: 'var(--studio-chip)',
  dotInactive: 'var(--studio-dot-inactive)',
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
  /** Quieter than `muted` — dates, counters, day-of-month ticks. Never body copy. */
  faint: 'var(--studio-faint)',
  faintRule: 'var(--studio-faint-rule)',
  danger: 'var(--color-danger)',

  /** The brand's filled CTA — light green fill, dark green text.
   *
   *  Deliberately NOT `--color-accent`. `globals.css` re-targets that name to
   *  shadcn's "accent", which means a hover/highlight SURFACE, not our button
   *  fill — and it says so in its own header comment, pointing at
   *  `--color-accent-fill` as "the collision-proof alias" for the original
   *  green. Reading `--color-accent` here resolved to the pale hover tint
   *  (#f0fdf4 measured in the browser) instead of the specified #86efac, so
   *  every filled button in the studio was rendering as a near-white pill. */
  accent: 'var(--color-accent-fill)',
  onAccent: 'var(--color-accent-fill-foreground)',
  accentInk: 'var(--color-accent-emphasis)',
  /** Accent text ON a mint tint (deeper than `accentInk` in light, brighter in
   *  dark) — the pairing the handoff uses for badges and rail-active glyphs. */
  accentDeep: 'var(--studio-accent-deep)',
  accentSubtle: 'var(--color-accent-subtle)',
  focus: 'var(--color-focus-ring)',

  /** The mint ladder — one hue, eight strengths, so a tint never has to be
   *  mixed at the call site. Tile = the 34px icon square; pill = a header
   *  action; 30/32 = badges and the rail's active cell; hover/soft/faint are
   *  the three washes. */
  mintTile: 'var(--studio-mint-tile)',
  mintPill: 'var(--studio-mint-pill)',
  mint30: 'var(--studio-mint-30)',
  mint32: 'var(--studio-mint-32)',
  mintHover: 'var(--studio-mint-hover)',
  mintSoft: 'var(--studio-mint-soft)',
  mintFaint: 'var(--studio-mint-faint)',
  mintEdge: 'var(--studio-mint-edge)',
  greenTint: 'var(--studio-green-tint)',
  /** A studied/progress dot — a FILL, not text. */
  greenDot: 'var(--studio-green-dot)',

  /** Status tones, dark-legible in both themes. `a2*`/`a3*` below are the
   *  annotation ordinals and stay reserved for the annotation layer. */
  amber: 'var(--studio-amber-ink)',
  amberBg: 'var(--studio-amber-bg)',
  amberBg2: 'var(--studio-amber-bg-2)',
  amberEdge: 'var(--studio-amber-edge)',
  dangerBg: 'var(--studio-danger-bg)',
  dangerEdge: 'var(--studio-danger-edge)',
  /** v4 homework-outcome fills (ADR-057) — pastel fill + dark ink, identical
   *  in both themes. See the globals.css block for why the existing status
   *  tokens could not carry a numbered chart segment. */
  outcomeOk: 'var(--studio-outcome-ok)',
  outcomeOkInk: 'var(--studio-outcome-ok-ink)',
  outcomeShaky: 'var(--studio-outcome-shaky)',
  outcomeShakyInk: 'var(--studio-outcome-shaky-ink)',
  outcomeTutored: 'var(--studio-outcome-tutored)',
  outcomeTutoredInk: 'var(--studio-outcome-tutored-ink)',

  blue: 'var(--studio-blue-ink)',
  blueBg: 'var(--studio-blue-bg)',
  blueEdge: 'var(--studio-blue-edge)',
  blueDeep: 'var(--studio-blue-deep)',

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

// Shadows from the premium handoff. Every one is a token so the dark theme can
// carry its own, far deeper ink — a light-mode shadow does nothing on a dark
// surface, which is exactly why the flat design had to lean on borders instead.
export const SHADOW = {
  pill: 'var(--studio-shadow-pill)',
  card: 'var(--studio-shadow-card)',
  soft: 'var(--studio-shadow-soft)',
  button: 'var(--studio-shadow-btn)',
  note: 'var(--studio-shadow-note)',
  flashcard: 'var(--studio-shadow-flash)',
  rail: 'var(--studio-shadow-rail)',
  popover: 'var(--shadow-panel)',
  composer: 'var(--studio-composer-glow)',
} as const

/** Motion routed through theme.css's duration tokens, which already zero
 *  themselves under `prefers-reduced-motion: reduce`. */
export const MOTION = {
  fast: 'var(--motion-duration-fast)',
  base: 'var(--motion-duration-base)',
  ease: 'var(--motion-ease-out)',
} as const


/** The premium look tops out at 600 — nothing in the studio is 700. */
export const eyebrow: CSSProperties = {
  fontSize: 10,
  fontWeight: 600,
  letterSpacing: '0.12em',
  textTransform: 'uppercase',
}

/** The page-level eyebrow, one notch wider than a card's. */
export const pageEyebrow: CSSProperties = { ...eyebrow, letterSpacing: '0.14em' }

/** The handoff's radius scale. Cards 17, inner boxes 12, icon tiles 11/12, the
 *  notebook math capsule 16, everything pill-shaped 999. */
export const RADIUS = {
  card: 17,
  box: 12,
  tile: 11,
  capsule: 16,
  pill: 999,
} as const

/** The glass card, as inline style, for the handful of places that can't take
 *  the `cx-card` class (a card whose fill is overridden, or one that must keep
 *  `overflow: visible`). Prefer the class: it also draws the top sheen. */
export const cardBox: CSSProperties = {
  background: T.card,
  border: `1px solid ${T.border}`,
  borderRadius: RADIUS.card,
  backdropFilter: 'blur(22px) saturate(1.5)',
  WebkitBackdropFilter: 'blur(22px) saturate(1.5)',
  boxShadow: SHADOW.card,
}

/** The 34px mint square that opens a card header, holding a 15–16px glyph. */
export const mintTile: CSSProperties = {
  width: 34,
  height: 34,
  borderRadius: RADIUS.tile,
  background: T.mintTile,
  color: T.accentInk,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  flexShrink: 0,
}

/** A separator INSIDE a card — a row rule, not a card edge. Its own token now
 *  (the handoff gives the hairline a weight per theme) rather than a mix of the
 *  foreground; `--studio-frame` remains the heavier card-on-card edge. */
export const RULE = `1px solid ${T.hairline}`

/** The accent-filled action button (brand rule: light fill, dark text — never
 *  light text on an accent fill). */
export const accentButton: CSSProperties = {
  background: T.accent,
  color: T.onAccent,
  border: 'none',
  borderRadius: RADIUS.box,
  fontWeight: 600,
  cursor: 'pointer',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 8,
  textDecoration: 'none',
  boxShadow: SHADOW.button,
}

export const ghostButton: CSSProperties = {
  background: T.raised3,
  color: T.ink,
  border: `1px solid ${T.borderStrong}`,
  borderRadius: RADIUS.box,
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

/** The status "sets" the design names — tint fill, tint border, legible ink —
 *  used for status chips, flags and result states.
 *
 *  These read the STUDIO status tokens, not the annotation ordinals. The
 *  ordinals (`aN*`) are light-only by construction — theme.css gives them no
 *  dark variant, so `-deep` stays a dark hue on a dark card — and they remain
 *  what the annotation layer in `NotesDocument` uses, where the tint underneath
 *  them is the matching light one. Everywhere else, a chip needs a tone that
 *  flips with the theme, which is what these four do. */
export const ORDINAL = {
  green: { background: T.greenTint, border: `1px solid ${T.mintEdge}`, color: T.accentInk },
  amber: { background: T.amberBg, border: `1px solid ${T.amberEdge}`, color: T.amber },
  blue: { background: T.blueBg, border: `1px solid ${T.blueEdge}`, color: T.blue },
  neutral: { background: T.chip, border: `1px solid ${T.border}`, color: T.muted },
  danger: { background: T.dangerBg, border: `1px solid ${T.dangerEdge}`, color: T.danger },
} as const

export type OrdinalKey = keyof typeof ORDINAL
