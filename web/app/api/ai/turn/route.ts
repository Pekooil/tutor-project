import { NextResponse } from 'next/server'
import { clientFromBearer } from '@/lib/auth/bearer'
import { runTutorTurn, type TurnMessage } from '@/lib/ai/claude'
import { loadProfile } from '@/lib/learning/profile-read'
import {
  MAX_EQUATIONS,
  MAX_EQUATION_CHARS,
  MAX_TEXT_CHARS,
  type PageContext,
  type PageEquation,
} from '@/lib/ai/page-context'

// This route reads the live learning profile (ADR-014) and writes nothing
// to the database. messages, pageContext, and the loaded profile are all
// rendered into the prompt for this turn only and then discarded — no
// migration exists for any of them (ADR-009, ADR-013, ADR-014).

// Defends the token budget against abusive payloads, not an exact token
// count — PLAN.md §2.5 targets the last 6–8 turns (well under MAX_MESSAGES).
const MAX_MESSAGES = 40
const MAX_MESSAGE_LENGTH = 4000

const MAX_PAGE_TITLE_LENGTH = 200

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

// pageContext is untrusted client input — extracted from the host page by a
// content script we don't control (PLAN §2.6) — and must never crash the
// route or blow the §2.5 page-context token budget. Any malformed or
// oversized shape is dropped to undefined rather than 400ing the whole
// turn: a flaky extractor degrades the turn to "no page context," it never
// blocks it (ADR-013). The per-field caps mirror /lib/ai/page-context.ts's
// budget constants so an accepted pageContext is always within the shape
// renderPageContext expects.
function parsePageContext(body: unknown): PageContext | undefined {
  if (typeof body !== 'object' || body === null) {
    return undefined
  }

  const { pageContext } = body as { pageContext?: unknown }

  if (pageContext === undefined) {
    return undefined
  }

  if (typeof pageContext !== 'object' || pageContext === null) {
    return undefined
  }

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

  if (!Array.isArray(equations) || equations.length > MAX_EQUATIONS) {
    return undefined
  }

  const parsedEquations: PageEquation[] = []

  for (const raw of equations) {
    if (typeof raw !== 'object' || raw === null) {
      return undefined
    }

    const { latex, mathml, text: equationText } = raw as {
      latex?: unknown
      mathml?: unknown
      text?: unknown
    }

    for (const field of [latex, mathml, equationText]) {
      if (field !== undefined && (typeof field !== 'string' || field.length > MAX_EQUATION_CHARS)) {
        return undefined
      }
    }

    parsedEquations.push({
      ...(typeof latex === 'string' ? { latex } : {}),
      ...(typeof mathml === 'string' ? { mathml } : {}),
      ...(typeof equationText === 'string' ? { text: equationText } : {}),
    })
  }

  return {
    ...(typeof title === 'string' ? { title } : {}),
    ...(typeof text === 'string' ? { text } : {}),
    equations: parsedEquations,
  }
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

  // Absent or invalid pageContext both resolve to undefined here, so a turn
  // with no pageContext (Sprint 05/06 callers) and a turn with a malformed
  // one behave identically: the AI leg proceeds with no page context rather
  // than failing the turn (ADR-013).
  const pageContext = parsePageContext(body)

  // The live profile (ADR-014) replaces HARDCODED_PROFILE (ADR-009). A read,
  // not a write — loadProfile never throws (it degrades to the calibrating
  // empty profile on any query failure), so it sits outside the try/catch
  // below, which is reserved for the Anthropic call.
  const profile = await loadProfile(auth.supabase)

  try {
    const { reply } = await runTutorTurn({ messages, pageContext, profile })
    return NextResponse.json({ reply })
  } catch {
    // Never relay the provider's error text or any key material to the client.
    return NextResponse.json({ error: 'Tutor is unavailable right now.' }, { status: 502 })
  }
}
