import { renderToString } from 'react-dom/server'
import { createElement } from 'react'
import { describe, expect, it } from 'vitest'
import { AdaptiveSection } from '../components/marketing/AdaptiveSection'
import { ProfileSection } from '../components/marketing/ProfileSection'
import { adaptiveVignetteAlts, checkinRecapAlts, pingCatalog } from '../components/marketing/demo/scripts'

// Sprint 25 Task 10: render tests for the sprint's new/rebuilt sections.
// SSR smoke renders (react-dom/server), matching how Next first paints them
// — no DOM emulation, no timers, deterministic markup. Client-only motion
// (the scene clocks, draw-ons) is covered by the scene reducer suite and
// the manual pass; what THESE tests pin is composition: every vignette and
// bookend present, the drafted alt strings adopted, the interactive ping
// catalog complete, and no retired-feature copy in what actually renders.

// React escapes quotes/apostrophes in attributes and text ("Tuesday’s" →
// &#x27;); decode the common entities so assertions can use plain strings.
function decode(html: string): string {
  return html
    .replaceAll('&#x27;', "'")
    .replaceAll('&quot;', '"')
    .replaceAll('&amp;', '&')
}

describe('AdaptiveSection (SSR)', () => {
  const html = decode(renderToString(createElement(AdaptiveSection)))

  it('renders the section frame and all four vignettes', () => {
    expect(html).toContain('It adapts while you work')
    expect(html).toContain('It calls your sticking point first.')
    expect(html).toContain('Eight ways to teach, switched live.')
    expect(html).toContain('Every mark explains itself.')
    expect(html).toContain('Three tones of ping.')
  })

  it('adopts the drafted alt strings for every vignette', () => {
    for (const alt of Object.values(adaptiveVignetteAlts)) {
      expect(html).toContain(alt)
    }
  })

  it('renders the full tap-to-fire catalog: 19 labelled buttons, all three tones', () => {
    expect(html.match(/<button/g)).toHaveLength(pingCatalog.length)
    for (const entry of pingCatalog) {
      expect(html).toContain(`Fire ping: ${entry.label}`)
    }
    for (const tone of ['positive', 'adjust', 'watch']) {
      expect(html).toContain(`--calyxa-ping-${tone}-bg`)
    }
  })

  it('gives the annotation vignette its measurement targets', () => {
    for (const target of ['problem', 'term-b', 'term-c']) {
      expect(html).toContain(`data-annot-target="${target}"`)
    }
  })

  it('renders no retired-feature copy', () => {
    expect(html).not.toMatch(/progress bar|profile tag|insight strip|gap closed|mastery/i)
  })
})

describe('ProfileSection (SSR)', () => {
  const html = decode(renderToString(createElement(ProfileSection)))

  it('renders the check-in → recap bookends with their labels', () => {
    expect(html).toContain('Before this session')
    expect(html).toContain('After this session')
    // The AFTER bookend is the composed recap card (hidden until the
    // timeline reaches it, but composed in the markup from the start).
    expect(html).toContain('What improved')
    expect(html).toContain('Generated for you')
    expect(html).toContain('Complete session')
    expect(html).toContain('Factoring quadratics')
  })

  it('adopts the drafted bookend alt strings', () => {
    expect(html).toContain(checkinRecapAlts.checkin)
    expect(html).toContain(checkinRecapAlts.recap)
  })

  it('keeps the callback quote', () => {
    expect(html).toContain('This connects to the factoring work from a few sessions ago')
    expect(html).toContain('picking up the thread a few sessions later')
  })

  it('renders no mastery bars or other retired copy', () => {
    expect(html).not.toMatch(/mastery|progress bar|profile tag|insight strip|gap closed/i)
  })
})
