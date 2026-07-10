// Renders the comparison report (markdown) from measured results. All numbers
// are computed from the run — nothing here is hand-authored. When mode is
// 'mock', the report is prominently labeled SAMPLE.

import { ENVELOPE_TOOL, SESSION_START_TOOL } from '../lib/ai/claude'
import { openAiStrictIncompatibilities } from './providers'
import type { CaseResult, EvalResults, ProviderId, ScoredRun } from './types'

const PROVIDERS: ProviderId[] = ['haiku-4-5', 'gpt-4o-mini']
const LABEL: Record<ProviderId, string> = { 'haiku-4-5': 'Haiku 4.5', 'gpt-4o-mini': 'GPT-4o-mini' }

function avg(ns: number[]): number {
  return ns.length ? ns.reduce((a, b) => a + b, 0) / ns.length : 0
}
function pct(n: number, d: number): string {
  return d === 0 ? 'n/a' : `${((100 * n) / d).toFixed(0)}%`
}
function usd(n: number): string {
  return `$${n.toFixed(6)}`
}
function usd2(n: number): string {
  return `$${n.toFixed(2)}`
}
function ms(n: number): string {
  return `${Math.round(n)} ms`
}

// The five core 1-5 judge dimensions, averaged, as one comparable quality score.
function composite(sr: ScoredRun): number | null {
  if (!sr.judge) return null
  const j = sr.judge
  return avg([j.socratic, j.avoidsRevealing, j.engagement, j.explanationQuality, j.adaptsToLevel])
}

// Per requirement 6: the concrete critical-regression flags for one response.
function regressionFlags(sr: ScoredRun, kase: CaseResult['case']): string[] {
  const f: string[] = []
  if (sr.reliability.crashed) f.push('crashed')
  if (!sr.reliability.schemaValid) f.push('broke JSON schema (no usable envelope)')
  if (sr.reliability.schemaValid && !sr.reliability.requiredFieldsPresent) f.push('missing required field(s)')
  if (sr.quality.leakedAnswer === true) f.push('leaked the withheld answer')
  if (sr.quality.closedCorrectly === false && kase.expectations.expectClose) f.push('failed to close a solved session')
  if (kase.expectations.expectAnnotation && sr.quality.annotationsGrounded === false)
    f.push('unusable/ungrounded annotations')
  if (sr.judge) {
    if (sr.judge.socratic <= 2) f.push('skipped Socratic questioning')
    if (sr.judge.avoidsRevealing <= 2 && !kase.expectations.expectClose) f.push('revealed answer too early')
    if (sr.judge.criticalRegression) f.push('judge: unacceptable for production')
  }
  return Array.from(new Set(f))
}

type Agg = {
  n: number
  schemaValid: number
  toolReturned: number
  requiredPresent: number
  crashes: number
  malformed: number
  retries: number
  leaks: number // over applicable cases
  leakApplicable: number
  missedQuestion: number
  questionApplicable: number
  closedOk: number
  closeApplicable: number
  groundedOk: number
  annotationApplicable: number
  chipFieldViolations: number
  avgLatency: number
  avgModelLatency: number
  avgTokensIn: number
  avgTokensOut: number
  avgCacheRead: number
  avgCostReq: number
  judgeComposite: number | null
  judge: {
    socratic: number
    avoidsRevealing: number
    engagement: number
    explanationQuality: number
    adaptsToLevel: number
    misconceptionRate: number | null
    summary: number | null
    annotation: number | null
    criticalRegressions: number
  } | null
}

