import type { DashboardStrandGroup } from '@/lib/learning/dashboard-read'
import { MasteryBar } from './MasteryBar'
import { StateBadge } from './StateBadge'
import { EmptyState } from './EmptyState'
import { strandColorVar } from './strand-color'
import { formatLastPracticed } from './format'

// Mastery view: the full per-concept grid, grouped by strand, decay-adjusted,
// titles resolved. Only strands with practiced concepts are shown (an untouched
// strand contributes nothing to a "what you've practiced" grid); a completely
// fresh account gets the empty state. Concepts arrive weakest-first from the
// read, which is the useful order here (what needs work, first).
export function MasteryGrid({ strands }: { strands: DashboardStrandGroup[] }) {
  const practiced = strands.filter((strand) => strand.nodes.length > 0)

  if (practiced.length === 0) {
    return (
      <EmptyState title="No concepts practiced yet">
        Once you start working through problems with Calyxa, every concept you touch shows up
        here with its current mastery.
      </EmptyState>
    )
  }

  return (
    <div className="flex flex-col gap-8">
      {practiced.map((strand) => (
        <section key={strand.strand} className="flex flex-col gap-4">
          <div className="flex items-center gap-2">
            <span
              className="h-3 w-3 shrink-0 rounded-sm"
              style={{ backgroundColor: strandColorVar(strand.strand) }}
              aria-hidden="true"
            />
            <h2 className="text-sm font-semibold text-foreground">{strand.strandLabel}</h2>
            <span className="text-xs text-muted-foreground">
              {strand.nodes.length} concept{strand.nodes.length === 1 ? '' : 's'}
            </span>
          </div>

          <ul className="flex flex-col gap-4">
            {strand.nodes.map((node) => (
              <li key={node.conceptKey} className="flex flex-col gap-2">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm text-foreground">{node.title}</span>
                  <StateBadge state={node.state} />
                </div>
                <MasteryBar
                  value={node.mastery}
                  colorVar={strandColorVar(strand.strand)}
                  sublabel={formatLastPracticed(node.lastPracticedAt)}
                />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}
