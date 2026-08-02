'use client'

import { motion, useReducedMotion } from 'motion/react'
import { HomeworkDemo } from '@/components/marketing/HomeworkDemo'
import { FREE_SESSIONS_PER_MONTH } from '@/components/marketing/Pricing'

// Landing v7 hero (design_handoff_calyxa_landing §2): two columns that wrap —
// a left-aligned headline, sub, one hard-shadowed accent CTA and the honest
// fine print on the left; the product demo on the right.
//
// The headline is Darcy's call (2026-07-29) over the handoff's default "The
// fastest way to do your homework yourself." — that one leans on "yourself",
// which is the moral frame the handoff's own copy rules ban, and it was the
// only word in the line doing differentiating work. Format is unchanged: two
// parts, the last phrase in --color-focus-ring.
//
// 2026-07-30: Darcy asked to swap "Go do something else" for "Go do what's
// actually important", explicitly wanting my read on it. My pushback: "what's
// actually important" quietly implies homework ISN'T important — it's a
// softer second edition of the same judgment "Stop copying" made, just
// pointed at the assignment instead of the student. A parent or teacher
// skimming the page reads it as the product taking a side against the
// assignment. "matters to you" keeps the emphatic upgrade Darcy wanted
// without relitigating whether homework matters — it's personal ("to you"),
// not comparative ("actually").
//
// The right column no longer transform-scales anything. The previous hero
// rendered HeroDemo at its authored 1020px and scaled it into a ~660px
// column, which painted a full macOS menu bar, tab strip, URL bar and Khan
// sidebar at 6-8px while Calyxa itself was a ~100px pill — the host page at
// full fidelity and the product at none. HomeworkDemo is authored fluid, the
// worksheet is deliberately recessed, and the Calyxa surfaces paint at their
// real size.
//
// showPlaceholders (handoff flag, default ON): keeps the honest scripted-demo
// footnote. Set NEXT_PUBLIC_SHOW_PLACEHOLDERS=0 only for marketing shots.

const ACCENT = '#86efac'
const ACCENT_HOVER = '#6ee7a0'

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
        {/* The weight is set HERE rather than with Tailwind's `font-bold`:
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
          Get homework done. <span className="text-(--color-focus-ring)">Go do what matters to you.</span>
        </h1>
        <p
          className="mb-0 mt-4 max-w-[480px] text-pretty text-muted-foreground sm:mt-6"
          style={{ fontSize: 'clamp(16px, 1.4vw, 21px)', lineHeight: 1.4 }}
        >
          Any homework page. A finish line you can watch move.
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

      <motion.div {...entrance(0.2)} style={{ flex: '1 1 560px', minWidth: 'min(100%, 400px)' }}>
        <HomeworkDemo />
        {showPlaceholders && (
          <p className="mb-0 mt-3 text-center text-[12px] text-(--mkt-faint) sm:text-[13px]">
            scripted demo — the real calyxa runs over your own homework tab
          </p>
        )}
      </motion.div>
    </section>
  )
}
