import type { DashboardStrandGroup } from '@/lib/learning/dashboard-read'
import { MasteryBar } from './MasteryBar'
import { strandColorVar } from './strand-color'

// Overview: one mastery bar per curriculum strand (its average decay-adjusted
// mastery), colored by the strand's `--chart-N` token. All six strands are
// shown for a consistent picture — a strand with nothing practiced yet renders
// a flat "Not started yet" row rather than being hidden, so coverage gaps are
// visible.
export function MasteryByStrand({ strands }: { strands: DashboardStrandGroup[] }) {
  return (
    <ul className="flex flex-col gap-5">
      {strands.map((strand) => {
        const count = strand.nodes.length
        return (
          <li key={strand.strand}>
            <MasteryBar
              label={strand.strandLabel}
              value={strand.averageMastery}
              colorVar={strandColorVar(strand.strand)}
              sublabel={count === 0 ? 'Not started yet' : `${count} concept${count === 1 ? '' : 's'} practiced`}
            />
          </li>
        )
      })}
    </ul>
  )
}
