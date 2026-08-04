'use client'

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import { CalyxaMark } from '@calyxa/ui'
import { CompatibleWith, type Platform } from '@/components/marketing/CompatibleWith'
import { HeroDemo } from '@/components/marketing/HeroDemo'
import { Nav } from '@/components/marketing/Nav'

// useLayoutEffect warns during SSR; fall back to useEffect on the server so the
// scale-to-fit measurement stays flash-free on the client without the warning.
const useIsomorphicLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect

// Hero (design_handoff_calyxa_hero_2a, 2026-07-20): the design's hero content
// — top nav, the Product Hunt featured badge, and the centered copy block —
// rendered full-bleed as part of the page (the design's grey frame / rounded
// card / shadow are intentionally dropped; only the green wash remains,
// spanning the page width). Because the artboard is authored against the
// design's 1440-wide frame, the content renders at its exact design size and
// is uniformly scaled to fit the viewport width (identical proportions at any
// width). The Mac-mockup live demo (HeroDemo) sits directly beneath it.
//
// 2026-07-21: the bottom motion layer — the flowing student questions, the
// live voice/mode pill, and the flowing platform chips — was removed at
// Darcy's ask, and the artboard shortened to CARD_H so the Mac demo rides up
// right under the CTA.

const NAV_LINKS = [
  { label: 'how it works', href: '#how-it-works' },
  { label: 'pricing', href: '#pricing' },
  { label: 'log in', href: '/login' },
]

// The platforms rotated through the hero's "Compatible with" pill — the same
// 7 names, in the same order, with the same brand accents the removed motion
// layer's chips used. Name-only (no brand logos), so nothing here is a
// third-party brand asset or a redrawn approximation.
const PLATFORMS: Platform[] = [
  { name: 'Canvas', color: '#e2323b' },
  { name: 'Khan Academy', color: '#14a07a' },
  { name: 'MyLab Math', color: '#9a5cb4' },
  { name: 'DeltaMath', color: '#2f9e6f' },
  { name: 'WebAssign', color: '#c8102e' },
  { name: 'AP Classroom', color: '#0077c8' },
  { name: 'Google Classroom', color: '#0f9d58' },
]

// Rightward nudge (design px) applied to the hero badge row — see the row's
// comment for why. Puts the page centre line at the midpoint of the gap
// between the Product Hunt badge and the "Compatible with" label; retuned when
// the row shrank (2026-07-22) since the pill slot's trailing dead space scales
// with its width.
const BADGE_ROW_NUDGE = 28

// Same correction for the mobile hero's compact row, in real CSS px: the
// compact slot is sized to "Google Classroom", so shorter names leave dead
// space on the right and the line reads left-of-centre. 24 optically centres
// the average name (the extremes land within ~17px either side).
const MOBILE_ROW_NUDGE = 24

const CARD_W = 1440
// Just the nav + copy block now that the motion layer is gone. The artboard
// clips (`overflow: hidden`), so it must stay tall enough for the CTA's
// `0 14px 36px` drop shadow to fade out completely inside it — cutting it off
// leaves a hard-edged band of half-drawn shadow under the button. CARD_TRIM
// below then pulls the demo back up, so this height costs no visible gap.
// 2026-07-22: shrunk from 555 → 388 alongside a smaller title + tighter copy
// spacing and nav padding (Darcy's ask) so the whole hero block rides up and
// the Mac demo below shows as much of its screen above the fold as possible.
const CARD_H = 388
// How much of the artboard's shadow-clearance tail the demo section rides back
// over. Kept in design units so it scales with the artboard.
const CARD_TRIM = 45

// One primary-CTA style shared by the nav pill and the hero CTA (values are
// each element's own; this only carries the accent hover, applied inline so it
// beats no layered utility). Kept as constants so both call sites match.
const ACCENT = '#86efac'
const ACCENT_HOVER = '#6ee7a0'

