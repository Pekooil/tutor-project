import { describe, it, expect } from 'vitest'
import { CONCEPT_KEYS } from '@calyxa/curriculum'
import { parseEnvelope, SESSION_CLOSE_SENTENCE } from '../lib/ai/envelope'

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

describe('parseEnvelope: NEW curriculum keys parse and validate (ADR-032, Sprint 15 Task 8)', () => {
  // The positive-path counterpart to the "nulls a bogus key" tests below --
  // assessments carrying a real key from the launch-scale curriculum (not
  // one of the frozen eight) must parse straight through against the FULL
  // CONCEPT_KEYS list, not just the prompt's bounded subset (ADR-032's
  // Task 4 note: a correct key outside the injected subset is kept, never
  // dropped, since envelope.ts always validates against the full list).
  const NEW_CALCULUS_KEY = 'calculus.differentiation.chain-rule'
  const NEW_GEOMETRY_KEY = 'geometry.trig.right-triangle'

  it('a calculus key added in Task 2 validates against the full list', () => {
    expect(CONCEPT_KEYS).toContain(NEW_CALCULUS_KEY)

    const envelope = parseEnvelope(
      validEnvelopeJson({
        assessment: {
          concept_key: NEW_CALCULUS_KEY,
          outcome: 'correct',
          reasoning_quality: 'sound',
          self_confidence: 'high',
          confidence: 'high',
        },
      })
    )

    expect(envelope.assessment?.conceptKey).toBe(NEW_CALCULUS_KEY)
  })

  it('a geometry key added in Task 2 validates against the full list', () => {
    expect(CONCEPT_KEYS).toContain(NEW_GEOMETRY_KEY)

    const envelope = parseEnvelope(
      validEnvelopeJson({
        assessment: {
          concept_key: NEW_GEOMETRY_KEY,
          outcome: 'correct',
          reasoning_quality: 'sound',
          self_confidence: 'high',
          confidence: 'high',
        },
      })
    )

    expect(envelope.assessment?.conceptKey).toBe(NEW_GEOMETRY_KEY)
  })

  it('a NEW curriculum key also validates in a profile_tag (known-gap), not just assessment', () => {
    const envelope = parseEnvelope(
      validEnvelopeJson({
        profile_tags: [{ kind: 'known-gap', concept_key: NEW_CALCULUS_KEY, label: 'sign errors on the inner derivative' }],
      })
    )

    expect(envelope.profileTags).toEqual([
      { kind: 'known-gap', conceptKey: NEW_CALCULUS_KEY, label: 'sign errors on the inner derivative' },
    ])
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

  it("parses the 'underline' type (design vocabulary, added 2026-07-17 — previously unreachable)", () => {
    const envelope = parseEnvelope(
      validEnvelopeJson({
        annotations: [{ ...validAnnotation, type: 'underline', target: { kind: 'textMatch', text: 'show all work' } }],
      })
    )
    expect(envelope.annotations?.[0].type).toBe('underline')
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

// --- Sprint 13 (ADR-024/026): profile_tags -- structural parse only. The
// route's grounding gate (per-kind checks against the injected profile) is
// a separate authority tested end-to-end in ai-turn.test.ts; this file pins
// parseProfileTag's own structural contract, case by case, the same split
// annotations already established.
describe('parseEnvelope: profile_tags (all five kinds structurally validated, always optional)', () => {
  const allKinds: Array<{ kind: string; concept_key: string | null; label: string }> = [
    { kind: 'reviewing', concept_key: VALID_KEY, label: 'Factoring' },
    { kind: 'known-gap', concept_key: VALID_KEY, label: 'sign errors' },
    { kind: 'due-review', concept_key: VALID_KEY, label: 'Factoring review' },
    { kind: 'strength', concept_key: VALID_KEY, label: 'Solid factoring' },
    { kind: 'callback', concept_key: VALID_KEY, label: 'a few sessions ago' },
  ]

  it('parses a tag of each of the five kinds (one at a time -- parse caps at 2 per turn)', () => {
    for (const tag of allKinds) {
      const envelope = parseEnvelope(validEnvelopeJson({ profile_tags: [tag] }))
      expect(envelope.profileTags).toEqual([{ kind: tag.kind, conceptKey: tag.concept_key, label: tag.label }])
    }
  })

  it('drops an entry with an unrecognised kind, and keeps the rest', () => {
    const envelope = parseEnvelope(
      validEnvelopeJson({
        profile_tags: [
          { kind: 'reviewing', concept_key: VALID_KEY, label: 'Factoring' },
          { kind: 'obsessing', concept_key: VALID_KEY, label: 'not a real kind' },
        ],
      })
    )

    expect(envelope.profileTags).toEqual([{ kind: 'reviewing', conceptKey: VALID_KEY, label: 'Factoring' }])
  })

  it('drops an entry with an empty or whitespace-only label, and keeps the rest', () => {
    const envelope = parseEnvelope(
      validEnvelopeJson({
        profile_tags: [
          { kind: 'reviewing', concept_key: VALID_KEY, label: '   ' },
          { kind: 'strength', concept_key: VALID_KEY, label: '' },
          { kind: 'due-review', concept_key: VALID_KEY, label: 'Factoring review' },
        ],
      })
    )

    expect(envelope.profileTags).toEqual([{ kind: 'due-review', conceptKey: VALID_KEY, label: 'Factoring review' }])
  })

  it('trims a label, and nulls (but keeps) an entry whose concept_key is not in CONCEPT_KEYS', () => {
    const envelope = parseEnvelope(
      validEnvelopeJson({
        profile_tags: [
          { kind: 'known-gap', concept_key: 'calculus.derivatives.chain-rule', label: '  sign errors  ' },
        ],
      })
    )

    expect(CONCEPT_KEYS).not.toContain('calculus.derivatives.chain-rule')
    expect(envelope.profileTags).toEqual([{ kind: 'known-gap', conceptKey: null, label: 'sign errors' }])
  })

  it('caps at 2 tags even when the model sends more, keeping the first two', () => {
    const envelope = parseEnvelope(
      validEnvelopeJson({
        profile_tags: [
          { kind: 'reviewing', concept_key: VALID_KEY, label: 'one' },
          { kind: 'strength', concept_key: VALID_KEY, label: 'two' },
          { kind: 'due-review', concept_key: VALID_KEY, label: 'three' },
        ],
      })
    )

    expect(envelope.profileTags).toHaveLength(2)
    expect(envelope.profileTags?.map((t) => t.label)).toEqual(['one', 'two'])
  })

  it('omits the profileTags key when the array is empty or nothing survives validation', () => {
    const empty = parseEnvelope(validEnvelopeJson({ profile_tags: [] }))
    expect(empty.profileTags).toBeUndefined()

    const allInvalid = parseEnvelope(
      validEnvelopeJson({ profile_tags: [{ kind: 'not-a-kind', concept_key: null, label: 'x' }] })
    )
    expect(allInvalid.profileTags).toBeUndefined()
    expect(allInvalid.say).toBe('What two numbers multiply to 6 and add to 5?')
  })

  it('a tag-free envelope (the common case -- most turns have none) is unchanged from Sprint 12', () => {
    const envelope = parseEnvelope(validEnvelopeJson())
    expect(envelope.profileTags).toBeUndefined()
  })
})

// Sprint 14 Task 3 (ADR-027/028): the two additive fields solution_progress
// and session. Both are absent-tolerant like every other optional field
// above -- a turn that carries neither is byte-identical to a Sprint 13
// envelope (pinned explicitly below, not just implied).
describe('parseEnvelope: solution_progress (Sprint 14, ADR-028 -- model-emitted, client-clamped)', () => {
  it('parses an in-range value through unchanged', () => {
    expect(parseEnvelope(validEnvelopeJson({ solution_progress: 0.6 })).solutionProgress).toBe(0.6)
    expect(parseEnvelope(validEnvelopeJson({ solution_progress: 0 })).solutionProgress).toBe(0)
    expect(parseEnvelope(validEnvelopeJson({ solution_progress: 1 })).solutionProgress).toBe(1)
  })

  it('clamps an out-of-range value to [0, 1] rather than dropping it', () => {
    expect(parseEnvelope(validEnvelopeJson({ solution_progress: 1.4 })).solutionProgress).toBe(1)
    expect(parseEnvelope(validEnvelopeJson({ solution_progress: -0.3 })).solutionProgress).toBe(0)
  })

  it('drops (never defaults to 0) a non-numeric value -- "no signal" is not "no progress"', () => {
    expect(parseEnvelope(validEnvelopeJson({ solution_progress: '0.5' })).solutionProgress).toBeUndefined()
    expect(parseEnvelope(validEnvelopeJson({ solution_progress: null })).solutionProgress).toBeUndefined()
    expect(parseEnvelope(validEnvelopeJson({ solution_progress: true })).solutionProgress).toBeUndefined()
    expect(parseEnvelope(validEnvelopeJson({ solution_progress: Number.NaN })).solutionProgress).toBeUndefined()
  })

  it('is omitted entirely (not present as an own key) when the model sends none', () => {
    const envelope = parseEnvelope(validEnvelopeJson())
    expect(envelope.solutionProgress).toBeUndefined()
    expect(Object.prototype.hasOwnProperty.call(envelope, 'solutionProgress')).toBe(false)
  })
})

describe('parseEnvelope: session completion (Sprint 14, ADR-027 -- AI-signaled, client-confirmed)', () => {
  it('parses all three named completion reasons', () => {
    for (const reason of ['solved', 'follow-up-declined', 'follow-up-corrected'] as const) {
      const envelope = parseEnvelope(validEnvelopeJson({ session: { complete: true, reason } }))
      expect(envelope.session).toEqual({ complete: true, reason })
    }
  })

  it('drops the whole field on complete: false -- a bad completion NEVER closes a session', () => {
    const envelope = parseEnvelope(validEnvelopeJson({ session: { complete: false, reason: 'solved' } }))
    expect(envelope.session).toBeUndefined()
  })

  it('drops the whole field on a missing or unrecognised reason, never guessing one', () => {
    expect(parseEnvelope(validEnvelopeJson({ session: { complete: true } })).session).toBeUndefined()
    expect(
      parseEnvelope(validEnvelopeJson({ session: { complete: true, reason: 'done' } })).session
    ).toBeUndefined()
    expect(
      parseEnvelope(validEnvelopeJson({ session: { complete: true, reason: 123 } })).session
    ).toBeUndefined()
  })

  it('drops a non-object session value rather than throwing', () => {
    expect(parseEnvelope(validEnvelopeJson({ session: 'solved' })).session).toBeUndefined()
    expect(parseEnvelope(validEnvelopeJson({ session: null })).session).toBeUndefined()
    expect(parseEnvelope(validEnvelopeJson({ session: 42 })).session).toBeUndefined()
  })

  it('is omitted entirely (not present as an own key) when the model sends none', () => {
    const envelope = parseEnvelope(validEnvelopeJson())
    expect(envelope.session).toBeUndefined()
    expect(Object.prototype.hasOwnProperty.call(envelope, 'session')).toBe(false)
  })
})

describe('parseEnvelope: completion backstop (the mandated close sentence infers a dropped session field)', () => {
  const closingSay = `Exactly — (x+2)(x+3) is right. ${SESSION_CLOSE_SENTENCE}`

  it('infers a solved close when "say" ends with the mandated sentence but "session" is absent', () => {
    // The reported bug: the tutor writes the closing line but the optional
    // "session" field is dropped, so the section-complete bloom + recap never
    // fire. The sentence is reserved for a genuine close, so its presence IS
    // the signal.
    const envelope = parseEnvelope(validEnvelopeJson({ say: closingSay }))
    expect(envelope.session).toEqual({ complete: true, reason: 'solved' })
  })

  it('a well-formed "session" the model actually emitted still wins over the backstop', () => {
    const envelope = parseEnvelope(
      validEnvelopeJson({ say: closingSay, session: { complete: true, reason: 'follow-up-declined' } })
    )
    expect(envelope.session).toEqual({ complete: true, reason: 'follow-up-declined' })
  })

  it('salvages a malformed "session" (bad reason) into a solved close when the close sentence is present', () => {
    const envelope = parseEnvelope(
      validEnvelopeJson({ say: closingSay, session: { complete: true, reason: 'done' } })
    )
    expect(envelope.session).toEqual({ complete: true, reason: 'solved' })
  })

  it('tolerates trailing whitespace, a missing final period, and case when matching the sentence', () => {
    for (const say of [
      `Nice work. ${SESSION_CLOSE_SENTENCE}   `,
      'Great — that is the answer. now closing tutoring session',
      'You solved it. NOW CLOSING TUTORING SESSION.',
    ]) {
      expect(parseEnvelope(validEnvelopeJson({ say })).session).toEqual({ complete: true, reason: 'solved' })
    }
  })

  it('never fires when the sentence only appears mid-"say", not as the closing line', () => {
    const midSentence = `${SESSION_CLOSE_SENTENCE} is the phrase I say when we finish — but we are not done yet, so what is the next step?`
    expect(parseEnvelope(validEnvelopeJson({ say: midSentence })).session).toBeUndefined()
  })

  it('never fires for an ordinary tutoring turn that never writes the close sentence', () => {
    expect(parseEnvelope(validEnvelopeJson()).session).toBeUndefined()
  })
})

describe('parseEnvelope: answer chips (design 8a -- model-offered tap-to-answer options)', () => {
  it('parses a valid chips array through, trimmed and in order', () => {
    const envelope = parseEnvelope(validEnvelopeJson({ chips: ['-2 and -3', ' 2 and 3 ', 'Not sure'] }))
    expect(envelope.chips).toEqual(['-2 and -3', '2 and 3', 'Not sure'])
  })

  it('omits the field entirely when chips is absent, empty, or not an array (never [])', () => {
    expect(parseEnvelope(validEnvelopeJson()).chips).toBeUndefined()
    expect(parseEnvelope(validEnvelopeJson({ chips: [] })).chips).toBeUndefined()
    expect(parseEnvelope(validEnvelopeJson({ chips: 'Not sure' })).chips).toBeUndefined()
  })

  it('drops non-string, empty, and over-long entries (never truncates -- a clipped answer is a different answer)', () => {
    const overlong = 'x'.repeat(81)
    const envelope = parseEnvelope(
      validEnvelopeJson({ chips: [42, '', '   ', overlong, 'x = 2 or x = 3'] })
    )
    expect(envelope.chips).toEqual(['x = 2 or x = 3'])
  })

  it('dedupes case-insensitively and caps at 4 (first four unique win)', () => {
    const envelope = parseEnvelope(
      validEnvelopeJson({ chips: ['Factor it', 'factor it', 'Formula', 'Graph it', 'Guess', 'Not sure'] })
    )
    expect(envelope.chips).toEqual(['Factor it', 'Formula', 'Graph it', 'Guess'])
  })

  it('drops chips from a closing turn -- structured session and backstop-inferred alike', () => {
    const structured = parseEnvelope(
      validEnvelopeJson({ chips: ['Yes', 'No'], session: { complete: true, reason: 'solved' } })
    )
    expect(structured.session).toEqual({ complete: true, reason: 'solved' })
    expect(structured.chips).toBeUndefined()

    const backstopped = parseEnvelope(
      validEnvelopeJson({ chips: ['Yes', 'No'], say: `Exactly right. ${SESSION_CLOSE_SENTENCE}` })
    )
    expect(backstopped.session).toEqual({ complete: true, reason: 'solved' })
    expect(backstopped.chips).toBeUndefined()
  })
})

describe('parseEnvelope: absent-fields back-compat (solution_progress + session both omitted)', () => {
  it('is byte-identical to a Sprint 13 envelope -- the wire shape gains no keys when the model carries neither field', () => {
    const envelope = parseEnvelope(validEnvelopeJson())
    expect(Object.keys(envelope).sort()).toEqual(['assessment', 'mode', 'say'].sort())
  })
})

describe("parseEnvelope: signals (Sprint 15, ADR-034 -- allowlisted kinds, drop-don't-guess)", () => {
  it('parses an array of allowlisted signal kinds through unchanged', () => {
    const signals = ['teaching-decompose', 'guidance-up', 'self-caught']
    expect(parseEnvelope(validEnvelopeJson({ signals })).signals).toEqual(signals)
  })

  it('accepts each allowlisted kind individually', () => {
    for (const kind of [
      'prediction-confirmed',
      'misconception-detected',
      'pattern-detected',
      'pattern-broken',
      'concept-understood',
      'teaching-visual',
      'teaching-decompose',
      'pace-up',
      'guidance-up',
      'guidance-down',
      'difficulty-up',
      'difficulty-down',
      'confidence-up',
      'self-caught',
    ] as const) {
      expect(parseEnvelope(validEnvelopeJson({ signals: [kind] })).signals).toEqual([kind])
    }
  })

  it('filters out unrecognised / free-text kinds, keeping the valid ones -- no invented signal', () => {
    expect(
      parseEnvelope(validEnvelopeJson({ signals: ['guidance-up', 'interpretive-dance', 'Teaching Visual', 42, null] }))
        .signals
    ).toEqual(['guidance-up'])
  })

  it('collapses duplicate kinds within a turn', () => {
    expect(parseEnvelope(validEnvelopeJson({ signals: ['pace-up', 'pace-up', 'guidance-up'] })).signals).toEqual([
      'pace-up',
      'guidance-up',
    ])
  })

  it('caps the array at 3 kinds even when the model sends more', () => {
    const many = ['pace-up', 'guidance-up', 'difficulty-up', 'teaching-visual', 'self-caught']
    expect(parseEnvelope(validEnvelopeJson({ signals: many })).signals).toHaveLength(3)
  })

  it('is omitted entirely (not present as an own key) when the array is empty or all-invalid', () => {
    expect(parseEnvelope(validEnvelopeJson({ signals: [] })).signals).toBeUndefined()
    expect(parseEnvelope(validEnvelopeJson({ signals: ['nope', 7] })).signals).toBeUndefined()
    const envelope = parseEnvelope(validEnvelopeJson())
    expect(Object.prototype.hasOwnProperty.call(envelope, 'signals')).toBe(false)
  })
})

describe('parseEnvelope: answer_fields (design 8d -- multi-part answers, model-emitted)', () => {
  const triangle = [
    { label: 'Adjacent', placeholder: 'e.g. 8.66' },
    { label: 'Hypotenuse', placeholder: 'e.g. 10' },
  ]

  it('parses 2+ well-formed fields, keeping label + optional placeholder', () => {
    expect(parseEnvelope(validEnvelopeJson({ answer_fields: triangle })).answerFields).toEqual(triangle)
  })

  it('keeps a field with no placeholder, omitting the key rather than defaulting it', () => {
    const envelope = parseEnvelope(validEnvelopeJson({ answer_fields: [{ label: 'x' }, { label: 'y' }] }))
    expect(envelope.answerFields).toEqual([{ label: 'x' }, { label: 'y' }])
  })

  it('degrades a single field to nothing -- one unknown is an ordinary question, not multi-part', () => {
    expect(parseEnvelope(validEnvelopeJson({ answer_fields: [{ label: 'x' }] })).answerFields).toBeUndefined()
  })

  it('trims labels/placeholders and drops a field whose label is blank or over-long', () => {
    const envelope = parseEnvelope(
      validEnvelopeJson({
        answer_fields: [
          { label: '  Adjacent  ', placeholder: '  e.g. 8.66 ' },
          { label: '   ' },
          { label: 'H'.repeat(60) },
          { label: 'Hypotenuse' },
        ],
      })
    )
    // Only the two usable ones survive; the trimmed label/placeholder win.
    expect(envelope.answerFields).toEqual([
      { label: 'Adjacent', placeholder: 'e.g. 8.66' },
      { label: 'Hypotenuse' },
    ])
  })

  it('drops a non-string placeholder but keeps the field on a valid label', () => {
    const envelope = parseEnvelope(
      validEnvelopeJson({ answer_fields: [{ label: 'x', placeholder: 42 }, { label: 'y' }] })
    )
    expect(envelope.answerFields).toEqual([{ label: 'x' }, { label: 'y' }])
  })

  it('dedupes by label case-insensitively and caps the list at four', () => {
    const dup = parseEnvelope(
      validEnvelopeJson({ answer_fields: [{ label: 'X' }, { label: 'x' }, { label: 'y' }] })
    )
    expect(dup.answerFields).toEqual([{ label: 'X' }, { label: 'y' }])

    const many = [{ label: 'a' }, { label: 'b' }, { label: 'c' }, { label: 'd' }, { label: 'e' }]
    expect(parseEnvelope(validEnvelopeJson({ answer_fields: many })).answerFields).toHaveLength(4)
  })

  it('drops a non-array (or non-object entries) rather than throwing', () => {
    expect(parseEnvelope(validEnvelopeJson({ answer_fields: 'Adjacent' })).answerFields).toBeUndefined()
    expect(parseEnvelope(validEnvelopeJson({ answer_fields: ['Adjacent', 'Hypotenuse'] })).answerFields).toBeUndefined()
  })

  it('is dropped on a closing turn -- a goodbye has nothing left to answer', () => {
    const envelope = parseEnvelope(
      validEnvelopeJson({ answer_fields: triangle, session: { complete: true, reason: 'solved' } })
    )
    expect(envelope.answerFields).toBeUndefined()
    expect(envelope.session).toEqual({ complete: true, reason: 'solved' })
  })

  it('is dropped when the mandated close sentence infers a session too', () => {
    const closingSay = `Nice work — that's the full triangle. ${SESSION_CLOSE_SENTENCE}`
    const envelope = parseEnvelope(validEnvelopeJson({ say: closingSay, answer_fields: triangle }))
    expect(envelope.answerFields).toBeUndefined()
    expect(envelope.session?.complete).toBe(true)
  })

  it('wins over chips when both are sent -- fields and chips are mutually exclusive (8d swaps the chip row)', () => {
    const envelope = parseEnvelope(
      validEnvelopeJson({ answer_fields: triangle, chips: ['8.66', '10', 'Not sure'] })
    )
    expect(envelope.answerFields).toEqual(triangle)
    expect(envelope.chips).toBeUndefined()
  })

  it('leaves chips intact when answer_fields is present but invalid (single field degrades)', () => {
    const envelope = parseEnvelope(
      validEnvelopeJson({ answer_fields: [{ label: 'x' }], chips: ['8.66', '10'] })
    )
    expect(envelope.answerFields).toBeUndefined()
    expect(envelope.chips).toEqual(['8.66', '10'])
  })

  it('is omitted entirely (not present as an own key) when the model sends none', () => {
    const envelope = parseEnvelope(validEnvelopeJson())
    expect(envelope.answerFields).toBeUndefined()
    expect(Object.prototype.hasOwnProperty.call(envelope, 'answerFields')).toBe(false)
  })
})
