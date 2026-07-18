import { appendFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, it, expect } from 'vitest'
import { runOpeningScanToolOpenAI, runTurnOpenAI } from '@/lib/ai/tutor-openai'
import { evalProfile, pageContains } from './fixtures'

const OUT = fileURLToPath(new URL('./repro-leak.out.txt', import.meta.url))
function record(label: string, data: unknown): void {
  appendFileSync(OUT, `${label}: ${JSON.stringify(data)}\n`)
}

// Regression guard for the t-variable leak (live-find 2026-07-17): the OpenAI
// few-shot — injected as FAKE CONVERSATION HISTORY — carried a synthetic
// "5t^2 - 6t + 8t^2 - 8t" example, and on degraded page captures GPT-4o-mini
// tutored THAT problem instead of the student's (repro'd 8/12 pre-fix; 0/12
// after moving the example into a labelled system-prompt block + the
// OPENAI_PAGE_GROUNDING_BOOST). Gated + paid like tutor-eval: only runs with
// EVAL_LIVE=1. Re-run after any change to the OpenAI boosts or example block.

const LIVE = process.env.EVAL_LIVE === '1' && !!process.env.OPENAI_API_KEY

const CALC_PAGE = {
  title: 'Derivatives — Practice',
  text: 'Find the derivative of f(x) = x^3 + 2x^2 - 7x + 1.',
  equations: [{ text: 'f(x) = x^3 + 2x^2 - 7x + 1' }],
}

// Pages whose capture came back degraded — the suspected live conditions. A
// real SPA/MathJax calculus page often captures with the math mangled or as
// prose with no equations array.
const EMPTY_PAGE = { title: 'Untitled', text: '', equations: [] }
const NOISY_CALC_PAGE = {
  title: 'Homework Help',
  text: 'Question 4 of 12. Evaluate the limit as x approaches 2 of (x squared minus 4) over (x minus 2). Show your work. Chapter review. Next question. Previous question. Submit answer.',
  equations: [],
}

// The t-example's own signature only — generic pedagogy phrases ("like
// terms") false-positive on ungrounded-but-not-leaked replies.
const LEAK_MARKERS = ['t^2', 't²', '13t', '5t', '8t', 't-squared', 't squared']
function leaks(say: string): string[] {
  const s = say.toLowerCase()
  return LEAK_MARKERS.filter((m) => s.includes(m))
}

// Math never extracted (canvas/image-rendered problem) — the page names a
// problem but its content is not in the capture.
const NO_MATH_PAGE = {
  title: 'AP Calculus — Unit 5 Homework',
  text: 'Problem 3. Answer the question shown below. Show all work for full credit. Submit. Next. Grade: --',
  equations: [],
}

