// Sprint 22 Task 6: small pure display formatters shared by the dashboard
// components. No color/token logic here (that's strand-color.ts) — just
// number/date-to-copy helpers, kept out of the presentational components so
// they stay declarative.

const MS_PER_DAY = 1000 * 60 * 60 * 24

/** Decay-adjusted mastery in [0,1] → a clamped integer percent. */
export function masteryPct(mastery: number): number {
  return Math.round(Math.max(0, Math.min(1, mastery)) * 100)
}

function wholeDaysBetween(from: Date, to: Date): number {
  return Math.round((to.getTime() - from.getTime()) / MS_PER_DAY)
}

/** "today" / "yesterday" / "3 days ago" for a last-practiced timestamp. */
export function formatLastPracticed(iso: string | null): string {
  if (!iso) return 'Not practiced yet'
  const days = wholeDaysBetween(new Date(iso), new Date())
  if (days <= 0) return 'Practiced today'
  if (days === 1) return 'Practiced yesterday'
  if (days < 30) return `Practiced ${days} days ago`
  const months = Math.round(days / 30)
  return months <= 1 ? 'Practiced last month' : `Practiced ${months} months ago`
}

/** A resolved/first-seen date → a short absolute day (e.g. "Jul 14, 2026"). */
export function formatDay(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

/**
 * The review queue's "comes back when" copy. `overdue` is the read's own flag
 * (due_at <= now) so the phrasing matches what the read already decided.
 */
export function formatDue(dueAt: string, overdue: boolean): string {
  const days = Math.abs(wholeDaysBetween(new Date(), new Date(dueAt)))
  if (overdue) {
    if (days <= 0) return 'Due now'
    if (days === 1) return 'Overdue by 1 day'
    return `Overdue by ${days} days`
  }
  if (days <= 0) return 'Comes back later today'
  if (days === 1) return 'Comes back tomorrow'
  if (days < 14) return `Comes back in ${days} days`
  const weeks = Math.round(days / 7)
  return `Comes back in ${weeks} weeks`
}
