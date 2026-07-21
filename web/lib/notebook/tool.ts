import 'server-only'
import type Anthropic from '@anthropic-ai/sdk'

// ADR-054 (v2, "live notebook"): the Personal Notebook generator's forced-tool
// contract and its validator, kept together the way study/tool.ts keeps
// STUDY_KIT_TOOL near its discipline. It mirrors that file's posture:
//   - `strict: true` is Anthropic's guaranteed schema validation — the model
//     cannot skip a required key or mis-type a field.
//   - every object node carries `additionalProperties: false`.
//   - array-LENGTH caps are NOT expressible under strict:true, so the counts
//     below are a prompt-side cap in the descriptions AND a hard slice in
//     parseNotebook.
//   - strict:true also can't express "optional" — so optional fields (a step's
//     expression, a key point's detail bullets, a step's mistake) are ALWAYS
//     present in the schema and use the ""/[] EMPTY SENTINEL convention: the
//     model emits "" / [] when there's nothing, and parseNotebook reads that as
//     absent. This is the same convention `summary: ""` already used.
//
// The v2 model turns the notebook from three prose fields into a real worked
// document, one concept per page (the redesign the product brief asks for):
//   - summary   : where the student stands on this concept (header brief).
//   - mustKnow  : the numbered "you must know this" key points, each with its
//                 own sub-bullets and an optional highlighted expression.
//   - method    : the ordered "how to solve these" steps, each with an optional
//                 highlighted expression AND, when the student has slipped there,
//                 an attached mistake annotation (what went wrong + what to watch
//                 for). The mistake's `category` links to a misconception row so
//                 the render layer joins the live count/date ("you last got this
//                 wrong on …, N× so far").

// Prompt-side caps (strict:true can't enforce array length — same note as
// study/tool.ts). A notebook is a re-readable running document, not a dump.
export const MAX_MUST_KNOW = 5
export const MAX_POINTS_PER_KEY = 4
export const MAX_STEPS = 8

export const NOTEBOOK_TOOL_NAME = 'submit_concept_notebook'