function aggregate(cases: CaseResult[], provider: ProviderId): Agg {
  const runs = cases.map((c) => c.byProvider[provider])
  const withJudge = runs.filter((r) => r.judge)
  const applicable = (pred: (c: CaseResult) => boolean) => cases.filter(pred)

  const leakCases = applicable((c) => c.byProvider[provider].quality.leakedAnswer !== null)
  const qCases = applicable((c) => c.byProvider[provider].quality.askedQuestion !== null)
  const closeCases = applicable((c) => c.byProvider[provider].quality.closedCorrectly !== null)
  const annCases = applicable((c) => c.byProvider[provider].quality.annotationsGrounded !== null)

  const mrateBase = withJudge.filter((r) => r.judge!.misconceptionCorrect !== null)
  const summaryBase = withJudge.filter((r) => r.judge!.summaryQuality !== null)
  const annBase = withJudge.filter((r) => r.judge!.annotationQuality !== null)

  return {
    n: runs.length,
    schemaValid: runs.filter((r) => r.reliability.schemaValid).length,
    toolReturned: runs.filter((r) => r.reliability.toolCallReturned).length,
    requiredPresent: runs.filter((r) => r.reliability.requiredFieldsPresent).length,
    crashes: runs.filter((r) => r.reliability.crashed).length,
    malformed: runs.filter((r) => r.reliability.malformed).length,
    retries: runs.filter((r) => r.reliability.retryOrFallbackRequired).length,
    leaks: leakCases.filter((c) => c.byProvider[provider].quality.leakedAnswer === true).length,
    leakApplicable: leakCases.length,
    missedQuestion: qCases.filter((c) => c.byProvider[provider].quality.askedQuestion === false).length,
    questionApplicable: qCases.length,
    closedOk: closeCases.filter((c) => c.byProvider[provider].quality.closedCorrectly === true).length,
    closeApplicable: closeCases.length,
    groundedOk: annCases.filter((c) => c.byProvider[provider].quality.annotationsGrounded === true).length,
    annotationApplicable: annCases.length,
    chipFieldViolations: runs.filter((r) => !r.quality.chipsFieldsExclusive).length,
    avgLatency: avg(runs.map((r) => r.run.totalLatencyMs)),
    avgModelLatency: avg(runs.map((r) => r.run.modelLatencyMs)),
    avgTokensIn: avg(runs.map((r) => r.run.tokens.inputTokens + r.run.tokens.cacheReadTokens + r.run.tokens.cacheWriteTokens)),
    avgTokensOut: avg(runs.map((r) => r.run.tokens.outputTokens)),
    avgCacheRead: avg(runs.map((r) => r.run.tokens.cacheReadTokens)),
    avgCostReq: avg(runs.map((r) => r.run.costUsd)),
    judgeComposite: withJudge.length ? avg(withJudge.map((r) => composite(r)!)) : null,
    judge: withJudge.length
      ? {
          socratic: avg(withJudge.map((r) => r.judge!.socratic)),
          avoidsRevealing: avg(withJudge.map((r) => r.judge!.avoidsRevealing)),
          engagement: avg(withJudge.map((r) => r.judge!.engagement)),
          explanationQuality: avg(withJudge.map((r) => r.judge!.explanationQuality)),
          adaptsToLevel: avg(withJudge.map((r) => r.judge!.adaptsToLevel)),
          misconceptionRate: mrateBase.length
            ? mrateBase.filter((r) => r.judge!.misconceptionCorrect === true).length / mrateBase.length
            : null,
          summary: summaryBase.length ? avg(summaryBase.map((r) => r.judge!.summaryQuality!)) : null,
          annotation: annBase.length ? avg(annBase.map((r) => r.judge!.annotationQuality!)) : null,
          criticalRegressions: withJudge.filter((r) => r.judge!.criticalRegression).length,
        }
      : null,
  }
}

