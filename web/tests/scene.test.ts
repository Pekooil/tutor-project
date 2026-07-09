import { describe, expect, it } from 'vitest'
import {
  assertTimeOrdered,
  DEMO_TUTOR_MODES,
  reduceScene,
  sceneEndState,
  scrubTime,
  segmentText,
  TUTOR_CHARS_PER_SEC,
  type SceneScript,
} from '../components/marketing/demo/scene'
import { allScripts } from '../components/marketing/demo/scripts'

// One fixture exercising the Sprint 25 vocabulary end to end: check-in →
// session (mode/stage/board/annotations/chips/ping/milestone) → recap.
const script: SceneScript = {
  durationMs: 10000,
  restMs: 1000,
  steps: [
    { at: 300, do: { kind: 'checkin', checkin: { variant: 'scan', line: 'Reading the page…' } } },
    {
      at: 700,
      do: {
        kind: 'checkin',
        checkin: {
          variant: 'predict',
          topic: 'Quadratic equations',
          sticking: 'Choosing a method',
          evidence: 'from your last session',
        },
      },
    },
    { at: 900, do: { kind: 'checkin', checkin: null } },
    { at: 900, do: { kind: 'stage', label: 'Stage 1 of 3 · spot the shortcut' } },
    { at: 900, do: { kind: 'board', expression: 'x² + 5x + 6 = 0' } },
    {
      at: 1000,
      do: {
        kind: 'annotate',
        annotations: [
          { id: 'eq', target: 'problem', ordinal: 1, shape: 'box', label: 'Start here' },
          { id: 'term-b', target: 'term-b', ordinal: 2, shape: 'circle', label: 'Split this term', note: 'b tells you what the two numbers add to.', step: 1 },
        ],
      },
    },
    { at: 1200, do: { kind: 'bubble', role: 'tutor', text: 'What two numbers multiply to 6?', links: [{ phrase: '6', ordinal: 2 }] } },
    { at: 3000, do: { kind: 'chips', chips: ['2 and 3', '1 and 6', 'Not sure'] } },
    { at: 3200, do: { kind: 'mode', mode: 'coach' } },
    { at: 4000, do: { kind: 'bubble', role: 'student', text: '2 and 3.' } },
    { at: 5000, do: { kind: 'ping', ping: { glyph: '✓', label: 'Pattern broken · sign errors', tone: 'positive' }, durationMs: 2000 } },
    { at: 5100, do: { kind: 'milestone', milestone: { tone: 'positive', glyph: '✓', line: 'Pattern broken · sign errors' } } },
    { at: 6000, do: { kind: 'bubble', role: 'tutor', text: 'Right.' } },
    { at: 6500, do: { kind: 'board', expression: '(x + 2)(x + 3) = 0' } },
    { at: 6500, do: { kind: 'stage', label: 'Stage 3 of 3 · proven' } },
    { at: 8000, do: { kind: 'waveform', active: true } },
    {
      at: 8800,
      do: {
        kind: 'recap',
        recap: {
          concept: 'Factoring quadratics',
          meta: '18 min · 5 problems',
          outcomes: [
            { title: 'Factoring quadratics', outcome: 'solid' },
            { title: 'Negative coefficients', outcome: 'revisit' },
          ],
        },
      },
    },
    { at: 9000, do: { kind: 'artifact', artifact: 'notes' } },
  ],
}