export const NOTEBOOK_TOOL: Anthropic.Tool = {
  name: NOTEBOOK_TOOL_NAME,
  description:
    'Submit the UPDATED personal notebook for ONE concept. This is the ONLY way to reply — always ' +
    'call it, exactly once. You are given the student\'s CURRENT notebook for this concept and what ' +
    "happened in today's session on it (the transcript, the outcomes, the tutor's highlighted steps, " +
    'and the misconceptions seen). Revise the notebook in place: keep what is still true, refine the ' +
    'method with today\'s work, and attach a mistake annotation to any step the student got wrong. ' +
    'Ground everything in the material provided — never invent coverage the sessions did not have.',
  strict: true,
  input_schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      summary: {
        type: 'string',
        description:
          'A short running summary of what this concept is and where the student stands on it, ' +
          'updated to reflect today\'s session. Two or three plain sentences; no markdown. Use "" only ' +
          'if there is genuinely nothing to summarize yet.',
      },
      mustKnow: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            heading: {
              type: 'string',
              description: 'A short heading for this key point — the one idea it captures.',
            },
            points: {
              type: 'array',
              items: { type: 'string' },
              description:
                `The sub-bullets under this key point (at most ${MAX_POINTS_PER_KEY}, prompt-side cap). ` +
                'Each a single plain sentence; no markdown. Use [] if the heading needs no sub-bullets.',
            },
            expression: {
              type: 'string',
              description:
                'A single short math expression that anchors this key point (rendered as a highlighted ' +
                'bubble), e.g. "x^2 - 5x + 6 = (x-2)(x-3)". Plain text, no markdown/LaTeX delimiters. Use ' +
                '"" when this point has no expression to show.',
            },
          },
          required: ['heading', 'points', 'expression'],
        },
        description:
          `The "you must know this" key points for the concept — the facts and results the student needs ` +
          `in hand before solving (at most ${MAX_MUST_KNOW}, prompt-side cap). Carry forward the still-true ` +
          `ones and refine with today's work. Use [] only if there is genuinely nothing yet.`,
      },
      method: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            step: {
              type: 'string',
              description:
                'One step of the procedure for solving this type of problem, in the tutor\'s voice. A ' +
                'single plain sentence or two; no markdown.',
            },
            expression: {
              type: 'string',
              description:
                'A single short math expression demonstrating this step (rendered as a highlighted ' +
                'bubble), e.g. "2 * 3 = 6, 2 + 3 = 5". Plain text, no markdown/LaTeX delimiters. Use "" ' +
                'when this step has no expression to show.',
            },
            mistake: {
              type: 'object',
              additionalProperties: false,
              description:
                'A mistake the STUDENT actually made at this step, if any. When they have not slipped ' +
                'here, set all three fields to "".',
              properties: {
                category: {
                  type: 'string',
                  description:
                    'The EXACT misconception category from the "MISCONCEPTIONS" list you were given that ' +
                    'this mistake corresponds to (so the notebook can show how often/when it happened). ' +
                    'Use "" if this step\'s slip is not one of the listed misconceptions.',
                },
                whatWentWrong: {
                  type: 'string',
                  description:
                    'What the student did wrong at this step, grounded in the session — one plain ' +
                    'sentence. "" when there is no mistake here.',
                },
                watchFor: {
                  type: 'string',
                  description:
                    'What to watch for next time to avoid this, in the tutor\'s voice — one plain, ' +
                    'concrete sentence. "" when there is no mistake here.',
                },
              },
              required: ['category', 'whatWentWrong', 'watchFor'],
            },
          },
          required: ['step', 'expression', 'mistake'],
        },
        description:
          `The ordered procedure for solving this type of problem — the steps the student walks through ` +
          `(at most ${MAX_STEPS}, prompt-side cap). Attach a mistake annotation to any step the student ` +
          `got wrong this or a prior session. Revise steps in place rather than duplicating. Use [] only ` +
          `if the sessions give no procedure to record yet.`,
      },
    },
    required: ['summary', 'mustKnow', 'method'],
  },
  // A worked example anchoring the intended grain: a running summary, two key
  // points (one with a highlighted expression), and a three-step method whose
  // sign step carries the student's actual slip.
  input_examples: [
    {
      summary:
        'Factoring simple quadratics x^2 + bx + c. You can find the factor pair reliably now, and you are ' +
        'getting more careful about the signs.',
      mustKnow: [
        {
          heading: 'What factoring a quadratic means',
          points: [
            'You are rewriting x^2 + bx + c as a product of two binomials (x + p)(x + q).',
            'p and q are the two numbers you are looking for.',
          ],
          expression: '',
        },
        {
          heading: 'The number pair rule',
          points: ['p and q multiply to c and add to b.'],
          expression: 'p * q = c,  p + q = b',
        },
      ],
      method: [
        {
          step: 'Identify b and c from the quadratic.',
          expression: 'x^2 + 5x + 6  ->  b = 5, c = 6',
          mistake: { category: '', whatWentWrong: '', watchFor: '' },
        },
        {
          step: 'Find two numbers that multiply to c and add to b.',
          expression: '2 * 3 = 6,  2 + 3 = 5',
          mistake: { category: '', whatWentWrong: '', watchFor: '' },
        },
        {
          step: 'Handle the signs: the sign of c tells you whether the numbers share a sign; the sign of b tells you which.',
          expression: 'x^2 - 5x + 6 = (x - 2)(x - 3)',
          mistake: {
            category: 'sign-error',
            whatWentWrong: 'You made both numbers positive when c was positive but b was negative.',
            watchFor: 'When c is positive but b is negative, BOTH numbers are negative — check the sum sign.',
          },
        },
      ],
    },
  ],
}

// ── The validated, persist-ready notebook. parseNotebook is the only producer. ─

export type NotebookKeyPoint = {
  heading: string
  points: string[]
  /** A short math expression to highlight, or null when absent. */
  expression: string | null
}

export type NotebookMistake = {
  /** The misconception category this slip maps to (for the live count/date
   *  join at render), or null when it maps to no tracked misconception. */
  category: string | null
  whatWentWrong: string
  watchFor: string
}