export function Hero({ showPlaceholders }: { showPlaceholders: boolean }) {
  const [scale, setScale] = useState(1)
  const stageRef = useRef<HTMLDivElement>(null)
  const askRef = useRef<((question: string) => void) | null>(null)
  const reduceMotion = useReducedMotion()

  // On-landing entrance: the hero copy (headline + CTA) and the Mac demo are
  // above the fold, so they animate on mount rather than on scroll — the fade
  // plays the moment the page loads. Matches the Reveal primitive's feel
  // (opacity + a short rise), with the demo staggered just behind the copy.
  // Reduced motion renders the composed end state with no movement.
  const entrance = (delay: number) =>
    reduceMotion
      ? {}
      : {
          initial: { opacity: 0, y: 16 },
          animate: { opacity: 1, y: 0 },
          transition: { duration: 0.5, ease: [0, 0, 0.2, 1] as const, delay },
        }

  // Uniform scale-to-fit: the card is authored at CARD_W×CARD_H, so scale it to
  // the stage's available width and reserve the scaled height in layout so the
  // demo below flows right after it.
  useIsomorphicLayoutEffect(() => {
    // Scale to fill the full viewport width at any size — uncapped, so the
    // green wash and copy keep the design's proportions on screens wider than
    // the 1440 design frame.
    const measure = () => {
      const avail = stageRef.current?.clientWidth ?? CARD_W
      setScale(avail / CARD_W)
    }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [])

  return (
    <>
      {/* Mobile hero (<640px): the scaled 1440-wide artboard below renders its
          nav + copy at ~0.26× on a phone (≈4px nav links, ≈19px H1), so on
          mobile it is hidden and this properly-sized, tap-friendly layout takes
          its place. Desktop (≥640px) is untouched — the artboard shows exactly
          as before. */}
      <MobileHero />

      {/* Full-bleed hero: the design's green wash spans the page width (no grey
          frame, no rounded card, no shadow) so the hero reads as part of the
          site. The 1440-wide content is centered and scaled to fit. Hidden on
          mobile (see MobileHero above). */}
      <div
        ref={stageRef}
        className="hidden justify-center overflow-hidden sm:flex"
        style={{
          // Light ambient green wash anchored at the top (2026-07-22): a gentle
          // linear tint in the same very-light register as the closing "Press
          // and start talking" gradient (→ #f0fdf4), fading to white by the
          // mid-hero so the Mac demo below stays on clean white. The soft radial
          // glow keeps the green organic rather than a flat band.
          background:
            'linear-gradient(180deg, #e6faed 0%, rgba(240,253,244,0.5) 32%, rgba(255,255,255,0) 60%), radial-gradient(74rem 38rem at 50% -12rem, rgba(134,239,172,0.2), transparent 66%), #ffffff',
        }}
      >
        {/* Height reservation for the scaled card so the demo flows below it. */}
        <div style={{ width: CARD_W * scale, height: CARD_H * scale, flex: 'none' }}>
          <div
            style={{
              position: 'relative',
              width: CARD_W,
              height: CARD_H,
              flex: 'none',
              overflow: 'hidden',
              transform: `scale(${scale})`,
              transformOrigin: 'top left',
            }}
          >
            {/* Top navigation bar */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 36, padding: '18px 56px' }}>
              <a href="/" style={{ display: 'flex', alignItems: 'center', gap: 9, color: 'inherit' }}>
                <CalyxaMark style={{ width: 26, height: 26 }} />
                <span style={{ fontSize: 18, fontWeight: 600, letterSpacing: '-0.01em', color: '#1c1c1a' }}>
                  calyxa
                </span>
              </a>
              <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 30 }}>
                {NAV_LINKS.map((link) => (
                  <a
                    key={link.href}
                    href={link.href}
                    style={{ fontSize: 14.5, fontWeight: 500, color: '#55554f', textDecoration: 'none' }}
                  >
                    {link.label}
                  </a>
                ))}
                <a
                  href="/start"
                  onMouseEnter={(e) => (e.currentTarget.style.background = ACCENT_HOVER)}
                  onMouseLeave={(e) => (e.currentTarget.style.background = ACCENT)}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    background: ACCENT,
                    color: '#14532d',
                    fontSize: 14,
                    fontWeight: 600,
                    padding: '10px 20px',
                    borderRadius: 999,
                    textDecoration: 'none',
                    boxShadow: '0 6px 18px rgba(28,40,30,0.14)',
                  }}
                >
                  Add to Chrome — free
                </a>
              </div>
            </div>

            {/* Centered hero copy block */}
            <motion.div
              {...entrance(0.05)}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                paddingTop: 28,
                position: 'relative',
                zIndex: 2,
              }}
            >
              {/* Badge row (2026-07-21): the Product Hunt badge and the
                  rotating "Compatible with" pill sit as one centered group —
                  not pinned to the page edges — which lands Product Hunt just
                  left of centre and the pill to its right.
                  The nudge right compensates for the pill slot's fixed width:
                  its trailing dead space (the slot is sized to the longest
                  platform name) drags the row's geometric centre left of what
                  the eye reads as centre. BADGE_ROW_NUDGE puts the page's
                  centre line in the gap between the two badges. Measured, not
                  eyeballed — a transform so it costs no layout. */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 32,
                  transform: `translateX(${BADGE_ROW_NUDGE}px)`,
                }}
              >
                <a
                  href="https://www.producthunt.com/products/calyxa?embed=true&utm_source=badge-featured&utm_medium=badge&utm_campaign=badge-calyxa"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <img
                    alt="Calyxa - Adaptive AI math tutoring that lives in your browser | Product Hunt"
                    width={200}
                    height={43}
                    src="https://api.producthunt.com/widgets/embed-image/v1/featured.svg?post_id=1202106&theme=light&t=1784615962865"
                  />
                </a>
                <CompatibleWith platforms={PLATFORMS} />
              </div>
              <h1
                style={{
                  margin: '20px 0 0',
                  fontFamily: 'var(--font-display)',
                  fontWeight: 700,
                  fontSize: 52,
                  lineHeight: 1.02,
                  letterSpacing: '-0.032em',
                  textAlign: 'center',
                  whiteSpace: 'nowrap',
                  color: '#1c1c1a',
                }}
              >
                Stop copying. Start learning.
              </h1>
              <p
                style={{
                  margin: '13px 0 0',
                  fontSize: 15,
                  lineHeight: 1.5,
                  color: '#55554f',
                  textAlign: 'center',
                  maxWidth: 560,
                  textWrap: 'pretty',
                }}
              >
                Your Adaptive AI tutor that teaches directly on any homework, website, or PDF.
              </p>
              <a
                href="/start"
                onMouseEnter={(e) => (e.currentTarget.style.background = ACCENT_HOVER)}
                onMouseLeave={(e) => (e.currentTarget.style.background = ACCENT)}
                style={{
                  marginTop: 26,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 10,
                  background: ACCENT,
                  color: '#14532d',
                  fontSize: 16,
                  fontWeight: 600,
                  padding: '15px 30px',
                  borderRadius: 999,
                  border: '1px solid rgba(20,83,45,0.18)',
                  textDecoration: 'none',
                  boxShadow: '0 14px 36px rgba(28,40,30,0.18), 0 2px 8px rgba(28,40,30,0.08)',
                }}
              >
                Add to Chrome — free
              </a>
            </motion.div>

          </div>
        </div>
      </div>

      {/* The Mac-mockup live demo, directly beneath the hero copy. The scaled
          negative margin reclaims the artboard's CARD_TRIM shadow-clearance
          tail (see CARD_H) so the demo sits right under the CTA without
          clipping its drop shadow. (The works-where-your-homework-is eyebrow +
          platform-pill marquee that used to close this band were removed
          2026-07-20; the motion layer, 2026-07-21.) */}
      <motion.section
        {...entrance(0.2)}
        id="hero-demo-section"
        className="relative z-10 flex flex-col items-center px-[22px] sm:px-14"
        style={{ marginTop: -Math.round(CARD_TRIM * scale) }}
      >
        <HeroDemo askRef={askRef} showPlaceholders={showPlaceholders} />
      </motion.section>
    </>
  )
}

