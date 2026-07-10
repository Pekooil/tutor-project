// The tutoring-quality judge: Claude Opus 4.8 scores each response against a
// Socratic rubric. Blind to which provider produced the response (the prompt
// never names the model). Structured output via a forced tool so scores parse
// deterministically. This is the subjective half of the hybrid scoring; the
// objective half is metrics.ts.

import Anthropic from '@anthropic-ai/sdk'
import type { EvalCase, JudgeScores, ProviderRun } from './types'

export const JUDGE_MODEL = 'claude-opus-4-8'

const nullableNumber = { anyOf: [{ type: 'number' }, { type: 'null' }] } as const

const JUDGE_TOOL: Anthropic.Tool = {
  name: 'submit_judgment',
  description: 'Submit your rubric scores for the tutor response under review.',
  strict: true,
  input_schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      socratic: { type: 'integer', enum: [1, 2, 3, 4, 5], description: 'Follows Socratic method (guides vs. tells).' },
      avoids_revealing: { type: 'integer', enum: [1, 2, 3, 4, 5], description: 'Avoids handing over the final answer when it should withhold.' },
      engagement: { type: 'integer', enum: [1, 2, 3, 4, 5], description: 'Keeps the student engaged; warm, motivating.' },
      explanation_quality: { type: 'integer', enum: [1, 2, 3, 4, 5], description: 'Clarity and correctness of the explanation/hint.' },
      adapts_to_level: { type: 'integer', enum: [1, 2, 3, 4, 5], description: 'Adapts step size to the student profile and moment.' },
      misconception_correct: {
        type: 'string',
        enum: ['yes', 'no', 'na'],
        description: 'If the case has a specific misconception, did the response correctly identify/handle it? "na" if not applicable.',
      },
      summary_quality: { ...nullableNumber, description: 'Closing turns only: quality of the session summary/close. null if N/A.' },
      annotation_quality: { ...nullableNumber, description: 'Annotation turns only: usefulness + groundedness of annotations. null if N/A.' },
      critical_regression: {
        type: 'boolean',
        description: 'True if this response would be unacceptable in production (leaks answer, skips Socratic method entirely, breaks workflow, unusable output).',
      },
      rationale: { type: 'string', description: 'One or two sentences justifying the scores.' },
    },
    required: [
      'socratic',
      'avoids_revealing',
      'engagement',
      'explanation_quality',
      'adapts_to_level',
      'misconception_correct',
      'summary_quality',
      'annotation_quality',
      'critical_regression',
      'rationale',
    ],
  },
}

function contextBlock(kase: EvalCase, run: ProviderRun): string {
  const convo = kase.messages.map((m) => `${m.role.toUpperCase()}: ${m.content}`).join('\n')
  const env = run.envelope
  const structured = env
    ? [
        `say: ${JSON.stringify(env.say)}`,
        `mode: ${env.mode ?? '(none)'}`,
        env.assessment ? `assessment: ${JSON.stringify(env.assessment)}` : null,
        env.annotations ? `annotations: ${JSON.stringify(env.annotations)}` : null,
        env.session ? `session: ${JSON.stringify(env.session)}` : null,
        env.chips ? `chips: ${JSON.stringify(env.chips)}` : null,
        env.answerFields ? `answer_fields: ${JSON.stringify(env.answerFields)}` : null,
      ]
        .filter(Boolean)
        .join('\n')
    : '(NO VALID STRUCTURED OUTPUT — the tutor failed to return a usable response)'

  return [
    `CATEGORY: ${kase.category}`,
    `WHAT A GOOD RESPONSE DOES HERE: ${kase.expectations.rubricNote}`,
    kase.expectations.expectedMisconception ? `EXPECTED MISCONCEPTION: ${kase.expectations.expectedMisconception}` : null,
    kase.pageContext ? `PAGE CONTEXT (on screen): ${JSON.stringify(kase.pageContext)}` : null,
    '',
    'CONVERSATION SO FAR:',
    convo,
    '',
    'TUTOR RESPONSE UNDER REVIEW:',
    structured,
  ]
    .filter((l) => l !== null)
    .join('\n')
}

const JUDGE_SYSTEM =
  'You are an expert evaluator of a Socratic math tutor. You grade one tutor response against a rubric. ' +
  'The Socratic ideal: guide with questions and small hints, surface misconceptions, keep the student ' +
  'thinking, and do NOT reveal the final answer prematurely (except on a genuine closing turn). Be strict ' +
  'but fair. Judge only the response shown; do not assume anything not present. You do not know which model ' +
  'produced it. Always call submit_judgment exactly once.'

export async function judge(kase: EvalCase, run: ProviderRun): Promise<JudgeScores> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  const res = await client.messages.create({
    model: JUDGE_MODEL,
    max_tokens: 1024,
    output_config: { effort: 'low' },
    system: JUDGE_SYSTEM,
    messages: [{ role: 'user', content: contextBlock(kase, run) }],
    tools: [JUDGE_TOOL],
    tool_choice: { type: 'tool', name: 'submit_judgment' },
  } as Anthropic.MessageCreateParamsNonStreaming)

  const block = res.content.find(
    (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use' && b.name === 'submit_judgment',
  )
  const input = (block?.input ?? {}) as Record<string, unknown>
  const num = (v: unknown, d = 0) => (typeof v === 'number' ? v : d)
  const nnum = (v: unknown) => (typeof v === 'number' ? v : null)
  return {
    socratic: num(input.socratic),
    avoidsRevealing: num(input.avoids_revealing),
    engagement: num(input.engagement),
    explanationQuality: num(input.explanation_quality),
    adaptsToLevel: num(input.adapts_to_level),
    misconceptionCorrect: input.misconception_correct === 'na' ? null : input.misconception_correct === 'yes',
    summaryQuality: nnum(input.summary_quality),
    annotationQuality: nnum(input.annotation_quality),
    criticalRegression: input.critical_regression === true,
    rationale: typeof input.rationale === 'string' ? input.rationale : '',
  }
}
