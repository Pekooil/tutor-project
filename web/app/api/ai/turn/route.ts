import { NextResponse } from 'next/server'
import { clientFromBearer } from '@/lib/auth/bearer'
import { runTutorTurn, type TurnMessage } from '@/lib/ai/claude'

// Defends the token budget against abusive payloads, not an exact token
// count — PLAN.md §2.5 targets the last 6–8 turns (well under MAX_MESSAGES).
const MAX_MESSAGES = 40
const MAX_MESSAGE_LENGTH = 4000

function parseMessages(body: unknown): TurnMessage[] | null {
  if (typeof body !== 'object' || body === null) {
    return null
  }

  const { messages } = body as { messages?: unknown }

  if (!Array.isArray(messages) || messages.length === 0 || messages.length > MAX_MESSAGES) {
    return null
  }

  const parsed: TurnMessage[] = []

  for (const raw of messages) {
    if (typeof raw !== 'object' || raw === null) {
      return null
    }

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

  if (parsed[parsed.length - 1].role !== 'user') {
    return null
  }

  return parsed
}

export async function POST(request: Request) {
  const auth = await clientFromBearer(request)

  if ('error' in auth) {
    return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })
  }

  // sessionId is accepted for forward-compat (a later sprint ties a turn to
  // a session) but ignored here — there is no DB write this sprint (ADR-009).
  const body = await request.json().catch(() => null)
  const messages = parseMessages(body)

  if (!messages) {
    return NextResponse.json(
      {
        error:
          'messages must be a non-empty array of { role: "user" | "assistant", content: string }, ending with a user turn.',
      },
      { status: 400 }
    )
  }

  try {
    const { reply } = await runTutorTurn({ messages })
    return NextResponse.json({ reply })
  } catch {
    // Never relay the provider's error text or any key material to the client.
    return NextResponse.json({ error: 'Tutor is unavailable right now.' }, { status: 502 })
  }
}
