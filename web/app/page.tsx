import { Faq } from '@/components/marketing/Faq'
import { FinalCta } from '@/components/marketing/FinalCta'
import { HowItWorks } from '@/components/marketing/HowItWorks'
import { LandingFooter } from '@/components/marketing/LandingFooter'
import { LandingHero } from '@/components/marketing/LandingHero'
import { LandingNav } from '@/components/marketing/LandingNav'
import { PlatformMarquee } from '@/components/marketing/PlatformMarquee'
import { Reveal } from '@/components/marketing/Reveal'
import { SocraticSection } from '@/components/marketing/SocraticSection'
import { StudyMaterials } from '@/components/marketing/StudyMaterials'
import '@/components/marketing/marketing.css'

// Landing v7 (design_handoff_calyxa_landing, 2026-07-29): nav → oversized
// left-aligned hero with the homework-session demo → platform marquee → the
// three moves → the tutoring mechanic → the study kit → FAQ → keycap closer →
// dark footer. The `.mkt` wrapper scopes the marketing token layer
// (marketing.css) to this page only — product surfaces never inherit it.
//
// Same page, new positioning and new product. v6 sold a tutoring chat you talk
// to; the extension shipped a homework-session referee that counts the
// problems, paces you against your own history, takes one tap per problem,
// raises a hand when you stall, and closes the set. Tutoring is now the
// subroutine it calls when you're stuck. This page describes THAT.
//
// Positioning: we compete on getting through homework faster, and the
// comparison is against doing the assignment alone — never against a
// general-purpose chatbot, which is a fight that can only be lost by entering
// it. No moral framing anywhere: the page never says cheating, honesty,
// integrity, "stop copying", or anything implying supervision.
//
// Darcy's calls on top of the design file (2026-07-29):
//  - Headline is "Get homework done. Go do something else." over the design's
//    "The fastest way to do your homework yourself." — that one leans on
//    "yourself", the moral frame the handoff's own rules ban, and it was the
//    only differentiating word in the line. This one is set-scoped (the whole
//    assignment, not the stuck moment) and states the payoff.
//  - §5 is reframed from "It asks. You answer." to "It finds the one step
//    you're missing." In the speed lane, "never the worked solution" reads as
//    a limitation; this section's job is now to explain why the Socratic
//    mechanic is what makes it FAST, rather than to apologise for it.
//  - The comparison bar keeps the design's 52 → 38 figures. Flagged as the
//    page's one unverifiable claim and accepted; see HowItWorks.tsx.
//  - The page ships as if the homework session is live — the extension build
//    carrying it goes to the Chrome Web Store alongside this.
//
// Retired with v6: BeforeAfter.tsx (its eight-step "screenshot → paste → copy
// it down" list was the page's most eye-catching motion and a tutorial for the
// competing workflow, and its closing line carried the moral framing) and
// HeroDemo.tsx's scripted Khan tutoring session. Both stay on disk, still
// covered by their SSR tests; neither renders here.
//
// Unchanged from v6: the nav, the platform marquee, the keycap closer, the
// dark footer, and pricing living at /pricing rather than on this page.
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
            <HowItWorks />
          </Reveal>

          <Reveal>
            <SocraticSection />
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
