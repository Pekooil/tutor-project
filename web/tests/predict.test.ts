import { describe, it, expect, vi } from 'vitest'

// predict.ts carries `import 'server-only'` as a defensive marker even
// though predictLikelyStruggle itself is pure -- mocked here exactly as
// topic.test.ts mocks it for topic.ts (the standard way to unit-test pure
// logic behind the marker without spawning a dev server).
vi.mock('server-only', () => ({}))

import { predictLikelyStruggle, pickStickingCandidates } from '../lib/learning/predict'
import type { ActiveMisconception, LearningProfile, MasteryNode } from '../lib/ai/profile'

function node(conceptKey: string): MasteryNode {
  return { conceptKey, mastery: 0.4, state: 'weak', confidenceBand: 'low' }
}

function misconception(conceptKey: string, description = ''): ActiveMisconception {
  return { conceptKey, category: 'procedural_error', description }
}

function profile(overrides: Partial<LearningProfile> = {}): LearningProfile {
  return {
    masteryNodes: [],
    activeMisconceptions: [],
    confidenceNote: 'Based on recorded session history.',
    ...overrides,
  }
}

describe('predictLikelyStruggle — the grounded session-kickoff prediction', () => {
  it('returns null when the profile carries no active misconceptions (cold start / all resolved)', () => {
    expect(predictLikelyStruggle(profile(), [])).toBeNull()
    expect(
      predictLikelyStruggle(profile({ masteryNodes: [node('algebra.quadratics.factoring')] }), [
        'algebra.quadratics.factoring',
      ])
    ).toBeNull()
  })

  it('prefers a misconception on a page-relevant (topic-detected) concept', () => {
    const p = profile({
      masteryNodes: [node('algebra.linear.slope'), node('calculus.differentiation.chain-rule')],
      activeMisconceptions: [
        misconception('algebra.linear.slope'),
        misconception('calculus.differentiation.chain-rule', 'drops the inner derivative'),
      ],
    })
    expect(predictLikelyStruggle(p, ['calculus.differentiation.chain-rule'])).toEqual(
      misconception('calculus.differentiation.chain-rule', 'drops the inner derivative')
    )
  })

  it('falls back to the profile node order (topic-relevant first, then weakest-first) when no topic key matches', () => {
    const p = profile({
      masteryNodes: [node('geometry.trig.right-triangle'), node('algebra.linear.slope')],
      activeMisconceptions: [
        // Listed in the OPPOSITE order of the nodes -- the node order must win.
        misconception('algebra.linear.slope'),
        misconception('geometry.trig.right-triangle'),
      ],
    })
    expect(predictLikelyStruggle(p, ['calculus.limits.continuity'])).toEqual(
      misconception('geometry.trig.right-triangle')
    )
  })

  it('falls back to the first active misconception when none sits on a surfaced node', () => {
    const p = profile({
      masteryNodes: [node('algebra.quadratics.factoring')],
      activeMisconceptions: [misconception('prob-stats.probability.conditional'), misconception('algebra2.logs.properties')],
    })
    expect(predictLikelyStruggle(p, [])).toEqual(misconception('prob-stats.probability.conditional'))
  })

  it('is a pure read: never mutates the profile it is handed', () => {
    const misconceptions = [misconception('algebra.linear.slope')]
    const p = profile({ masteryNodes: [node('algebra.linear.slope')], activeMisconceptions: misconceptions })
    predictLikelyStruggle(p, ['algebra.linear.slope'])
    expect(p.activeMisconceptions).toBe(misconceptions)
    expect(p.activeMisconceptions).toHaveLength(1)
  })
})

