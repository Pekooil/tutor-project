import Link from 'next/link'
import { parseNotebook } from '@/lib/notebook/tool'
import type { DashboardMisconception } from '@/lib/learning/dashboard-read'
import type { RecentSession } from '@/lib/learning/activity-read'
import { HistoryScreen } from '@/components/studio/HistoryScreen'
import type { StudioSubject } from '@/components/studio/catalog-read'
import type { StudioNotes } from '@/components/studio/notes-read'
import { DashboardScreen } from '@/components/studio/DashboardScreen'
import { NotesScreen } from '@/components/studio/NotesScreen'
import { StudioTitle } from '@/components/studio/StudioShell'

// Public, unauthenticated visual harness for the Notebook Studio — the real
// routes are auth-gated, so this renders the four screens inside the real shell
// against mock data. Same posture as /notebook-preview: dev scaffolding, not
// linked from anywhere, no user data touched.
//
// Switch views with ?view=dash|notes|history. The quiz and flashcards are
// exercised from inside the notes view's panel, where they now live.
export const dynamic = 'force-dynamic'

const NOW = new Date('2026-07-22T15:00:00Z')
const iso = (d: string) => new Date(d).toISOString()

const SUBJECTS: StudioSubject[] = [
  {
    key: 'algebra1',
    label: 'Algebra 1',
    short: 'A1',
    color: '#9a3412',
    averageMastery: 0.72,
    misconceptionCount: 3,
    watchingCount: 1,
    lastPracticedAt: iso('2026-07-22'),
    concepts: [
      {
        conceptKey: 'algebra.quadratics.factoring',
        title: 'Quadratic Equations & Factoring',
        mastery: 0.61,
        sessions: 3,
        lastPracticedAt: iso('2026-07-22'),
        quizCount: 3,
        cardCount: 4,
        misconceptionCount: 2,
        watchingCount: 0,
        hasNotes: true,
        status: 'gap',
        dueAt: iso('2026-07-22'),
      },
      {
        conceptKey: 'algebra.systems.linear',
        title: 'Systems of Equations',
        mastery: 0.68,
        sessions: 2,
        lastPracticedAt: iso('2026-07-18'),
        quizCount: 5,
        cardCount: 8,
        misconceptionCount: 1,
        watchingCount: 0,
        hasNotes: true,
        status: 'due',
        dueAt: iso('2026-07-22'),
      },
      {
        conceptKey: 'algebra.linear.slope',
        title: 'Linear Functions & Slope',
        mastery: 0.88,
        sessions: 4,
        lastPracticedAt: iso('2026-07-11'),
        quizCount: 6,
        cardCount: 10,
        misconceptionCount: 0,
        watchingCount: 1,
        hasNotes: true,
        status: 'solid',
        dueAt: null,
      },
    ],
  },
  {
    key: 'geometry',
    label: 'Geometry',
    short: 'GE',
    color: '#166534',
    averageMastery: 0.58,
    misconceptionCount: 4,
    watchingCount: 0,
    lastPracticedAt: iso('2026-07-20'),
    concepts: [
      {
        conceptKey: 'geometry.similarity.triangles',
        title: 'Similar Triangles',
        mastery: 0.52,
        sessions: 2,
        lastPracticedAt: iso('2026-07-20'),
        quizCount: 4,
        cardCount: 6,
        misconceptionCount: 3,
        watchingCount: 0,
        hasNotes: true,
        status: 'gap',
        dueAt: iso('2026-07-23'),
      },
      {
        conceptKey: 'geometry.circles.theorems',
        title: 'Circle Theorems',
        mastery: 0.64,
        sessions: 1,
        lastPracticedAt: iso('2026-07-14'),
        quizCount: 3,
        cardCount: 5,
        misconceptionCount: 1,
        watchingCount: 0,
        hasNotes: false,
        status: 'gap',
        dueAt: iso('2026-07-21'),
      },
    ],
  },
  {
    key: 'precalc',
    label: 'Pre-Calculus',
    short: 'PC',
    color: '#6d28d9',
    averageMastery: 0.84,
    misconceptionCount: 0,
    watchingCount: 2,
    lastPracticedAt: iso('2026-07-17'),
    concepts: [
      {
        conceptKey: 'precalc.trig.identities',
        title: 'Trig Identities',
        mastery: 0.81,
        sessions: 3,
        lastPracticedAt: iso('2026-07-17'),
        quizCount: 6,
        cardCount: 12,
        misconceptionCount: 0,
        watchingCount: 2,
        hasNotes: true,
        status: 'due',
        dueAt: iso('2026-07-22'),
      },
      {
        conceptKey: 'precalc.exp.log',
        title: 'Exponential & Log Functions',
        mastery: 0.87,
        sessions: 2,
        lastPracticedAt: iso('2026-07-09'),
        quizCount: 5,
        cardCount: 9,
        misconceptionCount: 0,
        watchingCount: 0,
        hasNotes: true,
        status: 'solid',
        dueAt: null,
      },
    ],
  },
]

