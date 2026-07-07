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
import { bricolage } from '@/components/marketing/fonts'
import '@/components/marketing/marketing.css'

// The composed page, in the Sprint 20 plan's section order. The `.mkt`
// wrapper scopes the marketing token layer (marketing.css) and the display
// font variable to this page only — product surfaces never inherit either.
export default function Home() {
  return (
    <div className={`${bricolage.variable} mkt`}>
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
    </div>
  )
}
