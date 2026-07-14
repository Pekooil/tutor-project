import { masteryPct } from './format'

// A single horizontal mastery bar on the chart tokens — the dashboard's core
// data mark (used by MasteryByStrand and the per-concept grid). Built as
// accessible DOM (a labeled track + a token-colored fill), NOT a Recharts
// <Bar>: Task 3 found recharts@3.9.2 renders Bar height non-proportionally in
// this Next 16 / Turbopack / React 19 stack, and a horizontal mastery bar is a
// better fit for CSS anyway (the plan's "reuse the MasteryBars pattern where it
// fits"). The visible percent is the accessible value; the track is decorative.
export function MasteryBar({
  label,
  value,
  colorVar,
  sublabel,
}: {
  label?: string
  value: number
  colorVar: string
  sublabel?: string
}) {
  const pct = masteryPct(value)
  return (
    <div className="flex flex-col gap-1.5">
      {label !== undefined ? (
        <div className="flex items-baseline justify-between gap-3">
          <span className="truncate text-sm text-foreground">{label}</span>
          <span className="shrink-0 text-sm tabular-nums text-muted-foreground">{pct}%</span>
        </div>
      ) : null}
      <div
        className="flex items-center gap-3"
        role="meter"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        aria-label={label ? `${label} mastery` : 'mastery'}
      >
        <div
          className="h-2 flex-1 overflow-hidden rounded-full"
          style={{ backgroundColor: 'var(--color-border)' }}
          aria-hidden="true"
        >
          <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: colorVar }} />
        </div>
        {label === undefined ? (
          <span className="w-9 shrink-0 text-right text-sm tabular-nums text-muted-foreground">{pct}%</span>
        ) : null}
      </div>
      {sublabel ? <span className="text-xs text-muted-foreground">{sublabel}</span> : null}
    </div>
  )
}
