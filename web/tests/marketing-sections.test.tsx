import { renderToString } from 'react-dom/server'
import { createElement } from 'react'
import { describe, expect, it } from 'vitest'
import { Hero } from '../components/marketing/Hero'
import { BeforeAfter } from '../components/marketing/BeforeAfter'
import { Features } from '../components/marketing/Features'
import { WallOfLove } from '../components/marketing/WallOfLove'
import { Pricing } from '../components/marketing/Pricing'
import { FinalCta } from '../components/marketing/FinalCta'
import { Footer } from '../components/marketing/Footer'
import { Faq } from '../components/marketing/Faq'
import { HERO_SESSION } from '../components/marketing/HeroDemo'
import { LandingFooter } from '../components/marketing/LandingFooter'
import { LandingHero } from '../components/marketing/LandingHero'
import { LandingNav } from '../components/marketing/LandingNav'
import { PlatformMarquee } from '../components/marketing/PlatformMarquee'
import { StudyMaterials } from '../components/marketing/StudyMaterials'

// Landing v5 render tests: SSR smoke renders (react-dom/server), matching
// how Next first paints them — no DOM emulation, no timers, deterministic
// markup. Client-only motion (the hero demo machine, the step ticker, the
// tab rotator) is covered by the manual pass; what THESE tests pin is
// composition: each section presents with its v5 copy, and the
// showPlaceholders flag actually gates the placeholder chrome.

// React escapes quotes/apostrophes ("you're" → &#x27;); decode the common
// entities and strip SSR text-boundary markers so assertions can use plain
// strings across interpolated values.
function decode(html: string): string {
  return html
    .replaceAll('&#x27;', "'")
    .replaceAll('&quot;', '"')
    .replaceAll('&amp;', '&')
    .replaceAll('<!-- -->', '')
}

describe('Hero (SSR)', () => {
  const html = decode(renderToString(createElement(Hero, { showPlaceholders: true })))

  it('renders the hero badge, headline, sub, and CTA', () => {
    expect(html).toContain('producthunt.com/products/calyxa')
    expect(html).toContain('embed-image/v1/featured.svg')
    expect(html).toContain('Stop copying. Start learning')
    expect(html).toContain('Your Adaptive AI tutor that teaches directly on any homework, website, or PDF.')
    expect(html).toContain('Add to Chrome — free')
  })

  it('renders the Chrome-window demo scene idle state', () => {
    expect(html).toContain('khanacademy.org/math/trigonometry/right-triangles-trig')
    expect(html).toContain('Solve for a side in right triangles | Khan Academy')
    expect(html).toContain('sees this page')
    expect(html).toContain('hero-khan.png')
    // idle: the three suggestion chips + the pill input, no transcript yet
    expect(html).toContain('stuck on this one')
    expect(html).toContain('which ratio do I use?')
    expect(html).toContain('just tell me AB')
    expect(html).toContain('Ask about this problem…')
    expect(html).not.toContain('✧ Exploring')
  })

  it('gates the scripted-demo footnote behind showPlaceholders', () => {
    expect(html).toContain('scripted demo — the real calyxa floats over your actual homework tab')
    const hidden = decode(renderToString(createElement(Hero, { showPlaceholders: false })))
    expect(hidden).not.toContain('scripted demo')
  })
})

describe('BeforeAfter (SSR)', () => {
  const html = decode(renderToString(createElement(BeforeAfter)))

  it('renders the heading and all 8 before-steps', () => {
    // Retitled 2026-07-24; the before/after content itself is unchanged.
    expect(html).toContain('Calyxa makes learning simple.')
    for (const step of [
      'Screenshot the problem',
      'Open a new chat',
      'Paste it in',
      "Type where you're stuck",
      'Read the full solution',
      'Copy it down',
      'Turn it in',
      'Miss the same step on the test',
    ]) {
      expect(html).toContain(step)
    }
  })

  it('renders the after card with the one-step exchange', () => {
    expect(html).toContain("“hey calyxa — I'm stuck on 2b.”")
    expect(html).toContain('x² − 5x + 6 = 0')
    expect(html).toContain('already looking at 2b — what did you try first?')
    expect(html).toContain('actually understand the concept your test needs')
  })
})

describe('Features (SSR)', () => {
  const html = decode(renderToString(createElement(Features)))

  it('renders the three tabs with Annotations active by default', () => {
    expect(html).toContain('Everything a tutor does, in one session.')
    expect(html).toContain('Annotations')
    expect(html).toContain('Voice')
    expect(html).toContain('Study kits')
    expect(html).toContain('It draws on the problem itself.')
  })

  it('keeps the quadratic example in the annotation mock (intentional per handoff)', () => {
    expect(html).toContain('x²')
    expect(html).toContain('they add to +5')
    expect(html).toContain('they multiply to +6')
    expect(html).toContain('Coaching')
  })
})

