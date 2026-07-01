import 'server-only'
import Anthropic from '@anthropic-ai/sdk'
import { buildSystemPrompt } from './system-prompt'
import type { LearningProfile } from './profile'
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

// Non-streaming turn — used by /api/ai/turn (legacy) and voice synthesis
// path where the full reply is needed before TTS can start.
export async function runTutorTurn({
  messages,
  pageContext,
  profile,
}: {
  messages: TurnMessage[]
  pageContext?: PageContext
  profile: LearningProfile
}): Promise<{ reply: string }> {
  const response = await createClient().messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: buildSystemPrompt(profile, pageContext),
    messages,
  })

  const textBlock = response.content.find((block) => block.type === 'text')
  const reply = textBlock?.type === 'text' ? textBlock.text : ''

  return { reply }
}

// Streaming turn — used by /api/ai/stream. Yields text deltas as they
// arrive from the Anthropic streaming API so the client can render
// word-by-word. The full reply is assembled by the caller.
export async function* runTutorTurnStream({
  messages,
  pageContext,
  profile,
}: {
  messages: TurnMessage[]
  pageContext?: PageContext
  profile: LearningProfile
}): AsyncGenerator<string> {
  const stream = createClient().messages.stream({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: buildSystemPrompt(profile, pageContext),
    messages,
  })

  for await (const event of stream) {
    if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
      yield event.delta.text
    }
  }
}
