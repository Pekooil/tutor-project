import { HeroDemo } from '@/components/marketing/HeroDemo'
import { Button } from '@/components/ui/button'
import { FREE_SESSIONS_PER_MONTH } from '@/components/marketing/Pricing'

// The Landing v3 hero: split layout — copy + signup CTA left, the
// interactive one-beat demo right, bleeding off the right edge on desktop.
// The old centered stack (H1 annotations, parallax ground, full-session
// DemoStage, in-hero marquee) is retired with the panel language; the
// platforms strip is its own band below (PlatformsStrip), and the full
// session lives in the scrollytelling. Still mostly server-rendered: the H1
// ships as static HTML (the LCP element); only HeroDemo is a client island.
// The nav above already carries the logo, so the mock's in-hero logo row is
// folded into it rather than duplicated.
export function Hero() {
  return (
    <section
      id="hero"
      className="relative overflow-hidden"
      style={{ background: 'linear-gradient(180deg, var(--color-accent-subtle) 0%, var(--color-background) 40%)' }}
    >
      <div className="mx-auto grid max-w-[1400px] gap-12 px-6 pt-10 max-lg:pb-16 lg:grid-cols-[minmax(0,1fr)_640px] lg:pl-16 lg:pr-0 lg:pt-6">
        <div className="flex flex-col pb-4 lg:pb-20 lg:pt-16">
          <p className="m-0 inline-flex items-center gap-2 self-start rounded-full border border-(--calyxa-sage-border) bg-accent-subtle px-3.5 py-1.5 text-[12.5px] font-semibold text-accent-emphasis">
            chrome extension · free to start
          </p>
          <h1 className="mkt-display mkt-h1 mt-6 max-w-[16ch] text-foreground">
            Stop copying. Start learning.
          </h1>
          <p className="mt-[22px] max-w-[42ch] text-pretty text-lg leading-[1.6] text-muted-foreground">
            calyxa sees the problem you&apos;re stuck on, talks you through it out loud, and points at the exact step
            you&apos;re missing — never the answer.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Button asChild size="lg">
              <a href="/signup">Create your free account</a>
            </Button>
          </div>
          <p className="mt-[13px] text-[13.5px] text-muted-foreground">
            free for {FREE_SESSIONS_PER_MONTH} sessions a month · chrome
          </p>
        </div>
        <HeroDemo />
      </div>
    </section>
  )
}
