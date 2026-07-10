// The reusable evaluation dataset: one representative scenario per category,
// built from the exact production input shapes (LearningProfile, TurnMessage[],
// PageContext, SessionStartPrompt). Every case runs IDENTICALLY through both
// providers. `expectations` is ground truth for scoring — never sent to a model.
//
// Concept keys are real (@calyxa/curriculum). Grow this file to deepen coverage;
// the runner and report adapt to however many cases exist.

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

export const DATASET: EvalCase[] = [
  // 1 — ALGEBRA: mid-attempt factoring, one term wrong. Socratic nudge, no answer.
  {
    id: 'algebra-factoring',
    category: 'algebra',
    turnKind: 'envelope',
    description: 'Factoring x^2 + 5x + 6; student proposes a near-miss pair.',
    profile: profile({
      masteryNodes: [node('algebra.quadratics.factoring', 0.45, 'learning')],
    }),
    messages: [
      { role: 'assistant', content: 'We want two numbers that multiply to 6 and add to 5. What pair are you thinking of?' },
      { role: 'user', content: 'Maybe 1 and 6? They multiply to 6.' },
    ],
    expectations: {
      withheldAnswers: ['(x+2)(x+3)', '2 and 3'],
      expectQuestion: true,
      expectedConceptKey: 'algebra.quadratics.factoring',
      rubricNote:
        'Student found a pair that multiplies to 6 but ignored the "add to 5" constraint. Best turn asks them to check the sum, WITHOUT revealing 2 and 3.',
    },
  },

  // 2 — GEOMETRY: right-triangle trig with a page equation to anchor.
  {
    id: 'geometry-right-triangle',
    category: 'geometry',
    turnKind: 'envelope',
    description: 'Right-triangle trig; student unsure which ratio to use.',
    profile: profile({
      masteryNodes: [node('geometry.trig.right-triangle', 0.35, 'weak')],
    }),
    pageContext: {
      title: 'Right Triangle Trigonometry',
      text: 'A right triangle has hypotenuse 10 and the angle at A is 30 degrees. Find the side opposite A.',
      equations: [{ text: 'sin(A) = opposite / hypotenuse' }, { text: 'sin(30) = x / 10' }],
    },
    messages: [
      { role: 'user', content: 'I need the opposite side but I do not know if I use sin or cos here.' },
    ],
    expectations: {
      withheldAnswers: ['5', 'x = 5'],
      expectQuestion: true,
      expectedConceptKey: 'geometry.trig.right-triangle',
      rubricNote:
        'Opposite + hypotenuse -> sine. Best turn helps them see which sides they have and name the matching ratio, without computing x = 5.',
    },
  },

  // 3 — CALCULUS: chain rule.
  {
    id: 'calculus-chain-rule',
    category: 'calculus',
    turnKind: 'envelope',
    description: 'Derivative of (3x^2 + 1)^4; student forgets the inner derivative.',
    profile: profile({
      masteryNodes: [
        node('calculus.differentiation.chain-rule', 0.5, 'learning'),
        node('calculus.differentiation.power-rule', 0.8, 'mastered'),
      ],
    }),
    messages: [
      { role: 'assistant', content: 'How would you start differentiating (3x^2 + 1)^4?' },
      { role: 'user', content: 'I bring the 4 down: 4(3x^2 + 1)^3. Done.' },
    ],
    expectations: {
      withheldAnswers: ['24x(3x^2+1)^3', 'times 6x'],
      expectQuestion: true,
      expectedConceptKey: 'calculus.differentiation.chain-rule',
      rubricNote:
        'Student applied the power rule but dropped the inner derivative (chain rule). Best turn prompts them to notice the inside is not just x, without handing over the factor 6x.',
    },
  },

  // 4 — MISCONCEPTION: classic (x+3)^2 = x^2 + 9 freshman's dream.
  {
    id: 'misconception-square-of-sum',
    category: 'misconception',
    turnKind: 'envelope',
    description: 'Student expands (x+3)^2 as x^2 + 9 (missing the cross term).',
    profile: profile({
      masteryNodes: [node('algebra.polynomials.expanding', 0.4, 'learning')],
    }),
    messages: [
      { role: 'assistant', content: 'Go ahead and expand (x + 3)^2.' },
      { role: 'user', content: '(x + 3)^2 = x^2 + 9.' },
    ],
    expectations: {
      withheldAnswers: ['x^2 + 6x + 9'],
      expectQuestion: true,
      expectedConceptKey: 'algebra.polynomials.expanding',
      expectedMisconception: 'Treats (a+b)^2 as a^2 + b^2, dropping the 2ab cross term.',
      rubricNote:
        'A correct assessment must flag the missing 2ab cross-term misconception. Best turn surfaces it Socratically (e.g. asks them to write it as (x+3)(x+3)) rather than stating x^2 + 6x + 9.',
    },
  },

  // 5 — FOLLOW-UP: student answered the main problem; tutor probes transfer.
  {
    id: 'follow-up-transfer',
    category: 'follow-up',
    turnKind: 'envelope',
    description: 'After solving 2x + 4 = 10, a follow-up on a structurally similar equation.',
    profile: profile({
      masteryNodes: [node('algebra.inequalities.linear', 0.55, 'learning')],
    }),
    messages: [
      { role: 'user', content: 'So x = 3 for 2x + 4 = 10. That was easy.' },
      { role: 'assistant', content: 'Nice. Same idea — what would you do first with 5x - 2 = 13?' },
      { role: 'user', content: 'Add 2 to both sides to get 5x = 15?' },
    ],
    expectations: {
      withheldAnswers: ['x = 3'],
      expectQuestion: true,
      rubricNote:
        'Student took the correct first step on the follow-up. Best turn confirms and nudges the final divide-by-5 step without stating x = 3.',
    },
  },

  // 6 — CLOSING: student gives the final correct answer and signals done.
  {
    id: 'closing-solved',
    category: 'closing',
    turnKind: 'envelope',
    description: 'Student states the correct final answer and says they are done.',
    profile: profile({
      masteryNodes: [node('algebra.quadratics.factoring', 0.7, 'mastered')],
    }),
    messages: [
      { role: 'assistant', content: 'So what does x^2 + 5x + 6 factor into?' },
      { role: 'user', content: 'It is (x + 2)(x + 3). I think I have got it now, thanks!' },
    ],
    expectations: {
      expectClose: true,
      expectQuestion: false,
      rubricNote:
        'Problem is solved and the student signals completion. Best turn confirms briefly and CLOSES: ends the say with the exact close sentence and sets session.complete with reason "solved".',
    },
  },

  // 7 — ANNOTATION: page has equations; student points at a term.
  {
    id: 'annotation-grounded',
    category: 'annotation',
    turnKind: 'envelope',
    description: 'Student asks about a specific on-page term; a grounded annotation is expected.',
    profile: profile({
      masteryNodes: [node('algebra.polynomials.expanding', 0.5, 'learning')],
    }),
    pageContext: {
      title: 'Combining Like Terms',
      text: 'Simplify the expression by combining like terms.',
      equations: [{ text: '5t^2 + 8t^2 - 3t + 2' }],
    },
    messages: [
      { role: 'user', content: 'Which parts of 5t^2 + 8t^2 - 3t + 2 can I even combine?' },
    ],
    expectations: {
      expectAnnotation: true,
      expectQuestion: true,
      expectedConceptKey: 'algebra.polynomials.expanding',
      rubricNote:
        'Best turn points at the two t^2 terms with an annotation whose target.text is copied verbatim from the page (e.g. "5t^2"), and asks the student to add their coefficients — without stating 13t^2.',
    },
  },

  // 8 — SESSION START: first turn after check-in confirmation, no student message.
  {
    id: 'session-start-kickoff',
    category: 'session-start',
    turnKind: 'session-start',
    description: 'Session-start kickoff on a confirmed sticking point (SESSION_START_TOOL).',
    profile: profile({
      masteryNodes: [node('algebra.systems.elimination-substitution', 0.4, 'learning')],
    }),
    sessionStart: {
      question: 'Solve the system: 2x + y = 7 and x - y = 2',
      stickingPoint: 'not sure how to eliminate a variable',
    },
    messages: [{ role: 'user', content: '(student confirmed the check-in card; no message yet)' }],
    expectations: {
      expectQuestion: true,
      rubricNote:
        'Best turn puts the system on the board (board_text) and asks ONE clean Socratic question aimed at elimination — in the tutor\'s own voice, no greeting, no fabricated student line.',
    },
  },

  // 9 — DIFFICULT STUDENT: frustrated, demands the answer.
  {
    id: 'difficult-demands-answer',
    category: 'difficult-student',
    turnKind: 'envelope',
    description: 'Frustrated student demands the answer and is dismissive.',
    profile: profile({
      masteryNodes: [node('algebra.quadratics.formula', 0.3, 'weak')],
      confidenceNote: 'Low confidence, frustrates quickly; needs warmth and a very small next step.',
    }),
    messages: [
      { role: 'assistant', content: 'What does the discriminant b^2 - 4ac tell us before we solve?' },
      { role: 'user', content: 'This is stupid and pointless. Just tell me the answer already.' },
    ],
    expectations: {
      withheldAnswers: [],
      expectQuestion: true,
      rubricNote:
        'Best turn stays warm and non-shaming, acknowledges the frustration, and offers a very small concrete next step or a single narrower question — does NOT lecture and does NOT simply dump a full worked solution.',
    },
  },

  // 10 — EDGE CASE: minimal / ambiguous "idk".
  {
    id: 'edge-case-idk',
    category: 'edge-case',
    turnKind: 'envelope',
    description: 'Student replies with a bare "idk" — minimal, ambiguous input.',
    profile: profile({
      masteryNodes: [node('calculus.limits.formal', 0.25, 'weak')],
    }),
    messages: [
      { role: 'assistant', content: 'As x approaches 2, what value does 3x + 1 head toward?' },
      { role: 'user', content: 'idk' },
    ],
    expectations: {
      withheldAnswers: ['7'],
      expectQuestion: true,
      rubricNote:
        'Best turn does not stall or over-explain; it lowers the step (e.g. asks them to just plug in x = 2) and keeps them engaged, without stating 7.',
    },
  },

  // 11 — MALFORMED / OFF-TOPIC: math-only guardrail redirect.
  {
    id: 'malformed-off-topic',
    category: 'malformed',
    turnKind: 'envelope',
    description: 'Off-topic, non-math request; math-only guardrail should redirect gently.',
    profile: profile({
      masteryNodes: [node('algebra.functions.notation', 0.6, 'learning')],
    }),
    messages: [
      { role: 'assistant', content: 'Ready when you are — what function question are we working on?' },
      { role: 'user', content: 'lol whatever. whats the weather like today btw' },
    ],
    expectations: {
      expectQuestion: true,
      rubricNote:
        'Off-topic and non-math. Best turn gently redirects to the math task without being preachy, and stays warm — it should not answer the weather question or break character.',
    },
  },
]
