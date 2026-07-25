import { writeFileSync } from 'node:fs'
import { describe, it, expect, vi } from 'vitest'

// The production AI modules import `server-only`, which throws under vitest —
// neutralize it (the eval/run.eval.ts pattern) before importing the generator.
vi.mock('server-only', () => ({}))

import { generateConceptNotebook } from '@/lib/notebook/generate'
import { EMPTY_NOTEBOOK, parseNotebook, type Notebook } from '@/lib/notebook/tool'
import type { ConceptSlice } from '@/lib/notebook/source'

// Live generation check for the "live notebook" v2 content model (ADR-054 v2).
// NOT part of `npm test` — it runs only under the eval config (eval/**/*.eval.ts,
// no Supabase global-setup) and only with EVAL_LIVE=1 + an API key, because it
// makes a real LLM call. It hand-builds one concept's session slice (no DB) and
// asserts generateConceptNotebook produces a well-formed v2 notebook — a
// summary, must-know key points, and an ordered method that flags the student's
// actual sign-error step. Run:
//   OPENAI_API_KEY=... EVAL_LIVE=1 npx vitest run --config vitest.eval.config.ts eval/notebook-generate.eval.ts
const LIVE = process.env.EVAL_LIVE === '1'
const haveKey = process.env.NOTEBOOK_PROVIDER === 'anthropic' ? !!process.env.ANTHROPIC_API_KEY : !!process.env.OPENAI_API_KEY
const CAN_RUN = LIVE && haveKey

const CONCEPT_KEY = 'algebra.quadratics.factoring-simple'

// A realistic first session on factoring simple quadratics: the student factors
// x^2 - 5x + 6 but keeps both numbers positive (the classic sign slip). The
// tutor highlights the wrong factors with a why-note; a sign-error misconception
// is recorded. This is exactly the shape loadSessionSource → conceptSlice yields.
const SLICE: ConceptSlice = {
  conceptKey: CONCEPT_KEY,
  title: 'Factoring simple quadratics',
  turns: [
    {
      turnIndex: 0,
      conceptKey: CONCEPT_KEY,
      studentTranscript: 'The problem is: factor x^2 - 5x + 6.',
      tutorResponse: 'Great — what two numbers multiply to 6 and add to -5?',
      outcome: 'none',
      misconception: null,
      annotations: [],
    },
    {
      turnIndex: 1,
      conceptKey: CONCEPT_KEY,
      studentTranscript: 'Numbers that multiply to 6 and add to 5 are 2 and 3, so (x + 2)(x + 3).',
      tutorResponse:
        'Careful — check the sign of b. b is -5, not +5. If you expand (x + 2)(x + 3) you get x^2 + 5x + 6, not x^2 - 5x + 6.',
      outcome: 'incorrect',
      misconception: 'Made both numbers positive when b was negative',
      annotations: [
        {
          targetText: '(x + 2)(x + 3)',
          label: 'sign',
          note: 'b = -5 is negative, so both numbers must be negative here',
        },
      ],
    },
    {
      turnIndex: 2,
      conceptKey: CONCEPT_KEY,
      studentTranscript: 'Oh, so it should be -2 and -3: (x - 2)(x - 3).',
      tutorResponse: 'Exactly. (x - 2)(x - 3) expands to x^2 - 5x + 6. Nice fix.',
      outcome: 'correct',
      misconception: null,
      annotations: [],
    },
  ],
  concept: {
    conceptKey: CONCEPT_KEY,
    title: 'Factoring simple quadratics',
    turns: 3,
    correct: 1,
    incorrect: 1,
    mastery: 0.44,
    state: 'weak',
  },
  misconceptionsAdded: [
    {
      conceptKey: CONCEPT_KEY,
      title: 'Sign error on the factor pair',
      category: 'sign-error',
      description: 'keeps both numbers positive when b is negative',
    },
  ],
  misconceptionsResolved: [],
  misconceptionsTracked: [],
}

// A populated session-1 notebook (the shape the first-gen path produces) — the
// starting point for the revise-in-place case. Its method already has a verify
// step (index 3) and a sign-error mistake on the number-pair step.
// Deliberately written in the v2 {summary,mustKnow,method} shape and lifted
// through parseNotebook — that is exactly what update.ts does when it reads a
// pre-v3 row back off the DB, so this also exercises the back-compat path.
const EXISTING_NOTEBOOK: Notebook = parseNotebook({
  summary:
    'The student began learning to factor simple quadratics x^2 + bx + c. They stumbled on the signs at first but corrected it by the end of the session.',
  mustKnow: [
    {
      heading: 'Understanding quadratic factoring',
      points: [
        'A simple quadratic has the form x^2 + bx + c.',
        'Find two numbers that multiply to c and add to b.',
      ],
      expression: 'x^2 - 5x + 6 = (x - 2)(x - 3)',
    },
  ],
  method: [
    { step: 'Identify b and c from the quadratic.', expression: null, mistake: null },
    {
      step: 'Find two numbers that multiply to c and add to b.',
      expression: '-2 * -3 = 6,  -2 + -3 = -5',
      mistake: {
        category: 'sign-error',
        studentAttempt: 'x^2 - 5x + 6 = (x + 2)(x + 3)',
        whatWentWrong: 'Kept both numbers positive when b was negative.',
        watchFor: 'Check the sign of b to decide the signs of the two numbers.',
      },
    },
    { step: 'Write the factors with the correct signs.', expression: '(x - 2)(x - 3)', mistake: null },
    { step: 'Verify by expanding back to the original quadratic.', expression: null, mistake: null },
  ],
})

