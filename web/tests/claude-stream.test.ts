import { describe, it, expect, vi } from 'vitest'

// claude.ts carries `import 'server-only'`; same mock pattern as
// system-prompt.test.ts / topic.test.ts so the pure createSayExtractor helper
// can be unit-tested without a server. createSayExtractor itself makes no
// network/SDK call -- it just parses streamed forced-tool JSON fragments.
vi.mock('server-only', () => ({}))

import { createSayExtractor } from '../lib/ai/claude'

// Feeds a full tool-input JSON string to the extractor in arbitrary fragment
// splits and returns the concatenated say deltas -- mimicking Anthropic's
// input_json_delta arriving in chunks that don't respect value boundaries.
function runFragments(fragments: string[]): string {
  const extractor = createSayExtractor()
  let out = ''
  for (const f of fragments) out += extractor.push(f)
  return out
}

describe('createSayExtractor (Sprint 15 voice follow-on — streamed forced-tool say extraction)', () => {
  it('reconstructs a plain say value split mid-word across fragments', () => {
    const say = runFragments(['{"say": "The chain ', 'rule has two ', 'parts."', ', "mode": "socratic"}'])
    expect(say).toBe('The chain rule has two parts.')
  })

  it('emits only the NEW characters each push (deltas never overlap or repeat)', () => {
    const extractor = createSayExtractor()
    const d1 = extractor.push('{"say": "Hello')
    const d2 = extractor.push(' there')
    const d3 = extractor.push(' world"')
    expect(d1).toBe('Hello')
    expect(d2).toBe(' there')
    expect(d3).toBe(' world')
    expect(d1 + d2 + d3).toBe('Hello there world')
  })

  it('stops at the closing quote and ignores everything after (later fields never leak into say)', () => {
    const say = runFragments([
      '{"say": "Done.", "assessment": {"concept_key": "algebra.quadratics.factoring", "outcome": "correct"}}',
    ])
    expect(say).toBe('Done.')
  })

  it('decodes JSON escapes (\\" and \\n) including when the escape straddles a fragment boundary', () => {
    // The backslash lands at the end of one fragment, its escaped char in the next.
    const say = runFragments(['{"say": "She said \\', '"hi\\', 'nbye"}'])
    expect(say).toBe('She said "hi\nbye')
  })

  it('waits on an incomplete trailing backslash rather than emitting a broken char', () => {
    const extractor = createSayExtractor()
    const d1 = extractor.push('{"say": "line\\') // lone trailing backslash -- must not emit yet
    const d2 = extractor.push('nbreak"}')
    expect(d1).toBe('line') // the "\ " is held back
    expect(d2).toBe('\nbreak') // completed on the next fragment
  })

  it('waits on a half-written \\uXXXX escape until all four hex digits arrive', () => {
    const extractor = createSayExtractor()
    // The fragment ends mid-escape, so its whole decode throws and is held
    // back atomically; it flushes intact once the escape completes. What must
    // never happen is a broken/partial character leaking out.
    const d1 = extractor.push('{"say": "x = \\u00') // incomplete unicode escape
    const d2 = extractor.push('b2 done"}')
    expect(d1).toBe('')
    expect(d2).toBe('x = ² done')
    expect(d1 + d2).toBe('x = ² done')
  })

  it('does not lose already-emitted text when a LATER fragment ends mid-escape', () => {
    const extractor = createSayExtractor()
    const d1 = extractor.push('{"say": "x = ') // decodable, emits
    const d2 = extractor.push('\\u00') // incomplete escape -- holds back, but keeps d1
    const d3 = extractor.push('b2"}')
    expect(d1).toBe('x = ')
    expect(d2).toBe('')
    expect(d3).toBe('²')
    expect(d1 + d2 + d3).toBe('x = ²')
  })

  it('tolerates whitespace around the say key/colon (not assuming a fixed prefix)', () => {
    const say = runFragments(['{ "say"  :   "spaced"', '}'])
    expect(say).toBe('spaced')
  })

  it('returns nothing until the say key actually appears', () => {
    const extractor = createSayExtractor()
    expect(extractor.push('{')).toBe('')
    expect(extractor.push('"sa')).toBe('') // key not yet complete
    expect(extractor.push('y": "now"')).toBe('now')
  })
})
