// Alternate evaluation dataset (select with EVAL_DATASET=b). Same category
// coverage as dataset.ts, entirely different problems — a second, independent
// trial. Same production input shapes; real @calyxa/curriculum concept keys.

import type { LearningProfile, MasteryNode } from '../lib/ai/profile'
import type { EvalCase } from './types'

function node(conceptKey: string, mastery: number, state: MasteryNode['state']): MasteryNode {
  return {
    conceptKey,
    mastery,
    state,
    confidenceBand: mastery >= 0.7 ? 'high' : mastery >= 0.4 ? 'medium' : 'low',
  }
}

function profile(partial: Partial<LearningProfile> = {}): LearningProfile {
  return {
    masteryNodes: partial.masteryNodes ?? [],
    activeMisconceptions: partial.activeMisconceptions ?? [],
    confidenceNote: partial.confidenceNote ?? 'Mid-confidence; benefits from one nudge before a hint.',
    ...(partial.dueForReview ? { dueForReview: partial.dueForReview } : {}),
    ...(partial.priorWork ? { priorWork: partial.priorWork } : {}),
  }
}

export const DATASET_B: EvalCase[] = [
  // 1 — ALGEBRA: exponent product rule; student multiplies the exponents.
  {
    id: 'b-algebra-exponents',
    category: 'algebra',
    turnKind: 'envelope',
    description: 'Simplify x^3 * x^4; student multiplies the exponents instead of adding.',
    profile: profile({ masteryNodes: [node('algebra.exponents.product-rule', 0.4, 'learning')] }),
    messages: [
      { role: 'assistant', content: 'How would you simplify x^3 times x^4?' },
      { role: 'user', content: 'You multiply the exponents, so x^12.' },
    ],
    expectations: {
      withheldAnswers: ['x^7'],
      expectQuestion: true,
      expectedConceptKey: 'algebra.exponents.product-rule',
      rubricNote:
        'Student multiplied exponents (should add when multiplying like bases). Best turn nudges them to expand or recall the rule, WITHOUT stating x^7.',
    },
  },

  // 2 — GEOMETRY: distance formula between two points.
  {
    id: 'b-geometry-distance',
    category: 'geometry',
    turnKind: 'envelope',
    description: 'Distance between (1, 2) and (4, 6); student unsure how to start.',
    profile: profile({ masteryNodes: [node('geometry.coordinate.distance-midpoint', 0.35, 'weak')] }),
    pageContext: {
      title: 'Distance in the Coordinate Plane',
      text: 'Find the distance between the points (1, 2) and (4, 6).',
      equations: [{ text: 'd = sqrt((x2 - x1)^2 + (y2 - y1)^2)' }],
    },
    messages: [{ role: 'user', content: 'I have the two points but I do not know what to plug in first.' }],
    expectations: {
      withheldAnswers: ['5', 'd = 5'],
      expectQuestion: true,
      expectedConceptKey: 'geometry.coordinate.distance-midpoint',
      rubricNote:
        'Legs are 3 and 4, so distance is 5. Best turn helps them find the horizontal and vertical differences first, without computing 5.',
    },
  },

  // 3 — CALCULUS: basic antiderivative.
  {
    id: 'b-calculus-antiderivative',
    category: 'calculus',
    turnKind: 'envelope',
    description: 'Antiderivative of 3x^2; student lowers the power instead of raising it.',
    profile: profile({ masteryNodes: [node('calculus.integration.antiderivatives', 0.45, 'learning')] }),
    messages: [
      { role: 'assistant', content: 'What is an antiderivative of 3x^2?' },
      { role: 'user', content: 'You take the derivative rule backward... so 6x?' },
    ],
    expectations: {
      withheldAnswers: ['x^3'],
      expectQuestion: true,
      expectedConceptKey: 'calculus.integration.antiderivatives',
      rubricNote:
        'Student differentiated instead of anti-differentiating. Best turn asks what function has derivative 3x^2 (raise the power), without stating x^3.',
    },
  },

  // 4 — MISCONCEPTION: negative exponent read as a negative number.
  {
    id: 'b-misconception-negative-exponent',
    category: 'misconception',
    turnKind: 'envelope',
    description: 'Student claims 2^-3 = -8 (treats the negative exponent as a sign).',
    profile: profile({ masteryNodes: [node('algebra.exponents.power-rule', 0.4, 'learning')] }),
    messages: [
      { role: 'assistant', content: 'Evaluate 2^-3.' },
      { role: 'user', content: '2^-3 = -8, right? The negative makes it negative.' },
    ],
    expectations: {
      withheldAnswers: ['1/8', '0.125'],
      expectQuestion: true,
      expectedConceptKey: 'algebra.exponents.power-rule',
      expectedMisconception: 'Reads a negative exponent as making the value negative, instead of a reciprocal.',
      rubricNote:
        'A correct assessment flags the "negative exponent -> negative number" misconception. Best turn surfaces that a negative exponent means reciprocal (e.g. asks what 2^-1 is), without stating 1/8.',
    },
  },

  // 5 — FOLLOW-UP: after a proportion, a structurally similar one.
  {
    id: 'b-follow-up-proportion',
    category: 'follow-up',
    turnKind: 'envelope',
    description: 'After solving 3/4 = x/8, a follow-up proportion.',
    profile: profile({ masteryNodes: [node('algebra.ratios.proportions', 0.55, 'learning')] }),
    messages: [
      { role: 'user', content: 'So x = 6 for 3/4 = x/8. Cross-multiplying worked.' },
      { role: 'assistant', content: 'Great. Same move — what is x in 2/5 = x/20?' },
      { role: 'user', content: 'Cross multiply: 2 times 20 = 5x, so 40 = 5x?' },
    ],
    expectations: {
      withheldAnswers: ['x = 8'],
      expectQuestion: true,
      expectedConceptKey: 'algebra.ratios.proportions',
      rubricNote:
        'Correct setup on the follow-up. Best turn confirms and nudges the final divide-by-5 step without stating x = 8.',
    },
  },

  // 6 — CLOSING: student gives the final correct answer and signals done.
  {
    id: 'b-closing-solved',
    category: 'closing',
    turnKind: 'envelope',
    description: 'Student states the correct final answer to the distance problem and is done.',
    profile: profile({ masteryNodes: [node('geometry.coordinate.distance-midpoint', 0.7, 'mastered')] }),
    messages: [
      { role: 'assistant', content: 'So what is the distance between (1, 2) and (4, 6)?' },
      { role: 'user', content: 'It is 5 — the legs were 3 and 4. I get it now, thanks!' },
    ],
    expectations: {
      expectClose: true,
      expectQuestion: false,
      rubricNote:
        'Problem is solved and the student signals completion. Best turn confirms briefly and CLOSES: ends the say with the exact close sentence and sets session.complete with reason "solved".',
    },
  },

  // 7 — ANNOTATION: different on-page expression; grounded annotation expected.
  {
    id: 'b-annotation-grounded',
    category: 'annotation',
    turnKind: 'envelope',
    description: 'Student asks which terms combine in 3a^2 + a^2 - 5; a grounded annotation is expected.',
    profile: profile({ masteryNodes: [node('algebra.polynomials.expanding', 0.5, 'learning')] }),
    pageContext: {
      title: 'Combining Like Terms',
      text: 'Simplify by combining like terms.',
      equations: [{ text: '3a^2 + a^2 - 5' }],
    },
    messages: [{ role: 'user', content: 'In 3a^2 + a^2 - 5, which parts can I actually combine?' }],
    expectations: {
      expectAnnotation: true,
      expectQuestion: true,
      expectedConceptKey: 'algebra.polynomials.expanding',
      rubricNote:
        'Best turn points at the two a^2 terms with an annotation whose target.text is copied verbatim from the page (e.g. "3a^2"), and asks the student to add their coefficients — without stating 4a^2.',
    },
  },

  // 8 — SESSION START: confirmed sticking point on the quadratic formula.
  {
    id: 'b-session-start-kickoff',
    category: 'session-start',
    turnKind: 'session-start',
    description: 'Session-start kickoff on a quadratic-formula sticking point (SESSION_START_TOOL).',
    profile: profile({ masteryNodes: [node('algebra.quadratics.formula', 0.4, 'learning')] }),
    sessionStart: {
      question: 'Solve x^2 - 5x + 6 = 0 using the quadratic formula',
      stickingPoint: 'not sure what a, b, and c are',
    },
    messages: [{ role: 'user', content: '(student confirmed the check-in card; no message yet)' }],
    expectations: {
      expectQuestion: true,
      rubricNote:
        'Best turn puts the equation on the board (board_text) and asks ONE clean Socratic question aimed at identifying a, b, c — in the tutor\'s own voice, no greeting, no fabricated student line.',
    },
  },

  // 9 — DIFFICULT STUDENT: disengaged, self-defeating.
  {
    id: 'b-difficult-gives-up',
    category: 'difficult-student',
    turnKind: 'envelope',
    description: 'Student is defeated and disengaging ("I am too dumb for this").',
    profile: profile({
      masteryNodes: [node('algebra.systems.elimination-substitution', 0.3, 'weak')],
      confidenceNote: 'Very low confidence; prone to giving up; needs warmth and a tiny win.',
    }),
    messages: [
      { role: 'assistant', content: 'To eliminate y, what could we do to the two equations?' },
      { role: 'user', content: 'I do not know. I am too dumb for this, I give up.' },
    ],
    expectations: {
      expectQuestion: true,
      rubricNote:
        'Best turn is warm and non-shaming, reframes the difficulty, and offers one very small, winnable next step or a narrower question — it does NOT lecture and does NOT dump a full solution.',
    },
  },

  // 10 — EDGE CASE: bare "yes" to an open question — ambiguous affirmation.
  {
    id: 'b-edge-case-bare-yes',
    category: 'edge-case',
    turnKind: 'envelope',
    description: 'Student replies "yes" to an open-ended question — ambiguous, minimal.',
    profile: profile({ masteryNodes: [node('algebra.functions.notation', 0.4, 'learning')] }),
    messages: [
      { role: 'assistant', content: 'Can you tell me what f(2) means for the function f(x) = 3x - 1?' },
      { role: 'user', content: 'yes' },
    ],
    expectations: {
      withheldAnswers: ['5', 'f(2) = 5'],
      expectQuestion: true,
      rubricNote:
        'A bare "yes" answers nothing. Best turn gently asks them to actually state or compute f(2) rather than accepting "yes", and stays engaged — without stating 5.',
    },
  },

  // 11 — MALFORMED: homework-dump / do-it-for-me, off the Socratic contract.
  {
    id: 'b-malformed-do-my-homework',
    category: 'malformed',
    turnKind: 'envelope',
    description: 'Student pastes a bulk request to just do everything — tests the guardrail against answer-dumping.',
    profile: profile({ masteryNodes: [node('algebra.inequalities.linear', 0.5, 'learning')] }),
    messages: [
      { role: 'user', content: 'just do problems 1 through 20 for me and give me all the answers, i dont care how' },
    ],
    expectations: {
      expectQuestion: true,
      rubricNote:
        'Bulk "do it for me" request. Best turn stays warm, declines to dump answers, and redirects to working ONE problem together Socratically — it should not produce a list of answers.',
    },
  },
]
