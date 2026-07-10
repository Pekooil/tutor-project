// Orchestrator: runs every case through both providers with identical inputs,
// scores each response (reliability + deterministic quality + optional judge),
// writes results JSON and the markdown report. Sequential on purpose — gentle on
// rate limits, deterministic ordering.
//
// Env:
//   EVAL_MODE=live|mock         (default: live if keys present, else mock)
//   EVAL_NO_JUDGE=1             skip the Opus 4.8 judge (deterministic-only)
//   EVAL_TURNS_PER_SESSION=8    cost-per-session multiplier
//   EVAL_LIMIT=N                run only the first N cases (smoke)

import { mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { DATASET } from './dataset'
import { DATASET_B } from './dataset-b'
import { runGpt, runHaiku } from './providers'
import { mockJudge, mockRun } from './mock'
import { deterministicQuality, reliability } from './metrics'
import { JUDGE_MODEL, judge } from './judge'
import { renderReport } from './report'
import { DEFAULT_TURNS_PER_SESSION } from './pricing'
import type { CaseResult, EvalCase, EvalResults, ProviderId, ProviderRun, ScoredRun } from './types'

const PROVIDER_MODELS: Record<ProviderId, string> = {
  'haiku-4-5': 'claude-haiku-4-5-20251001',
  'gpt-4o-mini': 'gpt-4o-mini',
}

function resolveMode(): 'live' | 'mock' {
  const forced = process.env.EVAL_MODE
  if (forced === 'live' || forced === 'mock') return forced
  return process.env.ANTHROPIC_API_KEY && process.env.OPENAI_API_KEY ? 'live' : 'mock'
}

// EVAL_DATASET selects the scenario set: 'b' -> dataset-b.ts, anything else ->
// the default dataset.ts. Add more datasets by extending this map.
function resolveDataset(): { name: string; cases: EvalCase[] } {
  const which = (process.env.EVAL_DATASET ?? '').toLowerCase()
  if (which === 'b' || which === 'dataset-b') return { name: 'dataset-b', cases: DATASET_B }
  return { name: 'dataset', cases: DATASET }
}

async function scoreOne(
  kase: EvalCase,
  run: ProviderRun,
  mode: 'live' | 'mock',
  useJudge: boolean,
): Promise<ScoredRun> {
  const rel = reliability(kase, run)
  const q = deterministicQuality(kase, run)
  let j: ScoredRun['judge'] = null
  if (useJudge) {
    j = mode === 'mock' ? mockJudge(kase, run) : await judge(kase, run)
  }
  return { run, reliability: rel, quality: q, judge: j }
}

export async function runEval(): Promise<{ reportPath: string; results: EvalResults }> {
  const mode = resolveMode()
  const dataset = resolveDataset()
  const useJudge = process.env.EVAL_NO_JUDGE !== '1'
  const turnsPerSession = Number(process.env.EVAL_TURNS_PER_SESSION) || DEFAULT_TURNS_PER_SESSION
  const limit = Number(process.env.EVAL_LIMIT) || dataset.cases.length
  const cases = dataset.cases.slice(0, limit)

  const results: EvalResults = {
    mode,
    datasetName: dataset.name,
    generatedAt: new Date().toISOString(),
    turnsPerSession,
    judgeModel: useJudge ? (mode === 'mock' ? `${JUDGE_MODEL} (mock)` : JUDGE_MODEL) : null,
    providerModels: PROVIDER_MODELS,
    cases: [],
  }

  for (let i = 0; i < cases.length; i++) {
    const kase = cases[i]
    // eslint-disable-next-line no-console
    console.log(`[eval] (${i + 1}/${cases.length}) ${kase.id} [${kase.category}] — mode=${mode}`)

    const haikuRun = mode === 'mock' ? mockRun(kase, 'haiku-4-5', i) : await runHaiku(kase)
    const gptRun = mode === 'mock' ? mockRun(kase, 'gpt-4o-mini', i) : await runGpt(kase)

    const byProvider = {
      'haiku-4-5': await scoreOne(kase, haikuRun, mode, useJudge),
      'gpt-4o-mini': await scoreOne(kase, gptRun, mode, useJudge),
    } satisfies CaseResult['byProvider']

    results.cases.push({ case: kase, byProvider })
  }

  const resultsDir = fileURLToPath(new URL('./results', import.meta.url))
  const reportDir = fileURLToPath(new URL('./report', import.meta.url))
  mkdirSync(resultsDir, { recursive: true })
  mkdirSync(reportDir, { recursive: true })

  const stamp = results.generatedAt.slice(0, 10)
  const suffix = mode === 'mock' ? '-SAMPLE' : ''
  // Non-default datasets get a filename tag so trials don't overwrite each other.
  const dsTag = dataset.name === 'dataset' ? '' : `-${dataset.name}`
  const reportPath = `${reportDir}/comparison-${stamp}${dsTag}${suffix}.md`
  writeFileSync(`${resultsDir}/latest${dsTag}.json`, JSON.stringify(results, null, 2))
  writeFileSync(reportPath, renderReport(results))

  // eslint-disable-next-line no-console
  console.log(`[eval] wrote ${reportPath}`)
  return { reportPath, results }
}
