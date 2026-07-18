import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it, expect } from 'vitest'
import { getTutorProvider } from '@/lib/ai/provider'
import type { TurnEnvelope } from '@/lib/ai/envelope'
import { SCENARIOS, score, type Scenario, type ScoredTurn } from './fixtures'

// Sprint 24 (ADR-038) — Task 6: the GO/NO-GO eval. Runs every fixture through
// BOTH providers, scores the envelope-compliance metrics the migration risks
// regressing, times each call, and prints a Haiku-vs-GPT-4o-mini comparison
// table. This is the gate: GPT-4o-mini switches traffic ONLY if it meets or
// beats the Haiku baseline on compliance AND latency.
//
// LIVE + PAID + gated: it makes real Anthropic and OpenAI calls, so it is
// SKIPPED unless you opt in explicitly. Run it with:
//
//   EVAL_LIVE=1 ANTHROPIC_API_KEY=... OPENAI_API_KEY=... \
//     npx vitest run tests/tutor-eval          (from /web)
//
// Without EVAL_LIVE=1 (e.g. in the normal `npm test` suite) it is a no-op, so
// CI never spends money or flakes on model behavior.

const LIVE = process.env.EVAL_LIVE === '1'
const haveAnthropic = !!process.env.ANTHROPIC_API_KEY
const haveOpenAI = !!process.env.OPENAI_API_KEY
const CAN_RUN = LIVE && haveAnthropic && haveOpenAI

type ProviderName = 'anthropic' | 'openai'

async function runOne(provider: ProviderName, s: Scenario): Promise<{ env: TurnEnvelope | null; ms: number }> {
  process.env.TUTOR_PROVIDER = provider
  const p = getTutorProvider()
  const t0 = performance.now()
  try {
    // The opening scan returns OpeningScanResult (envelope + classification)
    // since the forced-tool rework; the eval scores the envelope like every
    // other turn kind.
    const env =
      s.kind === 'opening'
        ? (await p.runOpeningScan({ pageContext: s.args.pageContext!, profile: s.args.profile })).envelope
        : await p.runTurn(s.args)
    return { env, ms: performance.now() - t0 }
  } catch (err) {
    console.error(`[eval] ${provider} failed on "${s.name}":`, err)
    return { env: null, ms: performance.now() - t0 }
  }
}

function pct(nums: boolean[]): number {
  if (nums.length === 0) return 100
  return Math.round((nums.filter(Boolean).length / nums.length) * 100)
}

function percentile(xs: number[], p: number): number {
  if (xs.length === 0) return 0
  const s = [...xs].sort((a, b) => a - b)
  const idx = Math.max(0, Math.ceil((p / 100) * s.length) - 1)
  return Math.round(s[idx])
}

type Aggregate = {
  provider: ProviderName
  valid: number
  assessment: number
  annotation: number
  chips: number
  close: number
  notFabricated: number
  p50: number
  p95: number
}

function aggregate(provider: ProviderName, scored: ScoredTurn[]): Aggregate {
  return {
    provider,
    valid: pct(scored.map((r) => r.valid)),
    assessment: pct(scored.map((r) => r.assessmentOk)),
    annotation: pct(scored.map((r) => r.annotationOk)),
    chips: pct(scored.map((r) => r.chipsOk)),
    close: pct(scored.map((r) => r.closeOk)),
    notFabricated: pct(scored.map((r) => r.notFabricated)),
    p50: percentile(scored.map((r) => r.ms), 50),
    p95: percentile(scored.map((r) => r.ms), 95),
  }
}

describe('tutor-eval (Sprint 24 gate)', () => {
  it.skipIf(!CAN_RUN)(
    'Haiku 4.5 vs GPT-4o-mini — envelope compliance + latency',
    async () => {
      const providers: ProviderName[] = ['anthropic', 'openai']
      const results: Record<ProviderName, ScoredTurn[]> = { anthropic: [], openai: [] }

      for (const provider of providers) {
        for (const s of SCENARIOS) {
          const { env, ms } = await runOne(provider, s)
          results[provider].push(score(s, env, ms))
        }
      }

      const aggs = providers.map((p) => aggregate(p, results[p]))

      // Build the decision table, print it, AND persist it to disk — vitest's
      // default reporter hides passing-test console output on non-TTY runs, so
      // a green run would otherwise silently discard the (paid) results.
      const lines: string[] = []
      lines.push('='.repeat(72))
      lines.push('TUTOR EVAL — Haiku 4.5 vs GPT-4o-mini  (higher = better; latency ms lower = better)')
      lines.push(`fixtures: ${SCENARIOS.length}  (⚠️ synthetic — replace with recorded turns for a production gate)`)
      lines.push('='.repeat(72))
      const row = (label: string, key: keyof Aggregate, suffix = '%') =>
        lines.push(
          `  ${label.padEnd(28)}` + aggs.map((a) => `${String(a[key])}${suffix}`.padStart(16)).join('')
        )
      lines.push(`  ${''.padEnd(28)}` + aggs.map((a) => a.provider.padStart(16)).join(''))
      lines.push('  ' + '-'.repeat(60))
      row('envelope valid', 'valid')
      row('assessment present', 'assessment')
      row('annotation grounded', 'annotation')
      row('chips shape ok', 'chips')
      row('session-close discipline', 'close')
      row('no fabricated turn', 'notFabricated')
      row('latency p50', 'p50', 'ms')
      row('latency p95', 'p95', 'ms')
      lines.push('='.repeat(72))
      lines.push('GATE: switch traffic only if GPT-4o-mini >= Haiku on EVERY compliance row AND on latency.')
      // eslint-disable-next-line no-console
      console.log('\n' + lines.join('\n') + '\n')
      const outDir = fileURLToPath(new URL('.', import.meta.url))
      writeFileSync(join(outDir, 'last-run.txt'), lines.join('\n') + '\n')
      writeFileSync(join(outDir, 'last-run.json'), JSON.stringify({ aggregates: aggs, perScenario: results }, null, 2) + '\n')

      // Hard structural bar (not a model-quality judgment): both providers must
      // return a valid, parseable envelope for every fixture. The compliance/
      // latency comparison above is the human GO/NO-GO read.
      for (const a of aggs) {
        expect(a.valid, `${a.provider} returned an invalid/blank envelope on some fixture`).toBe(100)
      }
    },
    180_000
  )

  it('fixtures are well-formed (runs without keys)', () => {
    expect(SCENARIOS.length).toBeGreaterThan(0)
    for (const s of SCENARIOS) {
      expect(s.name).toBeTruthy()
      expect(['regular', 'opening', 'session-start']).toContain(s.kind)
      if (s.kind === 'regular') expect(s.args.messages.at(-1)?.role).toBe('user')
    }
  })
})