const MISCONCEPTIONS: DashboardMisconception[] = [
  {
    id: 'm1',
    conceptKey: 'algebra.quadratics.factoring',
    title: 'Guesses factors instead of using a·c',
    strand: 'algebra1',
    strandLabel: 'Algebra 1',
    category: 'guess-and-check',
    description: 'jumps straight to a factor pair when the leading coefficient is not 1',
    status: 'active',
    occurrenceCount: 4,
    consecutiveCorrect: 0,
    firstSeenAt: iso('2026-07-08'),
    lastSeenAt: iso('2026-07-22'),
    resolvedAt: null,
  },
  {
    id: 'm2',
    conceptKey: 'algebra.quadratics.factoring',
    title: 'Sign error on the factor pair',
    strand: 'algebra1',
    strandLabel: 'Algebra 1',
    category: 'sign-error',
    description: 'keeps both numbers positive when b is negative',
    // 'pending' — seen once, surfaced as "Watching" rather than hidden.
    status: 'pending',
    occurrenceCount: 1,
    consecutiveCorrect: 0,
    firstSeenAt: iso('2026-07-18'),
    lastSeenAt: iso('2026-07-18'),
    resolvedAt: null,
  },
  {
    id: 'm4',
    conceptKey: 'algebra.quadratics.factoring',
    title: 'Drops the common factor before grouping',
    strand: 'algebra1',
    strandLabel: 'Algebra 1',
    category: 'common-factor',
    description: 'leaves a factorable bracket in the final answer',
    // Confirmed, but trending right → "Improving".
    status: 'active',
    occurrenceCount: 3,
    consecutiveCorrect: 2,
    firstSeenAt: iso('2026-07-05'),
    lastSeenAt: iso('2026-07-16'),
    resolvedAt: null,
  },
  {
    id: 'm3',
    conceptKey: 'algebra.quadratics.factoring',
    title: 'Misreads the discriminant',
    strand: 'algebra1',
    strandLabel: 'Algebra 1',
    category: 'discriminant',
    description: 'treats b² − 4ac = 0 as "no solutions"',
    status: 'resolved',
    occurrenceCount: 3,
    consecutiveCorrect: 3,
    firstSeenAt: iso('2026-07-02'),
    lastSeenAt: iso('2026-07-15'),
    resolvedAt: iso('2026-07-22'),
  },
]

