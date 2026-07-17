import { Nav } from '@/components/marketing/Nav'
import { Footer } from '@/components/marketing/Footer'
import { Hero } from '@/components/marketing/Hero'
import { PlatformsStrip } from '@/components/marketing/PlatformsStrip'
import { SessionShowcase } from '@/components/marketing/SessionShowcase'
import { WhyUs } from '@/components/marketing/WhyUs'
import { Pricing } from '@/components/marketing/Pricing'
import { FinalCta } from '@/components/marketing/FinalCta'
import { Reveal } from '@/components/marketing/Reveal'
import '@/components/marketing/marketing.css'

// The composed page (hero → platforms → scrollytelling → why us → pricing →
// final CTA). SocialProof (placeholder testimonials + the empty stat row),
// the four-systems spec panel, the profile bookends, and the study-kit
// section are cut. The `.mkt` wrapper scopes the marketing token layer
// (marketing.css) to this page only — product surfaces never inherit it.
export default function Home() {
  return (
    <div className="mkt">
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
