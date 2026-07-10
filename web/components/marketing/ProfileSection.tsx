'use client'

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useInView, useReducedMotion } from 'motion/react'
import { cn } from '@/lib/utils'
import { Section } from '@/components/marketing/Section'
import { Reveal } from '@/components/marketing/Reveal'
import { DemoPanel } from '@/components/marketing/demo/DemoPanel'
import { reduceScene } from '@/components/marketing/demo/scene'
import { checkinRecapAlts, checkinRecapFrames, checkinRecapScene } from '@/components/marketing/demo/scripts'

// Sprint 25 Task 8 (originally Sprint 20 Task 7): "It learns how you learn",
// rebuilt on the product's real bookends (ADR-040) — the check-in card the
// session opens with (scanning orb → the one AI-prediction card) and the
// recap card it closes with (What improved / Still needs practicing). The
// mastery-bar panels this section used to recreate no longer exist in the
// product. Both panels are Task 3's DemoPanel recreation driven by
// checkinRecapScene (scripts.ts) — same session, same fixture, third angle.
//
// The once-in-view driver survives the rebuild: this section still does NOT
// play through useSceneTimeline. Its gate is the opposite of the hero's
// looping clock — animate once on first in-view, then hold, never replay on
// a later scroll-past. reduceScene (the shared pure reducer) still turns the
// local clock into state. The BEFORE panel plays the scan → prediction arc
// and holds the composed card (clamped at checkinRecapFrames.checkin); the
// AFTER panel holds the composed recap end frame and fades in when the
// timeline reaches the recap step — the card itself is static in the
// product, so the reveal is the animation.

const CALLBACK_QUOTE =
  'This connects to the factoring work from a few sessions ago — same move, same equation shape.'

// The real overlay's panel width (DemoStage's PANEL_W) — DemoPanel is a 1:1
// recreation at this width; the viewport below scales it to fit the column.
const PANEL_W = 420

// One shared viewport height so the two bookend panels sit level; the
// tallest composed state (the recap card, ~390px) sets it.
const PANEL_VIEWPORT_H = 424

// The demo tree's file-local color exceptions, mirrored from DemoStage (see
// its comment for why these two values are unreachable by token name inside
// /web). Scoped to the bookends grid.
const DEMO_SCOPE_VARS = {
  '--cx-demo-hairline': '#e5e3de',
  '--cx-demo-hairline-soft': '#eceae5',
} as React.CSSProperties

