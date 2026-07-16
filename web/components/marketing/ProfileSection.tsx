'use client'

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useInView, useReducedMotion } from 'motion/react'
import { cn } from '@/lib/utils'
import { Section } from '@/components/marketing/Section'
import { ThinkDots } from '@/components/marketing/pill/overlay'
import { reduceScene } from '@/components/marketing/demo/scene'
import { checkinRecapFrames, checkinRecapScene } from '@/components/marketing/demo/scripts'

// Landing v3: "it learns how you learn" — the before/after bookends
// restyled to the pill language. Two desk panels, each holding one glass
// card: BEFORE plays the thinking dots then pops the AI-prediction card;
// AFTER reveals the composed recap card (what improved / still needs
// practicing). The retired DemoPanel recreation is gone; the once-in-view
// playback gate survives — checkinRecapScene still provides the shared
// scan → predict → recap clock (animate once on first in-view, then hold,
// never replay on a later scroll-past), reduced motion holds the composed
// end state.

const BEFORE_ALT =
  'Before the session: after checking your last session, Calyxa predicts the topic — factoring quadratics — and the likely sticking point, sign errors on the roots, flagged twice in Tuesday’s session.'
const AFTER_ALT =
  'After the session: the recap card for factoring quadratics — factor pairs improved and solid; sign errors on the roots still needs practicing.'

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

  // BEFORE holds the composed prediction once the timeline reaches it;
  // AFTER reveals the recap when the timeline reaches the recap step.
  const beforeState = useMemo(() => reduceScene(checkinRecapScene, Math.min(t, checkinRecapFrames.checkin)), [t])
  const predictionVisible = beforeState.checkin?.variant === 'predict'
  const afterVisible = useMemo(() => reduceScene(checkinRecapScene, t).recap !== null, [t])

  return { ref, predictionVisible, afterVisible, reducedMotion }
}

export function ProfileSection() {
  const { ref, predictionVisible, afterVisible, reducedMotion } = useBookendsPlayback()

  return (
    <Section
      id="profile"
      tone="wash"
      align="center"
      kicker="it learns how you learn"
      heading="every session updates what calyxa knows about you."
      sub="one prediction before you start, an honest recap when you finish — the profile working at both ends of every session."
    >
      <div ref={ref} className="mx-auto grid w-full max-w-[1020px] gap-6 md:grid-cols-2">
        <Bookend label="before this session" alt={BEFORE_ALT}>
          <span className="flex items-center gap-[9px] text-[12.5px] text-muted-foreground">
            <ThinkDots />
            checking your last session…
          </span>
          <GlassCard
            className={cn(
              !reducedMotion && 'transition-all duration-500 ease-out',
              predictionVisible ? 'translate-y-0 opacity-100' : 'translate-y-3 opacity-0'
            )}
          >
            <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-accent-emphasis">
              AI prediction
            </span>
            <span className="text-[15.5px] font-semibold tracking-[-0.01em] text-foreground">factoring quadratics</span>
            <p className="m-0 text-[13.5px] leading-[1.55] text-(--calyxa-chip-text)">
              likely sticking point: <span className="font-semibold">sign errors on the roots</span>
            </p>
            <p className="m-0 text-[12px] text-(--mkt-faint)">came up twice in tuesday&apos;s session</p>
          </GlassCard>
        </Bookend>

        <Bookend label="after this session" alt={AFTER_ALT}>
          <span className="text-[12.5px] text-muted-foreground">session recap · 18 min · 5 problems</span>
          <GlassCard
            className={cn(
              'gap-3',
              !reducedMotion && 'transition-all duration-500 ease-out',
              afterVisible ? 'translate-y-0 opacity-100' : 'translate-y-3 opacity-0'
            )}
          >
            <span className="text-[15.5px] font-semibold tracking-[-0.01em] text-foreground">factoring quadratics</span>
            <div aria-hidden="true" className="h-px bg-(--mkt-hairline-soft)" />
            <div className="flex flex-col gap-2">
              <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-accent-emphasis">
                what improved
              </span>
              <span className="flex items-center gap-2 text-[13.5px] text-foreground">
                <span className="inline-flex h-[18px] w-[18px] flex-none items-center justify-center rounded-full border border-(--color-accent-fill) bg-accent-subtle text-[10.5px] text-accent-fill-foreground">
                  ✓
                </span>
                factor pairs — solid
              </span>
            </div>
            <div className="flex flex-col gap-2">
              <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-(--calyxa-ping-watch-text)">
                still needs practicing
              </span>
              <span className="flex items-center gap-2 text-[13.5px] text-foreground">
                <span className="inline-flex h-[18px] w-[18px] flex-none items-center justify-center rounded-full border border-(--calyxa-ping-watch-border) bg-(--calyxa-ping-watch-bg) text-[10.5px] text-(--calyxa-ping-watch-text)">
                  ↺
                </span>
                sign errors on the roots — revisit
              </span>
            </div>
          </GlassCard>
        </Bookend>
      </div>
    </Section>
  )
}

function Bookend({ label, alt, children }: { label: string; alt: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-3.5">
      <span className="mkt-kicker-faint text-center">{label}</span>
      <p className="sr-only">{alt}</p>
      <div
        aria-hidden="true"
        className="flex flex-col items-center gap-4 rounded-2xl border border-(--mkt-hairline) bg-(--mkt-desk) px-8 py-11"
      >
        {children}
      </div>
    </div>
  )
}

function GlassCard({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div
      className={cn('mkt-glass flex w-[340px] max-w-full flex-col gap-2.5 rounded-[17px] px-[19px] py-4 text-left', className)}
    >
      {children}
    </div>
  )
}