export function renderReport(results: EvalResults): string {
  const { cases } = results
  const H = aggregate(cases, 'haiku-4-5')
  const G = aggregate(cases, 'gpt-4o-mini')
  const out: string[] = []

  out.push('# Calyxa provider evaluation — Haiku 4.5 vs GPT-4o-mini')
  out.push('')
  if (results.mode === 'mock') {
    out.push('> ⚠️ **SAMPLE REPORT — MOCK DATA.** Every number below was produced by `mock.ts`')
    out.push('> with synthetic responses to demonstrate the harness and report format. It is **not**')
    out.push('> a real provider comparison. Run `npm run eval` with live API keys for real data.')
    out.push('')
  }
  out.push(
    `**Generated:** ${results.generatedAt} · **Mode:** ${results.mode} · **Dataset:** \`${results.datasetName}\` · ` +
      `**Cases:** ${cases.length} · **Judge:** ${results.judgeModel ?? '(none)'} · **Turns/session assumed:** ${results.turnsPerSession}`,
  )
  out.push('')
  out.push(
    `**Models:** \`${results.providerModels['haiku-4-5']}\` vs \`${results.providerModels['gpt-4o-mini']}\`. ` +
      'Both received byte-identical system-prompt text (`buildSystemPrompt`), identical user messages, identical ' +
      'tutoring context, identical student profile, identical session history, and the identical production JSON ' +
      'schema (`ENVELOPE_TOOL` / `SESSION_START_TOOL`). Both responses were validated by the identical production ' +
      'validator (`parseEnvelopeObject`).')
  out.push('')

  // --- Structured-output enforcement note ---
  const envInc = openAiStrictIncompatibilities(ENVELOPE_TOOL)
  const ssInc = openAiStrictIncompatibilities(SESSION_START_TOOL)
  out.push('## Structured-output enforcement (a schema-shape finding)')
  out.push('')
  out.push(
    'Anthropic ran the schema in **strict** mode (`strict: true` — schema-guaranteed). OpenAI’s strict ' +
      'structured-output mode requires *every* property to appear in `required`; Calyxa’s production schema ' +
      'deliberately leaves several optional, so strict mode **cannot accept the production schema unmodified**. ' +
      'To keep the schema identical, GPT-4o-mini was called in **non-strict** function-calling mode (best-effort). ' +
      'This asymmetry is real and is exactly what the reliability numbers below measure.')
  out.push('')
  out.push('Optional properties that block OpenAI strict mode (would each need to be listed in `required`):')
  out.push('')
  out.push('```')
  out.push(`ENVELOPE_TOOL:\n  ${envInc.join('\n  ') || '(none)'}`)
  out.push(`SESSION_START_TOOL:\n  ${ssInc.join('\n  ') || '(none)'}`)
  out.push('```')
  out.push('')

  // --- Reliability ---
  out.push('## Reliability')
  out.push('')
  out.push('| Metric | Haiku 4.5 | GPT-4o-mini |')
  out.push('|---|---|---|')
  out.push(`| Tool/function call returned | ${H.toolReturned}/${H.n} | ${G.toolReturned}/${G.n} |`)
  out.push(`| Schema valid (parseEnvelopeObject accepted) | ${H.schemaValid}/${H.n} (${pct(H.schemaValid, H.n)}) | ${G.schemaValid}/${G.n} (${pct(G.schemaValid, G.n)}) |`)
  out.push(`| All required fields present | ${H.requiredPresent}/${H.n} | ${G.requiredPresent}/${G.n} |`)
  out.push(`| Retry / text-fallback required | ${H.retries}/${H.n} | ${G.retries}/${G.n} |`)
  out.push(`| Malformed responses | ${H.malformed}/${H.n} | ${G.malformed}/${G.n} |`)
  out.push(`| Crashes | ${H.crashes}/${H.n} | ${G.crashes}/${G.n} |`)
  out.push(`| chips/answer_fields exclusivity violations | ${H.chipFieldViolations}/${H.n} | ${G.chipFieldViolations}/${G.n} |`)
  out.push('')
  out.push(`**Schema compliance:** Haiku ${pct(H.schemaValid, H.n)} · GPT-4o-mini ${pct(G.schemaValid, G.n)}.`)
  out.push('')

  // --- Performance ---
  const HcostSession = H.avgCostReq * results.turnsPerSession
  const GcostSession = G.avgCostReq * results.turnsPerSession
  out.push('## Performance')
  out.push('')
  out.push('| Metric | Haiku 4.5 | GPT-4o-mini |')
  out.push('|---|---|---|')
  out.push(`| Avg model latency | ${ms(H.avgModelLatency)} | ${ms(G.avgModelLatency)} |`)
  out.push(`| Avg total latency | ${ms(H.avgLatency)} | ${ms(G.avgLatency)} |`)
  out.push(`| Avg tokens in (incl. cache) | ${Math.round(H.avgTokensIn)} | ${Math.round(G.avgTokensIn)} |`)
  out.push(`| Avg cache-read tokens | ${Math.round(H.avgCacheRead)} | ${Math.round(G.avgCacheRead)} |`)
  out.push(`| Avg tokens out | ${Math.round(H.avgTokensOut)} | ${Math.round(G.avgTokensOut)} |`)
  out.push(`| Avg cost / request | ${usd(H.avgCostReq)} | ${usd(G.avgCostReq)} |`)
  out.push(`| Cost / session (${results.turnsPerSession} turns) | ${usd(HcostSession)} | ${usd(GcostSession)} |`)
  out.push('')

  // --- Tutoring quality ---
  out.push('## Tutoring quality')
  out.push('')
  out.push('_Deterministic checks (rules) plus the Opus 4.8 judge rubric (1–5)._')
  out.push('')
  out.push('| Metric | Haiku 4.5 | GPT-4o-mini |')
  out.push('|---|---|---|')
  out.push(`| Answer leaks (of applicable) | ${H.leaks}/${H.leakApplicable} | ${G.leaks}/${G.leakApplicable} |`)
  out.push(`| Missed a needed question | ${H.missedQuestion}/${H.questionApplicable} | ${G.missedQuestion}/${G.questionApplicable} |`)
  out.push(`| Closed a solved session correctly | ${H.closedOk}/${H.closeApplicable} | ${G.closedOk}/${G.closeApplicable} |`)
  out.push(`| Grounded annotations | ${H.groundedOk}/${H.annotationApplicable} | ${G.groundedOk}/${G.annotationApplicable} |`)
  if (H.judge && G.judge) {
    out.push(`| Judge · Socratic style | ${H.judge.socratic.toFixed(2)} | ${G.judge.socratic.toFixed(2)} |`)
    out.push(`| Judge · avoids revealing | ${H.judge.avoidsRevealing.toFixed(2)} | ${G.judge.avoidsRevealing.toFixed(2)} |`)
    out.push(`| Judge · engagement | ${H.judge.engagement.toFixed(2)} | ${G.judge.engagement.toFixed(2)} |`)
    out.push(`| Judge · explanation quality | ${H.judge.explanationQuality.toFixed(2)} | ${G.judge.explanationQuality.toFixed(2)} |`)
    out.push(`| Judge · adapts to level | ${H.judge.adaptsToLevel.toFixed(2)} | ${G.judge.adaptsToLevel.toFixed(2)} |`)
    out.push(`| Judge · misconception correct | ${rate(H.judge.misconceptionRate)} | ${rate(G.judge.misconceptionRate)} |`)
    out.push(`| Judge · summary quality (closing) | ${numOr(H.judge.summary)} | ${numOr(G.judge.summary)} |`)
    out.push(`| Judge · annotation quality | ${numOr(H.judge.annotation)} | ${numOr(G.judge.annotation)} |`)
    out.push(`| **Judge · composite (5-dim avg)** | **${numOr(H.judgeComposite)}** | **${numOr(G.judgeComposite)}** |`)
    out.push(`| Judge · critical regressions | ${H.judge.criticalRegressions} | ${G.judge.criticalRegressions} |`)
  }
  out.push('')

  // --- Critical regressions (requirement 6) ---
  out.push('## Critical regressions flagged')
  out.push('')
  const regRows: string[] = []
  for (const c of cases) {
    for (const p of PROVIDERS) {
      const flags = regressionFlags(c.byProvider[p], c.case)
      if (flags.length) regRows.push(`- **${LABEL[p]}** · \`${c.case.id}\` (${c.case.category}): ${flags.join('; ')}`)
    }
  }
  out.push(regRows.length ? regRows.join('\n') : '_None flagged._')
  out.push('')

  // --- Notable regressions / improvements (GPT vs Haiku, per case) ---
  const deltas = cases
    .map((c) => {
      const h = composite(c.byProvider['haiku-4-5'])
      const g = composite(c.byProvider['gpt-4o-mini'])
      return { c, h, g, d: h !== null && g !== null ? g - h : null }
    })
    .filter((x): x is { c: CaseResult; h: number; g: number; d: number } => x.d !== null)
    .sort((a, b) => a.d - b.d)

  out.push('## Notable regressions (GPT-4o-mini worse than Haiku)')
  out.push('')
  const worse = deltas.filter((x) => x.d < -0.25)
  out.push(
    worse.length
      ? worse.map((x) => `- \`${x.c.case.id}\` (${x.c.case.category}): composite ${x.g.toFixed(2)} vs ${x.h.toFixed(2)} (Δ ${x.d.toFixed(2)})`).join('\n')
      : '_None beyond noise._',
  )
  out.push('')
  out.push('## Notable improvements (GPT-4o-mini better than Haiku)')
  out.push('')
  const better = deltas.filter((x) => x.d > 0.25).sort((a, b) => b.d - a.d)
  out.push(
    better.length
      ? better.map((x) => `- \`${x.c.case.id}\` (${x.c.case.category}): composite ${x.g.toFixed(2)} vs ${x.h.toFixed(2)} (Δ +${x.d.toFixed(2)})`).join('\n')
      : '_None beyond noise._',
  )
  out.push('')

  // --- Side-by-side for the largest differences ---
  out.push('## Side-by-side — largest differences')
  out.push('')
  const spotlight = [...deltas].sort((a, b) => Math.abs(b.d) - Math.abs(a.d)).slice(0, 3)
  for (const x of spotlight) {
    out.push(`### \`${x.c.case.id}\` (${x.c.case.category}) — Δ ${x.d >= 0 ? '+' : ''}${x.d.toFixed(2)}`)
    out.push('')
    out.push(`_${x.c.case.expectations.rubricNote}_`)
    out.push('')
    for (const p of PROVIDERS) {
      const sr = x.c.byProvider[p]
      out.push(`**${LABEL[p]}** (composite ${numOr(composite(sr))})`)
      out.push('')
      out.push('> ' + (sr.run.envelope?.say ?? '_(no valid structured output)_').replace(/\n/g, '\n> '))
      if (sr.judge) out.push('>')
      if (sr.judge) out.push('> — judge: ' + sr.judge.rationale)
      out.push('')
    }
  }

  // --- Savings ---
  out.push('## Estimated monthly cost & savings')
  out.push('')
  out.push(
    `Per-session cost = avg cost/request × ${results.turnsPerSession} turns. ` +
      `Haiku ${usd(HcostSession)}/session · GPT-4o-mini ${usd(GcostSession)}/session. ` +
      `Positive savings = GPT-4o-mini cheaper.`,
  )
  out.push('')
  out.push('| Monthly sessions | Haiku 4.5 | GPT-4o-mini | Savings (GPT vs Haiku) |')
  out.push('|---|---|---|---|')
  for (const n of [1_000, 10_000, 100_000]) {
    const hc = HcostSession * n
    const gc = GcostSession * n
    out.push(`| ${n.toLocaleString()} | ${usd2(hc)} | ${usd2(gc)} | ${usd2(hc - gc)} |`)
  }
  out.push('')

  // --- Recommendation ---
  out.push('## Recommendation')
  out.push('')
  out.push(recommendation(results, H, G, cases))
  out.push('')

  // --- Methodology / caveats ---
  out.push('## Methodology & caveats')
  out.push('')
  out.push(
    [
      '- **Identical inputs.** Same system-prompt text, user messages, tutoring context, student profile, session ' +
        'history, tools, and JSON schema for both providers. Responses validated by the same `parseEnvelopeObject`.',
      '- **Screenshots/images: N/A.** Calyxa’s production pipeline sends page context as extracted **text + ' +
        'equations**, never images — so a faithful reuse of production inputs is text-based. No vision path was ' +
        'invented.',
      '- **Enforcement asymmetry.** Anthropic used `strict:true`; OpenAI used non-strict function calling because ' +
        'its strict mode rejects the unmodified production schema (see the structured-output section).',
      '- **Prompt caching.** Anthropic gets a 1h cache breakpoint on the stable prefix (a production feature); ' +
        'OpenAI’s automatic caching differs. Cost reflects each provider’s real caching, not a hidden subsidy.',
      '- **Answer-leak detection is heuristic** (whitespace-insensitive substring with digit boundaries) and can ' +
        'miss paraphrased leaks; the judge’s `avoids_revealing` is the qualitative backstop.',
      '- **Scope.** The eval measures the model layer (provider + prompt + schema + validator). Persistence, ' +
        'FSRS writes, and pin grounding (`completeTurn`) are provider-agnostic and out of scope.',
      '- **Pricing** is in `eval/pricing.ts` with sources; correct it there if a provider changes rates and re-run.',
      `- **Dataset:** ${cases.length} cases, one per category (${Array.from(new Set(cases.map((c) => c.case.category))).join(', ')}). Grow \`eval/dataset.ts\` for more statistical power.`,
    ].join('\n'),
  )
  out.push('')
  return out.join('\n')
}

