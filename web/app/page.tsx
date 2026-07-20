import { Footer } from '@/components/marketing/Footer'
import { Hero } from '@/components/marketing/Hero'
import { BeforeAfter } from '@/components/marketing/BeforeAfter'
import { Features } from '@/components/marketing/Features'
// PARKED 2026-07-20: the beta-cohort "wall of love" is temporarily removed from
// the landing pending real beta feedback (see the restore note in the body).
// Keep this import commented rather than deleted so restoring is a two-line
// uncomment.
// import { WallOfLove } from '@/components/marketing/WallOfLove'
import { Pricing } from '@/components/marketing/Pricing'
import { FinalCta } from '@/components/marketing/FinalCta'
import { Reveal } from '@/components/marketing/Reveal'
import '@/components/marketing/marketing.css'

// Landing v5 ("light", design_handoff_landing_v5, 2026-07-19): hero with the
// live scripted Khan-Academy demo → before/after step loop → tabbed features
// → pricing → keycap closer. (The wall-of-love/beta-cohort section sits between
// features and pricing when restored — parked 2026-07-20, see below.) The
// `.mkt` wrapper scopes the
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

        {/* Beta-cohort "wall of love" — PARKED 2026-07-20 pending real beta
            feedback. The full section is preserved intact at
            components/marketing/WallOfLove.tsx (still exercised by its SSR tests
            in tests/marketing-sections.test.tsx), so nothing needs recreating.
            To restore: uncomment the import above and this block — done. */}
        {/*
        <Reveal>
          <WallOfLove showPlaceholders={SHOW_PLACEHOLDERS} />
        </Reveal>
        */}

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
