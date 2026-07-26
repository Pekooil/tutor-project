import { describe, expect, it } from 'vitest'
import { diffScore, parseScoreSnapshot, type ScoreSnapshot } from '../lib/learning/score-snapshot'

// The end-of-session "what changed" summary. Pure functions over two snapshots,
// so this needs no Supabase and no dev server — the reads are covered by the
// session-lifecycle integration tests.
//
// What matters here is restraint: the summary is shown to a student right after
// they finish working, so it must never overstate. Every case below is a way it
// could lie.

const snap = (o: Partial<ScoreSnapshot> = {}): ScoreSnapshot => ({
  score: 60,
  mastery: 50,
  accuracy: 70,
  consistency: 40,
  ...o,
})

describe('parseScoreSnapshot', () => {
  it('reads a well-formed snapshot back', () => {
    expect(parseScoreSnapshot({ score: 60, mastery: 50, accuracy: 70, consistency: 40 })).toEqual(snap())
  })

  it('treats anything unexpected as absent', () => {
    // A pre-0028 session, a partial write, hand-edited data.
    for (const bad of [null, undefined, 'nope', 42, [], {}, { score: 'high' }]) {
      expect(parseScoreSnapshot(bad)).toBeNull()
    }
  })

  it('keeps a partial snapshot but drops non-finite numbers', () => {
    const parsed = parseScoreSnapshot({ score: 60, mastery: null, accuracy: NaN, consistency: 40 })
    expect(parsed).toEqual({ score: 60, mastery: null, accuracy: null, consistency: 40 })
  })
})

describe('diffScore', () => {
  it('reports per-signal movement and the composite change', () => {
    const change = diffScore(snap(), snap({ score: 64, accuracy: 78 }))
    expect(change?.change).toBe(4)
    expect(change?.signals.find((s) => s.key === 'accuracy')?.change).toBe(8)
    expect(change?.signals.find((s) => s.key === 'mastery')?.change).toBe(0)
  })

  it('says nothing at all when nothing moved', () => {
    // A summary that announces "no change" after real work reads as the app
    // failing to notice — better to render no summary than a null one.
    expect(diffScore(snap(), snap())).toBeNull()
  })

  it('says nothing when there is no before to compare against', () => {
    expect(diffScore(null, snap())).toBeNull()
    expect(diffScore(snap(), null)).toBeNull()
  })

  it('leaves a just-unlocked signal without a delta', () => {
    // Going from "not enough history" to a first reading is not a gain of 62.
    const change = diffScore(snap({ consistency: null }), snap({ consistency: 62, score: 66 }))
    const consistency = change?.signals.find((s) => s.key === 'consistency')
    expect(consistency?.change).toBeNull()
    expect(consistency?.after).toBe(62)
  })

  it('reports a decline as readily as a gain', () => {
    // Accuracy genuinely falls after a hard session. Hiding that would make
    // every other number untrustworthy.
    const change = diffScore(snap(), snap({ score: 56, accuracy: 58 }))
    expect(change?.change).toBe(-4)
    expect(change?.signals.find((s) => s.key === 'accuracy')?.change).toBe(-12)
  })

  it('still reports signal movement when the composite itself is unknown', () => {
    const change = diffScore(snap({ score: null }), snap({ score: null, accuracy: 80 }))
    expect(change?.change).toBeNull()
    expect(change?.signals.find((s) => s.key === 'accuracy')?.change).toBe(10)
  })
})
