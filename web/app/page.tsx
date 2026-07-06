import { Nav } from '@/components/marketing/Nav'
import { Footer } from '@/components/marketing/Footer'
import { Hero } from '@/components/marketing/Hero'
import { SessionShowcase } from '@/components/marketing/SessionShowcase'
import { ProfileSection } from '@/components/marketing/ProfileSection'
import { StudyLoopSection } from '@/components/marketing/StudyLoopSection'
import { HowItWorks } from '@/components/marketing/HowItWorks'
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
          <ProfileSection />
        </Reveal>

        <Reveal>
          <StudyLoopSection />
        </Reveal>

        <Reveal>
          <HowItWorks />
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
