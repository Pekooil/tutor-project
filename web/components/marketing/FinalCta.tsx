import { WaitlistForm } from '@/components/marketing/WaitlistForm'

// Sprint 20 Task 9: the accent-subtle band that closes the page — one line,
// one form. Full-bleed background, so this doesn't compose <Section> (its
// max-width container has no background of its own).
export function FinalCta() {
  return (
    <section id="final-cta" className="bg-accent-subtle py-20 sm:py-24">
      <div className="mx-auto flex max-w-2xl flex-col items-center gap-6 px-6 text-center">
        <h2 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">Join the waitlist.</h2>
        <WaitlistForm source="footer" className="w-full max-w-md" />
      </div>
    </section>
  )
}
