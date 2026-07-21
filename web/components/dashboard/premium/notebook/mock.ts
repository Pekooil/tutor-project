import type { NotebookData, NbConcept } from '../notebook-read'
import type { WorkedSnapshot } from '../snapshots-read'

// Seeded notebook data for the /notebook-preview design harness (redesign) — a
// realistic Algebra 1 notebook so the two-pane shell can be reviewed without a
// live account. Mirrors the real loadNotebook() shape exactly; concept keys are
// real curriculum keys. NOT used by the authenticated /notebook route.

const D = (iso: string) => new Date(iso).toISOString()

function concept(partial: Partial<NbConcept> & Pick<NbConcept, 'conceptKey' | 'title' | 'chapterKey' | 'chapterLabel'>): NbConcept {
  return {
    node: null,
    notebook: null,
    misconceptions: [],
    kit: null,
    snapshots: [],
    review: null,
    timeline: [],
    hasContent: false,
    reviewHref: null,
    ...partial,
  }
}

const factoring: NbConcept = concept({
  conceptKey: 'algebra.quadratics.factoring',
  title: 'Factoring quadratics',
  chapterKey: 'quadratics',
  chapterLabel: 'Quadratics',
  node: { mastery: 0.78, state: 'mastered', observationCount: 11, lastPracticedAt: D('2026-07-18'), confidenceBand: 'high' },
  notebook: {
    summary:
      'Factoring simple quadratics x² + bx + c. You can find the factor pairs reliably now, and you have gotten much more careful about the signs since the first session.',
    reminders: [
      'When c is positive but b is negative, BOTH numbers are negative — e.g. x² − 5x + 6 = (x − 2)(x − 3).',
      'Always expand your factors back out to check before moving on.',
      'If it does not factor nicely, that is a signal to reach for the quadratic formula.',
    ],
    explanations: [
      {
        title: 'Find two numbers that multiply to c and add to b',
        body:
          'To factor x² + bx + c, look for two numbers whose product is c and whose sum is b. For x² + 5x + 6 that is 2 and 3, so it factors to (x + 2)(x + 3). The product sign tells you whether the two numbers share a sign; the sum sign tells you which.',
      },
    ],
  },
  misconceptions: [
    {
      id: 'm1',
      title: 'Mixed up the signs when c is positive and b is negative',
      category: 'sign-error',
      description: 'Wrote (x + 2)(x + 3) for x² − 5x + 6 instead of two negative factors.',
      status: 'resolved',
      occurrenceCount: 4,
      consecutiveCorrect: 3,
      firstSeenAt: D('2026-07-12'),
      resolvedAt: D('2026-07-18'),
    },
    {
      id: 'm2',
      title: "Didn't check by expanding the factors back out",
      category: 'verification',
      description: 'Skipped the expand-to-check step and missed an arithmetic slip.',
      status: 'active',
      occurrenceCount: 2,
      consecutiveCorrect: 1,
      firstSeenAt: D('2026-07-16'),
      resolvedAt: null,
    },
  ],
  kit: {
    notes: [
      'Write the quadratic in standard form x² + bx + c.',
      'List factor pairs of c.',
      'Pick the pair that adds to b (mind the signs).',
      'Write (x + p)(x + q) and expand to verify.',
    ],
    problems: [
      { statement: 'Factor x² + 7x + 12.', solution: '(x + 3)(x + 4) — 3 and 4 multiply to 12 and add to 7.' },
      { statement: 'Factor x² − 5x + 6.', solution: '(x − 2)(x − 3) — both negative since c > 0 and b < 0.' },
      { statement: 'Factor x² + x − 12.', solution: '(x + 4)(x − 3) — 4 and −3 multiply to −12 and add to 1.' },
    ],
    flashcards: [
      { front: 'x² − 5x + 6', back: '(x − 2)(x − 3)' },
      { front: 'When c > 0 and b < 0, the two numbers are…', back: 'both negative.' },
      { front: 'How do you check a factoring?', back: 'Expand the factors back out and compare.' },
    ],
  },
  snapshots: [
    {
      id: 's1',
      turnIndex: 3,
      conceptKey: 'algebra.quadratics.factoring',
      conceptTitle: 'Factoring quadratics',
      studentTranscript: 'Is it (x + 2)(x + 3)?',
      tutorResponse:
        'Close — check the middle term. Since c is +6 but b is −5, both numbers have to be negative. Try (x − 2)(x − 3).',
      misconception: 'Sign error',
      annotations: [
        { id: 'a1', type: 'circle', targetText: 'x² − 5x + 6', color: 'amber', label: 'Look at the signs', note: 'c is positive, b is negative → both factors negative.' },
      ],
      createdAt: D('2026-07-12'),
    },
    {
      id: 's2',
      turnIndex: 6,
      conceptKey: 'algebra.quadratics.factoring',
      conceptTitle: 'Factoring quadratics',
      studentTranscript: '(x − 2)(x − 3), and expanding gives x² − 5x + 6.',
      tutorResponse: 'Exactly right, and nice job expanding to check. That is the habit that keeps you from sign slips.',
      misconception: null,
      annotations: [
        { id: 'a2', type: 'highlight', targetText: '(x − 2)(x − 3)', color: 'green', label: 'Verified', note: 'Expanded back to the original — good.' },
      ],
      createdAt: D('2026-07-18'),
    },
  ],
  review: { dueAt: D('2026-07-26'), intervalDays: 8, overdue: false, lapses: 1 },
  timeline: [
    { date: D('2026-07-12'), kind: 'learned', label: 'First worked on this', future: false },
    { date: D('2026-07-12'), kind: 'spotted', label: 'Spotted: Mixed up the signs when c is positive and b is negative', future: false },
    { date: D('2026-07-18'), kind: 'resolved', label: 'Resolved: Mixed up the signs when c is positive and b is negative', future: false },
    { date: D('2026-07-18'), kind: 'mastered', label: 'Reached mastered', future: false },
    { date: D('2026-07-26'), kind: 'review', label: 'Next scheduled review', future: true },
  ],
  hasContent: true,
  reviewHref: '/review/algebra.quadratics.factoring',
})