describe('WallOfLove (SSR)', () => {
  const html = decode(renderToString(createElement(WallOfLove, { showPlaceholders: true })))

  it('renders the heading, quotes, and placeholder chrome', () => {
    expect(html).toContain('Loved by students who hate being stuck.')
    expect(html).toContain('sample quotes — swapped for real ones when beta cohort 3 wraps.')
    expect(html).toContain('placeholder')
    expect(html).toContain("it never just tells me. it's annoying for five seconds and then it clicks.")
  })

  it('hides all placeholder chrome when the flag is off', () => {
    const hidden = decode(renderToString(createElement(WallOfLove, { showPlaceholders: false })))
    expect(hidden).not.toContain('sample quotes')
    expect(hidden).not.toContain('placeholder')
  })
})

describe('Pricing (SSR)', () => {
  const html = decode(renderToString(createElement(Pricing)))

  it('is monthly-only at $10/mo with no annual toggle (launch pricing)', () => {
    expect(html).toContain('Simple, honest pricing.')
    expect(html).toContain('$10')
    expect(html).toContain('billed monthly')
    // Annual is disabled at launch — no toggle, no annual copy.
    expect(html).not.toContain('Annual')
    expect(html).not.toContain('billed annually')
    expect(html).not.toContain('$8')
  })

  it('renders the free tier and the honest cost comparison', () => {
    expect(html).toContain('$0')
    expect(html).toContain('10 tutoring sessions a month.')
    expect(html).toContain('Start free')
    expect(html).toContain('Upgrade to Pro')
    expect(html).toContain('a human tutor is $40–80 an hour. a month of calyxa costs less than 20 minutes of one.')
  })
})

describe('FinalCta (SSR)', () => {
  const html = decode(renderToString(createElement(FinalCta)))

  it('renders the keycap closer with the fine print', () => {
    expect(html).toContain('Press and start talking.')
    expect(html).toContain('your homework is already open. so is the tutor.')
    expect(html).toContain('10 free sessions a month · chrome, for now · alt + shift + C on windows')
  })
})

describe('Footer (SSR)', () => {
  const html = decode(renderToString(createElement(Footer)))

  it('renders the tagline, live links only, and the baseline row', () => {
    expect(html).toContain("the tutor that's already on the page.")
    expect(html).toContain('made for students, not answers.')
    expect(html).toContain('/privacy')
    expect(html).toContain('/terms')
    // dead design links stay dropped until the pages exist
    expect(html).not.toContain('beta notes')
    expect(html).not.toContain('changelog')
  })
})

// ── Landing v6 (2026-07-24) ───────────────────────────────────────────────
// The sections page.tsx actually composes now. Same SSR-smoke contract as
// above: composition and copy, not client motion.

describe('LandingNav (SSR)', () => {
  const html = decode(renderToString(createElement(LandingNav)))

  it('links How it works, Pricing and Privacy beside the Dashboard pill', () => {
    expect(html).toContain('How it works')
    expect(html).toContain('/#how-it-works')
    // Pricing left the landing page entirely — the nav is one of its two ways in.
    expect(html).toContain('/pricing')
    expect(html).toContain('/privacy')
    expect(html).toContain('Dashboard')
  })
})

describe('LandingHero (SSR)', () => {
  const html = decode(renderToString(createElement(LandingHero, { showPlaceholders: true })))

  it('keeps the existing headline and sub at the v6 hero format', () => {
    expect(html).toContain('Stop copying.')
    expect(html).toContain('Start learning.')
    expect(html).toContain('Your Adaptive AI tutor that teaches directly on any homework, website, or PDF.')
    expect(html).toContain('Add to Chrome — free')
    expect(html).toContain('10 free sessions a month · chrome, for now')
  })

  it('renders the real Khan Academy demo in the right column, not the design mock', () => {
    expect(html).toContain('khanacademy.org/math/trigonometry/right-triangles-trig')
    expect(html).toContain('hero-khan.png')
    expect(html).toContain('sees this page')
    // the design file's static overlay placeholder is gone
    expect(html).not.toContain('Static preview of the extension overlay')
  })

  it('runs the demo voice-only — the wide text composer never renders', () => {
    // voiceOnly (2026-07-24): the pill rests on Listening and morphs through
    // think/speak, so there is no composer input and no ↵ hint.
    expect(html).toContain('Listening')
    expect(html).not.toContain('Ask about this problem…')
    expect(html).not.toContain('<input')
    // the pill harness still gets the full pill — Hero (SSR) above asserts
    // the composer is present there.
  })

  it('is play-only — no suggestion chips and nothing clickable in the demo', () => {
    // interactive={false}: the demo is a film, not a toy. The only <button> in
    // the section would be a chip, and there are none.
    expect(html).not.toContain('<button')
    expect(html).not.toContain('I’m stuck on this one')
    expect(html).toContain('pointer-events-none')
  })
})

