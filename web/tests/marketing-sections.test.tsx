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
import { HowItWorks } from '../components/marketing/HowItWorks'
import { SocraticSection } from '../components/marketing/SocraticSection'
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
    // Landing v7 (2026-07-29): "Press and start the set." — the set-scoped
    // closer, replacing "Press and start talking."
    expect(html).toContain('Press and start the set.')
    expect(html).toContain("the page is already open. this just counts what's on it.")
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

  it('carries the v7 headline and sub at the hero format', () => {
    // Darcy, 2026-07-29: set-scoped and payoff-first, replacing both the
    // moral "Stop copying. Start learning." and the handoff's default, which
    // leaned on "yourself".
    expect(html).toContain('Get homework done.')
    expect(html).toContain('Go do what matters to you.')
    expect(html).toContain('Any homework page. A finish line you can watch move.')
    expect(html).toContain('Add to Chrome — free')
    expect(html).toContain('10 free sessions a month · chrome, for now')
  })

  it('retires the moral framing the v7 copy rules ban', () => {
    expect(html).not.toContain('Stop copying')
    expect(html).not.toContain('Start learning')
    expect(html).not.toContain('Adaptive AI tutor')
  })

  it('renders the homework-session demo, not the scaled Khan tutoring mock', () => {
    // The host page is a recessed context strip now; the full browser mock
    // (menu bar, tab strip, sidebar) that painted at ~62% scale is gone.
    expect(html).toContain('khanacademy.org')
    expect(html).not.toContain('hero-khan.png')
    expect(html).not.toContain('khanacademy.org/math/trigonometry/right-triangles-trig')
  })

  it('opens on the count-and-time screen with the real session header', () => {
    expect(html).toContain('5 / 8')
    expect(html).toContain('min left')
    expect(html).toContain('Stage 2 of 3')
    expect(html).toContain('The bar, and the time')
    expect(html).toContain('One tap per problem')
    expect(html).toContain('It marks up your screen')
  })

  it('is play-only — nothing in the demo is clickable', () => {
    expect(html).not.toContain('<button')
    expect(html).not.toContain('<input')
  })

  it('keeps the honest scripted-demo footnote behind showPlaceholders', () => {
    expect(html).toContain('scripted demo')
    const hidden = decode(renderToString(createElement(LandingHero, { showPlaceholders: false })))
    expect(hidden).not.toContain('scripted demo')
  })
})

describe('HowItWorks (SSR)', () => {
  const html = decode(renderToString(createElement(HowItWorks)))

  it('renders the three moves and the alone-vs-Calyxa comparison', () => {
    expect(html).toContain("Three moves. That's it.")
    expect(html).toContain('Open the page you were going to do anyway.')
    expect(html).toContain('It counts the problems.')
    expect(html).toContain('You tap one per problem.')
    expect(html).toContain('The bar hits the end.')
    expect(html).toContain('On your own')
    expect(html).toContain('52 min')
    expect(html).toContain('With Calyxa')
    expect(html).toContain('38 min')
    expect(html).toContain('Same eight problems')
  })

  it('leads the comparison with the delta as a headline stat, not just two bars', () => {
    // Darcy, 2026-07-30: the "faster and less grind" argument was too quiet —
    // no number bigger than the row labels. The delta (52 - 38) is now its own
    // headline figure, and each row names WHERE the time goes.
    expect(html).toContain('14')
    expect(html).toContain('fewer minutes')
    expect(html).toContain('less rereading, less restarting, less grind')
    expect(html).toContain('reread the solution')
    expect(html).toContain('one nudge')
  })

  it('never claims a pace estimate on the first session', () => {
    // opener.ts's MIN_SESSIONS_FOR_ESTIMATE is 3 and estimateRange() returns
    // null until then — deliberately, so a first-timer gets no estimate rather
    // than a fabricated one. The design file's "tells you how long it'll take,
    // from your own pace" is therefore false for every first-time reader.
    expect(html).toContain('after a few sets')
    expect(html).not.toContain("tells you how long it'll take, from your own pace")
  })

  it('retires the eight-step chatbot loop and its moral closing line', () => {
    expect(html).not.toContain('Screenshot the problem')
    expect(html).not.toContain('Open a new chat')
    expect(html).not.toContain('Copy it down')
    expect(html).not.toContain('cheating and learning nothing')
  })
})

