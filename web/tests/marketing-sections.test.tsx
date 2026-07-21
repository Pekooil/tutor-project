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
    expect(html).toContain('Skip the copy-paste loop.')
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
