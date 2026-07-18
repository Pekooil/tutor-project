import { renderToString } from 'react-dom/server'
import { createElement } from 'react'
import { describe, expect, it } from 'vitest'
import { Hero } from '../components/marketing/Hero'
import { WhyUs } from '../components/marketing/WhyUs'
import { SessionShowcase } from '../components/marketing/SessionShowcase'
import { FinalCta } from '../components/marketing/FinalCta'

// Landing v3 render tests: SSR smoke renders (react-dom/server), matching
// how Next first paints them — no DOM emulation, no timers, deterministic
// markup. Client-only motion (the hero beat machine, the scroll scrub, the
// once-in-view playbacks) is covered by the manual pass; what THESE tests
// pin is composition: the sections present with their copy, and no retired
// panel-era vocabulary in what actually renders.

// React escapes quotes/apostrophes in attributes and text ("tuesday's" →
// &#x27;); decode the common entities so assertions can use plain strings.
// Also strips React's SSR text-boundary markers (<!-- -->) so assertions
// can span interpolated values like the free-session count.
function decode(html: string): string {
  return html
    .replaceAll('&#x27;', "'")
    .replaceAll('&quot;', '"')
    .replaceAll('&amp;', '&')
    .replaceAll('<!-- -->', '')
}

describe('Hero (SSR)', () => {
  const html = decode(renderToString(createElement(Hero)))

  it('renders the v3 headline, badge, and footnote', () => {
    expect(html).toContain('Stop asking AI for answers. Start learning from it.')
    expect(html).toContain('chrome extension · free to start')
    expect(html).toContain('free for 10 sessions a month · chrome')
  })

  it('renders the auto-playing demo card with the problem sheet and play control', () => {
    expect(html).toContain('mathpath.example/unit-4')
    expect(html).toContain('Problem 2 · solve by factoring')
    expect(html).toContain('Play the demo — hear one tutor reply')
  })
})

describe('SessionShowcase (SSR)', () => {
  const html = decode(renderToString(createElement(SessionShowcase)))

  it('renders all four rewritten beats', () => {
    expect(html).toContain('it talks you through the problem, live.')
    expect(html).toContain('it points at the problem.')
    expect(html).toContain('the moment it clicks, it’s on the record.')
    expect(html).toContain('it saw that mistake coming.')
    expect(html).toContain('talk it through out loud.')
    expect(html).toContain('scrolling back rewinds it')
  })

  it('speaks the pill language, not the retired panel vocabulary', () => {
    expect(html).toContain('the pill switches from exploring to coaching')
    expect(html).not.toMatch(/board strip|milestone row|chat bubble|header timer/i)
  })
})

describe('WhyUs (SSR)', () => {
  const html = decode(renderToString(createElement(WhyUs)))

  it('renders the three-column comparison with its headers', () => {
    expect(html).toContain('why not just a chatbot? why not a real tutor?')
    expect(html).toContain('a general AI chatbot')
    expect(html).toContain('a tutor that sees your screen')
    expect(html).toContain('a human tutor')
  })

  it('keeps the honest rows — the concession and the equal availability call', () => {
    expect(html).toContain('no — honestly')
    expect(html).toContain('yes — nothing replaces that')
    // "always on" appears for BOTH the chatbot and calyxa.
    expect(html.match(/always on/g)?.length).toBe(2)
    expect(html).toContain('calyxa is for the other 165 hours a week.')
  })
})

describe('FinalCta (SSR)', () => {
  const html = decode(renderToString(createElement(FinalCta)))

  it('renders the closing line with the idle pill band copy', () => {
    expect(html).toContain('your homework is already open. so is the tutor.')
    expect(html).toContain('free for 10 sessions a month · chrome, for now')
  })
})
