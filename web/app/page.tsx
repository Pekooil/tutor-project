import { Footer } from '@/components/marketing/Footer'
import { Hero } from '@/components/marketing/Hero'
import { BeforeAfter } from '@/components/marketing/BeforeAfter'
import { Features } from '@/components/marketing/Features'
import { WallOfLove } from '@/components/marketing/WallOfLove'
import { Pricing } from '@/components/marketing/Pricing'
import { FinalCta } from '@/components/marketing/FinalCta'
import { Reveal } from '@/components/marketing/Reveal'
import '@/components/marketing/marketing.css'

// Landing v5 ("light", design_handoff_landing_v5, 2026-07-19): hero with the
// live scripted Khan-Academy demo → before/after step loop → tabbed features
// → wall of love → pricing → keycap closer. The `.mkt` wrapper scopes the
// marketing token layer (marketing.css) to this page only — product surfaces
// never inherit it.
//
// showPlaceholders (handoff flag, default ON): one boolean hides the
// scripted-demo footnote, the sample-quotes caption, and the per-quote
// placeholder badges — set NEXT_PUBLIC_SHOW_PLACEHOLDERS=0 only for
// marketing screenshots.
const SHOW_PLACEHOLDERS = process.env.NEXT_PUBLIC_SHOW_PLACEHOLDERS !== '0'

export default function Home() {
  return (
    <div className="mkt">
      <main>
        <Hero showPlaceholders={SHOW_PLACEHOLDERS} />

        <Reveal>
          <BeforeAfter />
        </Reveal>

        <Reveal>
          <Features />
        </Reveal>

        <Reveal>
          <WallOfLove showPlaceholders={SHOW_PLACEHOLDERS} />
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