describe('SocraticSection (SSR)', () => {
  const html = decode(renderToString(createElement(SocraticSection)))

  it('makes the speed argument rather than apologising for the mechanic', () => {
    // Reframed from the handoff's "It asks. You answer." (Darcy, 2026-07-29):
    // in the speed lane, "never the worked solution" reads as a limitation
    // unless the section explains why it is what makes Calyxa fast.
    expect(html).toContain("It finds the one step you're missing.")
    expect(html).toContain('A worked solution makes you read seven steps to find the one you')
    expect(html).not.toContain('It asks. You answer.')
  })

  it('opens on the student turn with the reference card and no chat log', () => {
    expect(html).toContain('2x² + 5x − 3 = 0')
    expect(html).toContain('your page')
    expect(html).toContain("I don't know where to start on this one")
    expect(html).toContain('Listening')
    expect(html).toContain('No chat log to scroll')
  })

  it('starts in Exploring — the mode a session idles at, not a fallback', () => {
    // deriveTutorMode returns `current` for an unsignalled turn, so the first
    // (student) turn holds the session's opening mode.
    expect(html).toContain('Exploring')
    expect(html).toContain('Stage 1 of 3')
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
    // Landing v7 trims the caveat sentence to the short form — the FAQ's
    // "Does it work on my school's portal?" answer carries that idea now.
    expect(html).toContain('And any other page in Chrome.')
  })
})

describe('StudyMaterials (SSR)', () => {
  const html = decode(renderToString(createElement(StudyMaterials)))

  it('summarises the pack, naming the set it came from', () => {
    // Landing v7 (2026-07-29): "The set writes your study kit." — the
    // whole-set framing, and the pack header names the SET (problems + time)
    // rather than a session duration.
    expect(html).toContain('The set writes your study kit.')
    expect(html).toContain('Factoring quadratics')
    expect(html).toContain('Jul 22 set')
    expect(html).toContain('8 problems, 38 min')
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
    expect(html).toContain('Your attempt · Jul 22 set')
    expect(html).toContain('2x² + 5x − 3 = (2x − 1)(x + 3)')
    expect(html).toContain('Ask Calyxa about this →')
  })

  it('renders the mistake equation as MathCapsule’s real shape, not italic serif', () => {
    // Darcy, 2026-07-30 ("the font and the design", "supposed to be black"):
    // math.tsx is explicit that the real product has NO serif and NO italic —
    // the capsule inherits the page's sans font. mkt-math (Georgia) was the
    // marketing page's own artboard convention, not what the studio renders.
    expect(html).not.toContain('mkt-math')
    expect(html).not.toMatch(/italic[^"]*">2x/)
  })

  it('shows the quiz and flashcard tiles beside the notes tile', () => {
    expect(html).toContain('2 / 6')
    expect(html).toContain('Factor x² − 7x + 12.')
    expect(html).toContain('−3 and −4 multiply to 12 and add to −7.')
    expect(html).toContain('I had it')
    expect(html).toContain('I missed it')
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

  it('renders all four questions, one-liners, with the first one open', () => {
    // Landing v7 §7: four items down from five, one-line answers instead of
    // paragraphs.
    expect(html).toContain('Frequently asked questions')
    expect(html).toContain('Is it free?')
    expect(html).toContain("Does it work on my school's portal?")
    expect(html).toContain('Which math?')
    expect(html).toContain('What happens to my data?')
    expect(html).toContain('aria-expanded="true"')
  })

  it('retires the item that planted the moral objection it then answered', () => {
    // "Will it just do my homework for me?" is gone — it invited an objection
    // most visitors weren't having and answered it with the moral framing the
    // v7 copy rules ban.
    expect(html).not.toContain('Will it just do my homework for me?')
    expect(html).not.toContain("isn't a limit we plan to remove")
  })

  it('quotes the launch free cap, not the retired beta copy', () => {
    expect(html).toContain('10 sessions a month, no card')
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
