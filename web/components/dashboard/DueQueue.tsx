import type { DashboardDueItem } from '@/lib/learning/dashboard-read'
import { formatDue } from './format'
import { EmptyState } from './EmptyState'

// Review view: the reinforcement schedule — what's coming back and when. The
// read already ordered it priority DESC, due_at ASC (PLAN §2.3 query 2) and
// flagged each item overdue; this renders that order with "comes back …" /
// "overdue by …" copy and a quiet marker on items due now.
export function DueQueue({ items }: { items: DashboardDueItem[] }) {
  if (items.length === 0) {
    return (
      <EmptyState title="Nothing scheduled to review">
        As concepts settle in, Calyxa schedules them to come back at the right spacing. Your
        queue will fill in as you practice.
      </EmptyState>
    )
  }

  return (
    <ul className="flex flex-col gap-2">
      {items.map((item) => (
        <li
          key={item.conceptKey}
          className="flex items-center justify-between gap-3 rounded-lg border border-border p-4"
        >
          <div className="flex flex-col gap-0.5">
            <span className="text-sm font-medium text-foreground">{item.title}</span>
            <span className="text-xs text-muted-foreground">{item.strandLabel}</span>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {item.overdue ? (
              <span
                className="rounded-full px-2 py-0.5 text-xs font-medium"
                style={{ backgroundColor: 'var(--color-accent-subtle)', color: 'var(--color-accent-emphasis)' }}
              >
                Due
              </span>
            ) : null}
            <span className="text-sm text-muted-foreground">{formatDue(item.dueAt, item.overdue)}</span>
          </div>
        </li>
      ))}
    </ul>
  )
}