const quadraticFormula: NbConcept = concept({
  conceptKey: 'algebra.quadratics.formula',
  title: 'The quadratic formula',
  chapterKey: 'quadratics',
  chapterLabel: 'Quadratics',
  node: { mastery: 0.41, state: 'learning', observationCount: 4, lastPracticedAt: D('2026-07-17'), confidenceBand: 'medium' },
  notebook: {
    summary: 'The quadratic formula for when factoring is awkward. You are getting the setup right; the discriminant sign is where it still slips.',
    reminders: ['Divide the whole numerator by 2a, not just the ±√ part.'],
    explanations: [
      {
        title: 'x = (−b ± √(b² − 4ac)) / 2a',
        body: 'Identify a, b, c from ax² + bx + c = 0, then substitute. The discriminant b² − 4ac tells you how many real roots there are before you even finish.',
      },
    ],
  },
  misconceptions: [
    { id: 'm3', title: 'Only divided the radical term by 2a', category: 'algebra-slip', description: 'Forgot the −b also gets divided by 2a.', status: 'active', occurrenceCount: 2, consecutiveCorrect: 0, firstSeenAt: D('2026-07-17'), resolvedAt: null },
  ],
  kit: null,
  snapshots: [],
  review: { dueAt: D('2026-07-21'), intervalDays: 4, overdue: false, lapses: 0 },
  timeline: [
    { date: D('2026-07-17'), kind: 'learned', label: 'First worked on this', future: false },
    { date: D('2026-07-17'), kind: 'spotted', label: 'Spotted: Only divided the radical term by 2a', future: false },
    { date: D('2026-07-21'), kind: 'review', label: 'Next scheduled review', future: true },
  ],
  hasContent: true,
  reviewHref: null,
})

