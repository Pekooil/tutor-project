import { renderToString } from 'react-dom/server'
import { createElement } from 'react'
import { describe, expect, it } from 'vitest'
import { Hero } from '../components/marketing/Hero'
import { WhyUs } from '../components/marketing/WhyUs'
import { AdaptiveSection } from '../components/marketing/AdaptiveSection'
import { ProfileSection } from '../components/marketing/ProfileSection'
import { StudyLoopSection } from '../components/marketing/StudyLoopSection'
import { SessionShowcase } from '../components/marketing/SessionShowcase'
import { FinalCta } from '../components/marketing/FinalCta'

// Landing v3 render tests: SSR smoke renders (react-dom/server), matching
// how Next first paints them — no DOM emulation, no timers, deterministic
// markup. Client-only motion (the hero beat machine, the scroll scrub, the
// once-in-view playbacks) is covered by the manual pass; what THESE tests
// pin is composition: the new sections present with the handoff's copy, the
// study kit shipped as LIVE (no "on the way" qualifier), and no retired
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
    expect(html).toContain("a tutor's voice, on your homework page.")
    expect(html).toContain('chrome extension · waitlist open')
    expect(html).toContain('free for 20 sessions a month · chrome')
  })

  it('renders the interactive demo card with the problem sheet and play control', () => {
    expect(html).toContain('mathpath.example/unit-4')
    expect(html).toContain('Problem 2 · solve by factoring')
    expect(html).toContain('Play the demo — hear one tutor reply')
    expect(html).toContain('click the pill — hear one reply')
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

describe('AdaptiveSection — the four-systems spec panel (SSR)', () => {
  const html = decode(renderToString(createElement(AdaptiveSection)))

  it('renders the panel with all four numbered rows', () => {
    expect(html).toContain('the engine under the pill.')
    expect(html).toContain('misconception prediction')
    expect(html).toContain('tutor modes')
    expect(html).toContain('annotations')
    expect(html).toContain('pings')
  })

  it('shows exactly four mode chips plus the "+ 4 more" spill, never all eight', () => {
    for (const mode of ['Exploring', 'Coaching', 'Building', 'Recovering']) {
      expect(html).toContain(mode)
    }
    for (const mode of ['Practicing', 'Challenging', 'Verifying', 'Reviewing']) {
      expect(html).not.toContain(mode)
    }
    expect(html).toContain('+ 4 more')
    expect(html).toContain('18 in the catalog')
  })

  it('renders no interactive controls (the spec panel is static)', () => {
    expect(html).not.toContain('<button')
  })
})

describe('ProfileSection (SSR)', () => {
  const html = decode(renderToString(createElement(ProfileSection)))

  it('renders the before/after bookends in the pill language', () => {
    expect(html).toContain('before this session')
    expect(html).toContain('after this session')
    expect(html).toContain('checking your last session…')
    expect(html).toContain('AI prediction')
    expect(html).toContain('what improved')
    expect(html).toContain('still needs practicing')
    expect(html).toContain('factor pairs — solid')
    expect(html).toContain('sign errors on the roots — revisit')
  })

  it('renders no mastery bars or other retired copy', () => {
    expect(html).not.toMatch(/mastery|progress bar|profile tag|insight strip|gap closed/i)
  })
})

describe('StudyLoopSection (SSR)', () => {
  const html = decode(renderToString(createElement(StudyLoopSection)))

  it('markets the study kit as LIVE — the "on the way" qualifier is gone', () => {
    expect(html).toContain('every session leaves a study kit behind.')
    expect(html).not.toMatch(/on the way|coming soon|will leave|one day/i)
  })

  it('renders the filled recap anchor with the on-demand generate action', () => {
    expect(html).toContain("generated for you · on every session's recap card")
    expect(html).toContain('make my study kit')
    expect(html).not.toMatch(/automatic/i)
    // The dashed placeholder tiles are retired with the qualifier.
    expect(html).not.toContain('cx-demo-placeholder')
  })

  it('keeps the ArtifactKind trio with the worked-solutions superset', () => {
    expect(html).toContain('study notes')
    expect(html).toContain('practice problems')
    expect(html).toContain('flashcards')
    expect(html).toContain('show solutions')
    expect(html).toContain('what two numbers multiply to 6 and add to 5?')
  })
})

describe('FinalCta (SSR)', () => {
  const html = decode(renderToString(createElement(FinalCta)))

  it('renders the closing line with the idle pill band copy', () => {
    expect(html).toContain('your homework is already open. so is the tutor.')
    expect(html).toContain('free for 20 sessions a month · chrome, for now')
  })
})
