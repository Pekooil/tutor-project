import { Nav } from '@/components/marketing/Nav'
import { Footer } from '@/components/marketing/Footer'
import { Hero } from '@/components/marketing/Hero'
import { SessionShowcase } from '@/components/marketing/SessionShowcase'
import { ProfileSection } from '@/components/marketing/ProfileSection'
import { StudyLoopSection } from '@/components/marketing/StudyLoopSection'
import { HowItWorks } from '@/components/marketing/HowItWorks'
import { Pricing } from '@/components/marketing/Pricing'
import { SocialProof } from '@/components/marketing/SocialProof'
import { FinalCta } from '@/components/marketing/FinalCta'
import { Reveal } from '@/components/marketing/Reveal'

// Sprint 20: the full page skeleton, in the plan's section order. Every
// section is now a real component (Tasks 5-9) — this file only composes.
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
          <Pricing />
        </Reveal>

        <Reveal>
          <SocialProof />
        </Reveal>

        <Reveal>
          <FinalCta />
        </Reveal>
      </main>
      <Footer />
    </>
  )
}