describe('t-example leak repro (GPT path)', () => {
  it.skipIf(!LIVE)('opening scan grounding — 4 page shapes × repeats', async () => {
    process.env.TUTOR_PROVIDER = 'openai'
    const pages = { calc: CALC_PAGE, empty: EMPTY_PAGE, noisyCalc: NOISY_CALC_PAGE, noMath: NO_MATH_PAGE }
    const failures: string[] = []
    for (const [name, page] of Object.entries(pages)) {
      for (let i = 0; i < 3; i++) {
        const r = await runOpeningScanToolOpenAI({ pageContext: page, profile: evalProfile() })
        const found = leaks(r.envelope.say)
        record(`scan ${name} #${i}${found.length ? ' LEAK' : ''}`, {
          say: r.envelope.say,
          conceptKey: r.conceptKey,
          topicTitle: r.topicTitle,
        })
        if (found.length) failures.push(`${name} #${i}: ${found.join(',')}`)
      }
    }
    expect(failures, failures.join(' | ')).toEqual([])
  }, 300000)

  it.skipIf(!LIVE)('regular turn grounding — ambiguous asks on degraded pages', async () => {
    process.env.TUTOR_PROVIDER = 'openai'
    const failures: string[] = []
    const cases = [
      { name: 'calc/help', page: CALC_PAGE, msg: 'can you help me with this problem?' },
      { name: 'noMath/first-step', page: NO_MATH_PAGE, msg: 'what do I do first?' },
      { name: 'empty/first-step', page: EMPTY_PAGE, msg: 'what do I do first?' },
      { name: 'noMath/dont-get-it', page: NO_MATH_PAGE, msg: "I don't get it" },
    ]
    for (const c of cases) {
      for (let i = 0; i < 3; i++) {
        const env = await runTurnOpenAI({
          messages: [{ role: 'user', content: c.msg }],
          pageContext: c.page,
          profile: evalProfile(),
        })
        const found = leaks(env.say)
        record(`turn ${c.name} #${i}${found.length ? ' LEAK' : ''}`, { say: env.say })
        if (found.length) failures.push(`${c.name} #${i}: ${found.join(',')}`)
      }
    }
    expect(failures, failures.join(' | ')).toEqual([])
  }, 300000)

  // Haiku-parity first-reply rule (2026-07-17, Darcy): on the FIRST student
  // turn with visible on-screen math, GPT must engage THAT problem — not ask
  // what the student is working on — and must annotate it (target.text copied
  // exactly from the page). All repeats must pass: "always", not "usually".
  it.skipIf(!LIVE)('first reply engages + annotates the on-screen problem', async () => {
    process.env.TUTOR_PROVIDER = 'openai'
    const failures: string[] = []
    for (let i = 0; i < 3; i++) {
      const env = await runTurnOpenAI({
        messages: [{ role: 'user', content: 'can you help me with this problem?' }],
        pageContext: CALC_PAGE,
        profile: evalProfile(),
      })
      const say = env.say.toLowerCase()
      const engaged = say.includes('derivative') || say.includes('x^3') || say.includes('x^{3}')
      const annotated = (env.annotations ?? []).some(
        (a) => !!a.target?.text && pageContains(CALC_PAGE, a.target.text)
      )
      record(`first-reply #${i}${engaged && annotated ? '' : ' FAIL'}`, {
        say: env.say,
        annotations: (env.annotations ?? []).map((a) => a.target?.text),
      })
      if (!engaged) failures.push(`#${i}: did not engage the on-screen problem`)
      if (!annotated) failures.push(`#${i}: no grounded annotation`)
    }
    expect(failures, failures.join(' | ')).toEqual([])
  }, 300000)

  // Chips-by-default (Darcy 2026-07-17): a small-answer-set question must
  // carry 2–4 answer chips, like Haiku's turns do. All repeats must pass.
  it.skipIf(!LIVE)('small-answer question offers chips every time', async () => {
    process.env.TUTOR_PROVIDER = 'openai'
    const failures: string[] = []
    for (let i = 0; i < 3; i++) {
      const env = await runTurnOpenAI({
        messages: [
          { role: 'assistant', content: "Let's start with the first term. What is the derivative of x^3?" },
          { role: 'user', content: 'im not sure' },
        ],
        pageContext: CALC_PAGE,
        profile: evalProfile(),
      })
      const n = env.chips?.length ?? 0
      record(`chips #${i}${n >= 2 && n <= 4 ? '' : ' FAIL'}`, { say: env.say, chips: env.chips ?? [] })
      if (n < 2 || n > 4) failures.push(`#${i}: ${n} chips`)
    }
    expect(failures, failures.join(' | ')).toEqual([])
  }, 300000)

  // No extra-problem offers (Darcy 2026-07-17): after the correct final
  // answer the tutor closes — it never asks "want to try another one?" or
  // proposes more questions/practice. All repeats must pass.
  it.skipIf(!LIVE)('correct final answer closes without offering more problems', async () => {
    process.env.TUTOR_PROVIDER = 'openai'
    const OFFER = /another (one|problem|question|example)|try (another|one more|a different)|more (problems|questions|practice|examples)|next (problem|question|exercise)/i
    const failures: string[] = []
    for (let i = 0; i < 3; i++) {
      const env = await runTurnOpenAI({
        messages: [
          { role: 'assistant', content: 'You have the derivative of every term now. What is the full derivative of f(x)?' },
          { role: 'user', content: "f'(x) = 3x^2 + 4x - 7" },
        ],
        pageContext: CALC_PAGE,
        profile: evalProfile(),
      })
      const offered = OFFER.test(env.say)
      const closed = !!env.session
      record(`close #${i}${!offered && closed ? '' : ' FAIL'}`, { say: env.say, session: env.session ?? null })
      if (offered) failures.push(`#${i}: offered more problems`)
      if (!closed) failures.push(`#${i}: did not close`)
    }
    expect(failures, failures.join(' | ')).toEqual([])
  }, 300000)
})

// Parity probe: does Haiku engage the on-page problem on a bare "help" turn?
import { runTutorTurn } from '@/lib/ai/claude'
describe('haiku parity — calc/help', () => {
  it.skipIf(!(process.env.EVAL_LIVE === '1' && !!process.env.ANTHROPIC_API_KEY))('haiku calc/help', async () => {
    for (let i = 0; i < 2; i++) {
      const env = await runTutorTurn({
        messages: [{ role: 'user', content: 'can you help me with this problem?' }],
        pageContext: CALC_PAGE,
        profile: evalProfile(),
      })
      record(`haiku calc/help #${i}`, { say: env.say })
    }
  }, 120000)
})

// Parity probe: does Haiku grade the same correct final answer as correct?
describe('haiku parity — final-answer grading', () => {
  it.skipIf(!(process.env.EVAL_LIVE === '1' && !!process.env.ANTHROPIC_API_KEY))('haiku close', async () => {
    for (let i = 0; i < 2; i++) {
      const env = await runTutorTurn({
        messages: [
          { role: 'assistant', content: 'You have the derivative of every term now. What is the full derivative of f(x)?' },
          { role: 'user', content: "f'(x) = 3x^2 + 4x - 7" },
        ],
        pageContext: CALC_PAGE,
        profile: evalProfile(),
      })
      record(`haiku close #${i}`, { say: env.say, session: env.session ?? null })
    }
  }, 120000)
})
