// Deterministic scoring: reliability (objective structured-output facts) and
// rule-based tutoring-quality checks. No model calls here — these are cheap,
// reproducible, and free. The subjective dimensions are the judge's job
// (judge.ts). Reuses production's saysClosingSentence and the real tool
// `required` lists so "schema valid" and "closed correctly" mean exactly what
// they mean in production.

import { ENVELOPE_TOOL, SESSION_START_TOOL } from '../lib/ai/claude'
import { saysClosingSentence } from '../lib/ai/envelope'
import { renderPageContext } from '../lib/ai/page-context'
import type { DeterministicQuality, EvalCase, ProviderRun, Reliability } from './types'

function requiredKeys(kase: EvalCase): string[] {
  const tool = kase.turnKind === 'session-start' ? SESSION_START_TOOL : ENVELOPE_TOOL
  const schema = tool.input_schema as { required?: string[] }
  return schema.required ?? []
}

export function reliability(kase: EvalCase, run: ProviderRun): Reliability {
  const crashed = run.error !== null
  const toolCallReturned = run.rawArgs !== null
  const argsParseOk = run.rawArgs !== null
  const req = requiredKeys(kase)
  const requiredFieldsPresent = run.rawArgs !== null && req.every((k) => k in (run.rawArgs as Record<string, unknown>))
  const schemaValid = run.envelope !== null
  return {
    toolCallReturned,
    argsParseOk,
    requiredFieldsPresent,
    schemaValid,
    retryOrFallbackRequired: run.usedTextFallback || run.openingQuestionRejected,
    crashed,
    malformed: crashed || !schemaValid,
  }
}

// Answer-leak matcher. Whitespace-insensitive (so "(x+2)(x+3)" matches
// "(x + 2)(x + 3)") and case-insensitive. Purely-numeric answers get digit
// boundaries so withholding "5" doesn't false-positive on "15" or "0.5".
// Heuristic by nature — flagged as such in the report.
function mentions(say: string, answer: string): boolean {
  const hay = say.toLowerCase()
  const needle = answer.toLowerCase().trim()
  if (!needle) return false
  const isNumeric = /^[\d.]+$/.test(needle)
  const body = needle
    .split('')
    .map((c) => c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('\\s*')
  const pattern = isNumeric ? `(?<![\\d.])${body}(?![\\d.])` : body
  try {
    return new RegExp(pattern, 'i').test(hay)
  } catch {
    return hay.includes(needle.replace(/\s+/g, ''))
  }
}

function pageHaystack(kase: EvalCase): string {
  if (!kase.pageContext) return ''
  return renderPageContext(kase.pageContext).toLowerCase()
}

export function deterministicQuality(kase: EvalCase, run: ProviderRun): DeterministicQuality {
  const env = run.envelope
  const say = env?.say ?? ''
  const exp = kase.expectations

  const leakedAnswer =
    exp.withheldAnswers && exp.withheldAnswers.length > 0
      ? exp.withheldAnswers.some((a) => mentions(say, a))
      : null

  const askedQuestion = exp.expectQuestion === undefined ? null : say.includes('?')

  const closedCorrectly =
    exp.expectClose === undefined
      ? null
      : saysClosingSentence(say) && env?.session?.complete === true

  let annotationsGrounded: boolean | null = null
  if (exp.expectAnnotation) {
    const hay = pageHaystack(kase)
    const anns = env?.annotations ?? []
    const withText = anns.filter((a) => typeof a.target.text === 'string' && a.target.text.length > 0)
    annotationsGrounded =
      withText.length > 0 && withText.every((a) => hay.includes((a.target.text as string).toLowerCase()))
  }

  const chipsFieldsExclusive = !(env?.chips && env.chips.length > 0 && env.answerFields && env.answerFields.length > 0)

  const sayWordCount = say.trim() ? say.trim().split(/\s+/).length : 0

  return { leakedAnswer, askedQuestion, closedCorrectly, annotationsGrounded, chipsFieldsExclusive, sayWordCount }
}