const NOTEBOOK = parseNotebook({
  summary:
    'Factoring a quadratic means rewriting ax² + bx + c as a product of two binomials. You can find the ' +
    'factor pair reliably now when a = 1, and your sign handling has gotten much steadier. The part that ' +
    'is still shaky is what to do first when a is not 1.',
  keyPoints: [
    'Factoring undoes multiplication: you are looking for the two binomials that multiply back to the original.',
    'When a = 1, you need two numbers that multiply to c and add to b.',
    'When a is not 1, start from the product a·c — not from c alone.',
    'Always check your factors by expanding them back out.',
  ],
  sections: [
    {
      title: 'Factoring Essentials',
      icon: 'pencil',
      subsections: [
        {
          heading: 'The number pair rule',
          body: [
            'For a quadratic with a leading coefficient of 1, factoring comes down to one question: which two numbers multiply to c and add to b? Once you have that pair, the binomials write themselves.',
            'The two signs follow from the two coefficients, and that is the part worth slowing down on.',
          ],
          expression: 'p * q = c,  p + q = b',
          callout: 'The sign of c tells you whether the numbers share a sign; the sign of b tells you which.',
          category: 'sign-error',
          steps: [],
        },
      ],
    },
    {
      title: 'Special Patterns',
      icon: 'grid',
      subsections: [
        {
          heading: 'Difference of squares',
          body: ['When you see two perfect squares with a minus between them, you can factor on sight.'],
          expression: 'a^2 - b^2 = (a - b)(a + b)',
          callout: '',
          category: '',
          steps: [],
        },
      ],
    },
    {
      title: 'The AC Method',
      icon: 'compass',
      subsections: [
        {
          heading: 'When the leading coefficient is not 1',
          body: [
            'With a leading coefficient other than 1 you cannot read the pair off c directly. The AC method fixes that by working from the product a·c instead.',
          ],
          expression: '',
          callout: '',
          category: 'guess-and-check',
          steps: [
            {
              step: 'Read off a, b and c so you know what you are working with.',
              expression: '6x^2 + 11x + 4  ->  a = 6, b = 11, c = 4',
              mistake: { category: '', studentAttempt: '', whatWentWrong: '', watchFor: '' },
            },
            {
              step: 'Multiply a by c. This — not c on its own — is the number you are factoring.',
              expression: 'a*c = 6 * 4 = 24',
              mistake: {
                category: 'guess-and-check',
                studentAttempt: '6x^2 + 11x + 4 -> (6x + 4)(x + 1)',
                whatWentWrong:
                  'You guessed a factor pair straight from the 6 and the 4 instead of computing a·c first.',
                watchFor:
                  'When a is not 1, always compute a·c before you look for a pair — guessing is what broke here.',
              },
            },
            {
              step: 'Find the pair that multiplies to a·c and adds to b.',
              expression: '3 * 8 = 24,  3 + 8 = 11',
              mistake: { category: '', studentAttempt: '', whatWentWrong: '', watchFor: '' },
            },
            {
              step: 'Split the middle term using that pair.',
              expression: '6x^2 + 11x + 4  ->  6x^2 + 3x + 8x + 4',
              mistake: { category: '', studentAttempt: '', whatWentWrong: '', watchFor: '' },
            },
            {
              step: 'Group the four terms in pairs and pull the common factor out of each.',
              expression: '6x^2 + 3x + 8x + 4  ->  3x(2x + 1) + 4(2x + 1)',
              mistake: { category: '', studentAttempt: '', whatWentWrong: '', watchFor: '' },
            },
            {
              step: 'Both groups now share a bracket — factor it out to finish.',
              expression: '3x(2x + 1) + 4(2x + 1) = (3x + 4)(2x + 1)',
              mistake: { category: '', studentAttempt: '', whatWentWrong: '', watchFor: '' },
            },
          ],
        },
      ],
    },
    {
      title: 'Quadratic Formula & the Discriminant',
      icon: 'bolt',
      subsections: [
        {
          heading: 'When factoring will not land',
          body: ['If no integer pair works, the formula always does — and the discriminant tells you what to expect first.'],
          expression: 'b^2 - 4ac = 0  ->  exactly one repeated root',
          callout: '',
          category: 'discriminant',
          steps: [],
        },
      ],
    },
  ],
  revision: {
    improved: [
      'You handled the signs correctly on every factor pair this session — that was the slip last time.',
      'You spotted the difference of squares on sight instead of expanding first.',
    ],
    newMisconceptions: [
      'When the leading coefficient was not 1, you guessed a factor pair instead of computing a·c first.',
    ],
    noteChanges: [
      'Added an AC Method section with the procedure broken into six steps, each showing its own working.',
      'Flagged the a·c step with the attempt you actually wrote.',
      'Marked the discriminant as solid — you had it right three times running.',
    ],
  },
})

