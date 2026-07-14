import type { DashboardActivityDay } from '@/lib/learning/dashboard-read'
import { EmptyState } from './EmptyState'
import { formatDay } from './format'

// Activity view: accuracy over time + sessions over time, from real
// session_interactions history (backfilled from existing rows — this trend is
// never empty for an active user, unlike the forward-only mastery trend). The
// series is time-ordered by day (loadDashboard aggregates on created_at); it
// never keys on (session_id, turn_index), which is display order, not identity
// (the Sprint 11 audit's carried note). Hand-built SVG for the same reason as
// the other dashboard charts (Task 3's recharts Bar-geometry defect).

const OUTCOME_SEGMENTS = [
  { key: 'correct', label: 'Correct', color: 'var(--chart-correct)' },
  { key: 'partial', label: 'Partial', color: 'var(--chart-partial)' },
  { key: 'incorrect', label: 'Incorrect', color: 'var(--chart-incorrect)' },
] as const

// Accuracy chart box.
const W = 640
const A_H = 168
const PAD = { top: 12, right: 12, bottom: 8, left: 28 }
const PLOT_W = W - PAD.left - PAD.right
const A_PLOT_H = A_H - PAD.top - PAD.bottom
// Sessions strip box (shares the same x layout / column centers).
const S_H = 52
const S_PLOT_H = S_H - 8 - 16

function columnLayout(n: number): { band: number; colW: number } {
  const band = PLOT_W / Math.max(1, n)
  return { band, colW: Math.min(band * 0.62, 26) }
}

function colX(i: number, band: number, colW: number): number {
  return PAD.left + band * i + (band - colW) / 2
}

export function ActivityChart({ days }: { days: DashboardActivityDay[] }) {
  if (days.length === 0) {
    return (
      <EmptyState title="No activity yet">
        Once you&apos;ve worked through some problems with Calyxa, your accuracy and session
        counts over time show up here.
      </EmptyState>
    )
  }

  const n = days.length
  const { band, colW } = columnLayout(n)
  const maxGraded = Math.max(1, ...days.map((d) => d.correct + d.partial + d.incorrect))
  const maxSessions = Math.max(1, ...days.map((d) => d.sessions))

  const first = days[0]
  const last = days[n - 1]

  return (
    <div className="flex flex-col gap-4">
      {/* Legend */}
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
        {OUTCOME_SEGMENTS.map((seg) => (
          <li key={seg.key} className="flex items-center gap-1.5">
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: seg.color }}
              aria-hidden="true"
            />
            <span className="text-muted-foreground">{seg.label}</span>
          </li>
        ))}
      </ul>

      {/* Accuracy: one stacked column per day (correct / partial / incorrect). */}
      <div className="flex flex-col gap-1">
        <span className="text-xs font-medium text-muted-foreground">Answers over time</span>
        <svg
          viewBox={`0 0 ${W} ${A_H}`}
          className="h-auto w-full"
          role="img"
          aria-label={`Answer outcomes per day from ${formatDay(first.day)} to ${formatDay(last.day)}`}
        >
          <line
            x1={PAD.left}
            x2={W - PAD.right}
            y1={PAD.top + A_PLOT_H}
            y2={PAD.top + A_PLOT_H}
            stroke="var(--color-border)"
            strokeWidth={1}
          />
          {days.map((d, i) => {
            const total = d.correct + d.partial + d.incorrect
            if (total === 0) return null
            const xPos = colX(i, band, colW)
            let yCursor = PAD.top + A_PLOT_H
            return (
              <g key={d.day}>
                {OUTCOME_SEGMENTS.map((seg) => {
                  const count = d[seg.key]
                  if (count === 0) return null
                  const segH = (count / maxGraded) * A_PLOT_H
                  yCursor -= segH
                  return (
                    <rect
                      key={seg.key}
                      x={xPos}
                      y={yCursor}
                      width={colW}
                      height={segH}
                      fill={seg.color}
                    />
                  )
                })}
              </g>
            )
          })}
        </svg>
      </div>

      {/* Sessions: a compact per-day strip sharing the same x positions. */}
      <div className="flex flex-col gap-1">
        <span className="text-xs font-medium text-muted-foreground">Sessions over time</span>
        <svg
          viewBox={`0 0 ${W} ${S_H}`}
          className="h-auto w-full"
          role="img"
          aria-label={`Sessions per day from ${formatDay(first.day)} to ${formatDay(last.day)}`}
        >
          <line
            x1={PAD.left}
            x2={W - PAD.right}
            y1={8 + S_PLOT_H}
            y2={8 + S_PLOT_H}
            stroke="var(--color-border)"
            strokeWidth={1}
          />
          {days.map((d, i) => {
            if (d.sessions === 0) return null
            const barH = (d.sessions / maxSessions) * S_PLOT_H
            return (
              <rect
                key={d.day}
                x={colX(i, band, colW)}
                y={8 + S_PLOT_H - barH}
                width={colW}
                height={barH}
                fill="var(--chart-state-unseen)"
                rx={1}
              />
            )
          })}
        </svg>
      </div>

      <div className="flex justify-between px-1 text-xs text-muted-foreground">
        <span>{formatDay(first.day)}</span>
        <span>{formatDay(last.day)}</span>
      </div>
    </div>
  )
}