describe('reduceScene', () => {
  it('is empty before the first step, idling in Explore', () => {
    const state = reduceScene(script, 0)
    expect(state.transcript).toHaveLength(0)
    expect(state.annotations).toHaveLength(0)
    expect(state.mode).toBe('explore')
    expect(state.stage).toBeNull()
    expect(state.board).toBeNull()
    expect(state.chips).toBeNull()
    expect(state.checkin).toBeNull()
    expect(state.recap).toBeNull()
    expect(state.ping).toBeNull()
    expect(state.waveform).toBe(false)
    expect(state.done).toBe(false)
  })

  it('activates steps in order at their timestamps', () => {
    expect(reduceScene(script, 299).checkin).toBeNull()
    expect(reduceScene(script, 300).checkin?.variant).toBe('scan')
    expect(reduceScene(script, 999).annotations).toHaveLength(0)
    expect(reduceScene(script, 1000).annotations).toHaveLength(2)
    expect(reduceScene(script, 1199).transcript).toHaveLength(0)
    expect(reduceScene(script, 1200).transcript).toHaveLength(1)
  })

  it('walks the check-in from scan to prediction and clears it for the session', () => {
    const scan = reduceScene(script, 500).checkin
    expect(scan).toEqual({ variant: 'scan', line: 'Reading the page…' })
    const predict = reduceScene(script, 800).checkin
    expect(predict?.variant).toBe('predict')
    if (predict?.variant === 'predict') {
      expect(predict.topic).toBe('Quadratic equations')
      expect(predict.sticking).toBe('Choosing a method')
    }
    expect(reduceScene(script, 950).checkin).toBeNull()
  })

  it('streams tutor turns at the character rate and completes them', () => {
    const atStart = reduceScene(script, 1200)
    expect(atStart.transcript[0]).toMatchObject({ role: 'tutor', revealedChars: 0 })

    const halfSecondIn = reduceScene(script, 1700)
    expect(halfSecondIn.transcript[0]).toMatchObject({ revealedChars: Math.floor(TUTOR_CHARS_PER_SEC / 2) })

    const done = reduceScene(script, 3000)
    expect(done.transcript[0]).toMatchObject({ revealedChars: 'What two numbers multiply to 6?'.length })
  })

  it('shows student turns whole immediately', () => {
    const state = reduceScene(script, 4000)
    expect(state.transcript[1]).toMatchObject({ role: 'student', revealedChars: '2 and 3.'.length })
  })

  it('keeps the latest mode, stage, and board expression', () => {
    expect(reduceScene(script, 3000).mode).toBe('explore')
    expect(reduceScene(script, 3200).mode).toBe('coach')
    expect(reduceScene(script, 1000).stage).toBe('Stage 1 of 3 · spot the shortcut')
    expect(reduceScene(script, 6500).stage).toBe('Stage 3 of 3 · proven')
    expect(reduceScene(script, 1000).board).toBe('x² + 5x + 6 = 0')
    expect(reduceScene(script, 6500).board).toBe('(x + 2)(x + 3) = 0')
  })

  it('shows chips for the latest turn and clears them when any new turn commits', () => {
    expect(reduceScene(script, 2999).chips).toBeNull()
    expect(reduceScene(script, 3000).chips).toEqual(['2 and 3', '1 and 6', 'Not sure'])
    // The student's answer (a chip tap in the product) clears the row.
    expect(reduceScene(script, 4000).chips).toBeNull()
  })

  it('settles milestones into the transcript, interleaved where they fired', () => {
    const state = reduceScene(script, 6000)
    expect(state.transcript.map((entry) => entry.role)).toEqual(['tutor', 'student', 'milestone', 'tutor'])
    const milestone = state.transcript[2]
    expect(milestone).toEqual({
      role: 'milestone',
      milestone: { tone: 'positive', glyph: '✓', line: 'Pattern broken · sign errors' },
    })
  })

  it('shows a toned ping only inside its duration window; the milestone persists after', () => {
    expect(reduceScene(script, 4999).ping).toBeNull()
    expect(reduceScene(script, 5000).ping).toEqual({ glyph: '✓', label: 'Pattern broken · sign errors', tone: 'positive' })
    expect(reduceScene(script, 6999).ping?.tone).toBe('positive')
    const after = reduceScene(script, 7000)
    expect(after.ping).toBeNull()
    expect(after.transcript.some((entry) => entry.role === 'milestone')).toBe(true)
  })

  it('replaces the current ping when a new one fires (one at a time)', () => {
    const twoPings: SceneScript = {
      durationMs: 3000,
      restMs: 0,
      steps: [
        { at: 500, do: { kind: 'ping', ping: { glyph: '✱', label: 'New misconception detected', tone: 'watch' }, durationMs: 3000 } },
        { at: 1000, do: { kind: 'ping', ping: { glyph: '↗', label: 'Confidence increasing', tone: 'positive' }, durationMs: 1000 } },
      ],
    }
    expect(reduceScene(twoPings, 900).ping?.tone).toBe('watch')
    expect(reduceScene(twoPings, 1500).ping?.label).toBe('Confidence increasing')
    // The replacement's window governs — the first ping never comes back.
    expect(reduceScene(twoPings, 2500).ping).toBeNull()
  })

  it('reports pendingReply between a student turn and the tutor reply, through a settling milestone', () => {
    expect(reduceScene(script, 4500).pendingReply).toBe(true)
    // The milestone at 5100 must not hide the typing indicator.
    expect(reduceScene(script, 5500).pendingReply).toBe(true)
    expect(reduceScene(script, 6000).pendingReply).toBe(false)
    expect(reduceScene(script, 3000).pendingReply).toBe(false)
  })

  it('sets and holds the recap card', () => {
    expect(reduceScene(script, 8700).recap).toBeNull()
    const recap = reduceScene(script, 8800).recap
    expect(recap?.concept).toBe('Factoring quadratics')
    expect(recap?.outcomes).toHaveLength(2)
  })

  it('produces the fully composed final frame (the reduced-motion state)', () => {
    const state = sceneEndState(script)
    expect(state.transcript.map((entry) => entry.role)).toEqual(['tutor', 'student', 'milestone', 'tutor'])
    expect(state.transcript[3]).toMatchObject({ revealedChars: 'Right.'.length })
    expect(state.mode).toBe('coach')
    expect(state.stage).toBe('Stage 3 of 3 · proven')
    expect(state.board).toBe('(x + 2)(x + 3) = 0')
    expect(state.recap?.concept).toBe('Factoring quadratics')
    expect(state.waveform).toBe(true)
    expect(state.artifacts).toEqual(['notes'])
    expect(state.ping).toBeNull()
    expect(state.done).toBe(true)
  })

  it('resets to empty when the loop restarts', () => {
    expect(reduceScene(script, 0).transcript).toHaveLength(0)
  })

  it('maps scrub progress onto the same states as elapsed time', () => {
    expect(scrubTime(script, 0)).toBe(0)
    expect(scrubTime(script, 0.5)).toBe(5000)
    expect(scrubTime(script, 1)).toBe(10000)
    expect(scrubTime(script, 1.5)).toBe(10000)
    expect(scrubTime(script, -1)).toBe(0)
    expect(reduceScene(script, scrubTime(script, 0.5))).toEqual(reduceScene(script, 5000))
  })
})

