// Offline mock provider + mock judge. NOT a real evaluation — it feeds
// deterministic, synthetic responses through the exact same scoring + report
// pipeline so `npm run eval:mock` can (a) prove the harness wiring end-to-end
// without API keys, and (b) show the report format. Every number here is
// invented; the SAMPLE report is labeled as such. The synthetic responses are
// deliberately shaped so GPT-4o-mini trails Haiku on a few cases (a leak, an
// ungrounded annotation, a missed close, a dropped tool call) so the report's
// regression/side-by-side branches are exercised.

import { scoreArgs } from './providers'
import { costUsd, GPT_4O_MINI_PRICING, HAIKU_PRICING, type ModelPricing, type TokenBreakdown } from './pricing'
import type { EvalCase, EvalCategory, JudgeScores, ProviderId, ProviderRun } from './types'

type Defects = { leak?: boolean; ungrounded?: boolean; noClose?: boolean; dropTool?: boolean }

// The synthetic defects the mock injects into the GPT-4o-mini arm, keyed by
// CATEGORY so they apply to any dataset (dataset.ts, dataset-b.ts, or a new
// one) — not by case id. Purely illustrative; labeled SAMPLE in the report.
const DEFECTS_BY_CATEGORY: Partial<Record<EvalCategory, Defects>> = {
  misconception: { leak: true },
  annotation: { ungrounded: true },
  closing: { noClose: true },
  'edge-case': { dropTool: true },
}

function defectsFor(kase: EvalCase, provider: ProviderId): Defects {
  return provider === 'gpt-4o-mini' ? (DEFECTS_BY_CATEGORY[kase.category] ?? {}) : {}
}

// A well-formed envelope-tool payload for a case, then optionally damaged.
function envelopeArgs(kase: EvalCase, defects: Defects): Record<string, unknown> | null {
  if (defects.dropTool) return null

  const base: Record<string, unknown> = {
    say: 'You are close — check that your pair also adds to the target, not just multiplies. Which sum do you get?',
    mode: 'socratic',
    solution_progress: 0.3,
    assessment: {
      concept_key: kase.expectations.expectedConceptKey ?? null,
      outcome: 'partial',
      reasoning_quality: 'shallow',
      self_confidence: 'med',
      misconception_category: kase.expectations.expectedMisconception ? 'expansion' : null,
      misconception_description: kase.expectations.expectedMisconception ?? null,
      confidence: 'med',
    },
    annotations: [],
    profile_tags: [],
    signals: ['guidance-up'],
    chips: [],
  }

  if (kase.category === 'closing') {
    base.say = defects.noClose
      ? 'Nice work getting there.'
      : 'Exactly right — that factors cleanly. Now closing tutoring session.'
    base.solution_progress = 1
    if (!defects.noClose) base.session = { complete: true, reason: 'solved' }
  }

  if (kase.category === 'annotation') {
    // Ground the "good" annotation to this case's actual page (any dataset), so
    // only the injected ungrounded defect (a token that isn't on the page) fails
    // the verbatim-grounding check.
    const onPage = kase.pageContext?.equations?.[0]?.text ?? ''
    base.say = 'Look at the like terms on screen — which ones can you combine?'
    base.annotations = [
      {
        id: 'a1',
        type: 'highlight',
        target: { kind: 'textMatch', text: defects.ungrounded ? '99z^9' : onPage },
        label: 'Add like terms',
      },
    ]
  }

  if (defects.leak && kase.expectations.withheldAnswers?.length) {
    base.say = `Right idea — it comes out to ${kase.expectations.withheldAnswers[0]}. See it?`
  }

  return base
}

function sessionStartArgs(kase: EvalCase): Record<string, unknown> {
  return {
    board_text: kase.sessionStart?.question ?? '',
    opening_question: 'Looking at what you have, what is the very first move you could make here?',
    annotations: [],
  }
}

function tokensFor(provider: ProviderId, i: number): TokenBreakdown {
  // Haiku rides the cached 1h stable prefix (small uncached tail); GPT-4o-mini
  // has no equivalent warm cross-session prefix on a cold run (larger uncached
  // input). Synthetic but shaped to mirror the real caching asymmetry.
  if (provider === 'haiku-4-5') {
    return { inputTokens: 130, cacheReadTokens: i === 0 ? 0 : 2180, cacheWriteTokens: i === 0 ? 2180 : 0, outputTokens: 150 }
  }
  return { inputTokens: 2320, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 165 }
}

export function mockRun(kase: EvalCase, provider: ProviderId, index: number): ProviderRun {
  const defects = defectsFor(kase, provider)
  const rawArgs = kase.turnKind === 'session-start' ? sessionStartArgs(kase) : envelopeArgs(kase, defects)
  const tokens = tokensFor(provider, index)
  const pricing: ModelPricing = provider === 'haiku-4-5' ? HAIKU_PRICING : GPT_4O_MINI_PRICING
  const latency = provider === 'haiku-4-5' ? 1000 + index * 20 : 720 + index * 15
  return {
    provider,
    rawArgs,
    ...scoreArgs(kase, rawArgs),
    tokens,
    modelLatencyMs: latency,
    totalLatencyMs: latency + 2,
    costUsd: costUsd(tokens, pricing),
    error: null,
  }
}

export function mockJudge(kase: EvalCase, run: ProviderRun): JudgeScores {
  const strong = run.provider === 'haiku-4-5'
  const defects = defectsFor(kase, run.provider)
  const leaked = defects.leak === true
  const failed = run.envelope === null
  const regression = failed || leaked || (run.provider === 'gpt-4o-mini' && Object.keys(defects).length > 0)
  const s = (hi: number, lo: number) => (strong ? hi : Math.max(1, lo))
  return {
    socratic: leaked ? 2 : s(5, 4),
    avoidsRevealing: leaked ? 1 : s(5, 4),
    engagement: s(4, 3),
    explanationQuality: failed ? 1 : s(5, 3),
    adaptsToLevel: s(4, 3),
    misconceptionCorrect: kase.expectations.expectedMisconception ? (strong ? true : false) : null,
    summaryQuality: kase.category === 'closing' ? (strong ? 5 : 2) : null,
    annotationQuality: kase.category === 'annotation' ? (strong ? 5 : 2) : null,
    criticalRegression: regression,
    rationale: strong
      ? 'Guides with a question and withholds the answer; well matched to the student level. (SAMPLE)'
      : regression
        ? 'Falls short here — see the category-specific defect. (SAMPLE)'
        : 'Reasonable Socratic turn, slightly less targeted. (SAMPLE)',
  }
}
