import { WaitlistForm } from '@/components/marketing/WaitlistForm'
import { Reveal } from '@/components/marketing/Reveal'
import { DemoStage } from '@/components/marketing/demo/DemoStage'
import { heroSession } from '@/components/marketing/demo/scripts'

// Sprint 20 Task 5: the full-bleed hero. Server component — the text column
// (H1 + sub + form + trust line) ships as static HTML so the H1 paints
// immediately and stays the LCP element; only the demo enters through Reveal
// (opacity/transform-only, space reserved by DemoStage's aspect-ratio, so
// CLS stays at zero). Beside the text at xl, beneath it below that — in the
// stacked order the demo always follows the fold-line text.
export function Hero() {
  return (
    <section id="hero" className="mx-auto max-w-7xl px-6 pb-24 pt-16 sm:pt-24 lg:pb-32">
      <div className="grid items-center gap-14 xl:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] xl:gap-16">
        <div>
          <h1 className="text-balance text-5xl font-semibold tracking-tight text-foreground sm:text-6xl">
            The math tutor that lives on your screen.
          </h1>
          <p className="mt-6 max-w-xl text-pretty text-lg text-muted-foreground sm:text-xl">
            Calyxa sees the problem you&apos;re stuck on, talks you through it out loud, and points
            at the exact step you&apos;re missing — without ever just giving you the answer.
          </p>
          <WaitlistForm source="hero" className="mt-8 max-w-md" />
          <p className="mt-4 text-sm text-muted-foreground">Free for 10 sessions a month · Chrome</p>
        </div>
        <Reveal delay={0.15}>
          <DemoStage
            script={heroSession}
            alt="A live demo of a Calyxa tutoring session: the tutor annotates the equation x² + 5x + 6 = 0 on a practice page, asks guiding questions while a solution progress bar fills, flags a sign-error weak spot, fires a 'Gap closed: sign errors' ping when the student self-corrects, and closes with a session recap."
          />
        </Reveal>
      </div>
    </section>
  )
}
