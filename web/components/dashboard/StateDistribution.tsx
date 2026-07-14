import type { StateCounts } from '@/lib/learning/dashboard-read'
import { STATE_DISTRIBUTION_ORDER, STATE_LABEL, stateColorVar } from './strand-color'
import { EmptyState } from './EmptyState'

// Overview: the state distribution across every practiced concept, as one
// token-colored stacked bar + a legend with counts. A CSS stacked bar (not a
// Recharts pie/bar) — same reason as MasteryBar — with each segment sized by
// its share and each legend row naming the state + count so hue is never the
// only signal.
export function StateDistribution({ counts }: { counts: StateCounts }) {
  const total = STATE_DISTRIBUTION_ORDER.reduce((sum, state) => sum + counts[state], 0)

  if (total === 0) {
    return (
      <EmptyState title="No concepts tracked yet">
        As you work through problems, each concept lands in a state here — learning, weak,
        mastered, and so on.
      </EmptyState>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <div
        className="flex h-3 w-full overflow-hidden rounded-full"
        style={{ backgroundColor: 'var(--color-border)' }}
        role="img"
        aria-label={STATE_DISTRIBUTION_ORDER.filter((s) => counts[s] > 0)
          .map((s) => `${counts[s]} ${STATE_LABEL[s].toLowerCase()}`)
          .join(', ')}
      >
        {STATE_DISTRIBUTION_ORDER.map((state) =>
          counts[state] > 0 ? (
            <div
              key={state}
              style={{ width: `${(counts[state] / total) * 100}%`, backgroundColor: stateColorVar(state) }}
            />
          ) : null
        )}
      </div>

      <ul className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-3">
        {STATE_DISTRIBUTION_ORDER.map((state) => (
          <li key={state} className="flex items-center gap-2 text-sm">
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: stateColorVar(state) }}
              aria-hidden="true"
            />
            <span className="text-muted-foreground">{STATE_LABEL[state]}</span>
            <span className="ml-auto tabular-nums text-foreground">{counts[state]}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