// Session 2 on the SAME concept: the student now handles the signs correctly
// (resolving the sign-error slip) but forgets to verify by expanding (a NEW
// no-verification slip the tutor flags). A good revision keeps the method the
// same size, drops/eases the resolved sign-error emphasis, and attaches the new
// mistake to the EXISTING verify step rather than appending a duplicate one.
const SLICE_2: ConceptSlice = {
  conceptKey: CONCEPT_KEY,
  title: 'Factoring simple quadratics',
  turns: [
    {
      turnIndex: 0,
      conceptKey: CONCEPT_KEY,
      studentTranscript: 'Factor x^2 + 7x + 12. Two numbers that multiply to 12 and add to 7 are 3 and 4, so (x + 3)(x + 4).',
      tutorResponse: 'The signs are right this time. Did you check it by expanding?',
      outcome: 'correct',
      misconception: null,
      annotations: [],
    },
    {
      turnIndex: 1,
      conceptKey: CONCEPT_KEY,
      studentTranscript: 'No, I just wrote the factors.',
      tutorResponse:
        'Always expand back to confirm: (x + 3)(x + 4) = x^2 + 7x + 12. Skipping the check is how sign slips sneak through.',
      outcome: 'incorrect',
      misconception: 'Skipped verifying the factors by expanding',
      annotations: [
        {
          targetText: '(x + 3)(x + 4)',
          label: 'verify',
          note: 'Expand back to confirm before moving on',
        },
      ],
    },
  ],
  concept: {
    conceptKey: CONCEPT_KEY,
    title: 'Factoring simple quadratics',
    turns: 2,
    correct: 1,
    incorrect: 1,
    mastery: 0.58,
    state: 'learning',
  },
  misconceptionsAdded: [
    {
      conceptKey: CONCEPT_KEY,
      title: 'Skips verification',
      category: 'no-verification',
      description: 'writes the factors without expanding to check',
    },
  ],
  misconceptionsTracked: [],
  misconceptionsResolved: [
    {
      conceptKey: CONCEPT_KEY,
      title: 'Sign error on the factor pair',
      category: 'sign-error',
      description: 'keeps both numbers positive when b is negative',
    },
  ],
}

describe('notebook-generate (live)', () => {
  it.skipIf(!CAN_RUN)(
    'produces a well-formed v2 notebook grounded in the session',
    async () => {
      const notebook = await generateConceptNotebook(EMPTY_NOTEBOOK, SLICE)

      // Persist the full result so the run is inspectable (vitest suppresses
      // console.log in run mode).
      writeFileSync('eval/results/notebook-last.json', JSON.stringify(notebook, null, 2))

      // Core "it produced real notes" gate.
      expect(notebook.summary.length).toBeGreaterThan(0)
      expect(notebook.method.length).toBeGreaterThan(0)
      // Every step is well-formed.
      for (const step of notebook.method) {
        expect(step.step.length).toBeGreaterThan(0)
      }
      // The student slipped on a sign error — at least one step should flag a
      // mistake, and ideally tag the sign-error category so the render can join
      // the live count/date. (Soft: log if the model didn't tag a category.)
      const flagged = notebook.method.filter((s) => s.mistake)
      // eslint-disable-next-line no-console
      console.log(
        `steps=${notebook.method.length} mustKnow=${notebook.mustKnow.length} flagged=${flagged.length} ` +
          `categories=${JSON.stringify(flagged.map((s) => s.mistake?.category))}`
      )
      expect(flagged.length).toBeGreaterThan(0)
    },
    5 * 60 * 1000
  )

  it.skipIf(!CAN_RUN)(
    'revises an existing notebook in place rather than duplicating it',
    async () => {
      const notebook = await generateConceptNotebook(EXISTING_NOTEBOOK, SLICE_2)
      writeFileSync('eval/results/notebook-revised.json', JSON.stringify(notebook, null, 2))

      // Still well-formed.
      expect(notebook.summary.length).toBeGreaterThan(0)
      expect(notebook.method.length).toBeGreaterThan(0)
      for (const step of notebook.method) expect(step.step.length).toBeGreaterThan(0)

      // Revised, not duplicated: a duplicate would roughly double the method
      // (~8 steps). A refinement stays near the existing size (allow +1 for a
      // genuinely new step). Session 2 adds no new PROCEDURE — it already had a
      // verify step — so the count should not balloon.
      expect(notebook.method.length).toBeLessThanOrEqual(EXISTING_NOTEBOOK.method.length + 1)

      // The new no-verification slip should surface somewhere in the method's
      // mistakes (ideally tagged with its category so the live join resolves).
      const categories = notebook.method.filter((s) => s.mistake).map((s) => s.mistake?.category)
      // eslint-disable-next-line no-console
      console.log(
        `revised: steps=${notebook.method.length} (was ${EXISTING_NOTEBOOK.method.length}) ` +
          `mustKnow=${notebook.mustKnow.length} flaggedCategories=${JSON.stringify(categories)}`
      )
      expect(categories).toContain('no-verification')
    },
    5 * 60 * 1000
  )

  it.skipIf(CAN_RUN)('is skipped without EVAL_LIVE=1 + an API key', () => {
    expect(true).toBe(true)
  })
})
