import { WaitlistForm } from '@/components/marketing/WaitlistForm'
import { PillGlow } from '@/components/marketing/pill/overlay'
import { FREE_SESSIONS_PER_MONTH } from '@/components/marketing/Pricing'

// Landing v3's closing band: the idle pill breathing alone above the
// headline on the full-bleed desk ground — one line, one form, nothing
// else (no testimonials, no stat row). Doesn't compose <Section>.
export function FinalCta() {
  return (
    <section id="final-cta" className="bg-(--mkt-desk)">
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
          join the waitlist and we&apos;ll send your invite as beta spots open.
        </p>
        <WaitlistForm source="footer" className="mt-8 w-full max-w-md" />
        <p className="mb-0 mt-3.5 text-[13.5px] text-muted-foreground">
          free for {FREE_SESSIONS_PER_MONTH} sessions a month · chrome, for now
        </p>
      </div>
    </section>
  )
}