const oneVar: NbConcept = concept({
  conceptKey: 'algebra.linear-equations.one-variable',
  title: 'One-variable linear equations',
  chapterKey: 'linear-equations',
  chapterLabel: 'Linear equations',
  node: { mastery: 0.88, state: 'mastered', observationCount: 9, lastPracticedAt: D('2026-07-10'), confidenceBand: 'high' },
  notebook: {
    summary: 'Solving for a single variable. Solid — you isolate cleanly and keep the equation balanced.',
    reminders: ['Whatever you do to one side, do to the other.'],
    explanations: [],
  },
  misconceptions: [],
  kit: null,
  snapshots: [],
  review: { dueAt: D('2026-08-04'), intervalDays: 21, overdue: false, lapses: 0 },
  timeline: [
    { date: D('2026-07-08'), kind: 'learned', label: 'First worked on this', future: false },
    { date: D('2026-07-10'), kind: 'practiced', label: 'Last practiced', future: false },
    { date: D('2026-08-04'), kind: 'review', label: 'Next scheduled review', future: true },
  ],
  hasContent: true,
  reviewHref: null,
})

const twoVar: NbConcept = concept({
  conceptKey: 'algebra.linear-equations.two-variable',
  title: 'Two-variable linear equations',
  chapterKey: 'linear-equations',
  chapterLabel: 'Linear equations',
  node: { mastery: 0.34, state: 'weak', observationCount: 3, lastPracticedAt: D('2026-07-14'), confidenceBand: 'low' },
  notebook: null,
  misconceptions: [],
  kit: null,
  snapshots: [],
  review: { dueAt: D('2026-07-20'), intervalDays: 2, overdue: true, lapses: 1 },
  timeline: [
    { date: D('2026-07-14'), kind: 'learned', label: 'First worked on this', future: false },
    { date: D('2026-07-20'), kind: 'review', label: 'Next scheduled review', future: true },
  ],
  hasContent: true,
  reviewHref: null,
})

const productRule: NbConcept = concept({
  conceptKey: 'algebra.exponents.product-rule',
  title: 'The product rule for exponents',
  chapterKey: 'exponents',
  chapterLabel: 'Exponents',
  node: { mastery: 0.62, state: 'learning', observationCount: 5, lastPracticedAt: D('2026-07-15'), confidenceBand: 'medium' },
  notebook: {
    summary: 'Multiplying powers with the same base — add the exponents.',
    reminders: ['aᵐ · aⁿ = aᵐ⁺ⁿ, only when the bases match.'],
    explanations: [],
  },
  misconceptions: [],
  kit: null,
  snapshots: [],
  review: null,
  timeline: [{ date: D('2026-07-15'), kind: 'practiced', label: 'Last practiced', future: false }],
  hasContent: true,
  reviewHref: null,
})

