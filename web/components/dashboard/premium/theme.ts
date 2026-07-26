import type { CSSProperties } from 'react'
import type { MasteryState } from '@/lib/ai/profile'

// Calyxa Dashboard Premium — shared design constants (Design handoff).
// The premium dashboard reproduces the handoff mockup literally, so these are
// the exact hexes / rgba values from the design rather than the token system —
// the token system (--chart-*, @calyxa/ui) drives the extension overlay and the
// pre-premium web dashboard; this surface is a pixel reproduction of the mockup.

export const C = {
  bg: '#f2f1ed',
  ink: '#1c1c1a',
  muted: '#6b6b65',
  faint: '#9a988f',
  hair: 'rgba(28,28,26,.07)',
  greenInk: '#166534',
  greenDeep: '#14532d',
  mint: '#86efac',
  mintTile: 'rgba(134,239,172,.24)',
  mintPill: 'rgba(134,239,172,.28)',
  blue: '#2563eb',
  amber: '#92400e',
  red: '#b91c1c',
  redBg: '#fef2f2',
  greenBg: '#f0fdf4',
} as const

// State chip / bar styling — [label, chipBg, chipInk, barColor] from the design.
export const STATE_STYLE: Record<
  MasteryState,
  { label: string; chipBg: string; ink: string; bar: string }
> = {
  mastered: { label: 'Mastered', chipBg: 'rgba(134,239,172,.3)', ink: '#14532d', bar: '#166534' },
  learning: { label: 'Learning', chipBg: 'rgba(37,99,235,.08)', ink: '#2563eb', bar: '#2563eb' },
  weak: { label: 'Weak', chipBg: 'rgba(146,64,14,.09)', ink: '#92400e', bar: '#92400e' },
  forgotten: { label: 'Forgotten', chipBg: '#fef2f2', ink: '#b91c1c', bar: '#b91c1c' },
  unseen: { label: 'Unseen', chipBg: 'rgba(28,28,26,.05)', ink: '#6b6b65', bar: '#c9c7c0' },
}

// Course key → design label/short-label/color/tile-tint. Keys match
// COURSE_ORDER in @calyxa/curriculum (via lib/curriculum/courses.ts); this
// file predates the token palette and keeps its literal hexes because the
// premium dashboard is light-only and is not covered by the studio's
// no-hex-literals gate. The hexes ARE the light values of --chart-1..8, and
// the Integrated Math courses share the hex of the core course they mirror —
// the same pairing, and the same reasoning, as `packages/ui/src/theme.css`.
export const COURSE_STYLE: Record<
  string,
  { label: string; short: string; color: string; tileBg: string }
> = {
  'algebra-1': { label: 'Algebra 1', short: 'Algebra 1', color: '#9a3412', tileBg: 'rgba(154,52,18,.08)' },
  geometry: { label: 'Geometry', short: 'Geometry', color: '#166534', tileBg: 'rgba(22,101,52,.08)' },
  'algebra-2': { label: 'Algebra 2', short: 'Algebra 2', color: '#0f766e', tileBg: 'rgba(15,118,110,.08)' },
  precalculus: { label: 'Precalculus', short: 'Precalculus', color: '#6d28d9', tileBg: 'rgba(109,40,217,.07)' },
  'ap-precalculus': { label: 'AP Precalculus', short: 'AP Precalc', color: '#075985', tileBg: 'rgba(7,89,133,.07)' },
  'ap-calculus-ab': { label: 'AP Calculus AB', short: 'AP Calc AB', color: '#a21caf', tileBg: 'rgba(162,28,175,.07)' },
  'ap-calculus-bc': { label: 'AP Calculus BC', short: 'AP Calc BC', color: '#3730a3', tileBg: 'rgba(55,48,163,.07)' },
  'ap-statistics': { label: 'AP Statistics', short: 'AP Stats', color: '#9f1239', tileBg: 'rgba(159,18,57,.07)' },
  'integrated-math-1': { label: 'Integrated Math 1', short: 'Int Math 1', color: '#9a3412', tileBg: 'rgba(154,52,18,.08)' },
  'integrated-math-2': { label: 'Integrated Math 2', short: 'Int Math 2', color: '#166534', tileBg: 'rgba(22,101,52,.08)' },
  'integrated-math-3': { label: 'Integrated Math 3', short: 'Int Math 3', color: '#0f766e', tileBg: 'rgba(15,118,110,.08)' },
}

export function courseStyle(courseKey: string) {
  return (
    COURSE_STYLE[courseKey] ?? {
      label: courseKey,
      short: courseKey,
      color: '#6b6b65',
      tileBg: 'rgba(28,28,26,.05)',
    }
  )
}

/** Retained names for the call sites that still speak of "strands". */
export const STRAND_STYLE = COURSE_STYLE
export const strandStyle = courseStyle

// ── Reusable style objects ─────────────────────────────────────────────────

/** The primary glass card (rgba(255,255,255,.8), strong drop shadow). */
export const glassCard: CSSProperties = {
  position: 'relative',
  background: 'rgba(255,255,255,.8)',
  border: '1px solid rgba(28,28,26,.1)',
  borderRadius: 17,
  backdropFilter: 'blur(22px) saturate(1.5)',
  WebkitBackdropFilter: 'blur(22px) saturate(1.5)',
  boxShadow: '0 18px 44px rgba(28,40,30,.14),0 2px 8px rgba(28,40,30,.07)',
  overflow: 'hidden',
}

/** The lighter "strip" card (rgba(255,255,255,.72), softer shadow). */
export const glassCardSoft: CSSProperties = {
  position: 'relative',
  background: 'rgba(255,255,255,.72)',
  border: '1px solid rgba(28,28,26,.09)',
  borderRadius: 17,
  backdropFilter: 'blur(24px) saturate(1.5)',
  WebkitBackdropFilter: 'blur(24px) saturate(1.5)',
  boxShadow: '0 12px 32px rgba(28,40,30,.08),0 2px 8px rgba(28,40,30,.05)',
  overflow: 'hidden',
}

/** The top-edge light sheen overlaid inside cards. */
export const sheen: CSSProperties = {
  position: 'absolute',
  inset: 0,
  background: 'linear-gradient(180deg,rgba(255,255,255,.45),rgba(255,255,255,0) 42%)',
  pointerEvents: 'none',
}

/** Small uppercase eyebrow label. */
export const eyebrow: CSSProperties = {
  fontSize: 10,
  fontWeight: 600,
  letterSpacing: '.12em',
  textTransform: 'uppercase',
  color: C.muted,
}

/** The 34px rounded icon tile that leads each card header. */
export const iconTile: CSSProperties = {
  flex: 'none',
  width: 34,
  height: 34,
  borderRadius: 11,
  background: C.mintTile,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
}

/** The small green "→" pill action buttons in card headers. */
export const pillAction: CSSProperties = {
  flex: 'none',
  border: 'none',
  fontSize: 12,
  fontWeight: 600,
  color: C.greenDeep,
  background: C.mintPill,
  borderRadius: 99,
  padding: '6px 13px',
  cursor: 'pointer',
}

export const entrance = (delay = 0): CSSProperties => ({
  animation: `cxPop .5s cubic-bezier(.3,1.4,.4,1) ${delay}s both`,
})

export function pct(mastery: number): number {
  return Math.round(Math.max(0, Math.min(1, mastery)) * 100)
}
