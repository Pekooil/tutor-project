import { EmptyState } from './EmptyState'
import { formatDay } from './format'
import { masteryPct } from './format'

// Activity view: the forward-only mastery trend. There is NO mastery history to
// backfill (ADR-047) — mastery_snapshot only starts accruing from Sprint 22's
// launch — so this chart is honestly empty at launch and sparse for the first
// days, and SAYS SO rather than faking a curve. A hand-built SVG line (not a
// Recharts LineChart): consistent with the dashboard's other charts (Task 3's
// recharts Bar-geometry defect made hand-built SVG the reliable substrate), and
// the geometry here is simple enough to compute directly and verify.

export type TrendPoint = { day: string; mastery: number }

// SVG user-space box; the element scales to its container width (w-full) and
// keeps this aspect via the viewBox.
const W = 640
const H = 180
const PAD = { top: 12, right: 12, bottom: 24, left: 32 }
const PLOT_W = W - PAD.left - PAD.right
const PLOT_H = H - PAD.top - PAD.bottom
const LINE_COLOR = 'var(--chart-state-mastered)'

function x(i: number, n: number): number {
  if (n <= 1) return PAD.left + PLOT_W / 2
  return PAD.left + (PLOT_W * i) / (n - 1)
}

// mastery 0..1 → y (0 at the bottom of the plot, 1 at the top).
function y(mastery: number): number {
  const clamped = Math.max(0, Math.min(1, mastery))
  return PAD.top + (1 - clamped) * PLOT_H
}

export function TrendChart({ points }: { points: TrendPoint[] }) {
  if (points.length === 0) {
    return (
      <EmptyState title="Your mastery trend builds as you practice">
        A snapshot of your mastery is saved once a day, so this line starts filling in from today
        forward. There&apos;s no history to show yet — check back after a few days of practice.
      </EmptyState>
    )
  }

  if (points.length === 1) {
    const only = points[0]
    return (
      <div className="flex flex-col gap-2">
        <div className="flex items-baseline gap-2">
          <span className="text-2xl font-semibold tabular-nums text-foreground">
            {masteryPct(only.mastery)}%
          </span>
          <span className="text-sm text-muted-foreground">average mastery</span>
        </div>
        <p className="text-sm text-muted-foreground">
          One day recorded so far ({formatDay(only.day)}). Your trend line appears once you&apos;ve
          practiced across more than one day — it builds as you go.
        </p>
      </div>
    )
  }

  const n = points.length
  const linePoints = points.map((p, i) => `${x(i, n)},${y(p.mastery)}`).join(' ')
  // Area under the line, closed to the baseline.
  const baseline = PAD.top + PLOT_H
  const areaPath = `M ${x(0, n)},${baseline} L ${points
    .map((p, i) => `${x(i, n)},${y(p.mastery)}`)
    .join(' L ')} L ${x(n - 1, n)},${baseline} Z`

  const first = points[0]
  const last = points[n - 1]
  const gridYs = [0, 0.5, 1]

  return (
    <div className="flex flex-col gap-2">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-auto w-full"
        role="img"
        aria-label={`Mastery trend from ${formatDay(first.day)} to ${formatDay(last.day)}, currently ${masteryPct(last.mastery)} percent average mastery`}
      >
        {/* y gridlines + labels at 0 / 50 / 100% */}
        {gridYs.map((g) => (
          <g key={g}>
            <line
              x1={PAD.left}
              x2={W - PAD.right}
              y1={y(g)}
              y2={y(g)}
              stroke="var(--color-border)"
              strokeWidth={1}
            />
            <text
              x={PAD.left - 6}
              y={y(g) + 3}
              textAnchor="end"
              fontSize={10}
              fill="var(--color-muted-foreground)"
            >
              {Math.round(g * 100)}
            </text>
          </g>
        ))}

        <path d={areaPath} fill={LINE_COLOR} fillOpacity={0.12} stroke="none" />
        <polyline
          points={linePoints}
          fill="none"
          stroke={LINE_COLOR}
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {points.map((p, i) => (
          <circle key={p.day} cx={x(i, n)} cy={y(p.mastery)} r={2.5} fill={LINE_COLOR} />
        ))}
      </svg>

      <div className="flex justify-between px-1 text-xs text-muted-foreground">
        <span>{formatDay(first.day)}</span>
        <span>{formatDay(last.day)}</span>
      </div>
    </div>
  )
}
