'use client'

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import { HERO_SESSION, HeroDemo } from '@/components/marketing/HeroDemo'
import { FREE_SESSIONS_PER_MONTH } from '@/components/marketing/Pricing'

// Landing v6 hero (design_handoff_landing_v6 §2): two columns that wrap — a
// left-aligned headline, sub, one hard-shadowed accent CTA and the honest fine
// print on the left; the product demo on the right.
//
// The design's right column is a STATIC overlay mock. Per Darcy (2026-07-24)
// it is replaced by the real Landing v5 hero demo — the live scripted Khan
// Academy session (HeroDemo) — scaled to fit the column. The headline is
// likewise the existing "Stop copying. Start learning." rather than the design
// file's "The patient way to learn math."; only the design's FORMAT (left
// aligned, last phrase in --color-focus-ring) is adopted.
//
// 2026-07-24 retune (Darcy): the headline came down off the design's
// clamp(54,6.6vw,104) — it was eating too much vertical space — and the demo
// column took the width it gave back. The demo is now PLAY-ONLY: no chips, no
// composer, nothing to click. It plays HERO_SESSION — one whole tutoring
// session, eight turns from stuck to solved — and loops forever.

// useLayoutEffect warns during SSR; fall back to useEffect on the server so the
// scale-to-fit measurement stays flash-free on the client without the warning.
const useIsomorphicLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect

const ACCENT = '#86efac'
const ACCENT_HOVER = '#6ee7a0'

// HeroDemo is authored at its own max width; on desktop it is rendered at
// exactly this width and uniformly scaled into whatever the hero's right
// column gives it, so its proportions never change with the breakpoint.
const DEMO_W = 1020

// Room left around the scaled demo for the mac card's drop shadow
// (`0 60px 120px -36px`) to fall off instead of being cut against the column
// edge: ~24px each side and ~84px below in the demo's own units, which at the
// scales this column produces comes out under these constant CSS px.
const SHADOW_X = 20
const SHADOW_BOTTOM = 40

export function LandingHero({ showPlaceholders }: { showPlaceholders: boolean }) {
  const reduceMotion = useReducedMotion()

  // Above the fold, so the copy and the demo fade in on mount rather than on
  // scroll (same feel as the Reveal primitive, demo staggered just behind).
  const entrance = (delay: number) =>
    reduceMotion
      ? {}
      : {
          initial: { opacity: 0, y: 16 },
          animate: { opacity: 1, y: 0 },
          transition: { duration: 0.5, ease: [0, 0, 0.2, 1] as const, delay },
        }

  // 2026-07-24 (Darcy): the hero band was pulled in from both edges — the
  // design's 1400/44px is now 1300/56, so the headline starts further in and
  // the demo ends further from the right edge. The nav and the platform strip
  // carry the same numbers so all three stay flush with each other.
  return (
    <section
      id="top"
      className="mx-auto flex w-full max-w-[1300px] flex-wrap items-center gap-10 px-[22px] pt-8 sm:gap-[60px] sm:px-14 sm:pt-14"
    >
      <motion.div
        {...entrance(0.05)}
        className="flex flex-col pb-2 sm:pb-8"
        style={{ flex: '1 1 440px', minWidth: 'min(100%, 380px)' }}
      >
        {/* The heavier/looser pass (weight 800, -0.015em, line-height 1.12)
            was reverted at Darcy's ask, 2026-07-24 — back to the tight display
            tracking the two lines sat on before.
            The weight is set HERE rather than with Tailwind's `font-bold`:
            `.mkt-display` declares `font-weight: 600` and the two selectors
            have equal specificity, so marketing.css wins on source order and
            the utility silently did nothing. Inline beats both. */}
        <h1
          className="mkt-display m-0 text-foreground"
          style={{
            fontSize: 'clamp(34px, 4.4vw, 68px)',
            fontWeight: 700,
            lineHeight: 1.0,
            letterSpacing: '-0.04em',
          }}
        >
          Stop copying. <span className="text-(--color-focus-ring)">Start learning.</span>
        </h1>
        <p
          className="mb-0 mt-4 max-w-[480px] text-pretty text-muted-foreground sm:mt-6"
          style={{ fontSize: 'clamp(16px, 1.4vw, 21px)', lineHeight: 1.4 }}
        >
          Your Adaptive AI tutor that teaches directly on any homework, website, or PDF.
        </p>
        <a
          href="/start"
          onMouseEnter={(event) => (event.currentTarget.style.background = ACCENT_HOVER)}
          onMouseLeave={(event) => (event.currentTarget.style.background = ACCENT)}
          className="mt-6 inline-flex max-w-full items-center gap-3 self-start rounded-[15px] font-bold text-accent-fill-foreground sm:mt-8"
          style={{
            background: ACCENT,
            fontSize: 'clamp(16px, 1.5vw, 22px)',
            padding: 'clamp(13px, 1.3vw, 19px) clamp(22px, 3vw, 42px)',
            letterSpacing: '-0.01em',
            boxShadow: '0 6px 0 #1f9d5b',
          }}
        >
          Add to Chrome — free →
        </a>
        <p className="mb-0 mt-3.5 pl-1.5 text-[14px] text-muted-foreground sm:mt-4 sm:text-[16px]">
          {FREE_SESSIONS_PER_MONTH} free sessions a month · chrome, for now
        </p>
      </motion.div>

      <motion.div {...entrance(0.2)} style={{ flex: '1 1 660px', minWidth: 'min(100%, 420px)' }}>
        <ScaledHeroDemo showPlaceholders={showPlaceholders} />
      </motion.div>
    </section>
  )
}