export const MOCK_NOTEBOOK: NotebookData = {
  subjects: [
    { key: 'algebra', label: 'Algebra 1', color: '#9a3412', practiced: 8, total: 17, averageMastery: 0.61, mastered: 3, active: true },
    { key: 'geometry', label: 'Geometry', color: '#166534', practiced: 2, total: 10, averageMastery: 0.44, mastered: 0, active: false },
    { key: 'algebra2', label: 'Algebra 2', color: '#0f766e', practiced: 0, total: 10, averageMastery: 0, mastered: 0, active: false },
    { key: 'precalc', label: 'Trig & Precalculus', color: '#6d28d9', practiced: 0, total: 7, averageMastery: 0, mastered: 0, active: false },
    { key: 'calculus', label: 'Calculus', color: '#a21caf', practiced: 0, total: 16, averageMastery: 0, mastered: 0, active: false },
    { key: 'stats', label: 'Probability & Statistics', color: '#9f1239', practiced: 0, total: 6, averageMastery: 0, mastered: 0, active: false },
  ],
  active: {
    key: 'algebra',
    label: 'Algebra 1',
    color: '#9a3412',
    practiced: 8,
    total: 17,
    averageMastery: 0.61,
    stateCounts: { unseen: 9, learning: 3, weak: 2, mastered: 3, forgotten: 0 },
    activeMisconceptions: 2,
    chapters: [
      {
        key: 'linear-equations',
        label: 'Linear equations',
        averageMastery: 0.61,
        concepts: [oneVar, twoVar],
      },
      {
        key: 'exponents',
        label: 'Exponents',
        averageMastery: 0.55,
        concepts: [
          productRule,
          concept({ conceptKey: 'algebra.exponents.power-rule', title: 'The power rule for exponents', chapterKey: 'exponents', chapterLabel: 'Exponents' }),
        ],
      },
      {
        key: 'polynomials',
        label: 'Polynomials',
        averageMastery: 0,
        concepts: [
          concept({ conceptKey: 'algebra.polynomials.expanding', title: 'Expanding polynomials', chapterKey: 'polynomials', chapterLabel: 'Polynomials' }),
        ],
      },
      {
        key: 'quadratics',
        label: 'Quadratics',
        averageMastery: 0.6,
        concepts: [factoring, quadraticFormula],
      },
      {
        key: 'inequalities',
        label: 'Inequalities',
        averageMastery: 0,
        concepts: [
          concept({ conceptKey: 'algebra.inequalities.linear', title: 'Linear inequalities', chapterKey: 'inequalities', chapterLabel: 'Inequalities' }),
        ],
      },
      {
        key: 'functions',
        label: 'Functions',
        averageMastery: 0,
        concepts: [
          concept({ conceptKey: 'algebra.functions.notation', title: 'Function notation & evaluation', chapterKey: 'functions', chapterLabel: 'Functions' }),
          concept({ conceptKey: 'algebra.functions.graphs', title: 'Graphing & interpreting functions', chapterKey: 'functions', chapterLabel: 'Functions' }),
        ],
      },
    ],
  },
  insights: {
    subjectsMastered: [
      { label: 'Algebra 1', color: '#9a3412', mastered: 3, practiced: 8, total: 17 },
      { label: 'Geometry', color: '#166534', mastered: 0, practiced: 2, total: 10 },
    ],
    mistakePatterns: [
      { category: 'Sign error', count: 6 },
      { category: 'Algebra slip', count: 3 },
      { category: 'Verification', count: 2 },
    ],
    activeMisconceptions: 2,
    resolvedMisconceptions: 4,
    accuracy: 74,
    streak: 3,
    sessionCount: 12,
    avgStudyMinutes: 14,
    practicesToMastery: 6.5,
    masteredConcepts: 3,
    practicedConcepts: 10,
  },
  lastSession: { id: 'demo', startedAt: D('2026-07-18'), mode: 'voice', kitHref: null },
}

// A focused sample for the /notebook-preview board showcase at the top of the
// page (so the visual snapshot board is screenshot-able without scrolling past
// the notebook chrome). The two factoring turns (hand-drawn circle + highlight)
// plus one demonstrating the squiggle underline and a note-only marker.
export const MOCK_SNAPSHOTS: WorkedSnapshot[] = [
  ...factoring.snapshots,
  {
    id: 's3',
    turnIndex: 4,
    conceptKey: 'algebra.quadratics.formula',
    conceptTitle: 'The quadratic formula',
    studentTranscript: 'x = (−b ± √(b²−4ac)), then I divide the root by 2a?',
    tutorResponse:
      'Careful — the WHOLE numerator, including the −b, gets divided by 2a. Underline the full numerator so you divide all of it.',
    misconception: 'Algebra slip',
    annotations: [
      { id: 'a3', type: 'underline', targetText: '−b ± √(b² − 4ac)', color: 'blue', label: 'Divide all of this by 2a', note: 'The −b is part of the numerator too, not just the radical.' },
      { id: 'a4', type: 'label', targetText: null, color: 'amber', label: 'Common slip', note: 'Only dividing the √ term is the most frequent quadratic-formula mistake.' },
    ],
    createdAt: D('2026-07-17'),
  },
]
