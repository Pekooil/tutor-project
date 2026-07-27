'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { T } from './tokens'
import { ChartIcon, HistoryIcon, HomeIcon, NotesIcon } from './icons'

// The mobile-only bottom tab bar. Below 640px the 64px icon rail is hidden
// (globals.css) and this fixed bar takes over; `.cx-tabbar` is display:none by
// default and shown only inside the mobile media query, so desktop rendering is
// untouched.
//
// It mirrors the rail's destinations, and points at the BARE /notes index
// rather than a concept-specific URL — that route resolves the student's current
// concept server-side and redirects, which is what a nav button with no concept
// in hand wants. Quiz and flashcards are not tabs: they open inside the notes.

const TABS = [
  { href: '/notes', label: 'Notes', icon: NotesIcon, match: (p: string) => p.startsWith('/notes') || p.startsWith('/quiz') || p.startsWith('/flashcards') },
  {
    href: '/dashboard',
    label: 'Home',
    icon: HomeIcon,
    match: (p: string) => p === '/dashboard' || p === '/',
  },
  { href: '/data', label: 'Progress', icon: ChartIcon, match: (p: string) => p.startsWith('/data') },
  { href: '/sessions', label: 'Sessions', icon: HistoryIcon, match: (p: string) => p.startsWith('/sessions') },
] as const

// Rendered order: Home first, then the rail's order. `TABS` is authored
// Notes-first because that is the tab a returning student reaches for most, so
// the index list re-orders rather than re-authoring the array.
const ORDER = [1, 0, 2, 3] as const

export function MobileTabBar() {
  const pathname = usePathname() ?? '/dashboard'

  return (
    <nav className="cx-tabbar" aria-label="Primary">
      {ORDER.map((i) => {
        const tab = TABS[i]
        const active = tab.match(pathname)
        const Glyph = tab.icon
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? 'page' : undefined}
            className="cx-tabbar-item"
            style={{ color: active ? T.accentDeep : T.muted }}
          >
            <span
              className="cx-tabbar-icon"
              style={{ background: active ? T.mint32 : 'transparent' }}
            >
              <Glyph size={21} />
            </span>
            <span style={{ fontSize: 10.5, fontWeight: active ? 600 : 500, letterSpacing: '-.005em' }}>
              {tab.label}
            </span>
          </Link>
        )
      })}
    </nav>
  )
}
