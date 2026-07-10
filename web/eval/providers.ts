// The provider seam. Production (web/lib/ai/claude.ts) calls Anthropic directly
// with no provider abstraction, so this introduces a minimal one HERE, in the
// eval module only, without touching production. Both adapters consume the SAME
// production artifacts so the comparison is apples-to-apples:
//   - buildSystemPromptBlocks / buildSystemPrompt (system-prompt.ts) — identical text
//   - ENVELOPE_TOOL / SESSION_START_TOOL (claude.ts) — the identical JSON schema
//   - parseEnvelopeObject (envelope.ts) — the identical validator
// The only per-provider differences are the wire format each SDK requires.

import Anthropic from '@anthropic-ai/sdk'
import OpenAI from 'openai'
import { ENVELOPE_TOOL, SESSION_START_TOOL } from '../lib/ai/claude'
import type { TurnMessage } from '../lib/ai/claude'
import { buildSystemPrompt, buildSystemPromptBlocks } from '../lib/ai/system-prompt'
import { parseEnvelopeObject } from '../lib/ai/envelope'
import type { EvalCase, ProviderRun } from './types'
import { costUsd, GPT_4O_MINI_PRICING, HAIKU_PRICING, type TokenBreakdown } from './pricing'

// MUST MIRROR web/lib/ai/claude.ts (MODEL, MAX_TOKENS) — these are the exact
// production call parameters. If claude.ts changes them, change them here too;
// they are private there so cannot be imported. Kept identical so the Haiku arm
// of the eval measures production behavior, not a variant of it.
const HAIKU_MODEL = 'claude-haiku-4-5-20251001'
const GPT_MODEL = 'gpt-4o-mini'
const MAX_TOKENS = 600

// Session-start uses SESSION_START_TOOL and threads sessionStart into the
// prompt; every other kind uses ENVELOPE_TOOL. isCleanOpeningQuestion is
// re-implemented here (production keeps it private) to mirror the retry gate.
const FABRICATED_TURN_PATTERNS = [
  /\bis that what you need help with\b/i,
  /\blooks like you'?re working on\b/i,
  /\bi'?m working on\b/i,
  /\btrips? me up\b/i,
  /\bcan we start there\b/i,
]
const MAX_OPENING_QUESTION_CHARS = 320

function isCleanOpeningQuestion(text: string): boolean {
  if (text.length === 0 || text.length > MAX_OPENING_QUESTION_CHARS) return false
  if (FABRICATED_TURN_PATTERNS.some((p) => p.test(text))) return false
  if (/\n\s*\n/.test(text)) return false
  const terminal = text.match(/[.?!]/g) ?? []
  return terminal.length <= 3
}

function toolFor(kase: EvalCase): Anthropic.Tool {
  return kase.turnKind === 'session-start' ? SESSION_START_TOOL : ENVELOPE_TOOL
}

// Session-start's tool has no top-level `say`; the server assembles it. For the
// eval we reconstruct the same displayed `say` so downstream checks (word
// count, question presence) see what the student would see.
function reconstructSay(kase: EvalCase, args: Record<string, unknown>): Record<string, unknown> {
  if (kase.turnKind !== 'session-start') return args
  const board = typeof args.board_text === 'string' ? args.board_text.trim() : ''
  const q = typeof args.opening_question === 'string' ? args.opening_question.trim() : ''
  return {
    say: board ? `$$${board}$$ ${q}` : q,
    mode: 'socratic',
    solution_progress: 0,
    assessment: {
      concept_key: null,
      outcome: 'none',
      reasoning_quality: 'none',
      self_confidence: 'unknown',
      misconception_category: null,
      misconception_description: null,
      confidence: 'low',
    },
    annotations: args.annotations ?? [],
    profile_tags: [],
    signals: [],
    answer_fields: args.answer_fields,
  }
}

export function scoreArgs(
  kase: EvalCase,
  rawArgs: Record<string, unknown> | null,
): Pick<ProviderRun, 'envelope' | 'usedTextFallback' | 'openingQuestionRejected'> {
  if (!rawArgs) {
    return { envelope: null, usedTextFallback: true, openingQuestionRejected: false }
  }
  const forParse = reconstructSay(kase, rawArgs)
  const envelope = parseEnvelopeObject(forParse) ?? null
  const openingQuestionRejected =
    kase.turnKind === 'session-start' &&
    !isCleanOpeningQuestion(typeof rawArgs.opening_question === 'string' ? rawArgs.opening_question.trim() : '')
  return { envelope, usedTextFallback: envelope === null, openingQuestionRejected }
}

// ---- Anthropic / Haiku 4.5 ----------------------------------------------

