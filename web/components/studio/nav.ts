import type { ReactNode } from 'react'
import { ChartIcon, HistoryIcon, HomeIcon, NotesIcon } from './icons'

// The studio's destinations, defined once. Three surfaces render them — the
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
    pathname.startsWith('/data') ||
    // Settings pair, rebuilt on tokens (studio/SettingsScreen) 2026-07-25 — they
    // were the two legacy screens the studio linked to most, via the rail avatar
    // and the dashboard's quota pill.
    pathname.startsWith('/account') ||
    pathname.startsWith('/billing') ||
    pathname.startsWith('/misconceptions') ||
    pathname.startsWith('/notes') ||
    pathname.startsWith('/quiz') ||
    pathname.startsWith('/flashcards') ||
    // Both the History tab and its detail page are on tokens now
    // (studio/HistoryScreen, studio/DetailScreens), so the whole prefix counts.
    pathname.startsWith('/sessions') ||
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
    // Always the index, never the open concept. Deep-linking here meant that
    // while reading a concept you could not reach the library from the rail at
    // all — the one place you would go to find a different concept.
    href: () => '/notes',
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
    // Not per-concept: Progress is the whole-account view by definition, so it
    // ignores the open concept rather than deep-linking into it. The route stays
    // `/data` — the tab was renamed at the design handoff, the URL was not.
    href: () => '/data',
    label: 'Progress',
    short: 'Progress',
    icon: ChartIcon,
    match: (p) => p.startsWith('/data'),
  },
  {
    href: () => '/sessions',
    label: 'Session history',
    short: 'History',
    icon: HistoryIcon,
    match: (p) => p.startsWith('/sessions'),
  },
]
