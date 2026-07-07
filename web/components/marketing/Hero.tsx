import { WaitlistForm } from '@/components/marketing/WaitlistForm'
import { Reveal } from '@/components/marketing/Reveal'
import { ParallaxGround } from '@/components/marketing/ParallaxGround'
import { DemoStage } from '@/components/marketing/demo/DemoStage'
import { heroSession } from '@/components/marketing/demo/scripts'

// The full-bleed hero, redesigned as a centered stack: oversized display
// headline, sub, waitlist form, then the live demo full-width beneath as the
// centerpiece, sitting on the hero's gradient ground with an ambient halo.
// Still a server component — the H1 ships as static HTML so it paints
// immediately and stays the LCP element; only the demo enters through Reveal
// (opacity/transform-only, space reserved by DemoStage's aspect-ratio, so
// CLS stays at zero).
export function Hero() {
  return (
    <section id="hero" className="relative overflow-hidden px-6 pb-24 pt-14 sm:pt-20 lg:pb-28">
      <ParallaxGround variant="hero" />
      <div className="relative z-10 mx-auto flex max-w-4xl flex-col items-center text-center">
        <p className="mkt-chip">Chrome extension · Waitlist open</p>
        <h1 className="mkt-display mkt-h1 mt-7 text-balance text-foreground">
          The math tutor that lives on your screen.
        </h1>
        <p className="mt-6 max-w-2xl text-pretty text-lg text-muted-foreground sm:text-xl">
          Calyxa sees the problem you&apos;re stuck on, talks you through it out loud, and points at
          the exact step you&apos;re missing — without ever just giving you the answer.
        </p>
        <WaitlistForm source="hero" className="mt-9 w-full max-w-md" />
        <p className="mt-4 text-sm text-muted-foreground">Free for 10 sessions a month · Chrome</p>
      </div>
      <div className="relative mx-auto mt-16 max-w-5xl sm:mt-20">
        <div aria-hidden="true" className="mkt-halo" />
        <Reveal delay={0.15}>
          <div className="mkt-stage">
            <DemoStage
              draggable
              script={heroSession}
              alt="A live demo of a Calyxa tutoring session: the tutor annotates the equation x² + 5x + 6 = 0 on a practice page, asks guiding questions while a solution progress bar fills, flags a sign-error weak spot, fires a 'Gap closed: sign errors' ping when the student self-corrects, and closes with a session recap."
            />
          </div>
        </Reveal>
      </div>
    </section>
  )
}
