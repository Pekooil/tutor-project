import { describe, it, expect } from 'vitest'
import { CONCEPT_KEYS } from '@calyxa/curriculum'
import { parseEnvelope } from '../lib/ai/envelope'

// Unit spec for the §2.5 envelope parser (ADR-019) — Task 8's only pure
// unit surface (envelope.ts deliberately has no 'server-only' import and no
// I/O). Everything here runs in-process: no spawned server, no Supabase, no
// fake-Anthropic backend. The same behaviours are also exercised end-to-end
// through the running route in ai-turn.test.ts (a plain-text model reply
// still returns { reply } and persists nothing); this file pins the parser
// contract itself, case by case.

const VALID_KEY = 'algebra.quadratics.factoring'

function validEnvelopeJson(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    say: 'What two numbers multiply to 6 and add to 5?',
    mode: 'socratic',
    assessment: {
      concept_key: VALID_KEY,
      outcome: 'correct',
      reasoning_quality: 'sound',
      self_confidence: 'high',
      misconception_category: null,
      misconception_description: null,
      confidence: 'high',
    },
    ...overrides,
  })
}

describe('parseEnvelope: well-formed model output', () => {
  it('parses a full envelope to { say, mode, assessment }', () => {
    const envelope = parseEnvelope(validEnvelopeJson())

    expect(envelope.say).toBe('What two numbers multiply to 6 and add to 5?')
    expect(envelope.mode).toBe('socratic')
    expect(envelope.assessment).toEqual({
      conceptKey: VALID_KEY,
      outcome: 'correct',
      reasoningQuality: 'sound',
      selfConfidence: 'high',
      misconceptionCategory: null,
      misconceptionDescription: null,
      confidence: 'high',
    })
    expect(envelope.annotations).toBeUndefined()
  })

  it('strips a markdown code fence before parsing (the summarise.ts discipline)', () => {
    const fenced = '```json\n' + validEnvelopeJson() + '\n```'
    const envelope = parseEnvelope(fenced)

    expect(envelope.say).toBe('What two numbers multiply to 6 and add to 5?')
    expect(envelope.assessment?.conceptKey).toBe(VALID_KEY)
  })

  it('recovers an envelope the model wrapped in leading prose + a fence (observed live in Task 9 acceptance)', () => {
    // The exact failure shape the live model produced: conversational prose,
    // then the fenced envelope. Before the Task 9 fix this degraded to
    // { say: <raw> } and leaked the JSON block into the student-visible reply.
    const prose = 'Excellent reasoning! Expand (x+3)(x+4) and tell me what you get.\n\n'
    const envelope = parseEnvelope(prose + '```json\n' + validEnvelopeJson() + '\n```')

    expect(envelope.say).toBe('What two numbers multiply to 6 and add to 5?')
    expect(envelope.say).not.toContain('```')
    expect(envelope.assessment?.conceptKey).toBe(VALID_KEY)
  })

  it('recovers an unfenced envelope wrapped in prose via the outermost brace span', () => {
    const envelope = parseEnvelope('Here is my structured response:\n' + validEnvelopeJson() + '\nHope that helps!')

    expect(envelope.say).toBe('What two numbers multiply to 6 and add to 5?')
    expect(envelope.assessment?.outcome).toBe('correct')
  })

  it('prose containing LaTeX braces still degrades to { say: <raw> }, not a bogus parse', () => {
    const raw = 'Rewrite x^{2} + 5x + 6 in factored form — what two numbers work here?'
    expect(parseEnvelope(raw)).toEqual({ say: raw })
  })

  it('an opening turn (no assessment key) parses with assessment absent', () => {
    const envelope = parseEnvelope(JSON.stringify({ say: 'Welcome! What are we working on?', mode: 'socratic' }))

    expect(envelope.say).toBe('Welcome! What are we working on?')
    expect(envelope.assessment).toBeUndefined()
  })
})

