import 'server-only'
import type Anthropic from '@anthropic-ai/sdk'

// ADR-054: the Personal Notebook generator's forced-tool contract and its
// validator, kept together the way study/tool.ts keeps STUDY_KIT_TOOL near its
// discipline. It mirrors that file exactly (which mirrors claude.ts's
// ENVELOPE_TOOL):
//   - `strict: true` is Anthropic's guaranteed schema validation — the model
//     cannot skip a required key or mis-type a field.
//   - every object node carries `additionalProperties: false` (a missing one
//     rejects the WHOLE tool at call time).
//   - array-LENGTH caps are NOT expressible under strict:true, so the counts
//     below are a prompt-side cap in the descriptions AND a hard slice in
//     parseNotebook — the schema shapes each item, parseNotebook enforces how
//     many.
//
// Unlike the study kit (no concept key in the payload → no nullableEnum here),
// the notebook is a plain three-part document: a rolling `summary`, a list of
// `reminders`, and titled `explanations`. That is ADR-054's mapping of the
// brief's "summaries, important reminders, tutor explanations".

// Prompt-side caps (strict:true can't enforce array length — same note as
// study/tool.ts). A notebook is a running document, not an exhaustive dump:
// a handful of reminders and a few titled explanations keep it re-readable.
export const MAX_REMINDERS = 6
export const MAX_EXPLANATIONS = 6

export const NOTEBOOK_TOOL_NAME = 'submit_concept_notebook'

export const NOTEBOOK_TOOL: Anthropic.Tool = {
  name: NOTEBOOK_TOOL_NAME,
  description:
    'Submit the UPDATED personal notebook for ONE concept. This is the ONLY way to reply — always ' +
    'call it, exactly once. You are given the student\'s CURRENT notebook for this concept and what ' +
    'happened in today\'s session on it. Revise the notebook: keep what is still true, refine the ' +
    'explanations with today\'s work, and add a reminder for any misconception seen. Ground everything ' +
    'in the material provided — never invent coverage the sessions did not have.',
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
      reminders: {
        type: 'array',
        items: { type: 'string' },
        description:
          `The important things for the student to remember on this concept — especially the ones they ` +
          `keep getting wrong (at most ${MAX_REMINDERS} — array-length caps are not enforceable here, so ` +
          `this is a prompt-side cap only). Each a single plain sentence; no markdown. Carry forward the ` +
          `still-relevant reminders from the current notebook and add any new one from today. Use [] only ` +
          `if there is nothing worth reminding.`,
      },
      explanations: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            title: {
              type: 'string',
              description: 'A short heading for this explanation — the method or idea it captures.',
            },
            body: {
              type: 'string',
              description:
                'The explanation itself, in the tutor\'s voice — how the method works, why, grounded in ' +
                'how the student worked it this (or a prior) session. A few plain sentences; no markdown.',
            },
          },
          required: ['title', 'body'],
        },
        description:
          `The tutor explanations worth keeping — the methods this concept needs, refined with today's ` +
          `work ({ title, body }; at most ${MAX_EXPLANATIONS} — prompt-side cap). Revise an existing ` +
          `explanation in place rather than duplicating it. Use [] only if the sessions give nothing to ` +
          `explain.`,
      },
    },
    required: ['summary', 'reminders', 'explanations'],
  },
  // A worked example anchoring the intended grain: a running summary, a
  // reminder targeting a common slip, and one titled method explanation.
  input_examples: [
    {
      summary:
        'Factoring simple quadratics x^2 + bx + c. You can find the factors reliably now, and you are ' +
        'getting more careful about the signs.',
      reminders: [
        'When c is positive but b is negative, BOTH numbers are negative (e.g. x^2 - 5x + 6 = (x - 2)(x - 3)).',
        'Always expand your factors back out to check.',
      ],
      explanations: [
        {
          title: 'Find two numbers that multiply to c and add to b',
          body:
            'To factor x^2 + bx + c, look for two numbers whose product is c and whose sum is b. For ' +
            'x^2 + 5x + 6 that is 2 and 3, so it factors to (x + 2)(x + 3). Watch the signs: the product ' +
            'sign tells you whether the two numbers share a sign, the sum sign tells you which.',
        },
      ],
    },
  ],
}

// The validated, persist-ready notebook. parseNotebook is the only producer.
export type NotebookExplanation = {
  title: string
  body: string
}

export type Notebook = {
  summary: string
  reminders: string[]
  explanations: NotebookExplanation[]
}

// The empty notebook (ADR-054's deterministic fallback, mirroring
// EMPTY_STUDY_KIT): every malformed-or-absent tool output degrades to THIS,
// never a throw and never a half-parsed notebook. An empty notebook is the
// update path's signal to persist nothing — never a row with an empty payload.
export const EMPTY_NOTEBOOK: Notebook = { summary: '', reminders: [], explanations: [] }

function cleanString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

// The semantic re-validation the strict schema doesn't cover — the same posture
// parseStudyKit / parseEnvelopeObject take: strict:true guarantees the SHAPE
// (keys exist, types match), this enforces the MEANING (non-empty strings, the
// array-length caps the schema can't). Total and defensive: `input` is
// `unknown` because this runs against a raw tool_use.input (Record), a
// hand-built object in tests, AND the stored jsonb re-read from the DB on the
// next revision — anything it can't make sense of collapses to EMPTY_NOTEBOOK
// rather than throwing.
export function parseNotebook(input: unknown): Notebook {
  if (typeof input !== 'object' || input === null) return EMPTY_NOTEBOOK

  const raw = input as Record<string, unknown>

  const summary = cleanString(raw.summary) ?? ''

  const reminders = (Array.isArray(raw.reminders) ? raw.reminders : [])
    .map(cleanString)
    .filter((r): r is string => r !== null)
    .slice(0, MAX_REMINDERS)

  const explanations: NotebookExplanation[] = (Array.isArray(raw.explanations) ? raw.explanations : [])
    .map((item): NotebookExplanation | null => {
      if (typeof item !== 'object' || item === null) return null
      const row = item as Record<string, unknown>
      const title = cleanString(row.title)
      const body = cleanString(row.body)
      // An explanation without BOTH a title and a body is not usable, so it is
      // dropped, not stored (mirrors parseStudyKit's problem/flashcard rule).
      if (!title || !body) return null
      return { title, body }
    })
    .filter((e): e is NotebookExplanation => e !== null)
    .slice(0, MAX_EXPLANATIONS)

  return { summary, reminders, explanations }
}

// True when a notebook has nothing worth persisting — the update path's gate
// for "store nothing" (never a row with an empty payload). A notebook is empty
// only when ALL three sections are: an empty summary AND no reminders AND no
// explanations. Kept here so the emptiness rule lives with the notebook shape.
export function isEmptyNotebook(notebook: Notebook): boolean {
  return notebook.summary === '' && notebook.reminders.length === 0 && notebook.explanations.length === 0
}
