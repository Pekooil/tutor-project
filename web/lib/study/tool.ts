import 'server-only'
import type Anthropic from '@anthropic-ai/sdk'
import { CONCEPT_KEYS, getConcept } from '@calyxa/curriculum'

// Sprint 21 / Task 4 (ADR-049): the study-kit generator's forced-tool contract
// and its validator, kept together the way claude.ts keeps ENVELOPE_TOOL near
// the discipline it enforces. This mirrors that file exactly:
//   - `strict: true` is Anthropic's guaranteed schema validation (Sprint 14
//     Task 10 live-find) -- the model cannot skip a required key or emit a
//     concept key outside CONCEPT_KEYS.
//   - every object node carries `additionalProperties: false` (a missing one
//     rejects the WHOLE tool at call time -- the exact break that 500'd
//     mid-conversation turns before it was added everywhere).
//   - array-LENGTH caps are NOT expressible under strict:true (claude.ts says
//     the same about `annotations` "at most 3"), so the counts below are a
//     prompt-side cap in the descriptions AND a hard slice in parseStudyKit --
//     the schema shapes each item, parseStudyKit enforces how many.
//   - a concept key is the `nullableEnum` form claude.ts documents: an
//     `anyOf: [{ enum }, { null }]` (a `type: ['string','null']` + enum is
//     REJECTED by the strict validator -- see claude.ts's nullableEnum note).
//
// The shapes are ADR-049 decision 1's marketing `ArtifactKind` contract
// (web/components/marketing/demo/scene.ts): notes = ordered step strings,
// problems = statements PLUS worked solutions (the one deliberate superset of
// the marketing card, which shows statements only -- a usable feature needs
// answers), flashcards = { front, back }.

// The nullableEnum form, copied from claude.ts (not imported -- claude.ts keeps
// it private, and duplicating three lines is cleaner than widening that file's
// surface for one reuse). A concept key constrained to the known curriculum
// keys, or null when none fits the problem clearly.
function nullableEnum(values: readonly string[]) {
  return { anyOf: [{ type: 'string', enum: values as string[] }, { type: 'null' }] } as const
}

// Prompt-side caps (see the header note: strict:true can't enforce array
// length, so these bound both the schema descriptions AND parseStudyKit's
// slice). Sized to ADR-049 / the plan's "notes that capture the method, 2-3
// NEW practice problems, 3-5 flashcards": notes get generous room for a
// step-by-step method, problems/flashcards match the stated ranges' ceilings.
export const MAX_NOTES = 8
export const MAX_PROBLEMS = 3
export const MAX_FLASHCARDS = 5

export const STUDY_KIT_TOOL_NAME = 'submit_study_kit'

export const STUDY_KIT_TOOL: Anthropic.Tool = {
  name: STUDY_KIT_TOOL_NAME,
  description:
    'Submit the study kit generated from this completed tutoring session. This is the ONLY way to ' +
    'reply -- always call it, exactly once. Ground every artifact in the session material provided: ' +
    'notes that capture the METHOD the student worked through, NEW practice problems on the SAME ' +
    'concepts (never a copy of the session\'s own problem), and flashcards on the key facts/steps.',
  strict: true,
  input_schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      notes: {
        type: 'array',
        items: { type: 'string' },
        description:
          `Ordered study notes capturing the METHOD from this session, one step per string, in order ` +
          `(at most ${MAX_NOTES} -- array-length caps are not enforceable here, so this is a prompt-side ` +
          `cap only). Plain sentences a student can re-read to redo the method themselves; no markdown. ` +
          `Use [] only if the session has genuinely no method worth capturing.`,
      },
      problems: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            statement: {
              type: 'string',
              description:
                'A NEW practice problem on the same concept(s) the student practiced -- never the ' +
                'session\'s own problem restated. Self-contained; solvable from the statement alone.',
            },
            solution: {
              type: 'string',
              description:
                'The worked solution to THIS statement -- the steps and the final answer, correct for ' +
                'the problem as written. Required on every problem (this is the deliberate superset of ' +
                'the marketing card, which shows statements only).',
            },
            concept_key: {
              ...nullableEnum(CONCEPT_KEYS),
              description:
                'The one curriculum concept this new problem practices, from the known keys, or null ' +
                'if none fits clearly. Must be a concept the SESSION actually covered -- do not invent ' +
                'coverage the session did not have.',
            },
          },
          required: ['statement', 'solution', 'concept_key'],
        },
        description:
          `2-3 NEW practice problems on the same concepts, each WITH a worked solution (at most ` +
          `${MAX_PROBLEMS} -- prompt-side cap). Use [] only if the session gives nothing to practice.`,
      },
      flashcards: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            front: {
              type: 'string',
              description: 'The prompt side -- a question or cue about a key fact/step from the session.',
            },
            back: {
              type: 'string',
              description: 'The answer side -- the fact/step itself, correct and concise.',
            },
          },
          required: ['front', 'back'],
        },
        description:
          `3-5 flashcards on the key facts/steps ({ front, back } pairs; at most ${MAX_FLASHCARDS} -- ` +
          `prompt-side cap). Use [] only if the session has no key facts worth a card.`,
      },
    },
    required: ['notes', 'problems', 'flashcards'],
  },
  // A worked example mirroring the marketing StudyLoopSection (x^2+5x+6 ->
  // factoring), so the model anchors on the intended grain: notes capture the
  // method, the practice problem is a SIBLING (not the same problem), and the
  // flashcard is the "two numbers multiply to 6, add to 5" fact the marketing
  // card demonstrates. concept_key is a real CONCEPT_KEYS value.
  input_examples: [
    {
      notes: [
        'To factor x^2 + bx + c, look for two numbers that multiply to c and add to b.',
        'For x^2 + 5x + 6: two numbers multiplying to 6 and adding to 5 are 2 and 3.',
        'Write the factors: (x + 2)(x + 3).',
        'Check by expanding: (x + 2)(x + 3) = x^2 + 5x + 6.',
      ],
      problems: [
        {
          statement: 'Factor x^2 + 7x + 12.',
          solution: 'Two numbers multiply to 12 and add to 7: 3 and 4. So x^2 + 7x + 12 = (x + 3)(x + 4).',
          concept_key: 'algebra.quadratics.factoring',
        },
      ],
      flashcards: [
        { front: 'To factor x^2 + 5x + 6, what two numbers do you need?', back: 'Two numbers that multiply to 6 and add to 5 — that is 2 and 3.' },
      ],
    },
  ],
}