describe('parseEnvelope: degrade-to-say (the tutor is never blanked)', () => {
  it('plain prose degrades to { say: <raw> } with no structure', () => {
    const raw = 'Nice work — now try factoring x^2 - 9 the same way.'
    const envelope = parseEnvelope(raw)

    expect(envelope).toEqual({ say: raw })
  })

  it('truncated/malformed JSON degrades to { say: <raw> }', () => {
    const raw = '{ "say": "half an envel'
    expect(parseEnvelope(raw)).toEqual({ say: raw })
  })

  it('valid JSON with no string "say" degrades to { say: <raw> }', () => {
    const noSay = JSON.stringify({ mode: 'socratic', assessment: { outcome: 'correct' } })
    expect(parseEnvelope(noSay)).toEqual({ say: noSay })

    const numberSay = JSON.stringify({ say: 42 })
    expect(parseEnvelope(numberSay)).toEqual({ say: numberSay })
  })
})

describe('parseEnvelope: field-level validation', () => {
  it('nulls an assessment.concept_key outside CONCEPT_KEYS instead of letting it leak', () => {
    const envelope = parseEnvelope(
      validEnvelopeJson({
        assessment: {
          concept_key: 'calculus.derivatives.chain-rule', // not in the curriculum graph
          outcome: 'correct',
          reasoning_quality: 'sound',
          self_confidence: 'high',
          confidence: 'high',
        },
      })
    )

    expect(CONCEPT_KEYS).not.toContain('calculus.derivatives.chain-rule')
    expect(envelope.assessment?.conceptKey).toBeNull()
    // The rest of the assessment still carries its signal.
    expect(envelope.assessment?.outcome).toBe('correct')
  })

  it('defaults unrecognised assessment sub-fields conservatively instead of discarding the assessment', () => {
    const envelope = parseEnvelope(validEnvelopeJson({ assessment: {} }))

    expect(envelope.assessment).toEqual({
      conceptKey: null,
      outcome: 'none',
      reasoningQuality: 'none',
      selfConfidence: 'unknown',
      misconceptionCategory: null,
      misconceptionDescription: null,
      confidence: 'low',
    })
  })

  it('drops an invalid mode rather than failing the envelope', () => {
    const envelope = parseEnvelope(validEnvelopeJson({ mode: 'lecture' }))

    expect(envelope.say).toBe('What two numbers multiply to 6 and add to 5?')
    expect(envelope.mode).toBeUndefined()
  })
})

describe('parseEnvelope: annotations (validated structurally, always optional)', () => {
  const validAnnotation = {
    id: 'a1',
    type: 'highlight',
    target: { kind: 'textMatch', text: 'x^2 + 5x + 6' },
    label: 'this term',
    step: 1,
    ttl_ms: 4000,
  }

  it('parses a structurally valid annotation (ttl_ms -> ttlMs)', () => {
    const envelope = parseEnvelope(validEnvelopeJson({ annotations: [validAnnotation] }))

    expect(envelope.annotations).toEqual([
      {
        id: 'a1',
        type: 'highlight',
        target: { kind: 'textMatch', text: 'x^2 + 5x + 6' },
        label: 'this term',
        step: 1,
        ttlMs: 4000,
      },
    ])
  })

  it('drops individually invalid entries and keeps the valid ones', () => {
    const envelope = parseEnvelope(
      validEnvelopeJson({
        annotations: [
          validAnnotation,
          { type: 'highlight', target: { kind: 'textMatch' } }, // no id
          { id: 'a2', type: 'sparkle', target: { kind: 'textMatch' } }, // unknown type
          { id: 'a3', type: 'circle', target: { kind: 'teleport' } }, // unknown target kind
          { id: 'a4', type: 'circle' }, // no target at all
          'not even an object',
        ],
      })
    )

    expect(envelope.annotations).toHaveLength(1)
    expect(envelope.annotations?.[0].id).toBe('a1')
  })

  it('omits the annotations key when the array is empty or nothing survives validation', () => {
    const empty = parseEnvelope(validEnvelopeJson({ annotations: [] }))
    expect(empty.annotations).toBeUndefined()

    const allInvalid = parseEnvelope(validEnvelopeJson({ annotations: [{ id: '', type: 'nope' }] }))
    expect(allInvalid.annotations).toBeUndefined()
    // and the envelope around them is unharmed
    expect(allInvalid.say).toBe('What two numbers multiply to 6 and add to 5?')
  })
})
