import type { CSSProperties } from 'react'
import { T, MOTION } from './tokens'

// The Progress tab's two chart primitives. Hand-built SVG and CSS on the
// `@calyxa/ui` tokens — the same call Sprint 22 made when recharts' bar geometry
// proved unreliable, and what lets this tree pass the token gate: nothing here
// names a colour, every fill is a `var()`.
//
// Both are responsive without JS. The sparkline uses a fixed viewBox with
// `preserveAspectRatio="none"` and `vector-effect="non-scaling-stroke"`, so it
// fills its column at any width while the stroke stays 2px. No text lives inside
// the SVG for that reason — labels are HTML beside it.

/** Numbers on this page are compared down columns, so they are all tabular. */
export const NUM: CSSProperties = { fontVariantNumeric: 'tabular-nums', fontFeatureSettings: '"tnum"' }

// ── Score sparkline ──────────────────────────────────────────────────────────

const VB_W = 330
const VB_H = 60
/** The design's baseline sits 4px above the bottom of the viewBox. */
const BASELINE = 56

/** The y-window never collapses below this many points, so a genuinely steady
 *  score renders as a steady line rather than magnified noise. */
const MIN_Y_SPAN = 20

export function Sparkline({
  points,
  height = 72,
  label,
}: {
  points: { day: string; score: number }[]
  height?: number
  label: string
}) {
  const values = points.map((p) => p.score)
  const rawMin = Math.min(...values)
  const rawMax = Math.max(...values)
  const pad = Math.max(0, (MIN_Y_SPAN - (rawMax - rawMin)) / 2)
  const lo = Math.max(0, Math.floor(rawMin - pad - 2))
  const hi = Math.min(100, Math.ceil(rawMax + pad + 2))
  const span = Math.max(1, hi - lo)

  // Plotted into the band above the baseline, with a little headroom so the
  // highest point never touches the top edge.
  const x = (i: number) => (points.length === 1 ? VB_W / 2 : (i / (points.length - 1)) * (VB_W - 10) + 5)
  const y = (v: number) => BASELINE - 8 - ((v - lo) / span) * (BASELINE - 16)

  const line = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(2)},${y(p.score).toFixed(2)}`).join(' ')
  const last = points[points.length - 1]

  return (
    <svg
      viewBox={`0 0 ${VB_W} ${VB_H}`}
      preserveAspectRatio="none"
      width="100%"
      height={height}
      role="img"
      aria-label={label}
      style={{ display: 'block', overflow: 'visible' }}
    >
      <line x1={0} y1={BASELINE} x2={VB_W} y2={BASELINE} stroke={T.border} strokeWidth={1} vectorEffect="non-scaling-stroke" />
      <path
        d={line}
        fill="none"
        stroke={T.accentInk}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
      {/* The head of the line. An <circle> would be squashed into an ellipse by
          `preserveAspectRatio="none"`, so it is drawn as a stroked dot instead —
          a zero-length round-capped line keeps its shape under any scale. */}
      <path
        d={`M${x(points.length - 1).toFixed(2)},${y(last.score).toFixed(2)} l0,0`}
        stroke={T.accentInk}
        strokeWidth={7}
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  )
}

// ── Bars ─────────────────────────────────────────────────────────────────────

/** A 0-100 bar. `fill` is a token string so a strand row can pass its own chart
 *  colour and a signal row can pass the accent or the caution tone. */
export function Meter({ value, fill = T.accentInk, height = 7 }: { value: number; fill?: string; height?: number }) {
  return (
    <span
      aria-hidden="true"
      style={{
        display: 'block',
        flex: 1,
        minWidth: 60,
        height,
        borderRadius: 4,
        background: T.track,
        overflow: 'hidden',
      }}
    >
      <span
        className="cx-bar"
        style={{
          display: 'block',
          width: `${Math.max(0, Math.min(100, value))}%`,
          height: '100%',
          borderRadius: 4,
          background: fill,
          transition: `width ${MOTION.base} ${MOTION.ease}`,
        }}
      />
    </span>
  )
}
