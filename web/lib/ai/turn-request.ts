import type { TurnMessage } from './claude'
import {
  MAX_EQUATIONS,
  MAX_EQUATION_CHARS,
  MAX_TEXT_CHARS,
  type PageContext,
  type PageEquation,
} from './page-context'

// Shared request-body parsers for the tutor-turn routes (Sprint 15 voice
// follow-on): /api/ai/turn (JSON) and /api/ai/turn/stream (SSE) accept the
// SAME request shape, so these live here as one source of truth rather than
// duplicated per route. Extracted verbatim from app/api/ai/turn/route.ts --
// same caps, same degrade-don't-400 discipline (ADR-013/019). (The older
// text-only /api/ai/stream keeps its own copies; it is out of scope here.)

// Defends the token budget against abusive payloads, not an exact token
// count -- PLAN.md §2.5 targets the last 6-8 turns (well under MAX_MESSAGES).
export const MAX_MESSAGES = 40
export const MAX_MESSAGE_LENGTH = 4000
export const MAX_PAGE_TITLE_LENGTH = 200

export function parseMessages(body: unknown): TurnMessage[] | null {
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

// pageContext is untrusted client input -- extracted from the host page by a
// content script we don't control (PLAN §2.6) -- and must never crash the
// route or blow the §2.5 page-context token budget. Any malformed or
// oversized shape is dropped to undefined rather than 400ing the whole turn
// (ADR-013). Per-field caps mirror page-context.ts's budget constants.
export function parsePageContext(body: unknown): PageContext | undefined {
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

// sessionId ties a turn to a session_interactions row (ADR-019). Untrusted
// like pageContext -- a missing/malformed value degrades to "no persistence
// this turn," never a 400.
export const MAX_SESSION_ID_LENGTH = 100

export function parseSessionId(body: unknown): string | undefined {
  if (typeof body !== 'object' || body === null) {
    return undefined
  }

  const { sessionId } = body as { sessionId?: unknown }

  if (typeof sessionId !== 'string' || sessionId.length === 0 || sessionId.length > MAX_SESSION_ID_LENGTH) {
    return undefined
  }

  return sessionId
}

// response_latency_ms is the think-time signal PLAN.md §2.3 describes --
// client-measured, not derived here. A missing/invalid value persists a null
// latency rather than a guessed one (ADR-019).
const MAX_RESPONSE_LATENCY_MS = 10 * 60 * 1000 // 10 minutes -- generous upper bound

export function parseResponseLatencyMs(body: unknown): number | undefined {
  if (typeof body !== 'object' || body === null) {
    return undefined
  }

  const { responseLatencyMs } = body as { responseLatencyMs?: unknown }

  if (
    typeof responseLatencyMs !== 'number' ||
    !Number.isFinite(responseLatencyMs) ||
    responseLatencyMs < 0 ||
    responseLatencyMs > MAX_RESPONSE_LATENCY_MS
  ) {
    return undefined
  }

  return Math.round(responseLatencyMs)
}

// ---- The session-start kickoff (the check-in confirm / reframe start) ----

// The confirmation the student gave on the check-in card, as STRUCTURED
// request data (mirrors the extension's SessionStartInfo): the tutor must
// never receive a fabricated student message -- the student only confirmed
// the detected question and the predicted sticking point, and topic phrasing
// can drift from the actual question. `question` is the opening scan's own
// one-line read of the detected problem; `stickingPoint` is the confirmed
// misconception (null = the honest "not sure"); `snippet` is the reframe
// tool's cropped page text, when the student framed the exact spot
// themselves. Rendered into the SESSION START MODE prompt block
// (system-prompt.ts), never into the conversation.
export type SessionStartRequest = {
  question: string
  stickingPoint: string | null
  snippet?: string
}

// Generous per-field cap: the question is a one-line scan reply, the
// sticking point a short misconception description, the snippet a crop of
// on-page text -- none should approach this; anything past it is clipped,
// not 400ed (the same degrade discipline as pageContext).
export const MAX_SESSION_START_FIELD_LENGTH = 1000

function clipSessionStartField(value: string): string {
  return value.length > MAX_SESSION_START_FIELD_LENGTH ? value.slice(0, MAX_SESSION_START_FIELD_LENGTH) : value
}

// Untrusted client input like everything else here: a malformed shape (or a
// missing/empty question -- the one field the prompt block cannot render
// without) degrades to undefined, and the route then requires `messages`
// as before -- never a special 400 for a bad kickoff.
export function parseSessionStart(body: unknown): SessionStartRequest | undefined {
  if (typeof body !== 'object' || body === null) {
    return undefined
  }

  const { sessionStart } = body as { sessionStart?: unknown }

  if (typeof sessionStart !== 'object' || sessionStart === null) {
    return undefined
  }

  const { question, stickingPoint, snippet } = sessionStart as {
    question?: unknown
    stickingPoint?: unknown
    snippet?: unknown
  }

  if (typeof question !== 'string' || question.trim().length === 0) {
    return undefined
  }

  if (stickingPoint !== null && stickingPoint !== undefined && typeof stickingPoint !== 'string') {
    return undefined
  }

  if (snippet !== undefined && typeof snippet !== 'string') {
    return undefined
  }

  const trimmedSticking = typeof stickingPoint === 'string' ? stickingPoint.trim() : ''
  const trimmedSnippet = typeof snippet === 'string' ? snippet.trim() : ''

  return {
    question: clipSessionStartField(question.trim()),
    stickingPoint: trimmedSticking ? clipSessionStartField(trimmedSticking) : null,
    ...(trimmedSnippet ? { snippet: clipSessionStartField(trimmedSnippet) } : {}),
  }
}

// The placeholder "user" turn the Anthropic API requires when the session
// starts with no student message (the OPENING_SCAN_PLACEHOLDER_MESSAGE
// precedent): honest meta about what actually happened in the UI -- a
// confirmation tap, not typed words -- with SESSION START MODE in the
// system prompt driving the behavior. Never shown to the student; also what
// persists as the row's student_transcript, which is exactly truthful.
export function sessionStartPlaceholder(start: SessionStartRequest): TurnMessage {
  const confirmed = start.stickingPoint
    ? `and picked the sticking point "${start.stickingPoint}"`
    : 'and said they are not sure where it usually goes wrong'
  return {
    role: 'user',
    content: `(Session start: the student confirmed the detected problem ${confirmed} on the check-in card. Nothing was typed -- follow SESSION START MODE.)`,
  }
}