export async function runHaiku(kase: EvalCase): Promise<ProviderRun> {
  const tool = toolFor(kase)
  const system = buildSystemPromptBlocks(kase.profile, kase.pageContext, {
    format: 'envelope',
    ...(kase.sessionStart ? { sessionStart: kase.sessionStart } : {}),
  })
  const client = new Anthropic({ apiKey: requireKey('ANTHROPIC_API_KEY') })

  const start = Date.now()
  try {
    const res = await client.messages.create({
      model: HAIKU_MODEL,
      max_tokens: MAX_TOKENS,
      system,
      messages: kase.messages as TurnMessage[],
      tools: [tool],
      tool_choice: { type: 'tool', name: tool.name },
    })
    const latency = Date.now() - start
    const block = res.content.find(
      (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use' && b.name === tool.name,
    )
    const rawArgs =
      block && typeof block.input === 'object' && block.input !== null
        ? (block.input as Record<string, unknown>)
        : null
    const tokens: TokenBreakdown = {
      inputTokens: res.usage.input_tokens ?? 0,
      cacheReadTokens: res.usage.cache_read_input_tokens ?? 0,
      cacheWriteTokens: res.usage.cache_creation_input_tokens ?? 0,
      outputTokens: res.usage.output_tokens ?? 0,
    }
    return {
      provider: 'haiku-4-5',
      rawArgs,
      ...scoreArgs(kase, rawArgs),
      tokens,
      modelLatencyMs: latency,
      totalLatencyMs: Date.now() - start,
      costUsd: costUsd(tokens, HAIKU_PRICING),
      error: null,
    }
  } catch (err) {
    return crashRun('haiku-4-5', start, err)
  }
}

// ---- OpenAI / GPT-4o-mini -----------------------------------------------

// OpenAI's `strict: true` structured outputs require EVERY property to appear in
// `required` (optional-by-omission is disallowed; optionals must be typed as
// nullable). Calyxa's production ENVELOPE_TOOL deliberately leaves `session`,
// `answer_fields` (and nested `style`/`note`/`step`) optional, so strict mode
// would 400 on the unmodified production schema. To keep the JSON schema
// IDENTICAL across providers we call GPT-4o-mini in NON-strict function-calling
// mode. The asymmetry (Anthropic strict-guaranteed vs OpenAI best-effort) is a
// real provider difference the reliability metrics are meant to surface — see
// openAiStrictIncompatibilities() for the report's static finding.
export async function runGpt(kase: EvalCase): Promise<ProviderRun> {
  const tool = toolFor(kase)
  const systemText = buildSystemPrompt(kase.profile, kase.pageContext, {
    format: 'envelope',
    ...(kase.sessionStart ? { sessionStart: kase.sessionStart } : {}),
  })
  const client = new OpenAI({ apiKey: requireKey('OPENAI_API_KEY') })

  const start = Date.now()
  try {
    const res = await client.chat.completions.create({
      model: GPT_MODEL,
      max_completion_tokens: MAX_TOKENS,
      messages: [
        { role: 'system', content: systemText },
        ...kase.messages.map((m) =>
          m.role === 'user'
            ? ({ role: 'user', content: m.content } as const)
            : ({ role: 'assistant', content: m.content } as const),
        ),
      ],
      tools: [
        {
          type: 'function',
          function: {
            name: tool.name,
            description: tool.description,
            parameters: tool.input_schema as Record<string, unknown>,
            strict: false,
          },
        },
      ],
      tool_choice: { type: 'function', function: { name: tool.name } },
    })
    const latency = Date.now() - start
    const call = res.choices[0]?.message?.tool_calls?.[0]
    let rawArgs: Record<string, unknown> | null = null
    if (call && call.type === 'function' && call.function?.arguments) {
      try {
        const parsed = JSON.parse(call.function.arguments)
        rawArgs = typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : null
      } catch {
        rawArgs = null // arguments were not valid JSON — a parse failure
      }
    }
    const cached = res.usage?.prompt_tokens_details?.cached_tokens ?? 0
    const prompt = res.usage?.prompt_tokens ?? 0
    const tokens: TokenBreakdown = {
      inputTokens: Math.max(0, prompt - cached),
      cacheReadTokens: cached,
      cacheWriteTokens: 0,
      outputTokens: res.usage?.completion_tokens ?? 0,
    }
    return {
      provider: 'gpt-4o-mini',
      rawArgs,
      ...scoreArgs(kase, rawArgs),
      tokens,
      modelLatencyMs: latency,
      totalLatencyMs: Date.now() - start,
      costUsd: costUsd(tokens, GPT_4O_MINI_PRICING),
      error: null,
    }
  } catch (err) {
    return crashRun('gpt-4o-mini', start, err)
  }
}

function crashRun(provider: ProviderRun['provider'], start: number, err: unknown): ProviderRun {
  return {
    provider,
    rawArgs: null,
    envelope: null,
    usedTextFallback: true,
    openingQuestionRejected: false,
    tokens: { inputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0 },
    modelLatencyMs: Date.now() - start,
    totalLatencyMs: Date.now() - start,
    costUsd: 0,
    error: err instanceof Error ? err.message : String(err),
  }
}

function requireKey(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`${name} is not set — the eval cannot make live calls without it.`)
  return v
}

// Static analysis (no API call): which object nodes in a tool schema would make
// OpenAI's strict structured-output mode reject it (a property not listed in
// `required`). Surfaced in the report as a migration finding.
export function openAiStrictIncompatibilities(tool: Anthropic.Tool): string[] {
  const findings: string[] = []
  const walk = (node: unknown, path: string) => {
    if (typeof node !== 'object' || node === null) return
    const obj = node as Record<string, unknown>
    if (obj.type === 'object' && obj.properties && typeof obj.properties === 'object') {
      const props = Object.keys(obj.properties as Record<string, unknown>)
      const required = Array.isArray(obj.required) ? (obj.required as string[]) : []
      const missing = props.filter((p) => !required.includes(p))
      if (missing.length > 0) findings.push(`${path || '(root)'}: optional ${missing.join(', ')}`)
      for (const [k, v] of Object.entries(obj.properties as Record<string, unknown>)) {
        walk(v, path ? `${path}.${k}` : k)
      }
    }
    if (obj.items) walk(obj.items, `${path}[]`)
    if (Array.isArray(obj.anyOf)) obj.anyOf.forEach((n) => walk(n, path))
  }
  walk(tool.input_schema, '')
  return findings
}