// The validated, persist-ready kit. parseStudyKit is the only producer.
export type StudyProblem = {
  statement: string
  solution: string
  // The concept this new problem practices, validated to CONCEPT_KEYS (or null).
  // Grounding signal used to enrich the persisted row's concept_keys; NOT stored
  // per-problem in the payload (the migration's problems payload is
  // { statement, solution } -- see the generate route).
  conceptKey: string | null
}

export type StudyFlashcard = {
  front: string
  back: string
}

export type StudyKit = {
  notes: string[]
  problems: StudyProblem[]
  flashcards: StudyFlashcard[]
}

// The empty/minimal kit (ADR-049 decision 2's deterministic fallback): every
// malformed-or-absent tool output degrades to THIS, never a throw and never a
// half-parsed kit. A kit with zero total artifacts is the generate route's
// signal to persist nothing and surface the "couldn't generate right now"
// placeholder (Task 5), never a broken kit stored to study_artifact.
export const EMPTY_STUDY_KIT: StudyKit = { notes: [], problems: [], flashcards: [] }

function cleanString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

// The semantic re-validation the strict schema doesn't cover -- the same
// posture parseEnvelopeObject takes for ENVELOPE_TOOL: strict:true guarantees
// the SHAPE (keys exist, types match, concept_key is a CONCEPT_KEYS value or
// null), this enforces the MEANING (non-empty strings, concept key really in
// the current curriculum, the array-length caps the schema can't). Total and
// defensive: `input` is `unknown` because this also runs against a raw
// tool_use.input (Record) OR a hand-built object in tests; anything it can't
// make sense of collapses to EMPTY_STUDY_KIT rather than throwing.
export function parseStudyKit(input: unknown): StudyKit {
  if (typeof input !== 'object' || input === null) return EMPTY_STUDY_KIT

  const raw = input as Record<string, unknown>

  const notes = (Array.isArray(raw.notes) ? raw.notes : [])
    .map(cleanString)
    .filter((note): note is string => note !== null)
    .slice(0, MAX_NOTES)

  const problems: StudyProblem[] = (Array.isArray(raw.problems) ? raw.problems : [])
    .map((item): StudyProblem | null => {
      if (typeof item !== 'object' || item === null) return null
      const row = item as Record<string, unknown>
      const statement = cleanString(row.statement)
      const solution = cleanString(row.solution)
      // A problem without BOTH a statement and a worked solution is not a
      // usable practice problem (the solution is ADR-049's deliberate
      // superset -- a problem missing it is exactly the marketing-card
      // shortfall this feature exists to fix), so it is dropped, not stored.
      if (!statement || !solution) return null
      const conceptKeyRaw = cleanString(row.concept_key)
      // Defense beyond strict:true -- only keep a concept key that is really in
      // the code-shipped curriculum graph (guards against curriculum drift the
      // same way titleFor's raw-key fallback does elsewhere); anything else
      // becomes null rather than a dangling reference.
      const conceptKey = conceptKeyRaw && getConcept(conceptKeyRaw) ? conceptKeyRaw : null
      return { statement, solution, conceptKey }
    })
    .filter((problem): problem is StudyProblem => problem !== null)
    .slice(0, MAX_PROBLEMS)

  const flashcards: StudyFlashcard[] = (Array.isArray(raw.flashcards) ? raw.flashcards : [])
    .map((item): StudyFlashcard | null => {
      if (typeof item !== 'object' || item === null) return null
      const row = item as Record<string, unknown>
      const front = cleanString(row.front)
      const back = cleanString(row.back)
      if (!front || !back) return null
      return { front, back }
    })
    .filter((card): card is StudyFlashcard => card !== null)
    .slice(0, MAX_FLASHCARDS)

  return { notes, problems, flashcards }
}

// True when a kit has nothing worth persisting -- the generate route's gate for
// "degrade to the placeholder, store nothing" (never a row with an empty
// payload). Kept here so the emptiness rule lives with the kit shape.
export function isEmptyStudyKit(kit: StudyKit): boolean {
  return kit.notes.length === 0 && kit.problems.length === 0 && kit.flashcards.length === 0
}
