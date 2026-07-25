import type { DashboardMisconception } from '@/lib/learning/dashboard-read'

// The one place a misconception's DB lifecycle state becomes something a student
// reads. Three surfaces need this agreement — the dashboard's per-concept pills
// (server), the Ask panel's list and counts (client), and the notes view's
// heading flags (client) — so it lives in a plain module both sides import
// rather than being re-derived in each.
//
// The DB lifecycle (`lib/learning/apply.ts`) is:
//   pending   → seen ONCE. Not yet a pattern.
//   active    → seen 2+ times. Confirmed.
//   resolved  → 3 consecutive correct since. Fixed.
//
// `active` splits in the UI on `consecutiveCorrect`: a confirmed misconception
// the student is currently getting right is worth distinguishing from one they
// are still missing, because it changes what they should do about it.

export type MisconceptionState = 'active' | 'improving' | 'watching' | 'resolved'

type StatusLike = Pick<DashboardMisconception, 'status' | 'consecutiveCorrect'>

export function misconceptionState(m: StatusLike): MisconceptionState {
  if (m.status === 'resolved') return 'resolved'
  if (m.status === 'pending') return 'watching'
  return m.consecutiveCorrect > 0 ? 'improving' : 'active'
}

export const MISCONCEPTION_LABEL: Record<MisconceptionState, string> = {
  active: 'Active',
  improving: 'Improving',
  watching: 'Watching',
  resolved: 'Resolved',
}

/** One-line explanation of what each state means, for the list rows. */
export const MISCONCEPTION_MEANING: Record<MisconceptionState, string> = {
  active: 'seen more than once and still going wrong',
  improving: 'confirmed, but you have been getting it right',
  watching: 'seen once — not a pattern yet',
  resolved: 'three correct in a row since',
}

export type MisconceptionCounts = {
  /** Confirmed and still being missed — what "to fix" means. */
  confirmed: number
  /** Confirmed but trending right. */
  improving: number
  /** Seen once; being watched, deliberately NOT counted as a gap. */
  watching: number
  resolved: number
}

export function countMisconceptions(list: StatusLike[]): MisconceptionCounts {
  const counts: MisconceptionCounts = { confirmed: 0, improving: 0, watching: 0, resolved: 0 }
  for (const m of list) {
    const state = misconceptionState(m)
    if (state === 'active') counts.confirmed += 1
    else if (state === 'improving') counts.improving += 1
    else if (state === 'watching') counts.watching += 1
    else counts.resolved += 1
  }
  return counts
}

/** Sort order for a list a student reads: what needs work first, done last. */
const RANK: Record<MisconceptionState, number> = { active: 0, improving: 1, watching: 2, resolved: 3 }

export function byUrgency(a: StatusLike, b: StatusLike): number {
  return RANK[misconceptionState(a)] - RANK[misconceptionState(b)]
}