export type NotebookStep = {
  step: string
  /** A short math expression to highlight, or null when absent. */
  expression: string | null
  /** The student's slip at this step, or null when they did not slip here. */
  mistake: NotebookMistake | null
}

export type Notebook = {
  summary: string
  mustKnow: NotebookKeyPoint[]
  method: NotebookStep[]
}

// The empty notebook (deterministic fallback, mirroring EMPTY_STUDY_KIT): every
// malformed-or-absent tool output degrades to THIS, never a throw and never a
// half-parsed notebook. An empty notebook is the update path's signal to persist
// nothing — never a row with an empty payload.
export const EMPTY_NOTEBOOK: Notebook = { summary: '', mustKnow: [], method: [] }

function cleanString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function cleanStringArray(value: unknown, cap: number): string[] {
  return (Array.isArray(value) ? value : [])
    .map(cleanString)
    .filter((s): s is string => s !== null)
    .slice(0, cap)
}

function parseMistake(value: unknown): NotebookMistake | null {
  if (typeof value !== 'object' || value === null) return null
  const row = value as Record<string, unknown>
  const whatWentWrong = cleanString(row.whatWentWrong)
  const watchFor = cleanString(row.watchFor)
  // A mistake needs at least a description of what went wrong to be worth
  // showing; the ""-sentinel (no slip here) collapses to null.
  if (!whatWentWrong && !watchFor) return null
  return {
    category: cleanString(row.category),
    // Keep the pair coherent even if the model filled only one side.
    whatWentWrong: whatWentWrong ?? watchFor ?? '',
    watchFor: watchFor ?? whatWentWrong ?? '',
  }
}

// The semantic re-validation the strict schema doesn't cover — the same posture
// parseStudyKit / parseEnvelopeObject take: strict:true guarantees the SHAPE,
// this enforces the MEANING (non-empty strings, the array-length caps the schema
// can't, ""→null optionals). Total and defensive: `input` is `unknown` because
// this runs against a raw tool_use.input, a hand-built object in tests, AND the
// stored jsonb re-read from the DB on the next revision (including the older
// {summary,reminders,explanations} shape — which simply yields empty mustKnow/
// method here, self-healing on the next generation) — anything it can't make
// sense of collapses to EMPTY_NOTEBOOK rather than throwing.
export function parseNotebook(input: unknown): Notebook {
  if (typeof input !== 'object' || input === null) return EMPTY_NOTEBOOK

  const raw = input as Record<string, unknown>

  const summary = cleanString(raw.summary) ?? ''

  const mustKnow: NotebookKeyPoint[] = (Array.isArray(raw.mustKnow) ? raw.mustKnow : [])
    .map((item): NotebookKeyPoint | null => {
      if (typeof item !== 'object' || item === null) return null
      const row = item as Record<string, unknown>
      const heading = cleanString(row.heading)
      if (!heading) return null
      return {
        heading,
        points: cleanStringArray(row.points, MAX_POINTS_PER_KEY),
        expression: cleanString(row.expression),
      }
    })
    .filter((k): k is NotebookKeyPoint => k !== null)
    .slice(0, MAX_MUST_KNOW)

  const method: NotebookStep[] = (Array.isArray(raw.method) ? raw.method : [])
    .map((item): NotebookStep | null => {
      if (typeof item !== 'object' || item === null) return null
      const row = item as Record<string, unknown>
      const step = cleanString(row.step)
      if (!step) return null
      return {
        step,
        expression: cleanString(row.expression),
        mistake: parseMistake(row.mistake),
      }
    })
    .filter((s): s is NotebookStep => s !== null)
    .slice(0, MAX_STEPS)

  return { summary, mustKnow, method }
}

// True when a notebook has nothing worth persisting — the update path's gate for
// "store nothing". Empty only when the summary is blank AND there are no key
// points AND no method steps.
export function isEmptyNotebook(notebook: Notebook): boolean {
  return notebook.summary === '' && notebook.mustKnow.length === 0 && notebook.method.length === 0
}
