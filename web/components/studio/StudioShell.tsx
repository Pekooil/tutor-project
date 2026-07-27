'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { CalyxaMark } from '@calyxa/ui'
import { MobileTabBar } from './MobileTabBar'
import { StudioNavBar } from './StudioNavBar'
import { NAV_ITEMS, isStudioView } from './nav'
import { T, MOTION, SHADOW, RADIUS, eyebrow, pill } from './tokens'
import { GiftIcon, HistoryIcon, KebabIcon, MoonIcon, ShareIcon, SunIcon } from './icons'

// The Notebook Studio's global chrome — a 64px left icon rail and a 60px top
// bar, present on every post-login route. It replaces the floating pill nav so
// the whole signed-in app shares one shell (the design handoff's "Global
// Chrome"); the pre-studio screens render inside it unchanged.
//
// This is the one client component in the shell because it owns three pieces of
// browser state: the active rail item (pathname), the theme (stamped on
// <body data-theme>), and the top-bar title, which a server page can only supply
// from inside its own subtree — hence the context + <StudioTitle> pair below.

// ── Top-bar title ────────────────────────────────────────────────────────────

export type StudioTitleValue = {
  /** The concept a view was opened for, or null on the dashboard. */
  concept: string | null
  subject: string | null
  /** The concept key, so the rail can deep-link Notes/Quiz/Flashcards. */
  conceptKey: string | null
  /** Overrides the pathname-derived layout mode. Only the preview harness needs
   *  it — its four views share one route, so the path can't tell them apart. */
  fullBleed?: boolean
}

const EMPTY_TITLE: StudioTitleValue = { concept: null, subject: null, conceptKey: null }

const TitleContext = createContext<(v: StudioTitleValue | null) => void>(() => {})

/** Rendered by a page to tell the shell which concept is open. Renders nothing;
 *  it exists so a server component can drive the client-owned top bar. */
export function StudioTitle({ concept, subject, conceptKey, fullBleed }: StudioTitleValue) {
  const set = useContext(TitleContext)
  useEffect(() => {
    set({ concept, subject, conceptKey, fullBleed })
    return () => set(null)
  }, [set, concept, subject, conceptKey, fullBleed])
  return null
}

// ── Rail ─────────────────────────────────────────────────────────────────────

const railButton = (active: boolean): CSSProperties => ({
  width: 40,
  height: 40,
  borderRadius: RADIUS.box,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: active ? T.mint32 : 'transparent',
  color: active ? T.accentDeep : T.muted,
  border: 'none',
  cursor: 'pointer',
  transition: `background ${MOTION.fast} ${MOTION.ease}, color ${MOTION.fast} ${MOTION.ease}`,
})

/** A 34×34 ghost square in the top bar. */
const barButton: CSSProperties = {
  width: 34,
  height: 34,
  borderRadius: RADIUS.tile,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'transparent',
  color: T.muted,
  transition: `background ${MOTION.fast} ${MOTION.ease}, color ${MOTION.fast} ${MOTION.ease}`,
}


// ── The shell ────────────────────────────────────────────────────────────────

/** Routes that own their own full-height layout and padding. Everything else
 *  gets the shell's default content column. */
function isFullBleed(pathname: string): boolean {
  return pathname.startsWith('/notes/') || pathname.startsWith('/quiz/') || pathname.startsWith('/flashcards/')
}

