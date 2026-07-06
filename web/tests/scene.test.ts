import { describe, expect, it } from 'vitest'
import {
  assertTimeOrdered,
  reduceScene,
  sceneEndState,
  scrubTime,
  segmentText,
  TUTOR_CHARS_PER_SEC,
  type SceneScript,
} from '../components/marketing/demo/scene'
import { allScripts } from '../components/marketing/demo/scripts'

const script: SceneScript = {
  durationMs: 10000,
  restMs: 1000,
  steps: [
    { at: 500, do: { kind: 'strip', strip: { variant: 'overview', mastery: [{ title: 'Factoring', value: 0.5 }] } } },
    { at: 1000, do: { kind: 'annotate', annotations: [{ id: 'eq', target: 'problem', color: 'amber' }] } },
    { at: 1200, do: { kind: 'bubble', role: 'tutor', text: 'What two numbers multiply to 6?', links: [{ phrase: '6', color: 'green' }] } },
    { at: 3000, do: { kind: 'tag', tag: { kind: 'reviewing', label: 'Factoring quadratics' } } },
    { at: 3500, do: { kind: 'progress', value: 0.4 } },
    { at: 4000, do: { kind: 'bubble', role: 'student', text: '2 and 3.' } },
    { at: 5000, do: { kind: 'ping', label: 'Gap closed: sign errors', durationMs: 2000 } },
    { at: 6000, do: { kind: 'bubble', role: 'tutor', text: 'Right.' } },
    { at: 6500, do: { kind: 'progress', value: 1 } },
    { at: 8000, do: { kind: 'waveform', active: true } },
    { at: 9000, do: { kind: 'artifact', artifact: 'notes' } },
  ],
}

describe('reduceScene', () => {
  it('is empty before the first step', () => {
    const state = reduceScene(script, 0)
    expect(state.bubbles).toHaveLength(0)
    expect(state.annotations).toHaveLength(0)
    expect(state.strip).toBeNull()
    expect(state.ping).toBeNull()
    expect(state.progress).toBe(0)
    expect(state.waveform).toBe(false)
    expect(state.done).toBe(false)
  })

  it('activates steps in order at their timestamps', () => {
    expect(reduceScene(script, 499).strip).toBeNull()
    expect(reduceScene(script, 500).strip?.variant).toBe('overview')
    expect(reduceScene(script, 999).annotations).toHaveLength(0)
    expect(reduceScene(script, 1000).annotations).toHaveLength(1)
    expect(reduceScene(script, 1199).bubbles).toHaveLength(0)
    expect(reduceScene(script, 1200).bubbles).toHaveLength(1)
  })

  it('streams tutor bubbles at the character rate and completes them', () => {
    const atStart = reduceScene(script, 1200)
    expect(atStart.bubbles[0].revealedChars).toBe(0)

    const halfSecondIn = reduceScene(script, 1700)
    expect(halfSecondIn.bubbles[0].revealedChars).toBe(Math.floor(TUTOR_CHARS_PER_SEC / 2))

    const done = reduceScene(script, 3000)
    expect(done.bubbles[0].revealedChars).toBe('What two numbers multiply to 6?'.length)
  })

  it('shows student bubbles whole immediately', () => {
    const state = reduceScene(script, 4000)
    expect(state.bubbles[1].revealedChars).toBe('2 and 3.'.length)
  })

  it('attaches tags to the most recent tutor bubble', () => {
    const state = reduceScene(script, 3000)
    expect(state.bubbles[0].tags).toEqual([{ kind: 'reviewing', label: 'Factoring quadratics' }])
  })

  it('shows a ping only inside its duration window', () => {
    expect(reduceScene(script, 4999).ping).toBeNull()
    expect(reduceScene(script, 5000).ping?.label).toBe('Gap closed: sign errors')
    expect(reduceScene(script, 6999).ping?.label).toBe('Gap closed: sign errors')
    expect(reduceScene(script, 7000).ping).toBeNull()
  })

  it('reports pendingReply between a student turn and the tutor reply', () => {
    expect(reduceScene(script, 4500).pendingReply).toBe(true)
    expect(reduceScene(script, 6000).pendingReply).toBe(false)
    expect(reduceScene(script, 3000).pendingReply).toBe(false)
  })

  it('clamps progress and takes the latest value', () => {
    expect(reduceScene(script, 3500).progress).toBe(0.4)
    expect(reduceScene(script, 6500).progress).toBe(1)
  })

  it('produces the fully composed final frame (the reduced-motion state)', () => {
    const state = sceneEndState(script)
    expect(state.bubbles).toHaveLength(3)
    expect(state.bubbles[2].revealedChars).toBe('Right.'.length)
    expect(state.progress).toBe(1)
    expect(state.waveform).toBe(true)
    expect(state.artifacts).toEqual(['notes'])
    expect(state.ping).toBeNull()
    expect(state.done).toBe(true)
  })

  it('resets to empty when the loop restarts', () => {
    expect(reduceScene(script, 0).bubbles).toHaveLength(0)
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

describe('segmentText (color-linking)', () => {
  it('highlights an exact phrase match', () => {
    expect(segmentText('Look at x² + 5x + 6 = 0 here', [{ phrase: 'x² + 5x + 6 = 0', color: 'amber' }])).toEqual([
      { text: 'Look at ', color: null },
      { text: 'x² + 5x + 6 = 0', color: 'amber' },
      { text: ' here', color: null },
    ])
  })

  it('renders a near-miss as plain text, never a guessed link', () => {
    expect(segmentText('Look at the equation', [{ phrase: 'x² + 5x', color: 'amber' }])).toEqual([
      { text: 'Look at the equation', color: null },
    ])
  })

  it('claims first occurrences without overlapping earlier links', () => {
    const segments = segmentText('the term 5x and the constant 6, since 6 = 2 × 3', [
      { phrase: '5x', color: 'blue' },
      { phrase: '6', color: 'green' },
    ])
    expect(segments).toEqual([
      { text: 'the term ', color: null },
      { text: '5x', color: 'blue' },
      { text: ' and the constant ', color: null },
      { text: '6', color: 'green' },
      { text: ', since 6 = 2 × 3', color: null },
    ])
  })

  it('skips a phrase whose only occurrence is inside an earlier claim', () => {
    const segments = segmentText('solve x² + 5x + 6 = 0 now, watch the 5x term', [
      { phrase: 'x² + 5x + 6 = 0', color: 'amber' },
      { phrase: '5x', color: 'blue' },
    ])
    expect(segments).toEqual([
      { text: 'solve ', color: null },
      { text: 'x² + 5x + 6 = 0', color: 'amber' },
      { text: ' now, watch the ', color: null },
      { text: '5x', color: 'blue' },
      { text: ' term', color: null },
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
        { at: 500, do: { kind: 'progress', value: 0.5 } },
        { at: 100, do: { kind: 'progress', value: 1 } },
      ],
    }
    expect(() => assertTimeOrdered(broken, 'broken')).toThrow(/not time-ordered/)
  })

  it('rejects a step past the script duration', () => {
    const broken: SceneScript = {
      durationMs: 1000,
      restMs: 0,
      steps: [{ at: 1500, do: { kind: 'progress', value: 1 } }],
    }
    expect(() => assertTimeOrdered(broken, 'broken')).toThrow(/past its durationMs/)
  })
})
