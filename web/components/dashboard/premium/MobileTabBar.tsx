'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import type { ReactNode } from 'react'
import { NAV, isActive } from './PremiumNav'
import { C } from './theme'

// The mobile-only bottom tab bar — the native-app navigation pattern for the
// post-login dashboard. On desktop the floating pill nav (PremiumNav) carries
// the same NAV items inline; below 640px those inline links are hidden and this
// fixed bottom bar takes over. Visibility is controlled entirely in globals.css
// (`.cx-tabbar` is display:none by default, shown only under the mobile media
// query) so desktop rendering is untouched. Shares NAV + isActive with
// PremiumNav so the two chrome treatments can never drift.

// One glyph per nav route, matched to the item's meaning (home / notebook /
// sessions / library). 22px line icons, currentColor so the active tint flows.
const ICONS: Record<string, ReactNode> = {
  '/dashboard': (
    <path d="M3.5 9 L11 3 L18.5 9 M5.5 7.6 V18 H16.5 V7.6" />
  ),
  '/notebook': (
    <>
      <path d="M5 3.5 H15.5 A1 1 0 0 1 16.5 4.5 V17.5 A1 1 0 0 1 15.5 18.5 H5.5 A1.5 1.5 0 0 1 4 17 V5 A1.5 1.5 0 0 1 5.5 3.5 Z" />
      <path d="M8 3.5 V18.5" />
    </>
  ),
  '/sessions': (
    <>
      <circle cx="11" cy="11" r="7.5" />
      <path d="M9 7.8 L14.5 11 L9 14.2 Z" />
    </>
  ),
  '/library': (
    <>
      <rect x="3.5" y="3.5" width="6" height="6" rx="1.4" />
      <rect x="12.5" y="3.5" width="6" height="6" rx="1.4" />
      <rect x="3.5" y="12.5" width="6" height="6" rx="1.4" />
      <rect x="12.5" y="12.5" width="6" height="6" rx="1.4" />
    </>
  ),
}

export function MobileTabBar() {
  const pathname = usePathname()

  return (
    <nav className="cx-tabbar" aria-label="Primary">
      {NAV.map((item) => {
        const active = isActive(pathname, item.match)
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            className="cx-tabbar-item"
            style={{ color: active ? C.greenDeep : C.muted }}
          >
            <span
              className="cx-tabbar-icon"
              style={{ background: active ? 'rgba(134,239,172,.35)' : 'transparent' }}
            >
              <svg
                width="22"
                height="22"
                viewBox="0 0 22 22"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                {ICONS[item.href]}
              </svg>
            </span>
            <span style={{ fontSize: 10.5, fontWeight: active ? 600 : 500, letterSpacing: '-.005em' }}>
              {item.label}
            </span>
          </Link>
        )
      })}
    </nav>
  )
}
