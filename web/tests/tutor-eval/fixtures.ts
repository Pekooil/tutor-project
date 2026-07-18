import type { TurnMessage } from '@/lib/ai/claude'
import { sessionStartPlaceholder } from '@/lib/ai/turn-request'
import type { TurnEnvelope } from '@/lib/ai/envelope'
import type { LearningProfile } from '@/lib/ai/profile'
import type { PageContext } from '@/lib/ai/page-context'
import type { SessionStartPrompt } from '@/lib/ai/system-prompt'

// Sprint 24 (ADR-038) — Task 6 eval fixtures.
//
// ⚠️ SYNTHETIC, not recorded production turns. Built to exercise the envelope
// behaviors the migration risks regressing (the Sprint 14 Task 10 failure
// family): assessment-present, annotate-when-referenced, chips shape, and
// session-close discipline, across all three turn kinds. Replace/extend with
// real recorded turn inputs before treating the gate as production-grade — the
// harness reads whatever SCENARIOS contains.

// A small, realistic profile (weakest-first mastery + one active misconception
// + a due-review + one prior session) so the STUDENT PROFILE block is populated
// the way a live turn's would be.
export function evalProfile(): LearningProfile {
  return {
    masteryNodes: [
      { conceptKey: 'algebra.polynomials.expanding', mastery: 0.42, state: 'weak', confidenceBand: 'medium' },
      { conceptKey: 'algebra.quadratics.factoring', mastery: 0.55, state: 'learning', confidenceBand: 'low' },
    ],
    activeMisconceptions: [
      {
        conceptKey: 'algebra.polynomials.expanding',
        category: 'sign.error.dropped',
        description: 'forgets to distribute the negative across both terms',
      },
    ],
    confidenceNote: 'moderate — several estimates are low-confidence, verify with a quick question.',
    dueForReview: [{ conceptKey: 'algebra.quadratics.factoring', reason: 'fading, last seen 6d ago' }],
    priorWork: [
      {
        conceptKey: 'algebra.polynomials.expanding',
        sessionsAgo: 1,
        daysAgo: 2,
        outcomeLine: 'struggled early, finished strong',
      },
    ],
  }
}

const LIKE_TERMS_PAGE: PageContext = {
  title: 'Combining Like Terms — Practice',
  text: 'Simplify the expression by combining like terms: 5t^2 - 6t + 8t^2 - 8t.',
  equations: [{ text: '5t^2 - 6t + 8t^2 - 8t' }],
}

const FACTORING_PAGE: PageContext = {
  title: 'Factoring Quadratics — Practice',
  text: 'Factor the quadratic expression and solve for x: x^2 + 5x + 6 = 0.',
  equations: [{ text: 'x^2 + 5x + 6 = 0' }],
}

export type Scenario = {
  name: string
  kind: 'regular' | 'opening' | 'session-start'
  args: {
    messages: TurnMessage[]
    pageContext?: PageContext
    profile: LearningProfile
    sessionStart?: SessionStartPrompt
  }
  // Expectations the scorer checks (see score.ts):
  expectAssessment: boolean // every non-opening/non-session-start turn must grade
  expectAnnotationFor?: string // a page substring the reply SHOULD annotate if it names it
  isCloseTurn: boolean // the ONE scenario where session.complete is legitimate
}

const P = evalProfile()

const SESSION_START = {
  question: 'Factor x^2 + 5x + 6 and solve for x',
  stickingPoint: 'finding the factor pair that multiplies to c and adds to b',
  snippet: 'x^2 + 5x + 6 = 0',
}
const SESSION_START_PLACEHOLDER = sessionStartPlaceholder(SESSION_START)

