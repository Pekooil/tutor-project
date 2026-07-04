import { NextResponse, after } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { clientFromBearer } from '@/lib/auth/bearer'
import { runTutorTurn, type TurnEnvelope, type TurnMessage } from '@/lib/ai/claude'
import { loadProfile } from '@/lib/learning/profile-read'
import { detectTopicKeys } from '@/lib/learning/topic'
import { applyInteraction } from '@/lib/learning/apply'
import {
  MAX_EQUATIONS,
  MAX_EQUATION_CHARS,
  MAX_TEXT_CHARS,
  type PageContext,
  type PageEquation,
} from '@/lib/ai/page-context'

// This route reads the live learning profile (ADR-014) and, as of ADR-019,
// WRITES one session_interactions row per gradable turn (text only, no
// audio -- ADR-011 unaffected) -- the explicit, ADR-recorded reversal of
// ADR-013's original "the turn writes nothing." pageContext and the loaded
// profile are still rendered into the prompt for this turn only and
// discarded (no migration for either); messages are persisted only as the
// last user turn's text, inside the new interaction row.

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

// sessionId ties this turn to a session_interactions row (ADR-019). It is
// untrusted client input like pageContext above -- a missing or malformed
// value degrades to "no persistence this turn," never a 400 (persisting is
// best-effort, the turn itself never depends on it).
const MAX_SESSION_ID_LENGTH = 100

