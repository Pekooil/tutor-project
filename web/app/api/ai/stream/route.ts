import { clientFromBearer } from '@/lib/auth/bearer'
import { runTutorTurnStream, type TurnMessage } from '@/lib/ai/claude'
import { loadProfile } from '@/lib/learning/profile-read'
import {
  MAX_EQUATIONS,
  MAX_EQUATION_CHARS,
  MAX_TEXT_CHARS,
  type PageContext,
  type PageEquation,
} from '@/lib/ai/page-context'

const MAX_MESSAGES = 40
const MAX_MESSAGE_LENGTH = 4000
const MAX_PAGE_TITLE_LENGTH = 200

function parseMessages(body: unknown): TurnMessage[] | null {
  if (typeof body !== 'object' || body === null) return null
  const { messages } = body as { messages?: unknown }
  if (!Array.isArray(messages) || messages.length === 0 || messages.length > MAX_MESSAGES) {
    return null
  }
  const parsed: TurnMessage[] = []
  for (const raw of messages) {
    if (typeof raw !== 'object' || raw === null) return null
    const { role, content } = raw as { role?: unknown; content?: unknown }
    if (
      (role !== 'user' && role !== 'assistant') ||
      typeof content !== 'string' ||
      content.length === 0 ||
      content.length > MAX_MESSAGE_LENGTH
    ) {
      return null
    }
    parsed.push({ role, content })
  }
  if (parsed[parsed.length - 1].role !== 'user') return null
  return parsed
}

function parsePageContext(body: unknown): PageContext | undefined {
  if (typeof body !== 'object' || body === null) return undefined
  const { pageContext } = body as { pageContext?: unknown }
  if (pageContext === undefined) return undefined
  if (typeof pageContext !== 'object' || pageContext === null) return undefined
  const { title, text, equations } = pageContext as {
    title?: unknown
    text?: unknown
    equations?: unknown
  }
  if (title !== undefined && (typeof title !== 'string' || title.length > MAX_PAGE_TITLE_LENGTH)) {
    return undefined
  }
  if (text !== undefined && (typeof text !== 'string' || text.length > MAX_TEXT_CHARS)) {
    return undefined
  }
  if (!Array.isArray(equations) || equations.length > MAX_EQUATIONS) return undefined
  const parsedEquations: PageEquation[] = []
  for (const raw of equations) {
    if (typeof raw !== 'object' || raw === null) return undefined
    const { latex, mathml, text: eqText } = raw as {
      latex?: unknown
      mathml?: unknown
      text?: unknown
    }
    for (const field of [latex, mathml, eqText]) {
      if (field !== undefined && (typeof field !== 'string' || field.length > MAX_EQUATION_CHARS)) {
        return undefined
      }
    }
    parsedEquations.push({
      ...(typeof latex === 'string' ? { latex } : {}),
      ...(typeof mathml === 'string' ? { mathml } : {}),
      ...(typeof eqText === 'string' ? { text: eqText } : {}),
    })
  }
  return {
    ...(typeof title === 'string' ? { title } : {}),
    ...(typeof text === 'string' ? { text } : {}),
    equations: parsedEquations,
  }
}

const encoder = new TextEncoder()

function sseChunk(data: unknown): Uint8Array {
  return encoder.encode(`data: ${JSON.stringify(data)}\n\n`)
}

export async function POST(request: Request) {
  const auth = await clientFromBearer(request)
  if ('error' in auth) {
    return new Response(JSON.stringify({ error: 'Not signed in.' }), { status: 401 })
  }

  const body = await request.json().catch(() => null)
  const messages = parseMessages(body)
  if (!messages) {
    return new Response(
      JSON.stringify({ error: 'messages must be a non-empty array ending with a user turn.' }),
      { status: 400 },
    )
  }

  const pageContext = parsePageContext(body)
  const profile = await loadProfile(auth.supabase)

  const stream = new ReadableStream({
    async start(controller) {
      try {
        for await (const text of runTutorTurnStream({ messages, pageContext, profile })) {
          controller.enqueue(sseChunk({ text }))
        }
        controller.enqueue(encoder.encode('data: [DONE]\n\n'))
      } catch {
        controller.enqueue(sseChunk({ error: 'Tutor is unavailable right now.' }))
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
    },
  })
}
