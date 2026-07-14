import type { MasteryState } from '@/lib/ai/profile'

// Sprint 22 Task 6 (ADR-048): the ONE place the dashboard maps a strand /
// mastery-state onto a chart color token. Every dashboard component reads its
// colors through these helpers, so the token-discipline gate (Task 8 greps
// /web/components/dashboard for `--chart-*` and forbids hard-coded hexes) has a
// single, auditable source and no component ever names a hex. The `var(--chart-*)`
// values themselves are defined in `@calyxa/ui` theme.css (Task 2).

// Strand key (the six-module prefix from strandOf) → its `--chart-N` token, in
// the exact curriculum file order the Task 2 palette was assigned in.
const STRAND_CHART_VAR: Record<string, string> = {
  algebra: 'var(--chart-1)',
  geometry: 'var(--chart-2)',
  algebra2: 'var(--chart-3)',
  precalc: 'var(--chart-4)',
  calculus: 'var(--chart-5)',
  stats: 'var(--chart-6)',
}

// A strand not in the six known modules (a legacy/renamed key) falls back to
// the neutral unseen tone rather than an undefined color — visible, not broken.
export function strandColorVar(strand: string): string {
  return STRAND_CHART_VAR[strand] ?? 'var(--chart-state-unseen)'
}

const STATE_CHART_VAR: Record<MasteryState, string> = {
  unseen: 'var(--chart-state-unseen)',
  learning: 'var(--chart-state-learning)',
  weak: 'var(--chart-state-weak)',
  mastered: 'var(--chart-state-mastered)',
  forgotten: 'var(--chart-state-forgotten)',
}

export function stateColorVar(state: MasteryState): string {
  return STATE_CHART_VAR[state]
}

export const STATE_LABEL: Record<MasteryState, string> = {
  unseen: 'Unseen',
  learning: 'Learning',
  weak: 'Weak',
  mastered: 'Mastered',
  forgotten: 'Forgotten',
}

// Left-to-right order for the state-distribution bar and legend: strongest
// (mastered) first, then in-progress, struggling, decayed, and never-seen last
// — a reading that puts progress on the left.
export const STATE_DISTRIBUTION_ORDER: readonly MasteryState[] = [
  'mastered',
  'learning',
  'weak',
  'forgotten',
  'unseen',
]