describe('tutor modes', () => {
  it('mirrors the extension mode table: eight modes, typographic glyphs, no emoji', () => {
    const keys = Object.keys(DEMO_TUTOR_MODES)
    expect(keys).toEqual(['explore', 'coach', 'build', 'practice', 'challenge', 'verify', 'review', 'recover'])
    for (const mode of Object.values(DEMO_TUTOR_MODES)) {
      expect(mode.glyph.length).toBe(1)
      // Typographic glyphs, never emoji (brand rule): all in the BMP,
      // outside the emoji presentation blocks.
      expect(mode.glyph.codePointAt(0)! < 0x1f000).toBe(true)
    }
  })
})

describe('segmentText (transcript echo)', () => {
  it('claims an exact phrase match with its ordinal', () => {
    expect(segmentText('Look at x² + 5x + 6 = 0 here', [{ phrase: 'x² + 5x + 6 = 0', ordinal: 1 }])).toEqual([
      { text: 'Look at ', ordinal: null },
      { text: 'x² + 5x + 6 = 0', ordinal: 1 },
      { text: ' here', ordinal: null },
    ])
  })

  it('renders a near-miss as plain text, never a guessed link', () => {
    expect(segmentText('Look at the equation', [{ phrase: 'x² + 5x', ordinal: 1 }])).toEqual([
      { text: 'Look at the equation', ordinal: null },
    ])
  })

  it('claims first occurrences without overlapping earlier links', () => {
    const segments = segmentText('the term 5x and the constant 6, since 6 = 2 × 3', [
      { phrase: '5x', ordinal: 2 },
      { phrase: '6', ordinal: 3 },
    ])
    expect(segments).toEqual([
      { text: 'the term ', ordinal: null },
      { text: '5x', ordinal: 2 },
      { text: ' and the constant ', ordinal: null },
      { text: '6', ordinal: 3 },
      { text: ', since 6 = 2 × 3', ordinal: null },
    ])
  })

  it('skips a phrase whose only occurrence is inside an earlier claim', () => {
    const segments = segmentText('solve x² + 5x + 6 = 0 now, watch the 5x term', [
      { phrase: 'x² + 5x + 6 = 0', ordinal: 1 },
      { phrase: '5x', ordinal: 2 },
    ])
    expect(segments).toEqual([
      { text: 'solve ', ordinal: null },
      { text: 'x² + 5x + 6 = 0', ordinal: 1 },
      { text: ' now, watch the ', ordinal: null },
      { text: '5x', ordinal: 2 },
      { text: ' term', ordinal: null },
    ])
  })
})

describe('script data lint', () => {
  it('every shipped script is time-ordered with steps inside its duration', () => {
    for (const [name, shipped] of Object.entries(allScripts)) {
      expect(() => assertTimeOrdered(shipped, name)).not.toThrow()
    }
  })

  it('rejects an out-of-order script', () => {
    const broken: SceneScript = {
      durationMs: 1000,
      restMs: 0,
      steps: [
        { at: 500, do: { kind: 'waveform', active: true } },
        { at: 100, do: { kind: 'waveform', active: false } },
      ],
    }
    expect(() => assertTimeOrdered(broken, 'broken')).toThrow(/not time-ordered/)
  })

  it('rejects a step past the script duration', () => {
    const broken: SceneScript = {
      durationMs: 1000,
      restMs: 0,
      steps: [{ at: 1500, do: { kind: 'waveform', active: true } }],
    }
    expect(() => assertTimeOrdered(broken, 'broken')).toThrow(/past its durationMs/)
  })
})
