import { PillGlow } from '@/components/marketing/pill/overlay'
import { Button } from '@/components/ui/button'
import { FREE_SESSIONS_PER_MONTH } from '@/components/marketing/Pricing'

// Landing v3's closing band: the idle pill breathing alone above the
// headline — one line, one CTA, nothing else (no testimonials, no stat
// row). Doesn't compose <Section>. The ground is the hero's green wash
// mirrored (background fading into accent-subtle), bookending the page.
export function FinalCta() {
  return (
    <section
      id="final-cta"
      style={{ background: 'linear-gradient(180deg, var(--color-background) 0%, var(--color-accent-subtle) 100%)' }}
    >
      <div className="mx-auto flex max-w-2xl flex-col items-center px-6 pb-[120px] pt-[110px] text-center">
        <div aria-hidden="true" className="relative">
          <PillGlow opacity={0.55} inset={-12} />
          <div
            className="relative h-[7px] w-[52px] rounded-[4px] border border-(--mkt-glass-border) bg-background/85"
            style={{ boxShadow: '0 10px 26px rgba(28, 40, 30, 0.18)' }}
          />
        </div>
        <h2 className="mkt-display mkt-h2 mt-11 max-w-[20ch] text-balance text-foreground">
          your homework is already open. so is the tutor.
        </h2>
        <p className="mb-0 mt-5 max-w-[46ch] text-pretty text-[17px] leading-[1.6] text-(--mkt-strip-text)">
          create a free account and you&apos;ll be mid-session in a couple of minutes.
        </p>
        <Button asChild size="lg" className="mt-8">
          <a href="/signup">Create your free account</a>
        </Button>
        <p className="mb-0 mt-3.5 text-[13.5px] text-muted-foreground">
          free for {FREE_SESSIONS_PER_MONTH} sessions a month · chrome, for now
        </p>
      </div>
    </section>
  )
}
