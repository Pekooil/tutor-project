import { Nav } from '@/components/marketing/Nav'
import { Footer } from '@/components/marketing/Footer'
import { Hero } from '@/components/marketing/Hero'
import { PlatformsStrip } from '@/components/marketing/PlatformsStrip'
import { SessionShowcase } from '@/components/marketing/SessionShowcase'
import { WhyUs } from '@/components/marketing/WhyUs'
import { AdaptiveSection } from '@/components/marketing/AdaptiveSection'
import { ProfileSection } from '@/components/marketing/ProfileSection'
import { StudyLoopSection } from '@/components/marketing/StudyLoopSection'
import { Pricing } from '@/components/marketing/Pricing'
import { FinalCta } from '@/components/marketing/FinalCta'
import { Reveal } from '@/components/marketing/Reveal'
import { bricolage } from '@/components/marketing/fonts'
import '@/components/marketing/marketing.css'

// The composed page, in the Landing v3 handoff's section order (hero →
// platforms → scrollytelling → why us → four systems → profile → study kit
// → pricing → final CTA). SocialProof (placeholder testimonials + the empty
// stat row) is cut. The `.mkt` wrapper scopes the marketing token layer
// (marketing.css) and the display font variable to this page only — product
// surfaces never inherit either.
export default function Home() {
  return (
    <div className={`${bricolage.variable} mkt`}>
      <Nav />
      <main>
        <Hero />

        <PlatformsStrip />

        <Reveal>
          <SessionShowcase />
        </Reveal>

        <Reveal>
          <WhyUs />
        </Reveal>

        <Reveal>
          <AdaptiveSection />
        </Reveal>

        <Reveal>
          <ProfileSection />
        </Reveal>

        <Reveal>
          <StudyLoopSection />
        </Reveal>

        <Reveal>
          <Pricing />
        </Reveal>

        <Reveal>
          <FinalCta />
        </Reveal>
      </main>
      <Footer />
    </div>
  )
}
