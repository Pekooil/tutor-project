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
//    at work, it now shows what a session LEAVES BEHIND. As of 2026-07-25 it
//    SUMMARISES that rather than rendering it: one card, three small tiles
//    (notes · quiz · flashcards) with their counts, and the two column
//    headings above it removed. Its "Knows your weak spots." and "Private by
//    design." cards were dropped earlier.
//  - The two mid-page section headings (before/after + study material) dropped
//    a type tier on 2026-07-25 (Darcy) — clamp(23px, 2.2vw, 34px) with a
//    16.5px sub, down from a 62px cap and a 22px sub.
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

// The page is WHITE (Darcy, 2026-07-24 — the design file's full-height green
// wash was too much of it). All that's left is a very light ambient green over
// roughly the top half of the first screen: a soft vertical tint that is fully
// gone by 58%, plus a wide radial glow anchored above the fold so the green
// reads as light rather than as a band.
//
// `backgroundSize: 100% 100vh` is what confines it — both gradient layers are
// scaled to one viewport height and not repeated, so the tint tracks the fold
// at any screen size instead of being a magic pixel value, and every section
// below simply sits on white.
const AMBIENT = {
  backgroundColor: '#ffffff',
  backgroundImage: [
    'linear-gradient(180deg, rgba(134,239,172,0.20) 0%, rgba(134,239,172,0.11) 20%, rgba(134,239,172,0.04) 40%, rgba(134,239,172,0) 58%)',
    'radial-gradient(70rem 30rem at 50% -10rem, rgba(134,239,172,0.14), transparent 68%)',
  ].join(', '),
  backgroundRepeat: 'no-repeat',
  backgroundSize: '100% 100vh',
}

export default function Home() {
  return (
    <div className="mkt">
      <div className="w-full overflow-x-hidden" style={AMBIENT}>
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
