import { describe, it, expect, vi } from 'vitest'

// system-prompt.ts is already transitively `server-only` via page-context.ts
// (a real value import, not type-only) even before this sprint; ADR-032
// Task 4 adds a second transitive source (topic.ts). Same mocking pattern as
// topic.test.ts (ADR-032 Task 3) — a marker package with zero real I/O of
// its own, stubbed so this pure-logic module can be unit-tested directly.
vi.mock('server-only', () => ({}))

import { assembleKeySubset, buildSystemPrompt } from '../lib/ai/system-prompt'
import type { LearningProfile } from '../lib/ai/profile'
import { CONCEPT_KEYS } from '@calyxa/curriculum'

function profile(overrides: Partial<LearningProfile> = {}): LearningProfile {
  return {
    masteryNodes: [],
    activeMisconceptions: [],
    confidenceNote: 'Calibrating — early estimate.',
    ...overrides,
  }
}

const CALIBRATING = profile()

describe('assembleKeySubset (ADR-032 Task 4, the bounded relevant subset)', () => {
  it('is empty for a cold-start profile with no page context', () => {
    expect(assembleKeySubset(CALIBRATING, undefined)).toEqual([])
  })

  it('unions profile-surfaced nodes, topic-detected keys, and due keys, then adds strand neighbors', () => {
    const p = profile({
      masteryNodes: [{ conceptKey: 'algebra.quadratics.factoring', mastery: 0.4, state: 'weak', confidenceBand: 'low' }],
      dueForReview: [{ conceptKey: 'algebra.inequalities.linear', reason: 'overdue by 2d' }],
    })
    const pageContext = { text: 'need help with the chain rule', equations: [] }

    const subset = assembleKeySubset(p, pageContext)

    // Core, in ∪ order: profile keys, topic keys, due keys.
    expect(subset.slice(0, 3)).toEqual([
      'algebra.quadratics.factoring',
      'calculus.differentiation.chain-rule',
      'algebra.inequalities.linear',
    ])
    // Strand neighbor: the quadratic formula shares "quadratics" with factoring.
    expect(subset).toContain('algebra.quadratics.formula')
  })

  it('dedupes when the same key surfaces from more than one source', () => {
    const p = profile({
      masteryNodes: [{ conceptKey: 'algebra.inequalities.linear', mastery: 0.3, state: 'weak', confidenceBand: 'low' }],
      dueForReview: [{ conceptKey: 'algebra.inequalities.linear', reason: 'overdue' }],
    })
    const subset = assembleKeySubset(p, undefined)
    expect(subset.filter((k) => k === 'algebra.inequalities.linear').length).toBe(1)
  })

  it('never exceeds the ~24 cap even with many distinct sources', () => {
    const p = profile({
      masteryNodes: [
        { conceptKey: 'algebra.linear-equations.one-variable', mastery: 0.2, state: 'weak', confidenceBand: 'low' },
        { conceptKey: 'geometry.angles.parallel-lines', mastery: 0.3, state: 'weak', confidenceBand: 'low' },
        { conceptKey: 'algebra2.logarithms.intro', mastery: 0.5, state: 'learning', confidenceBand: 'medium' },
      ],
      dueForReview: [
        { conceptKey: 'precalc.trig.identities', reason: 'due' },
        { conceptKey: 'calculus.integration.antiderivatives', reason: 'due' },
        { conceptKey: 'stats.probability.rules', reason: 'due' },
      ],
    })
    const subset = assembleKeySubset(p, undefined)
    expect(subset.length).toBeLessThanOrEqual(24)
  })

  it('is deterministic — same profile + pageContext, same output', () => {
    const p = profile({
      masteryNodes: [{ conceptKey: 'geometry.triangles.similarity', mastery: 0.5, state: 'learning', confidenceBand: 'medium' }],
    })
    const pageContext = { text: 'similar triangles problem', equations: [] }
    expect(assembleKeySubset(p, pageContext)).toEqual(assembleKeySubset(p, pageContext))
  })

  it('only ever returns real curriculum keys', () => {
    const p = profile({
      masteryNodes: [{ conceptKey: 'calculus.limits.formal', mastery: 0.4, state: 'weak', confidenceBand: 'low' }],
    })
    for (const key of assembleKeySubset(p, undefined)) {
      expect(CONCEPT_KEYS).toContain(key)
    }
  })
})

