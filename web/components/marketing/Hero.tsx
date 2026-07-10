import { WaitlistForm } from '@/components/marketing/WaitlistForm'
import { Reveal } from '@/components/marketing/Reveal'
import { ParallaxGround } from '@/components/marketing/ParallaxGround'
import { HeadlineAnnotations } from '@/components/marketing/HeadlineAnnotations'
import { PlatformMarquee } from '@/components/marketing/PlatformMarquee'
import { DemoStage } from '@/components/marketing/demo/DemoStage'
import { heroSession, heroSessionAlt } from '@/components/marketing/demo/scripts'
import { FREE_SESSIONS_PER_MONTH } from '@/components/marketing/Pricing'

// The full-bleed hero, redesigned as a centered stack: oversized display
// headline, sub, waitlist form, then the live demo full-width beneath as the
// centerpiece, sitting on the hero's gradient ground with an ambient halo.
// Sprint 25 Task 5 (ADR-040 decision 3): the H1 itself is annotated — Meadow
// marks draw onto it once after paint via HeadlineAnnotations (the spans
// below are its measurement targets; they add no styling and never move the
// text) — and the PlatformMarquee rolls the compatible-platform pills below
// the CTA. Still a server component — the H1 ships as static
// HTML so it paints immediately and stays the LCP element (the mark layer
// mounts after paint); only the demo enters through Reveal (opacity/
// transform-only, space reserved by DemoStage's aspect-ratio, so CLS stays
// at zero). The mt-14 above the H1 reserves the band the circle mark's
// label pill draws into.
export function Hero() {
  return (
    <section id="hero" className="relative overflow-hidden px-6 pb-24 pt-14 sm:pt-20 lg:pb-28">
      <ParallaxGround variant="hero" />
      <div className="relative z-10 mx-auto flex max-w-4xl flex-col items-center text-center">
        <p className="mkt-chip">Chrome extension · Waitlist open</p>
        <div className="relative mt-14">
          <h1 className="mkt-display mkt-h1 text-balance text-foreground">
            The <span data-h1-mark="tutor">math tutor</span> that lives <span data-h1-mark="screen">on your screen</span>.
          </h1>
          <HeadlineAnnotations />
        </div>
        <p className="mt-6 max-w-2xl text-pretty text-lg text-muted-foreground sm:text-xl">
          Calyxa sees the problem you&apos;re stuck on, talks you through it out loud, and points at
          the exact step you&apos;re missing — without ever just giving you the answer.
        </p>
        <WaitlistForm source="hero" className="mt-9 w-full max-w-md" />
        <p className="mt-4 text-sm text-muted-foreground">Free for {FREE_SESSIONS_PER_MONTH} sessions a month · Chrome</p>
        <PlatformMarquee />
      </div>
      <div className="relative mx-auto mt-16 max-w-5xl sm:mt-20">
        <div aria-hidden="true" className="mkt-halo" />
        <Reveal delay={0.15}>
          <div className="mkt-stage">
            <DemoStage draggable script={heroSession} alt={heroSessionAlt} />
          </div>
        </Reveal>
      </div>
    </section>
  )
}