describe('HERO_SESSION (the scripted hero session)', () => {
  it('is one whole session: stuck → wrong turn → solved → study kit', () => {
    expect(HERO_SESSION).toHaveLength(8)
    expect(HERO_SESSION[0].student).toContain("I'm stuck")
    // the arc has to include getting something wrong and being walked back,
    // not just a clean run — that is the product claim.
    expect(HERO_SESSION.map((turn) => turn.mode)).toContain('recover')
    // ...and it has to end somewhere: solved, then a kit.
    expect(HERO_SESSION[6].reply).toContain('3.11')
    expect(HERO_SESSION[7].reply).toContain('notes')
  })

  it('never hands over the answer before the student derives it', () => {
    // 3.11 may only appear in a reply to a student line that has ALREADY
    // stated AB = 2 ÷ cos 50 — each turn's `student` precedes its `reply`.
    const firstMention = HERO_SESSION.findIndex((turn) => turn.reply.includes('3.11'))
    expect(HERO_SESSION[firstMention].student).toContain('divide by cos 50')
  })
})

describe('PlatformMarquee (SSR)', () => {
  const html = decode(renderToString(createElement(PlatformMarquee)))

  it('names every platform and keeps the not-limited-to-a-list caveat', () => {
    for (const platform of [
      'Canvas',
      'Khan Academy',
      'MyLab Math',
      'DeltaMath',
      'WebAssign',
      'AP Classroom',
      'Google Classroom',
    ]) {
      expect(html).toContain(platform)
    }
    expect(html).toContain("isn't limited to a list")
  })
})

describe('StudyMaterials (SSR)', () => {
  const html = decode(renderToString(createElement(StudyMaterials)))

  it('summarises the pack, naming the session it came from', () => {
    expect(html).toContain('Every session becomes study material.')
    expect(html).toContain('Factoring quadratics')
    expect(html).toContain('Jul 22 tutoring session')
    // the three artifacts, each with its count (Darcy, 2026-07-25: a summary,
    // not the full surfaces)
    expect(html).toContain('Notes')
    expect(html).toContain('4 key points')
    expect(html).toContain('Quiz')
    expect(html).toContain('Flashcards')
    expect(html).toContain('3 / 12')
    // the extension replay this section used to carry is gone
    expect(html).not.toContain('turn 4 of 8')
    expect(html).not.toContain('Show the next turn')
    expect(html).not.toContain('mathportal.school.edu')
  })

  it('no longer renders the full notes document or the two column headings', () => {
    // the document chrome the full-size mock carried
    expect(html).not.toContain('Brief Overview')
    expect(html).not.toContain('Where you slipped')
    // the two headings that sat above the demo (Darcy, 2026-07-25)
    expect(html).not.toContain("Notes you didn't write")
    expect(html).not.toContain('Then practice the miss')
  })

  it('prints the student’s own wrong work in the "Your attempt" callout', () => {
    // The product's honesty claim: the callout quotes studentAttempt verbatim
    // and offers the same follow-up the real notes view does.
    expect(html).toContain('Your attempt · Jul 22 session')
    expect(html).toContain('x² − 5x + 6 = (x − 2)(x + 3)')
    expect(html).toContain('Ask Calyxa about this →')
  })

  it('shows the quiz and flashcard tiles beside the notes tile', () => {
    expect(html).toContain('1 / 6')
    expect(html).toContain('Reveal the solution')
    expect(html).toContain('Work it out, then reveal the solution and mark whether you had it.')
    expect(html).toContain('Prompt')
    expect(html).toContain('Click to flip')
  })

  it('drops the two closing cards the design file had', () => {
    expect(html).not.toContain('Knows your weak spots')
    expect(html).not.toContain('Private by design')
  })
})

describe('Faq (SSR)', () => {
  const html = decode(renderToString(createElement(Faq)))

  it('renders all five questions with the first one open', () => {
    expect(html).toContain('Frequently asked questions')
    expect(html).toContain('Is Calyxa free to use?')
    expect(html).toContain('Which math does it cover?')
    expect(html).toContain('Will it just do my homework for me?')
    expect(html).toContain("Does it work on my school's portal?")
    expect(html).toContain('What happens to my data?')
    expect(html).toContain('aria-expanded="true"')
  })

  it('quotes the launch free cap, not the retired beta copy', () => {
    expect(html).toContain('10 free sessions a month, no card')
    expect(html).not.toContain('The beta is free')
  })
})

describe('LandingFooter (SSR)', () => {
  const html = decode(renderToString(createElement(LandingFooter)))

  it('renders the tagline and the four live links', () => {
    expect(html).toContain('Growth through learning.')
    expect(html).toContain('/privacy')
    expect(html).toContain('/terms')
    expect(html).toContain('/pricing')
    expect(html).toContain('All rights reserved.')
    // the design's Support link is dropped — there is no support page
    expect(html).not.toContain('Support')
  })
})