const NOTES: StudioNotes = {
  conceptKey: 'algebra.quadratics.factoring',
  title: 'Quadratic Equations & Factoring',
  subjectLabel: 'Algebra 1',
  subjectColor: '#9a3412',
  notebook: {
    summary: NOTEBOOK.summary,
    keyPoints: NOTEBOOK.keyPoints,
    sections: NOTEBOOK.sections,
    revision: NOTEBOOK.revision,
    mustKnow: NOTEBOOK.mustKnow,
    method: NOTEBOOK.method,
    sessionCount: 3,
    updatedAt: iso('2026-07-22'),
  },
  misconceptions: MISCONCEPTIONS,
  misconceptionByCategory: Object.fromEntries(MISCONCEPTIONS.map((m) => [m.category, m])),
  // Shaped after the real `session_interactions.annotations` records (ADR-055):
  // a label, a why-note and the exact span the tutor pointed at.
  snapshots: [
    {
      id: 'snap-1',
      turnIndex: 4,
      conceptKey: 'algebra.quadratics.factoring',
      conceptTitle: 'Quadratic Equations & Factoring',
      studentTranscript: '6x^2 + 11x + 4 -> (6x + 4)(x + 1)',
      tutorResponse: null,
      misconception: 'guessed a factor pair instead of computing a·c first',
      annotations: [
        {
          id: 'a1',
          type: 'highlight',
          targetText: '6 * 4',
          color: null,
          label: 'Start from this product',
          note: 'With a leading coefficient other than 1, a·c is the number you factor — not c.',
        },
        {
          id: 'a2',
          type: 'highlight',
          targetText: '(6x + 4)',
          color: null,
          label: 'This bracket still factors',
          note: 'A finished answer has no common factor left inside a bracket.',
        },
      ],
      createdAt: iso('2026-07-22'),
    },
    {
      id: 'snap-2',
      turnIndex: 2,
      conceptKey: 'algebra.quadratics.factoring',
      conceptTitle: 'Quadratic Equations & Factoring',
      studentTranscript: 'x^2 - 5x + 6 = (x - 2)(x - 3)',
      tutorResponse: null,
      misconception: null,
      annotations: [
        {
          id: 'a3',
          type: 'highlight',
          targetText: '-2',
          color: null,
          label: 'Both signs negative',
          note: 'c positive and b negative means the pair shares a sign, and b says which.',
        },
      ],
      createdAt: iso('2026-07-18'),
    },
  ],
  // The study kit's own condensed bullets (ADR-049's `notes` artifact). These were
  // only visible in the kit viewer before /kits/[key] started forwarding here.
  notes: [
    'Factoring rewrites a quadratic as a product of two binomials — it undoes multiplication.',
    'With a = 1, find the pair that multiplies to c and adds to b.',
    'With a ≠ 1, work from a·c and split the middle term, then factor by grouping.',
    'Check every answer by expanding back to the original.',
  ],
  problems: [
    { statement: 'Factor: x² − 5x − 14', solution: 'Find the pair that multiplies to −14 and adds to −5: −7 and 2. So x² − 5x − 14 = (x − 7)(x + 2).' },
    { statement: '4x² + 12x + 9 — which pattern applies?', solution: 'It is a perfect square trinomial: (2x)² + 2(2x)(3) + 3², so it factors as (2x + 3)².' },
    { statement: 'What is the first move when factoring 6x² + 11x + 4?', solution: 'Multiply a·c = 6 × 4 = 24, then find the pair that multiplies to 24 and adds to 11. Guessing is what broke on Jul 22.' },
  ],
  flashcards: [
    { front: 'What is the standard form of a quadratic?', back: 'ax² + bx + c = 0, with a ≠ 0.' },
    { front: 'First move in the AC method?', back: 'Multiply a by c, then look for a pair that multiplies to a·c and adds to b.' },
    { front: 'a² − b² factors as…', back: '(a − b)(a + b) — the difference of squares.' },
    { front: 'b² − 4ac = 0 means…', back: 'Exactly one repeated real root.' },
  ],
  kitHref: '/kits/preview',
  lastSession: { id: 'preview-session', startedAt: iso('2026-07-22'), minutes: 24 },
}

const VIEWS = [
  { key: 'dash', label: 'Dashboard' },
  { key: 'notes', label: 'Notes' },
  { key: 'history', label: 'History' },
]