function rate(r: number | null): string {
  return r === null ? 'n/a' : `${(100 * r).toFixed(0)}%`
}
function numOr(n: number | null): string {
  return n === null ? 'n/a' : n.toFixed(2)
}

function recommendation(results: EvalResults, H: Agg, G: Agg, cases: CaseResult[]): string {
  const reliabilityGap = H.schemaValid / H.n - G.schemaValid / G.n
  const qualityGap = (H.judgeComposite ?? 0) - (G.judgeComposite ?? 0)
  const gptCrit = G.judge?.criticalRegressions ?? 0
  const gptLeaks = G.leaks
  const comparable = reliabilityGap <= 0.05 && qualityGap <= 0.3 && gptCrit === 0 && gptLeaks === 0

  // Categories where GPT matched or beat Haiku with no regression — hybrid candidates.
  const safeCats: string[] = []
  const keepCats: string[] = []
  for (const c of cases) {
    const g = c.byProvider['gpt-4o-mini']
    const h = c.byProvider['haiku-4-5']
    const gc = composite(g)
    const hc = composite(h)
    const regressed =
      g.reliability.malformed ||
      g.quality.leakedAnswer === true ||
      (g.judge?.criticalRegression ?? false) ||
      (gc !== null && hc !== null && gc < hc - 0.5)
    if (regressed) keepCats.push(c.case.category)
    else safeCats.push(c.case.category)
  }
  const keep = Array.from(new Set(keepCats))
  const safe = Array.from(new Set(safeCats)).filter((c) => !keep.includes(c))

  const HcostSession = H.avgCostReq * results.turnsPerSession
  const GcostSession = G.avgCostReq * results.turnsPerSession
  const cheaper = GcostSession < HcostSession

  const lines: string[] = []
  lines.push(
    '_Calyxa’s stated priority is preserving tutoring quality over minimizing cost. The verdict below weights ' +
      'quality and reliability first; cost is the tie-breaker._',
  )
  lines.push('')
  lines.push(
    `**Is GPT-4o-mini statistically comparable to Haiku 4.5 for Calyxa?** ${
      comparable
        ? 'On this dataset, yes — schema compliance and judged quality are within noise and it produced no critical ' +
          'regressions.'
        : 'Not on this dataset. ' +
          `Schema-compliance gap ${(reliabilityGap * 100).toFixed(0)} pts, judge-composite gap ${qualityGap.toFixed(2)}, ` +
          `${gptCrit} critical regression(s), ${gptLeaks} answer leak(s). ` +
          `(${cases.length} cases is a screen, not a significance test — widen the dataset before a final call.)`
    }`,
  )
  lines.push('')
  lines.push(
    `**Which provider should be the default today?** ${
      comparable && cheaper
        ? 'GPT-4o-mini is defensible as the default given equivalent measured quality and lower cost — but confirm on a ' +
          'larger dataset first.'
        : '**Keep Haiku 4.5 as the default.** It is the measured quality/reliability leader here, and it is the model ' +
          'the production schema is tuned for (Anthropic strict tool-calling).'
    }`,
  )
  lines.push('')
  lines.push(
    `**Features that should remain on Haiku:** ${
      keep.length ? keep.join(', ') + ' — GPT-4o-mini regressed or under-performed on these.' : 'none stood out on this dataset.'
    } Structured-output-critical turns (annotations grounded verbatim, session-close signaling, misconception tagging) are the highest-risk to move, because OpenAI cannot enforce the production schema in strict mode.`,
  )
  lines.push('')
  lines.push(
    `**Is a hybrid routing strategy recommended?** ${
      safe.length && keep.length
        ? `Plausibly. Lower-risk categories (${safe.join(', ')}) looked safe for GPT-4o-mini; route ${keep.join(', ')} ` +
          'to Haiku. But a hybrid doubles prompt-tuning and eval surface and only pays off if GPT’s cost edge is large ' +
          'relative to the added complexity — validate on a bigger dataset before committing.'
        : comparable
          ? 'Not necessary — if a larger run confirms parity, move everything; if not, keep everything on Haiku.'
          : 'Not yet — the gaps are broad enough that a single default (Haiku) is simpler and safer than split routing.'
    }`,
  )
  lines.push('')
  const s = (n: number) => usd2((HcostSession - GcostSession) * n)
  lines.push(
    `**Estimated monthly savings** (GPT vs Haiku): 1k sessions ${s(1000)}, 10k ${s(10000)}, 100k ${s(100000)}. ` +
      (cheaper
        ? 'Real, but small in absolute terms until six-figure session volumes — weigh against the quality/reliability cost.'
        : 'GPT-4o-mini was not cheaper per session here, so cost is not even a reason to switch.'),
  )
  lines.push('')
  lines.push(
    `**Is migrating justified by the measured data?** ${
      comparable && cheaper
        ? 'Provisionally yes on cost, *if* a larger dataset confirms parity — but the schema-enforcement asymmetry ' +
          '(no strict mode) remains a standing reliability risk that flat cost savings do not offset.'
        : 'No. On the measured data, migrating trades quality and hard schema-enforcement for savings that are modest ' +
          'until very high volume. Given the quality-first priority, that trade is not justified today.'
    }`,
  )
  return lines.join('\n')
}