describe('pickStickingCandidates — the check-in 5b sticking-point candidates', () => {
  it('returns [] when the profile carries nothing for this concept (cold start on this topic)', () => {
    expect(pickStickingCandidates(profile(), 'algebra.quadratics.factoring')).toEqual([])
    expect(
      pickStickingCandidates(
        profile({ activeMisconceptions: [misconception('calculus.limits.continuity')] }),
        'algebra.quadratics.factoring'
      )
    ).toEqual([])
  })

  it('filters to exactly one concept, dropping every other concept in the profile', () => {
    const target = misconception('algebra.quadratics.factoring', 'drops the negative sign')
    const p = profile({
      activeMisconceptions: [misconception('calculus.limits.continuity'), target, misconception('geometry.trig.right-triangle')],
    })
    expect(pickStickingCandidates(p, 'algebra.quadratics.factoring')).toEqual([target])
  })

  it('preserves the array order it is handed -- ranking is the CALLER\'s job (loadProfile\'s occurrence/recency-ordered read), not this function\'s', () => {
    const first = misconception('algebra.quadratics.factoring', 'first, most relevant')
    const second = misconception('algebra.quadratics.factoring', 'second')
    const third = misconception('algebra.quadratics.factoring', 'third, least relevant')
    const p = profile({ activeMisconceptions: [first, second, third] })
    expect(pickStickingCandidates(p, 'algebra.quadratics.factoring')).toEqual([first, second, third])
  })

  it('caps at the default limit of 3 even when the profile carries more for this concept', () => {
    const many = ['a', 'b', 'c', 'd', 'e'].map((letter) => misconception('algebra.quadratics.factoring', letter))
    const p = profile({ activeMisconceptions: many })
    expect(pickStickingCandidates(p, 'algebra.quadratics.factoring')).toEqual(many.slice(0, 3))
  })

  it('respects an explicit limit override', () => {
    const many = ['a', 'b', 'c'].map((letter) => misconception('algebra.quadratics.factoring', letter))
    const p = profile({ activeMisconceptions: many })
    expect(pickStickingCandidates(p, 'algebra.quadratics.factoring', 1)).toEqual(many.slice(0, 1))
  })

  it('is a pure read: never mutates the profile it is handed', () => {
    const misconceptions = [misconception('algebra.quadratics.factoring')]
    const p = profile({ activeMisconceptions: misconceptions })
    pickStickingCandidates(p, 'algebra.quadratics.factoring')
    expect(p.activeMisconceptions).toBe(misconceptions)
  })

  // The 2026-07-17 widen: related-concept history (prerequisites, dependents,
  // same curriculum family) fills slots the exact concept's history leaves
  // empty -- Darcy's "pull history from previous related sessions" ask.
  describe('the related-concept tier', () => {
    it('surfaces a misconception recorded on a PREREQUISITE of the confirmed concept', () => {
      const prereq = misconception('algebra.polynomials.expanding', 'drops the negative when distributing')
      const p = profile({ activeMisconceptions: [prereq] })
      expect(pickStickingCandidates(p, 'algebra.quadratics.factoring')).toEqual([prereq])
    })

    it('surfaces a misconception recorded on a DEPENDENT (a concept that lists this one as a prerequisite)', () => {
      // chain-rule lists product-rule as a prerequisite, so chain-rule
      // history is related when the student confirms product-rule.
      const dependent = misconception('calculus.differentiation.chain-rule', 'forgets the inner derivative')
      const p = profile({ activeMisconceptions: [dependent] })
      expect(pickStickingCandidates(p, 'calculus.differentiation.product-rule')).toEqual([dependent])
    })

    it('surfaces a misconception from the same curriculum family', () => {
      const sibling = misconception('algebra.quadratics.formula', 'drops the negative on -b')
      const p = profile({ activeMisconceptions: [sibling] })
      expect(pickStickingCandidates(p, 'algebra.quadratics.factoring')).toEqual([sibling])
    })

    it('ranks exact-concept matches ahead of related ones regardless of profile order', () => {
      const related = misconception('algebra.polynomials.expanding', 'related, listed first')
      const exact = misconception('algebra.quadratics.factoring', 'exact, listed second')
      const p = profile({ activeMisconceptions: [related, exact] })
      expect(pickStickingCandidates(p, 'algebra.quadratics.factoring')).toEqual([exact, related])
    })

    it('still returns [] for a concept with no exact OR related history (unrelated strand)', () => {
      const p = profile({ activeMisconceptions: [misconception('stats.probability.counting')] })
      expect(pickStickingCandidates(p, 'algebra.quadratics.factoring')).toEqual([])
    })

    it('never lets the related tier displace exact matches when exact already fills the limit', () => {
      const exact = ['a', 'b', 'c'].map((letter) => misconception('algebra.quadratics.factoring', letter))
      const related = misconception('algebra.polynomials.expanding', 'related')
      const p = profile({ activeMisconceptions: [related, ...exact] })
      expect(pickStickingCandidates(p, 'algebra.quadratics.factoring')).toEqual(exact)
    })
  })
})
