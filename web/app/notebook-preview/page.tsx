import type { NbConcept } from '@/components/dashboard/premium/notebook-read'
import { ConceptPage } from '@/components/dashboard/premium/notebook/ConceptPage'

// Public, unauthenticated visual harness for the "live notebook" concept page —
// the dashboard's own routes are auth-gated, so this renders ConceptPage against
// mock NbConcept data to eyeball the new note structure (must-know key points,
// the how-to-solve method flow with green expression bubbles + arrows, and the
// step-level mistake annotations joined to a misconception's count/date). Dev
// scaffolding; not linked from anywhere.
export const dynamic = 'force-dynamic'

const NOW = new Date('2026-07-20T12:00:00Z')

const FACTORING: NbConcept = {
  conceptKey: 'algebra.quadratics.factoring-simple',
  title: 'Factoring simple quadratics',
  chapterKey: 'algebra',
  chapterLabel: 'Algebra 1 · Quadratics',
  node: {
    mastery: 0.44,
    state: 'weak',
    observationCount: 6,
    lastPracticedAt: '2026-07-18T00:00:00.000Z',
    confidenceBand: 'medium',
  },
  notebook: {
    summary:
      'Factoring x² + bx + c into two binomials. You can find the factor pair reliably now — the sign handling when b is negative is still the part to keep an eye on.',
    mustKnow: [
      {
        heading: 'What factoring a quadratic means',
        points: [
          'You are rewriting x² + bx + c as a product (x + p)(x + q).',
          'p and q are the two numbers you are hunting for.',
        ],
        expression: '',
      },
      {
        heading: 'The number-pair rule',
        points: ['p and q multiply to c and add to b.'],
        expression: 'p · q = c,   p + q = b',
      },
    ],
    method: [
      {
        step: 'Read off b and c from the quadratic.',
        expression: 'x² + 5x + 6  →  b = 5, c = 6',
        mistake: null,
      },
      {
        step: 'Find two numbers that multiply to c and add to b.',
        expression: '2 · 3 = 6,   2 + 3 = 5',
        mistake: null,
      },
      {
        step: 'Handle the signs: the sign of c says whether the numbers share a sign; the sign of b says which.',
        expression: 'x² − 5x + 6 = (x − 2)(x − 3)',
        mistake: {
          category: 'sign-error',
          whatWentWrong: 'You made both numbers positive when c was positive but b was negative.',
          watchFor: 'When c is positive but b is negative, BOTH numbers are negative — check the sum sign.',
        },
      },
      {
        step: 'Expand your factors back out to check you land on the original quadratic.',
        expression: '(x − 2)(x − 3) = x² − 5x + 6 ✓',
        mistake: null,
      },
    ],
  },
  misconceptions: [
    {
      id: 'm1',
      title: 'Sign error on the factor pair',
      category: 'sign-error',
      description: 'drops the negative when b is negative',
      status: 'active',
      occurrenceCount: 3,
      consecutiveCorrect: 1,
      firstSeenAt: '2026-07-10T00:00:00.000Z',
      lastSeenAt: '2026-07-18T00:00:00.000Z',
      resolvedAt: null,
    },
    {
      id: 'm2',
      title: 'Forgets to check by expanding',
      category: 'no-verification',
      description: 'stops at the factors without expanding back',
      status: 'active',
      occurrenceCount: 2,
      consecutiveCorrect: 0,
      firstSeenAt: '2026-07-12T00:00:00.000Z',
      lastSeenAt: '2026-07-16T00:00:00.000Z',
      resolvedAt: null,
    },
  ],
  kit: {
    notes: ['Product sign → shared sign', 'Sum sign → which sign'],
    problems: [
      { statement: 'Factor x² + 7x + 12', solution: '(x + 3)(x + 4)' },
      { statement: 'Factor x² − 7x + 12', solution: '(x − 3)(x − 4)' },
      { statement: 'Factor x² + x − 6', solution: '(x + 3)(x − 2)' },
      { statement: 'Factor x² − 2x − 15', solution: '(x − 5)(x + 3)' },
    ],
    flashcards: [
      { front: 'x² + 5x + 6', back: '(x + 2)(x + 3)' },
      { front: 'x² − 5x + 6', back: '(x − 2)(x − 3)' },
      { front: 'x² + x − 6', back: '(x + 3)(x − 2)' },
    ],
  },
  snapshots: [],
  review: { dueAt: '2026-07-22T00:00:00.000Z', intervalDays: 4, overdue: false, lapses: 1 },
  timeline: [
    { date: '2026-07-10T00:00:00.000Z', kind: 'learned', label: 'First worked on this', future: false },
    { date: '2026-07-10T00:00:00.000Z', kind: 'spotted', label: 'Spotted: Sign error on the factor pair', future: false },
    { date: '2026-07-18T00:00:00.000Z', kind: 'practiced', label: 'Last practiced', future: false },
    { date: '2026-07-22T00:00:00.000Z', kind: 'review', label: 'Next scheduled review', future: true },
  ],
  hasContent: true,
  reviewHref: '/review/algebra.quadratics.factoring-simple',
  studyKitHref: '/kits/session-preview',
}

export default function NotebookPreviewPage() {
  return (
    <div style={{ minHeight: '100vh', background: '#faf9f5', padding: '40px 0' }}>
      <div style={{ maxWidth: 780, margin: '0 auto', padding: '0 24px' }}>
        <p style={{ margin: '0 0 24px', fontSize: 11, fontWeight: 600, letterSpacing: '.14em', textTransform: 'uppercase', color: '#9a988f' }}>
          Notebook preview · mock data
        </p>
        <ConceptPage concept={FACTORING} now={NOW} />
      </div>
    </div>
  )
}
