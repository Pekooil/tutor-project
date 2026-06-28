import 'server-only'
import Anthropic from '@anthropic-ai/sdk'
import { buildSystemPrompt } from './system-prompt'
import { HARDCODED_PROFILE } from './profile'
import type { PageContext } from './page-context'

export type TurnMessage = {
  role: 'user' | 'assistant'
  content: string
}

const MODEL = 'claude-haiku-4-5-20251001'
const MAX_TOKENS = 600 // PLAN.md §2.5 per-turn response budget

function createClient(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY

  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY is not set — the Claude proxy cannot run without it.')
  }

  return new Anthropic({ apiKey })
}

// The only call site for the Anthropic SDK (ADR-008) — the route never
// imports @anthropic-ai/sdk directly. No streaming this sprint; the voice
// sprint adds streaming alongside the §2.5 JSON output envelope.
export async function runTutorTurn({
  messages,
  pageContext,
}: {
  messages: TurnMessage[]
  pageContext?: PageContext
}): Promise<{ reply: string }> {
  const response = await createClient().messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: buildSystemPrompt(HARDCODED_PROFILE, pageContext),
    messages,
  })

  const textBlock = response.content.find((block) => block.type === 'text')
  const reply = textBlock?.type === 'text' ? textBlock.text : ''

  return { reply }
}
