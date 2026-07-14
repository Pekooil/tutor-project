import type { MasteryState } from '@/lib/ai/profile'
import { STATE_LABEL, stateColorVar } from './strand-color'

// A small state pill: a token-colored dot + the state label. Color carries no
// meaning alone (the label always states it), so it stays legible for
// color-blind readers and doesn't rely on hue as the only signal.
export function StateBadge({ state }: { state: MasteryState }) {
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-border px-2 py-0.5 text-xs font-medium text-foreground">
      <span
        className="h-2 w-2 rounded-full"
        style={{ backgroundColor: stateColorVar(state) }}
        aria-hidden="true"
      />
      {STATE_LABEL[state]}
    </span>
  )
}
