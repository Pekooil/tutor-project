import type { DashboardMisconception } from '@/lib/learning/dashboard-read'
import { formatDay } from './format'
import { EmptyState } from './EmptyState'

// Misconceptions view: active error patterns vs. resolved ones, each with its
// occurrence count and — for active ones — the consecutive-correct streak that
// is walking it toward resolved. Presentational: the read already split status
// and ordered by occurrence.
export function MisconceptionList({ misconceptions }: { misconceptions: DashboardMisconception[] }) {
  const active = misconceptions.filter((m) => m.status === 'active')
  const resolved = misconceptions.filter((m) => m.status === 'resolved')

  if (misconceptions.length === 0) {
    return (
      <EmptyState title="No misconceptions tracked">
        When a specific error pattern shows up more than once, it appears here — and moves to
        resolved as you get it right consistently.
      </EmptyState>
    )
  }

  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium text-muted-foreground">
          Active{active.length > 0 ? ` (${active.length})` : ''}
        </h2>
        {active.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing active right now — nice.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {active.map((m) => (
              <li
                key={`${m.conceptKey}-${m.category}`}
                className="flex flex-col gap-1 rounded-lg border border-border p-4"
              >
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-sm font-medium text-foreground">{m.title}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">{m.strandLabel}</span>
                </div>
                {m.description ? (
                  <p className="text-sm text-muted-foreground">{m.description}</p>
                ) : (
                  <p className="text-sm text-muted-foreground">{m.category}</p>
                )}
                <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  <span>
                    Seen {m.occurrenceCount} time{m.occurrenceCount === 1 ? '' : 's'}
                  </span>
                  <span>
                    {m.consecutiveCorrect > 0
                      ? `${m.consecutiveCorrect} correct in a row`
                      : 'No streak yet'}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {resolved.length > 0 ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-medium text-muted-foreground">Resolved ({resolved.length})</h2>
          <ul className="flex flex-col gap-2">
            {resolved.map((m) => (
              <li
                key={`${m.conceptKey}-${m.category}`}
                className="flex items-baseline justify-between gap-3 text-sm"
              >
                <span className="text-foreground">{m.title}</span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {m.resolvedAt ? `Resolved ${formatDay(m.resolvedAt)}` : 'Resolved'}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  )
}