// Mock tutoring history for the History view. `SessionsScreen` groups these into
// Today / Yesterday / date buckets itself, so the spread of dates is what makes
// the grouping visible. `kitHref` non-null is what tags a session as having
// produced a study kit.
const SESSIONS: RecentSession[] = [
  { id: 's1', startedAt: iso('2026-07-22'), endedAt: iso('2026-07-22'), mode: 'text', hasKit: true, kitHref: '/kits/s1', conceptKey: 'algebra.quadratics.factoring', conceptTitle: 'Quadratic Equations & Factoring' },
  { id: 's2', startedAt: iso('2026-07-22'), endedAt: iso('2026-07-22'), mode: 'voice', hasKit: false, kitHref: null, conceptKey: 'algebra.systems.linear', conceptTitle: 'Systems of Equations' },
  { id: 's3', startedAt: iso('2026-07-21'), endedAt: iso('2026-07-21'), mode: 'text', hasKit: true, kitHref: '/kits/s3', conceptKey: 'algebra.quadratics.factoring', conceptTitle: 'Quadratic Equations & Factoring' },
  { id: 's4', startedAt: iso('2026-07-18'), endedAt: iso('2026-07-18'), mode: 'text', hasKit: true, kitHref: '/kits/s4', conceptKey: 'geometry.similarity.triangles', conceptTitle: 'Similar Triangles' },
  // A session that never got past the opening scan: no concept, so no notes to
  // open — the row renders inert rather than linking into the old transcript page.
  { id: 's5', startedAt: iso('2026-07-17'), endedAt: iso('2026-07-17'), mode: 'voice', hasKit: false, kitHref: null, conceptKey: null, conceptTitle: null },
  { id: 's6', startedAt: iso('2026-07-14'), endedAt: iso('2026-07-14'), mode: 'text', hasKit: true, kitHref: '/kits/s6', conceptKey: 'precalc.trig.identities', conceptTitle: 'Trig Identities' },
  { id: 's7', startedAt: iso('2026-07-11'), endedAt: iso('2026-07-11'), mode: 'text', hasKit: false, kitHref: null, conceptKey: 'algebra.linear.slope', conceptTitle: 'Linear Functions & Slope' },
  { id: 's8', startedAt: iso('2026-07-09'), endedAt: iso('2026-07-09'), mode: 'text', hasKit: true, kitHref: '/kits/s8', conceptKey: 'precalc.exp.log', conceptTitle: 'Exponential & Log Functions' },
]

export default async function StudioPreviewPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>
}) {
  const { view = 'dash' } = await searchParams

  const switcher = (
    <div
      style={{
        position: 'fixed',
        bottom: 14,
        left: 80,
        zIndex: 60,
        display: 'flex',
        gap: 6,
        padding: 6,
        borderRadius: 999,
        background: 'var(--studio-card)',
        border: '1px solid var(--color-border)',
        boxShadow: 'var(--shadow-panel)',
        fontSize: 12,
      }}
    >
      {VIEWS.map((v) => (
        <Link
          key={v.key}
          href={`/studio-preview?view=${v.key}`}
          style={{
            padding: '5px 11px',
            borderRadius: 999,
            fontWeight: 600,
            background: v.key === view ? 'var(--color-accent)' : 'transparent',
            color: v.key === view ? 'var(--color-accent-foreground)' : 'var(--color-muted-foreground)',
          }}
        >
          {v.label}
        </Link>
      ))}
    </div>
  )

  if (view === 'notes') {
    return (
      <>
        <StudioTitle concept={NOTES.title} subject={NOTES.subjectLabel} conceptKey={NOTES.conceptKey} fullBleed />
        <NotesScreen data={NOTES} />
        {switcher}
      </>
    )
  }

  if (view === 'history') {
    // The real /sessions screen, rendered against mock sessions. No light wrapper
    // any more: HistoryScreen is token-based, so it themes with the shell like
    // every other studio view.
    return (
      <>
        <div style={{ overflowY: 'auto', flex: 1, minHeight: 0 }}>
          <HistoryScreen sessions={SESSIONS} now={NOW} />
        </div>
        {switcher}
      </>
    )
  }

  return (
    <>
      <DashboardScreen
        firstName="Darcy"
        now={NOW}
        quota={{ tier: 'free', isPro: false, limit: 5, used: 2, remaining: 3, resetsAt: null }}
        due={[
          {
            conceptKey: 'algebra.quadratics.factoring',
            title: 'Quadratics & Factoring',
            strand: 'algebra1',
            strandShort: 'Alg 1',
            strandColor: '#9a3412',
            mastery: 0.61,
            dueAt: iso('2026-07-22'),
            overdue: false,
          },
          {
            conceptKey: 'algebra.systems.linear',
            title: 'Systems of Equations',
            strand: 'algebra1',
            strandShort: 'Alg 1',
            strandColor: '#9a3412',
            mastery: 0.68,
            dueAt: iso('2026-07-22'),
            overdue: false,
          },
        ]}
        subjects={SUBJECTS}
        isEmpty={false}
      />
      {switcher}
    </>
  )
}