function parseSessionId(body: unknown): string | undefined {
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
// client-measured (Task 7 wires the extension to send it), not derived
// here. Not yet sent by any caller this task, so this is presently always
// undefined in practice; the parser exists so the column round-trips
// correctly the moment a caller does send it.
const MAX_RESPONSE_LATENCY_MS = 10 * 60 * 1000 // 10 minutes -- generous upper bound, anything larger is dropped

function parseResponseLatencyMs(body: unknown): number | undefined {
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

type InsertedInteraction = { id: string }

// Persists one session_interactions row for a gradable turn and kicks the
// per-interaction learning-model apply off the critical path via `after()`
// (ADR-019 -- the ADR-013 reversal). Best-effort and silent throughout: a
// missing/foreign sessionId, a missing assessment (the opening turn, or
// any turn the model didn't grade), or any query failure all degrade to
// "no persistence this turn" -- the exact discipline parsePageContext
// already applies to a read, now applied to this write. Never throws, and
// is called after the reply is already computed, never before.
async function persistInteraction(
  supabase: SupabaseClient,
  userId: string,
  sessionId: string | undefined,
  lastUserMessage: string,
  envelope: TurnEnvelope,
  responseLatencyMs: number | undefined
): Promise<void> {
  if (!sessionId || !envelope.assessment) {
    // Diagnostic only (never thrown, never changes the reply): every
    // degrade path here was previously silent, which made a real bug
    // ("nothing is ever persisted") indistinguishable from the DESIGNED
    // degrade ("this turn had nothing gradable to write") from outside a
    // debugger. Found the hard way debugging a real Khan Academy session
    // that wrote zero session_interactions rows across two full voice
    // sessions with no server-side trace to explain why.
    console.warn(
      '[ai/turn] persistInteraction skipped:',
      !sessionId
        ? 'no sessionId on the request'
        : `envelope carried no assessment (say: "${envelope.say.slice(0, 120)}")`
    )
    return
  }

  try {
    // Explicit ownership check, not just the FK's existence check: RLS on
    // session_interactions is keyed on user_id (which we set to the
    // caller), not session_id -- without this, a sessionId belonging to a
    // DIFFERENT user would still accept an insert, corrupting that user's
    // session with a row RLS would then hide from everyone (including
    // them). This confirms the caller actually owns the session.
    const { data: sessionRow } = await supabase
      .from('sessions')
      .select('id')
      .eq('id', sessionId)
      .eq('user_id', userId)
      .is('deleted_at', null)
      .maybeSingle()

    if (!sessionRow) {
      console.warn('[ai/turn] persistInteraction skipped: sessionId does not resolve to a session this caller owns', {
        sessionId,
      })
      return
    }

    const { count } = await supabase
      .from('session_interactions')
      .select('id', { count: 'exact', head: true })
      .eq('session_id', sessionId)
      .is('deleted_at', null)

    const turnIndex = (count ?? 0) + 1
    const { assessment } = envelope

    const { data: inserted, error } = await supabase
      .from('session_interactions')
      .insert({
        session_id: sessionId,
        user_id: userId,
        turn_index: turnIndex,
        concept_key: assessment.conceptKey,
        student_transcript: lastUserMessage,
        tutor_response: envelope.say,
        outcome: assessment.outcome,
        self_confidence: assessment.selfConfidence,
        reasoning_quality: assessment.reasoningQuality,
        response_latency_ms: responseLatencyMs ?? null,
        misconception_category: assessment.misconceptionCategory,
        misconception_description: assessment.misconceptionDescription,
        applied_to_profile: false,
      })
      .select('id')
      .single()

    if (error || !inserted) {
      console.warn('[ai/turn] persistInteraction skipped: session_interactions insert failed', {
        sessionId,
        error: error?.message,
      })
      return
    }

    const insertedId = (inserted as InsertedInteraction).id

    // Off the critical path (ADR-019): this runs after the response has
    // already been sent. applyInteraction runs the full per-interaction
    // FSRS update + fuzzy misconception match/resolution + reinforcement
    // scheduling (Task 5) -- the response_latency_ms passed here is what
    // restores the third lucky-guess sub-guard ADR-016 had to omit.
    after(() =>
      applyInteraction(supabase, userId, sessionId, {
        id: insertedId,
        conceptKey: assessment.conceptKey,
        outcome: assessment.outcome,
        reasoningQuality: assessment.reasoningQuality,
        selfConfidence: assessment.selfConfidence,
        misconceptionCategory: assessment.misconceptionCategory,
        misconceptionDescription: assessment.misconceptionDescription,
        responseLatencyMs: responseLatencyMs ?? null,
      })
    )
  } catch (err) {
    // Never let a persistence failure affect the turn -- but do surface it,
    // unlike before, so a real bug here doesn't read identically to a
    // designed degrade in the server's own logs.
    console.error('[ai/turn] persistInteraction threw', { sessionId }, err)
  }
}

export async function POST(request: Request) {
  const auth = await clientFromBearer(request)

  if ('error' in auth) {
    return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })
  }

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

  // Both untrusted, both optional, both degrade silently (ADR-019): a turn
  // with no sessionId (older callers, or the extension before Task 7)
  // simply persists nothing; a turn with no responseLatencyMs persists a
  // null latency rather than a guessed one.
  const sessionId = parseSessionId(body)
  const responseLatencyMs = parseResponseLatencyMs(body)

  // Turn-time topic detection (ADR-021): a deterministic keyword match over
  // the already-parsed pageContext + transcript — no model call, nothing
  // persisted, and [] on any miss, so the profile read below degrades to
  // exactly its pre-Sprint-11 behaviour.
  const topicKeys = detectTopicKeys(pageContext, messages)

  // The live profile (ADR-014) replaces HARDCODED_PROFILE (ADR-009), now
  // biased to the page-relevant topicKeys and carrying the scheduler's due
  // items (ADR-020/021). A read, not a write — loadProfile never throws (it
  // degrades to the calibrating empty profile on any query failure), so it
  // sits outside the try/catch below, which is reserved for the Anthropic
  // call.
  const profile = await loadProfile(auth.supabase, { topicKeys })

  try {
    // runTutorTurn returns the parsed §2.5 envelope (ADR-019). The client's
    // wire contract stays `{ reply }` for back-compat; the envelope's
    // assessment (when present) is what gets persisted below.
    const envelope = await runTutorTurn({ messages, pageContext, profile })

    // The ADR-013 reversal site: persistence is best-effort and always
    // happens after the reply is already computed, so a slow or failing
    // write can never delay or break the turn (persistInteraction never
    // throws).
    await persistInteraction(
      auth.supabase,
      auth.user.id,
      sessionId,
      messages[messages.length - 1].content,
      envelope,
      responseLatencyMs
    )

    return NextResponse.json({ reply: envelope.say })
  } catch {
    // Never relay the provider's error text or any key material to the client.
    return NextResponse.json({ error: 'Tutor is unavailable right now.' }, { status: 502 })
  }
}