/** Plays checkinRecapScene once when it first enters view, then holds. */
function useBookendsPlayback() {
  const reducedMotion = useReducedMotion() ?? false
  const ref = useRef<HTMLDivElement | null>(null)
  const inView = useInView(ref, { once: true, margin: '-80px' })
  const [elapsed, setElapsed] = useState(0)

  useEffect(() => {
    if (reducedMotion || !inView) return
    let frame = 0
    const start = performance.now()
    const tick = (now: number) => {
      const delta = Math.min(now - start, checkinRecapScene.durationMs)
      setElapsed(delta)
      if (delta < checkinRecapScene.durationMs) frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [inView, reducedMotion])

  const t = reducedMotion ? checkinRecapScene.durationMs : elapsed

  // BEFORE plays up to the composed prediction card, then holds it (the
  // scene itself clears the check-in at the recap step, which a held
  // "before" bookend must never do).
  const beforeState = useMemo(() => reduceScene(checkinRecapScene, Math.min(t, checkinRecapFrames.checkin)), [t])
  // AFTER is the static composed recap frame, revealed when the live
  // timeline actually reaches the recap step.
  const afterState = useMemo(() => reduceScene(checkinRecapScene, checkinRecapFrames.recap), [])
  const afterVisible = useMemo(() => reduceScene(checkinRecapScene, t).recap !== null, [t])

  return { ref, beforeState, afterState, afterVisible, reducedMotion }
}

export function ProfileSection() {
  const { ref, beforeState, afterState, afterVisible, reducedMotion } = useBookendsPlayback()

  return (
    <Section
      id="profile"
      tone="wash"
      kicker="It learns how you learn"
      heading="Every session updates what Calyxa knows about you."
      sub="One prediction before you start, an honest recap when you finish — the profile working at both ends of every session."
    >
      <div ref={ref} className="grid gap-8 lg:grid-cols-2" style={DEMO_SCOPE_VARS}>
        <Reveal>
          <BookendPanel label="Before this session" alt={checkinRecapAlts.checkin}>
            <DemoPanel state={beforeState} />
          </BookendPanel>
        </Reveal>

        <Reveal delay={0.1}>
          <BookendPanel label="After this session" alt={checkinRecapAlts.recap}>
            <div
              className={cn(
                !reducedMotion && 'transition-all duration-500 ease-out',
                afterVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-3'
              )}
            >
              <DemoPanel state={afterState} />
            </div>
          </BookendPanel>
        </Reveal>
      </div>

      <Reveal delay={0.2}>
        <figure className="mx-auto mt-20 max-w-3xl text-center">
          <blockquote className="mkt-display m-0 text-balance text-2xl leading-snug text-foreground sm:text-3xl">
            &ldquo;{CALLBACK_QUOTE}&rdquo;
          </blockquote>
          <figcaption className="mt-4 text-sm text-muted-foreground">
            Calyxa, picking up the thread a few sessions later
          </figcaption>
        </figure>
      </Reveal>

      {/* The demo-scoped keyframes + placeholder styling DemoPanel's
          check-in/recap states depend on (the scanning ring/orb, the chip
          dot, the "Generated for you" tiles), mirrored 1:1 from DemoStage's
          scoped <style> — this section renders DemoPanel without DemoStage,
          so it carries its own copy. Same reduced-motion discipline: looping
          motion only under prefers-reduced-motion: no-preference. */}
      <style>{`
        @keyframes cx-demo-dot { 0%, 100% { transform: scale(0.65); opacity: 0.5; } 50% { transform: scale(1); opacity: 1; } }
        @keyframes cx-demo-ring { 0% { transform: scale(0.7); opacity: 0.55; } 100% { transform: scale(1.9); opacity: 0; } }
        @keyframes cx-demo-orb { 0%, 100% { transform: scale(0.86); opacity: 0.7; } 50% { transform: scale(1.1); opacity: 1; } }
        @media (prefers-reduced-motion: no-preference) {
          .cx-demo-dot { animation: cx-demo-dot 2.2s ease-in-out infinite; }
          .cx-demo-ring { animation: cx-demo-ring 2.6s ease-out infinite; }
          .cx-demo-orb { animation: cx-demo-orb 2.8s ease-in-out infinite; }
        }
        .cx-demo-placeholder {
          border: 1px dashed var(--calyxa-placeholder-border);
          background: repeating-linear-gradient(
            135deg,
            var(--calyxa-placeholder-stripe-a),
            var(--calyxa-placeholder-stripe-a) 6px,
            var(--calyxa-placeholder-stripe-b) 6px,
            var(--calyxa-placeholder-stripe-b) 12px
          );
          color: var(--calyxa-placeholder-text);
        }
      `}</style>
    </Section>
  )
}

function BookendPanel({ label, alt, children }: { label: string; alt: string; children: ReactNode }) {
  return (
    <div className="mkt-card-raised p-6 sm:p-8">
      <p className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="sr-only">{alt}</p>
      <div className="mt-5" aria-hidden="true">
        <PanelViewport>{children}</PanelViewport>
      </div>
    </div>
  )
}

// DemoPanel at its real 420px width, scaled to fit the column and anchored
// bottom-center — the overlay's resting position; the panel's height is
// intrinsic (the scan orb state is shorter than the composed cards), so it
// grows upward into the viewport. Third hand-rolled copy of this
// scale-to-fit wiring (AdaptiveSection's PanelViewport, DemoStage's canvas
// scale) — flagged in the sprint handoff for a dedup pass.
function PanelViewport({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement | null>(null)
  const [scale, setScale] = useState(1)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const update = () => setScale(Math.min(1, el.clientWidth / PANEL_W))
    update()
    const observer = new ResizeObserver(update)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  return (
    <div
      ref={ref}
      className="relative w-full overflow-hidden rounded-lg bg-surface"
      style={{ height: Math.round(PANEL_VIEWPORT_H * scale) }}
    >
      <div
        className="absolute bottom-0 left-1/2 pb-3.5"
        style={{ width: PANEL_W, transform: `translateX(-50%) scale(${scale})`, transformOrigin: 'bottom center' }}
      >
        {children}
      </div>
    </div>
  )
}