export const SCENARIOS: Scenario[] = [
  {
    name: 'regular · combine like terms (annotate-when-referenced)',
    kind: 'regular',
    args: {
      profile: P,
      pageContext: LIKE_TERMS_PAGE,
      messages: [
        { role: 'assistant', content: 'Look at the two t-squared terms. Can you combine them?' },
        { role: 'user', content: '13t^2' },
      ],
    },
    expectAssessment: true,
    expectAnnotationFor: '5t^2',
    isCloseTurn: false,
  },
  {
    name: 'regular · small-answer question (chips shape)',
    kind: 'regular',
    args: {
      profile: P,
      pageContext: LIKE_TERMS_PAGE,
      messages: [
        { role: 'assistant', content: 'Nice — the t-squared terms give 13t^2. Now the t terms: what is -6t plus -8t?' },
        { role: 'user', content: 'not sure, can you give me options?' },
      ],
    },
    expectAssessment: true,
    isCloseTurn: false,
  },
  {
    name: 'regular · final answer (session-close discipline)',
    kind: 'regular',
    args: {
      profile: P,
      pageContext: FACTORING_PAGE,
      messages: [
        { role: 'assistant', content: 'Great. What two numbers multiply to 6 and add to 5?' },
        { role: 'user', content: '2 and 3, so it factors to (x+2)(x+3), and x = -2 or x = -3.' },
      ],
    },
    expectAssessment: true,
    isCloseTurn: true,
  },
  {
    name: 'opening-scan · name the visible problem',
    kind: 'opening',
    args: { profile: P, pageContext: FACTORING_PAGE, messages: [] },
    expectAssessment: false,
    isCloseTurn: false,
  },
  {
    name: 'session-start · dive at the sticking point (no fabricated turn)',
    kind: 'session-start',
    args: {
      profile: P,
      pageContext: FACTORING_PAGE,
      // The turn route never sends an empty messages array on session start —
      // it injects the placeholder turn (turn/route.ts). Mirror that here so
      // both providers see the production wire shape (Anthropic rejects []).
      messages: [SESSION_START_PLACEHOLDER],
      sessionStart: SESSION_START,
    },
    expectAssessment: false,
    isCloseTurn: false,
  },
]

// Does the page context (title + text + equations) literally contain `needle`?
// Used to score whether an annotation's target.text is grounded in what's on
// screen, not invented.
export function pageContains(page: PageContext | undefined, needle: string): boolean {
  if (!page) return false
  const hay = [page.title ?? '', page.text ?? '', ...page.equations.flatMap((e) => [e.text ?? '', e.latex ?? ''])].join(
    '\n'
  )
  return hay.includes(needle)
}

// Fabricated-turn phrases that must NOT appear in a session-start reply (the
// exact live-find the board_text/opening_question split exists to prevent).
export const FABRICATED_PHRASES = [
  'is that what you need help with',
  "looks like you're working on",
  "i'm working on",
  'trips me up',
]

export function looksFabricated(say: string): boolean {
  const s = say.toLowerCase()
  return FABRICATED_PHRASES.some((p) => s.includes(p))
}

// One scenario's scored result for one provider.
export type ScoredTurn = {
  scenario: string
  ms: number
  valid: boolean // envelope parsed, `say` is a string
  assessmentOk: boolean // assessment present when expected (else N/A -> true)
  annotationOk: boolean // grounded annotation present when a reference was expected (else N/A -> true)
  chipsOk: boolean // chips, when present, are 2–4 (else true)
  closeOk: boolean // session.complete present iff this is the close turn
  notFabricated: boolean // session-start reply free of fabricated phrasing (else true)
}

export function score(s: Scenario, env: TurnEnvelope | null, ms: number): ScoredTurn {
  const valid = !!env && typeof env.say === 'string'
  const say = env?.say ?? ''
  const annotations = env?.annotations ?? []
  const chips = env?.chips
  return {
    scenario: s.name,
    ms,
    valid,
    assessmentOk: !s.expectAssessment || !!env?.assessment,
    annotationOk:
      !s.expectAnnotationFor ||
      annotations.some((a) => !!a.target?.text && pageContains(s.args.pageContext, a.target.text)),
    chipsOk: !chips || (chips.length >= 2 && chips.length <= 4),
    closeOk: s.isCloseTurn ? !!env?.session : !env?.session,
    notFabricated: s.kind !== 'session-start' || (!!say && !looksFabricated(say)),
  }
}