// The mobile hero (<640px): the responsive Nav + a properly-sized, tap-friendly
// copy block on the same green wash as the desktop artboard. Rendered only on
// mobile (`sm:hidden`); the desktop scaled artboard above is hidden there. Copy
// mirrors the desktop hero exactly so the two never drift.
function MobileHero() {
  const reduceMotion = useReducedMotion()
  // Same on-landing fade as the desktop hero copy block.
  const entrance = reduceMotion
    ? {}
    : {
        initial: { opacity: 0, y: 16 },
        animate: { opacity: 1, y: 0 },
        transition: { duration: 0.5, ease: [0, 0, 0.2, 1] as const, delay: 0.05 },
      }
  return (
    <div className="sm:hidden">
      <Nav />
      <motion.div
        {...entrance}
        className="flex flex-col items-center px-6 pb-11 pt-10 text-center"
        style={{
          // Same light top-anchored green wash as the desktop artboard, scaled
          // for the phone hero (2026-07-22).
          background:
            'linear-gradient(180deg, #e6faed 0%, rgba(240,253,244,0.5) 34%, rgba(255,255,255,0) 62%), radial-gradient(46rem 24rem at 50% -6rem, rgba(134,239,172,0.22), transparent 70%), #ffffff',
        }}
      >
        <a
          href="https://www.producthunt.com/products/calyxa?embed=true&utm_source=badge-featured&utm_medium=badge&utm_campaign=badge-calyxa"
          target="_blank"
          rel="noopener noreferrer"
        >
          <img
            alt="Calyxa - Adaptive AI math tutoring that lives in your browser | Product Hunt"
            width={250}
            height={54}
            src="https://api.producthunt.com/widgets/embed-image/v1/featured.svg?post_id=1202106&theme=light&t=1784615962865"
          />
        </a>

        <h1 className="mkt-display mkt-h1 mt-[18px] text-balance text-foreground">Stop copying. Start learning.</h1>
        <p className="mt-4 max-w-[21rem] text-pretty text-[15.5px] leading-[1.55] text-(--mkt-strip-text)">
          Your Adaptive AI tutor that teaches directly on any homework, website, or PDF.
        </p>

        <a
          href="/start"
          className="mt-7 inline-flex w-full max-w-[21rem] items-center justify-center rounded-full px-6 py-[15px] text-[15.5px] font-semibold"
          style={{
            background: ACCENT,
            color: '#14532d',
            border: '1px solid rgba(20,83,45,0.18)',
            boxShadow: '0 12px 30px rgba(28,40,30,0.18), 0 2px 8px rgba(28,40,30,0.08)',
          }}
        >
          Add to Chrome — free
        </a>

        {/* The same rotating "Compatible with" pill the desktop badge row
            carries, at the compact size (2026-07-21). It replaces the static
            "Works on Khan Academy, Canvas…" line that used to sit here — same
            information, and it now names every supported platform rather than
            three plus "& more". Kept below the CTA rather than beside the
            Product Hunt badge: there is no room for a side-by-side badge row
            at phone widths. */}
        <div className="mt-6" style={{ transform: `translateX(${MOBILE_ROW_NUDGE}px)` }}>
          <CompatibleWith platforms={PLATFORMS} size="compact" />
        </div>
      </motion.div>
    </div>
  )
}
