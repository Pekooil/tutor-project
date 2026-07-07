'use client'

import { useRef } from 'react'
import { motion, useReducedMotion, useScroll, useTransform } from 'motion/react'

type Variant = 'hero' | 'wash' | 'finale'

// Scroll-linked parallax for the gradient grounds: the static ground the
// page shipped with stays as the base layer, and two decorative blobs drift
// over it at offset rates as the section traverses the viewport — the
// Stripe-on-light depth move, done transform-only (compositor work, no
// layout/paint) behind a pointer-transparent aria-hidden wrapper. Reduced
// motion renders the base ground alone, perfectly still; the blobs are
// additive decoration, so dropping them IS the final composed frame.
//
// Blob colors are the accent-glow tokens at low alpha (decorative-only per
// brand.md §4.1) — no new hues, same rule as marketing.css's grounds.
export function ParallaxGround({ variant }: { variant: Variant }) {
  const ref = useRef<HTMLDivElement | null>(null)
  const reduceMotion = useReducedMotion() ?? false

  // The hero is already in view at load, so its progress starts at its top
  // edge; every other ground runs across the full viewport traversal.
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: variant === 'hero' ? ['start start', 'end start'] : ['start end', 'end start'],
  })

  // Two layers, two rates — the depth read comes from the differential.
  const slowY = useTransform(scrollYProgress, [0, 1], [40, -110])
  const fastY = useTransform(scrollYProgress, [0, 1], [90, -230])
  const slowScale = useTransform(scrollYProgress, [0, 1], [1, 1.12])
  const riseY = useTransform(scrollYProgress, [0, 1], [140, 0])
  const riseOpacity = useTransform(scrollYProgress, [0, 0.6, 1], [0.3, 0.85, 1])

  return (
    <div ref={ref} aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
      <div className={`absolute inset-0 mkt-ground-${variant}`} />
      {!reduceMotion && variant === 'hero' && (
        <>
          <motion.div
            className="mkt-blob-glow absolute left-[-12%] top-[-14%] h-[34rem] w-[52rem]"
            style={{ y: slowY, scale: slowScale }}
          />
          <motion.div
            className="mkt-blob-mint absolute right-[-14%] top-[6%] h-[30rem] w-[44rem]"
            style={{ y: fastY }}
          />
        </>
      )}
      {!reduceMotion && variant === 'wash' && (
        <>
          <motion.div
            className="mkt-blob-glow absolute left-[-16%] top-[8%] h-[28rem] w-[42rem] opacity-70"
            style={{ y: slowY }}
          />
          <motion.div
            className="mkt-blob-mint absolute right-[-12%] top-[34%] h-[26rem] w-[40rem]"
            style={{ y: fastY }}
          />
        </>
      )}
      {!reduceMotion && variant === 'finale' && (
        // x/y both go through motion so they compose into one transform —
        // a Tailwind -translate-x-1/2 here would be overwritten.
        <motion.div
          className="mkt-blob-glow absolute bottom-[-30%] left-1/2 h-[30rem] w-[64rem]"
          style={{ x: '-50%', y: riseY, opacity: riseOpacity }}
        />
      )}
    </div>
  )
}
