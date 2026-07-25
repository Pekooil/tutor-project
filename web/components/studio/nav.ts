import type { ReactNode } from 'react'
import { HistoryIcon, HomeIcon, NotesIcon } from './icons'

// The studio's five destinations, defined once. Three surfaces render them — the
// icon rail (glyphs only, per the design handoff), the floating bottom-left
// bubble bar (labelled), and the mobile bottom tab bar — so keeping the list here
// stops them drifting apart.
//
// Notes / Quizzes / Flashcards are per-concept views. When a concept is open the
// links deep-link to it; otherwise they point at the BARE index route, which
// resolves the student's current concept server-side and redirects.

/** True for the four token-based studio views. Everything else is a pre-studio
 *  screen built on `premium/theme.ts`'s hardcoded LIGHT hexes and near-opaque
 *  white glass cards — those CANNOT render dark (inherited text goes near-white
 *  on a white card and vanishes), so the shell pins them to the light token set.
 *  Lives here rather than in StudioShell so it can be tested: every legacy route
 *  is auth-gated, so the classification cannot be checked in the browser. */
export function isStudioView(pathname: string): boolean {
  return (
    pathname === '/dashboard' ||
    pathname === '/' ||
    pathname.startsWith('/notes') ||
    pathname.startsWith('/quiz') ||
    pathname.startsWith('/flashcards') ||
    // /sessions is the History tab, rebuilt on tokens (studio/HistoryScreen).
    // Its detail page /sessions/[id] is still the pre-studio screen, so only the
    // index qualifies — hence the exact match rather than a prefix.
    pathname === '/sessions' ||
    pathname.startsWith('/studio-preview')
  )
}

export type NavItem = {
  href: (conceptKey: string | null) => string
  /** Full name — the accessible label and tooltip. */
  label: string
  /** Short caption for surfaces that show text. */
  short: string
  icon: (p: { size?: number }) => ReactNode
  match: (pathname: string) => boolean
}

export const NAV_ITEMS: NavItem[] = [
  {
    href: () => '/dashboard',
    label: 'Dashboard',
    short: 'Dashboard',
    icon: HomeIcon,
    match: (p) => p === '/dashboard' || p === '/',
  },
  {
    href: (k) => (k ? `/notes/${encodeURIComponent(k)}` : '/notes'),
    label: 'Notes',
    short: 'Notes',
    icon: NotesIcon,
    // Quiz and flashcards live INSIDE the notes panel now, and their old routes
    // redirect here, so Notes owns those paths too.
    match: (p) =>
      p.startsWith('/notes') ||
      p.startsWith('/misconceptions') ||
      p.startsWith('/quiz') ||
      p.startsWith('/flashcards'),
  },
  {
    href: () => '/sessions',
    label: 'Session history',
    short: 'History',
    icon: HistoryIcon,
    match: (p) => p.startsWith('/sessions'),
  },
]