export function StudioShell({
  children,
  initials,
  name,
}: {
  children: ReactNode
  initials: string
  name: string
}) {
  const pathname = usePathname() ?? '/dashboard'
  const [title, setTitle] = useState<StudioTitleValue>(EMPTY_TITLE)
  // Dark is the studio's default. theme.css's dark block re-points every token
  // the studio reads, so this one line flips the whole surface.
  const [theme, setTheme] = useState<'light' | 'dark'>('dark')

  // A stable identity so <StudioTitle>'s effect doesn't re-fire every render.
  const setTitleSafe = useCallback((v: StudioTitleValue | null) => setTitle(v ?? EMPTY_TITLE), [])

  useEffect(() => {
    document.body.dataset.theme = theme
    return () => {
      delete document.body.dataset.theme
    }
  }, [theme])

  const heading = useMemo(() => {
    if (pathname.startsWith('/notes/') && title.concept) {
      return [title.concept, title.subject, 'Session Review'].filter(Boolean).join(' — ')
    }
    if (pathname.startsWith('/quiz/') && title.concept) return `${title.concept} — Quiz`
    if (pathname.startsWith('/flashcards/') && title.concept) return `${title.concept} — Flashcards`
    const item = NAV_ITEMS.find((r) => r.match(pathname))
    return item?.label ?? 'Calyxa'
  }, [pathname, title])

  const full = title.fullBleed ?? isFullBleed(pathname)

  // The pre-studio screens (account, billing, referral, sessions, library, kits)
  // are built on premium/theme.ts's hardcoded LIGHT hexes over near-opaque WHITE
  // glass cards, so they cannot render dark — inherited text goes near-white on a
  // white card and disappears.
  //
  // The light pinning is scoped to the CONTENT AREA only, never the whole shell.
  // Pinning the shell made the rail and top bar flip light→dark→light as the
  // student moved between tabs, which reads as a glitch. The chrome now always
  // honours the chosen theme and the legacy page sits inside it as a light
  // document — the same arrangement the preview's History view already uses.
  const legacyContent = !isStudioView(pathname)

  return (
    <TitleContext.Provider value={setTitleSafe}>
      <div
        className="cx-app cx-studio"
        // Stamped on the element itself, not only on <body> via the effect below:
        // the attribute is then present in the SERVER-rendered HTML, so a
        // dark-by-default shell paints dark on the first frame instead of
        // flashing light until hydration runs. Always the CHOSEN theme — the shell
        // never flips underneath the student as they navigate.
        data-theme={theme}
        // background/color are deliberately NOT set inline: an inline style beats
        // a class rule, which is how the dark foreground colour was leaking onto
        // the light legacy screens. globals.css owns both.
        style={{ display: 'flex', height: '100vh', overflow: 'hidden' }}
      >
        {/* The page ground's three fixed mint blooms. Decorative and inert —
            `pointer-events: none` and a negative z-index inside the shell's own
            stacking context, so they never intercept a click or cover content. */}
        <span aria-hidden className="cx-bloom cx-bloom-1" />
        <span aria-hidden className="cx-bloom cx-bloom-2" />
        <span aria-hidden className="cx-bloom cx-bloom-3" />

        <nav
          aria-label="Primary"
          className="cx-rail"
          style={{
            width: 64,
            flex: '0 0 64px',
            height: '100%',
            background: T.cardSoft,
            borderRight: `1px solid ${T.frame}`,
            backdropFilter: 'blur(24px) saturate(1.5)',
            WebkitBackdropFilter: 'blur(24px) saturate(1.5)',
            boxShadow: SHADOW.rail,
            padding: '14px 0 16px',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 6,
          }}
        >
          <Link href="/dashboard" aria-label="Calyxa home" style={{ marginBottom: 16, display: 'flex' }}>
            <CalyxaMark style={{ width: 28, height: 28 }} />
          </Link>

          {/* Glyph-only, per the design handoff — each carries an aria-label and a
              title, so the destination is named on hover and to a screen reader
              without captions widening the specified 64px rail. */}
          {NAV_ITEMS.map((item) => {
            const active = item.match(pathname)
            const Glyph = item.icon
            return (
              <Link
                key={item.label}
                href={item.href(title.conceptKey)}
                aria-label={item.label}
                title={item.label}
                aria-current={active ? 'page' : undefined}
                className="cx-rail-btn"
                style={railButton(active)}
              >
                <Glyph size={18} />
              </Link>
            )
          })}

          <div style={{ flex: 1 }} />

          {/* Invite friends. Deep-links to the invite card on the plan page
              rather than the top of it — the point of the button is the link a
              student is about to copy, not the subscription above it.
              Deliberately BELOW the spacer with the toggle and the avatar: it is
              a standing offer, not a fifth destination, so it stays out of the
              four-item primary group the rail's `aria-current` describes. */}
          <Link
            href="/billing#invite"
            aria-label="Invite friends — earn free sessions"
            title="Invite friends — earn free sessions"
            className="cx-rail-btn"
            style={railButton(false)}
          >
            <GiftIcon size={18} />
          </Link>

          {/* Always available: the toggle drives the chrome, which is present on
              every route, so it is never a dead control. */}
          <button
            type="button"
            onClick={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
            aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
            className="cx-rail-btn"
            style={railButton(false)}
          >
            {theme === 'dark' ? <SunIcon size={18} /> : <MoonIcon size={18} />}
          </button>

          {/* A STATIC mint bloom, not the breathing one — the avatar is always
              on screen, and a permanent pulse in the corner of the eye is noise
              rather than emphasis. */}
          <span className="cx-glowwrap" style={{ marginTop: 4 }}>
            <span aria-hidden className="cx-glow" />
            <Link
              href="/account"
              aria-label={`Account — ${name}`}
              title={name}
              style={{
                width: 34,
                height: 34,
                borderRadius: '50%',
                background: T.accent,
                color: T.onAccent,
                fontSize: 14,
                fontWeight: 600,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                textDecoration: 'none',
              }}
            >
              {initials}
            </Link>
          </span>
        </nav>

        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
          <header
            style={{
              height: 60,
              flex: '0 0 60px',
              padding: '0 22px',
              background: T.topbar,
              borderBottom: `1px solid ${T.hairline}`,
              backdropFilter: 'blur(24px) saturate(1.5)',
              WebkitBackdropFilter: 'blur(24px) saturate(1.5)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 16,
            }}
          >
            <h1
              style={{
                fontSize: 15,
                fontWeight: 600,
                letterSpacing: '-0.005em',
                margin: 0,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {heading}
            </h1>

            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
              <Link href="/sessions" aria-label="Session history" className="cx-rail-btn" style={barButton}>
                <HistoryIcon size={17} />
              </Link>

              <button
                type="button"
                disabled
                title="Sharing a notebook isn't built yet"
                style={{
                  ...pill,
                  height: 34,
                  padding: '0 15px',
                  background: T.mint30,
                  color: T.accentDeep,
                  border: 'none',
                  fontSize: 13,
                  fontWeight: 600,
                  opacity: 0.6,
                  cursor: 'not-allowed',
                }}
              >
                <ShareIcon size={14} />
                Share
              </button>

              <Link href="/account" aria-label="Account settings" className="cx-rail-btn" style={barButton}>
                <KebabIcon size={16} />
              </Link>
            </div>
          </header>

          <main
            className={`cx-studio-main${legacyContent ? ' cx-legacy' : ''}`}
            // Light tokens for the legacy page only, so its hardcoded light hexes
            // resolve against a light surface while the surrounding chrome keeps
            // whatever theme the student chose.
            data-theme={legacyContent ? 'light' : undefined}
            style={
              full
                ? { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }
                : { flex: 1, minHeight: 0, overflowY: 'auto' }
            }
          >
            {children}
          </main>
        </div>

        {/* Names the five destinations the glyph-only rail can't. Bottom-left,
            desktop only — the tab bar owns navigation below 640px. */}
        <StudioNavBar pathname={pathname} conceptKey={title.conceptKey} />

        {/* Under 640px the rail is hidden and the existing bottom tab bar takes
            over — the mobile chrome the dashboard already shipped. */}
        <MobileTabBar />
      </div>
    </TitleContext.Provider>
  )
}

/** The uppercase section eyebrow used across the studio screens. */
export function Eyebrow({ children, tone = 'muted' }: { children: ReactNode; tone?: 'muted' | 'accent' }) {
  return <div style={{ ...eyebrow, color: tone === 'accent' ? T.accentInk : T.muted }}>{children}</div>
}
