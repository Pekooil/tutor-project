'use client'

import Link from 'next/link'
import { NAV_ITEMS } from './nav'
import { T, MOTION, SHADOW } from './tokens'

// The floating bottom-left nav bar, on every post-login route.
//
// Text-only by design: an earlier icon+label version was rejected, and the icon
// rail already carries the glyphs. This bar exists to NAME the five destinations,
// which the glyph-only rail cannot do without hovering.
//
// Not rendered on /studio-preview: that route has its own view switcher in the
// same corner (it flips a `?view=` param rather than navigating), and two bars
// stacked in one corner is exactly the duplication this replaced.

export function StudioNavBar({
  pathname,
  conceptKey,
}: {
  pathname: string
  /** The open concept, so Notes/Quiz/Flashcards deep-link to it. */
  conceptKey: string | null
}) {
  if (pathname.startsWith('/studio-preview')) return null

  return (
    <nav
      className="cx-navbar"
      aria-label="Studio views"
      style={{
        position: 'fixed',
        bottom: 14,
        left: 80,
        zIndex: 60,
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: 6,
        borderRadius: 999,
        background: T.cardSoft,
        border: `1px solid ${T.frame}`,
        backdropFilter: 'blur(22px) saturate(1.5)',
        WebkitBackdropFilter: 'blur(22px) saturate(1.5)',
        boxShadow: SHADOW.soft,
        fontSize: 12,
      }}
    >
      {NAV_ITEMS.map((item) => {
        const active = item.match(pathname)
        return (
          <Link
            key={item.label}
            href={item.href(conceptKey)}
            aria-label={item.label}
            aria-current={active ? 'page' : undefined}
            className={active ? undefined : 'cx-navbar-item'}
            style={{
              padding: '5px 11px',
              borderRadius: 999,
              fontWeight: 600,
              whiteSpace: 'nowrap',
              textDecoration: 'none',
              // Accent fill takes dark text (the brand's light-fill rule).
              background: active ? T.accent : 'transparent',
              color: active ? T.onAccent : T.muted,
              transition: `background ${MOTION.fast} ${MOTION.ease}, color ${MOTION.fast} ${MOTION.ease}`,
            }}
          >
            {item.short}
          </Link>
        )
      })}
    </nav>
  )
}
