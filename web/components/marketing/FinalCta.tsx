import { WaitlistForm } from '@/components/marketing/WaitlistForm'
import { ParallaxGround } from '@/components/marketing/ParallaxGround'

// The full-bleed gradient band that closes the page — one line, one form.
// Doesn't compose <Section> (its container has no ground of its own).
export function FinalCta() {
  return (
    <section id="final-cta" className="relative overflow-hidden py-28 sm:py-36">
      <ParallaxGround variant="finale" />
      <div className="relative mx-auto flex max-w-2xl flex-col items-center gap-6 px-6 text-center">
        <h2 className="mkt-display mkt-h2 m-0 text-balance text-foreground">Join the waitlist.</h2>
        <p className="m-0 text-lg text-muted-foreground">Free for 10 sessions a month · Chrome</p>
        <WaitlistForm source="footer" className="w-full max-w-md" />
      </div>
    </section>
  )
}
