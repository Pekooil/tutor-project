import { Nav } from '@/components/marketing/Nav'
import { Footer } from '@/components/marketing/Footer'
import { Hero } from '@/components/marketing/Hero'
import { SessionShowcase } from '@/components/marketing/SessionShowcase'
import { Section } from '@/components/marketing/Section'
import { Reveal } from '@/components/marketing/Reveal'
import { WaitlistForm } from '@/components/marketing/WaitlistForm'

// Sprint 20 Task 3: the full page skeleton, in the plan's section order.
// Hero (Task 5) and SessionShowcase (Task 6) are real; the sections below
// them are placeholder stubs via <Section>, replaced component-by-component
// in Tasks 7-9. This file itself only composes; nothing here should need
// touching once every section is a real import.
function DemoPlaceholder({ label }: { label: string }) {
  return (
    <div className="flex aspect-video items-center justify-center rounded-lg border border-dashed border-border bg-surface text-sm text-muted-foreground">
      {label}
    </div>
  )
}

export default function Home() {
  return (
    <>
      <Nav />
      <main>
        <Hero />

        <Reveal>
          <SessionShowcase />
        </Reveal>

        <Reveal>
          <Section
            id="profile"
            kicker="It learns how you learn"
            heading="Every session updates what Calyxa knows about you."
            sub="Mastery levels, weak spots, and what's due for review — visible before and after every session."
          >
            <DemoPlaceholder label="Profile adaptation demo arriving in Task 7" />
          </Section>
        </Reveal>

        <Reveal>
          <Section
            id="study-loop"
            kicker="One session in. A study kit out."
            heading="Notes, practice problems, and flashcards from every session."
            sub="Built from the exact steps you worked through — closing the loop back into your next session."
          >
            <DemoPlaceholder label="Study loop demo arriving in Task 8" />
          </Section>
        </Reveal>

        <Reveal>
          <Section id="how-it-works" kicker="How it works" heading="Three steps to your first session.">
            <ol className="grid gap-6 sm:grid-cols-3">
              {['Add Calyxa to Chrome', 'Open any math page', 'Start talking'].map((step, index) => (
                <li key={step} className="rounded-md border border-border bg-surface p-6">
                  <span className="text-sm font-semibold text-accent-emphasis">{index + 1}</span>
                  <p className="mt-2 font-medium text-foreground">{step}</p>
                </li>
              ))}
            </ol>
          </Section>
        </Reveal>

        <Reveal>
          <Section
            id="pricing"
            kicker="Pricing"
            heading="Simple, honest pricing."
            sub="Free — 10 tutoring sessions a month. Pro — $12/mo for unlimited sessions."
          >
            <DemoPlaceholder label="Pricing cards arriving in Task 9" />
          </Section>
        </Reveal>

        <Reveal>
          <Section id="social-proof" kicker="Social proof" heading="What students are saying.">
            <DemoPlaceholder label="Placeholder quotes arriving in Task 9 (TODO(launch): replace with real quotes)" />
          </Section>
        </Reveal>

        <Reveal>
          <Section id="final-cta" heading="Join the waitlist.">
            <WaitlistForm source="footer" className="max-w-md" />
          </Section>
        </Reveal>
      </main>
      <Footer />
    </>
  )
}
