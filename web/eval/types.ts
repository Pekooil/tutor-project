// Shared types for the provider A/B eval. Eval-only.

import type { TurnMessage } from '../lib/ai/claude'
import type { TurnEnvelope } from '../lib/ai/envelope'
import type { LearningProfile } from '../lib/ai/profile'
import type { PageContext } from '../lib/ai/page-context'
import type { SessionStartPrompt } from '../lib/ai/system-prompt'
import type { TokenBreakdown } from './pricing'

export type ProviderId = 'haiku-4-5' | 'gpt-4o-mini'

// Which forced tool the case exercises. `session-start` uses SESSION_START_TOOL
// (board_text + opening_question) and threads `sessionStart` into the prompt;
// everything else uses ENVELOPE_TOOL (submit_tutor_turn).
export type TurnKind = 'envelope' | 'session-start'

export type EvalCategory =
  | 'algebra'
  | 'geometry'
  | 'calculus'
  | 'misconception'
  | 'follow-up'
  | 'closing'
  | 'annotation'
  | 'session-start'
  | 'difficult-student'
  | 'edge-case'
  | 'malformed'

// One scenario, run IDENTICALLY through both providers. The fields below are the
// exact production inputs (turn-request.ts shapes): profile, messages,
// pageContext, sessionStart. `expectations` carries deterministic-check ground
// truth (an answer the tutor must NOT reveal, the concept a good grader should
// name, etc.) — never sent to the model, only used to score.
export type EvalCase = {
  id: string
  category: EvalCategory
  turnKind: TurnKind
  description: string
  profile: LearningProfile
  messages: TurnMessage[]
  pageContext?: PageContext
  sessionStart?: SessionStartPrompt
  expectations: CaseExpectations
}

export type CaseExpectations = {
  // The final numeric/textual answer the tutor must NOT reveal on a Socratic
  // turn (answer-leak check). Provide a few surface forms if relevant.
  withheldAnswers?: string[]
  // The tutor should be asking a question this turn (most Socratic turns).
  expectQuestion?: boolean
  // The turn should CLOSE the session (say ends with the close sentence + a
  // session-complete field).
  expectClose?: boolean
  // The turn should emit at least one grounded annotation whose target.text is
  // copied verbatim from the page.
  expectAnnotation?: boolean
  // The concept a correct assessment.concept_key should name (or null if the
  // case is deliberately off-curriculum / first-turn).
  expectedConceptKey?: string | null
  // The misconception (in plain words) a good grader should surface; scored by
  // the judge, not by a rule.
  expectedMisconception?: string
  // Free-text note on what a good response does here (fed to the judge as
  // rubric context, not to the tutor model).
  rubricNote: string
}

// One provider's answer to one case, with everything measured.
export type ProviderRun = {
  provider: ProviderId
  // Raw arguments the model returned in its tool/function call (or null if it
  // returned none — a hard structured-output failure).
  rawArgs: Record<string, unknown> | null
  // The envelope after running production's parseEnvelopeObject on rawArgs.
  // null = the validator rejected it (no usable structured output).
  envelope: TurnEnvelope | null
  // True when we had to fall back to the text-degrade path (tool absent or
  // validator rejected the tool args) — production's runTutorTurn does exactly
  // this; here it counts as a reliability miss.
  usedTextFallback: boolean
  // Session-start only: the opening_question failed production's
  // isCleanOpeningQuestion gate and would have triggered a retry/fallback.
  openingQuestionRejected: boolean
  tokens: TokenBreakdown
  modelLatencyMs: number
  totalLatencyMs: number
  costUsd: number
  // Populated only if the provider call threw (crash).
  error: string | null
}

export type Reliability = {
  toolCallReturned: boolean
  argsParseOk: boolean
  requiredFieldsPresent: boolean
  schemaValid: boolean
  retryOrFallbackRequired: boolean
  crashed: boolean
  malformed: boolean
}

export type DeterministicQuality = {
  leakedAnswer: boolean | null // null = not applicable to this case
  askedQuestion: boolean | null
  closedCorrectly: boolean | null
  annotationsGrounded: boolean | null // all annotation targets copied verbatim from page
  chipsFieldsExclusive: boolean // never emitted both
  sayWordCount: number
}

export type JudgeScores = {
  socratic: number // 1-5
  avoidsRevealing: number // 1-5
  engagement: number // 1-5
  explanationQuality: number // 1-5
  adaptsToLevel: number // 1-5
  misconceptionCorrect: boolean | null // null when N/A
  summaryQuality: number | null // 1-5, closing only
  annotationQuality: number | null // 1-5, annotation only
  criticalRegression: boolean // would block a tutoring turn
  rationale: string
}

export type ScoredRun = {
  run: ProviderRun
  reliability: Reliability
  quality: DeterministicQuality
  judge: JudgeScores | null // null when judging is skipped (mock/no-judge)
}

export type CaseResult = {
  case: EvalCase
  byProvider: Record<ProviderId, ScoredRun>
}

export type EvalResults = {
  mode: 'live' | 'mock'
  datasetName: string
  generatedAt: string
  turnsPerSession: number
  judgeModel: string | null
  providerModels: Record<ProviderId, string>
  cases: CaseResult[]
}