describe('buildSystemPrompt — subject scope + key-budget block (ADR-032 Task 4)', () => {
  it('widens the subject-scope line to HS math through intro college calculus, still math-only', () => {
    const prompt = buildSystemPrompt(CALIBRATING, undefined, { format: 'envelope' })
    expect(prompt).toContain('MATH ONLY')
    expect(prompt).toContain('first college calculus course')
  })

  it('shows the bounded subset, not the full ~66-key curriculum list', () => {
    const prompt = buildSystemPrompt(CALIBRATING, undefined, { format: 'envelope' })
    const keyLines = prompt.split('\n').filter((line) => /^\s*-\s[a-z0-9]+\.[a-z0-9.-]+$/.test(line))
    expect(keyLines.length).toBeLessThanOrEqual(24)
    expect(keyLines.length).toBeLessThan(CONCEPT_KEYS.length)
  })

  it('a page mentioning a derivative problem surfaces a calculus key in the bounded block', () => {
    const pageContext = { text: 'find the derivative using the chain rule', equations: [] }
    const prompt = buildSystemPrompt(CALIBRATING, pageContext, { format: 'envelope' })
    expect(prompt).toContain('calculus.differentiation.chain-rule')
  })

  it('instructs the model to use the canonical key when the real concept is outside the shown subset', () => {
    const prompt = buildSystemPrompt(CALIBRATING, undefined, { format: 'envelope' })
    expect(prompt).toMatch(/canonical key/i)
    expect(prompt).not.toMatch(/anything outside the algebra\s*\n?\s*list below/i)
  })

  it('leaves the text-format (streaming) path unaffected — no key list at all', () => {
    const prompt = buildSystemPrompt(CALIBRATING, undefined, { format: 'text' })
    expect(prompt).not.toContain('assessment.concept_key')
  })

  it('leaves Sprint 14 blocks (conciseness, annotations, session completion) untouched', () => {
    const prompt = buildSystemPrompt(CALIBRATING, undefined, { format: 'envelope' })
    expect(prompt).toContain('CONCISENESS is a bound, not a vibe')
    expect(prompt).toContain('ANNOTATION GUIDANCE')
    expect(prompt).toContain('SESSION COMPLETION')
    expect(prompt).toContain('SOLUTION PROGRESS')
  })
})

describe('buildSystemPrompt — SESSION START MODE (the check-in kickoff)', () => {
  const start = {
    question: 'Looks like you\'re working on which calculation gives the force in Newtons',
    stickingPoint: 'converting mass from grams to kilograms',
  }

  it('is absent unless opts.sessionStart is set', () => {
    expect(buildSystemPrompt(CALIBRATING, undefined, { format: 'envelope' })).not.toContain('SESSION START MODE')
  })

  it('renders the confirmed question and sticking point, and forbids re-confirmation', () => {
    const prompt = buildSystemPrompt(CALIBRATING, undefined, { format: 'envelope', sessionStart: start })
    expect(prompt).toContain('SESSION START MODE')
    expect(prompt).toContain(start.question)
    expect(prompt).toContain(start.stickingPoint)
    expect(prompt).toMatch(/do NOT re-confirm/)
    expect(prompt).toMatch(/Start AT the sticking point/)
    // This turn hands off to its own forced tool (board_text/opening_question),
    // not the shared "say" envelope -- the model never gets one open string.
    expect(prompt).toContain('submit_session_start_turn')
    expect(prompt).toContain('board_text')
    expect(prompt).toContain('opening_question')
  })

  it('the not-sure branch never claims a weakness the student did not name', () => {
    const prompt = buildSystemPrompt(CALIBRATING, undefined, {
      format: 'envelope',
      sessionStart: { question: start.question, stickingPoint: null },
    })
    expect(prompt).toContain('NOT sure where it usually goes wrong')
    expect(prompt).not.toContain('which they confirmed')
  })

  it('renders the reframe snippet when the student framed the exact spot', () => {
    const prompt = buildSystemPrompt(CALIBRATING, undefined, {
      format: 'envelope',
      sessionStart: { ...start, snippet: 'F = ma, m = 250 g' },
    })
    expect(prompt).toContain('"F = ma, m = 250 g"')
  })

  it('drops the BEFORE YOU ANSWER checklist -- it nags about fields this turn no longer lets the model fill', () => {
    const prompt = buildSystemPrompt(CALIBRATING, undefined, { format: 'envelope', sessionStart: start })
    expect(prompt).not.toContain('BEFORE YOU ANSWER')
  })
})
