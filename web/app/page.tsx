import { BeforeAfter } from '@/components/marketing/BeforeAfter'
import { Faq } from '@/components/marketing/Faq'
import { FinalCta } from '@/components/marketing/FinalCta'
import { LandingFooter } from '@/components/marketing/LandingFooter'
import { LandingHero } from '@/components/marketing/LandingHero'
import { LandingNav } from '@/components/marketing/LandingNav'
import { PlatformMarquee } from '@/components/marketing/PlatformMarquee'
import { Reveal } from '@/components/marketing/Reveal'
import { StudyMaterials } from '@/components/marketing/StudyMaterials'
import '@/components/marketing/marketing.css'

// Landing v6 (design_handoff_landing_v6, 2026-07-24): nav → oversized
// left-aligned hero with the live Khan-Academy demo → platform marquee →
// before/after → the session → FAQ → keycap closer → dark footer. The `.mkt`
// wrapper scopes the marketing token layer (marketing.css) to this page only —
// product surfaces never inherit it.
//
// Darcy's calls on top of the design file (2026-07-24):
//  - The hero's static overlay mock is replaced by the existing live demo
//    (HeroDemo, the scripted Khan Academy session), scaled into the column.
//  - The design's "Calyxa makes learning simple." tabbed feature section is
//    replaced by the existing before/after, which shows something the hero
//    demo doesn't — and which then took that heading (2026-07-24).
//    Features.tsx is now unused by this page (kept on disk, still covered by
//    its SSR tests).
//  - The design's "But wait, there's more" section became "Every session
//    becomes study material" and, since the hero already shows the extension
//    at work, it now shows what a session LEAVES BEHIND: the real notes
//    document, quiz and flashcard surfaces. Its "Knows your weak spots." and
//    "Private by design." cards were dropped earlier.
//  - The testimonial marquee is dropped entirely — there are no real users to
//    quote yet, the same rule that parked WallOfLove.tsx on 2026-07-20.
//  - The closer is the existing FinalCta, unchanged, at its current size.
//  - Pricing no longer renders here at all; it lives at /pricing, reachable
//    from the nav and the footer.
//
// showPlaceholders (handoff flag, default ON): hides the scripted-demo
// footnote — set NEXT_PUBLIC_SHOW_PLACEHOLDERS=0 only for marketing
// screenshots.
const SHOW_PLACEHOLDERS = process.env.NEXT_PUBLIC_SHOW_PLACEHOLDERS !== '0'

// The one vertical wash the whole page sits on (design §"Page structure");
// every section from the before/after down paints its own opaque background
// over it.
const PAGE_WASH = 'linear-gradient(180deg, #d6f5e3 0%, #e8f7ee 26%, #f6fbf8 58%, #ffffff 100%)'

export default function Home() {
  return (
    <div className="mkt">
      <div className="w-full overflow-x-hidden" style={{ background: PAGE_WASH }}>
        <LandingNav />
        <main>
          <LandingHero showPlaceholders={SHOW_PLACEHOLDERS} />

          <PlatformMarquee />

          <Reveal>
            <BeforeAfter />
          </Reveal>

          <Reveal>
            <StudyMaterials />
          </Reveal>

          <Reveal>
            <Faq />
          </Reveal>

          <Reveal>
            <FinalCta />
          </Reveal>
        </main>
        <LandingFooter />
      </div>
    </div>
  )
}