// The hero demo, uniformly scaled to fit the column it is given.
//
// HeroDemo's own responsive styles switch on the VIEWPORT (Tailwind `sm:`),
// not on its container, so at desktop widths it always paints its large
// layout — inside a ~660px hero column that would overflow. Rendering it at
// its authored DEMO_W and transform-scaling the whole thing keeps every
// proportion identical. Below `sm` the viewport IS narrow, HeroDemo paints its
// own compact layout, and no scaling is applied.
//
// Reduced motion still gets the session — it is the product demonstration, and
// there is no static frame that carries the same meaning — but the entrance
// fade around it is dropped like everywhere else on the page.
//
// 2026-07-24 (Darcy: "no cutoffs"): the demo used to be scaled to the FULL
// column width and clipped with overflow-hidden, which sliced the mac card's
// soft drop shadow flat against the left, right and bottom edges. The column
// keeps its boundary; the demo is scaled to fit INSIDE it with room for that
// shadow to fall off naturally, and nothing clips.
function ScaledHeroDemo({ showPlaceholders }: { showPlaceholders: boolean }) {
  const slotRef = useRef<HTMLDivElement>(null)
  const demoRef = useRef<HTMLDivElement>(null)
  const [box, setBox] = useState<{ wide: boolean; scale: number; height: number }>({
    wide: true,
    scale: 1,
    height: 0,
  })

  useIsomorphicLayoutEffect(() => {
    const measure = () => {
      const wide = window.innerWidth >= 640
      const avail = slotRef.current?.clientWidth ?? DEMO_W
      // Reserve the shadow's own footprint on both sides before scaling, so
      // the card lands inside the column rather than flush against it.
      const scale = wide ? Math.min(1, Math.max(0, avail - SHADOW_X * 2) / DEMO_W) : 1
      // `display: flow-root` below keeps HeroDemo's own top margin inside this
      // wrapper, so offsetHeight is the true painted height and the reserved
      // box can't come up short.
      const height = demoRef.current?.offsetHeight ?? 0
      setBox({ wide, scale, height: height * scale })
    }
    measure()
    // The demo's height changes as the scripted session opens and closes its
    // transient surfaces, so the reserved height has to track it.
    const observer = new ResizeObserver(measure)
    if (demoRef.current) observer.observe(demoRef.current)
    window.addEventListener('resize', measure)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [])

  return (
    <div ref={slotRef} className="w-full">
      <div
        style={
          // Before the first measurement box.height is 0 — leave the height
          // auto rather than reserving a 40px sliver.
          box.wide
            ? { height: box.height ? box.height + SHADOW_BOTTOM : undefined, padding: `0 ${SHADOW_X}px` }
            : undefined
        }
      >
        <div
          ref={demoRef}
          style={
            box.wide
              ? {
                  width: DEMO_W,
                  display: 'flow-root',
                  transform: `scale(${box.scale})`,
                  transformOrigin: 'top left',
                }
              : undefined
          }
        >
          <HeroDemo
            showPlaceholders={showPlaceholders}
            voiceOnly
            interactive={false}
            script={HERO_SESSION}
          />
        </div>
      </div>
    </div>
  )
}
