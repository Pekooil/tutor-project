'use client'

import { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import type { CSSProperties } from 'react'
import { Logomark } from './primitives'
import { C } from './theme'

// The floating pill nav (Design handoff). Client component: it marks the active
// route (usePathname) and owns the avatar dropdown (menuOpen). Each nav item is
// a real route Link, so navigation keeps the app's server-rendered, RLS-scoped
// per-route reads — the pill is the design's chrome over the existing routing.

const NAV = [
  { href: '/dashboard', label: 'Overview' },
  { href: '/mastery', label: 'Mastery' },
  { href: '/misconceptions', label: 'Misconceptions' },
  { href: '/kits', label: 'Study kits' },
  { href: '/activity', label: 'Activity' },
] as const

const linkBase: CSSProperties = {
  border: 'none',
  cursor: 'pointer',
  fontSize: 12.5,
  padding: '6px 13px',
  borderRadius: 99,
  textDecoration: 'none',
  display: 'inline-block',
}

function itemStyle(active: boolean): CSSProperties {
  return {
    ...linkBase,
    background: active ? 'rgba(134,239,172,.35)' : 'transparent',
    color: active ? C.greenDeep : C.muted,
    fontWeight: active ? 600 : 500,
  }
}

export function PremiumNav({
  name,
  initials,
  planLabel,
}: {
  name: string
  initials: string
  planLabel: string
}) {
  const pathname = usePathname()
  const [menuOpen, setMenuOpen] = useState(false)
  const onAccount = pathname === '/account'

  return (
    <div style={{ position: 'fixed', top: 18, left: '50%', transform: 'translateX(-50%)', zIndex: 50 }}>
      <div
        style={{
          position: 'relative',
          display: 'flex',
          alignItems: 'center',
          gap: 2,
          padding: '6px 7px',
          background: 'rgba(255,255,255,.78)',
          border: '1px solid rgba(28,28,26,.1)',
          borderRadius: 99,
          backdropFilter: 'blur(24px) saturate(1.5)',
          WebkitBackdropFilter: 'blur(24px) saturate(1.5)',
          boxShadow: '0 18px 44px rgba(28,40,30,.14),0 2px 8px rgba(28,40,30,.07)',
          animation: 'cxPop .5s cubic-bezier(.3,1.4,.4,1) both',
        }}
      >
        <Link href="/dashboard" style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '0 10px 0 8px', textDecoration: 'none', color: C.ink }}>
          <Logomark size={20} id="cxgNav" />
          <span style={{ fontSize: 14.5, fontWeight: 600 }}>calyxa</span>
        </Link>
        <span style={{ width: 1, height: 18, background: 'rgba(28,28,26,.1)', margin: '0 6px 0 2px' }} />
        {NAV.map((item) => {
          const active = pathname === item.href || (item.href === '/dashboard' && pathname === '/')
          return (
            <Link key={item.href} href={item.href} aria-current={active ? 'page' : undefined} style={itemStyle(active)}>
              {item.label}
            </Link>
          )
        })}
        <span style={{ width: 1, height: 18, background: 'rgba(28,28,26,.1)', margin: '0 4px' }} />
        <button
          onClick={() => setMenuOpen((o) => !o)}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          title={`${name} · Account`}
          className="cx-hover-menu"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            padding: '2px 6px 2px 2px',
            borderRadius: 99,
            border: 'none',
            cursor: 'pointer',
            background: onAccount || menuOpen ? 'rgba(134,239,172,.25)' : 'transparent',
          }}
        >
          <span
            style={{
              width: 28,
              height: 28,
              flex: 'none',
              borderRadius: 99,
              background: '#86efac',
              color: C.greenDeep,
              fontSize: 11,
              fontWeight: 600,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {initials}
          </span>
          <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="#6b6b65" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 4.5 L6 7.5 L9 4.5" />
          </svg>
        </button>
      </div>

      {menuOpen && (
        <div
          role="menu"
          style={{
            position: 'absolute',
            right: 0,
            top: 52,
            width: 230,
            padding: 7,
            background: 'rgba(255,255,255,.85)',
            border: '1px solid rgba(28,28,26,.1)',
            borderRadius: 17,
            backdropFilter: 'blur(24px) saturate(1.5)',
            WebkitBackdropFilter: 'blur(24px) saturate(1.5)',
            boxShadow: '0 18px 44px rgba(28,40,30,.18),0 2px 8px rgba(28,40,30,.08)',
            animation: 'cxPop .35s cubic-bezier(.3,1.4,.4,1) both',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: '9px 11px 11px',
              borderBottom: '1px solid rgba(28,28,26,.07)',
              marginBottom: 5,
            }}
          >
            <span
              style={{
                width: 30,
                height: 30,
                flex: 'none',
                borderRadius: 99,
                background: '#86efac',
                color: C.greenDeep,
                fontSize: 11.5,
                fontWeight: 600,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              {initials}
            </span>
            <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
              <span style={{ fontSize: 13, fontWeight: 600 }}>{name}</span>
              <span style={{ fontSize: 11.5, color: C.muted }}>{planLabel}</span>
            </span>
          </div>
          <Link
            href="/account"
            role="menuitem"
            onClick={() => setMenuOpen(false)}
            className="cx-hover-menu"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              width: '100%',
              textDecoration: 'none',
              textAlign: 'left',
              fontSize: 13,
              padding: '9px 11px',
              borderRadius: 11,
              background: onAccount ? 'rgba(134,239,172,.35)' : 'transparent',
              color: onAccount ? C.greenDeep : C.ink,
              fontWeight: onAccount ? 600 : 500,
            }}
          >
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <circle cx="8" cy="5.4" r="2.5" />
              <path d="M3.4 13 C4 10.6 5.8 9.5 8 9.5 C10.2 9.5 12 10.6 12.6 13" />
            </svg>
            Account
          </Link>
        </div>
      )}
    </div>
  )
}
