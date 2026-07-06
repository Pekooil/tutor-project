import { NextResponse, after } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getConcept } from '@calyxa/curriculum'
import { clientFromBearer } from '@/lib/auth/bearer'
import { runTutorTurn, type TurnEnvelope, type TurnMessage } from '@/lib/ai/claude'
import { parseEnvelope, type ProfileTag } from '@/lib/ai/envelope'
import { buildSystemPrompt } from '@/lib/ai/system-prompt'
import type { LearningProfile } from '@/lib/ai/profile'
import { loadProfile } from '@/lib/learning/profile-read'
import { detectTopicKeys } from '@/lib/learning/topic'
import { applyInteraction } from '@/lib/learning/apply'
import { computeTurnPings, type TurnPing } from '@/lib/learning/events'
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
//
// As of ADR-023 the response also carries the envelope's validated
// `annotations` ADDITIVELY (`{ reply, annotations? }`, field omitted when
// empty) -- annotations are never persisted; session_interactions keeps its
// Sprint 11 shape regardless of what a turn drew.
//
// As of ADR-024/025 (Sprint 13) it additionally carries `profileTags` the
// same way -- but only tags that survive the grounding gate below, which
// verifies each one against the exact profile this request injected into
// the prompt (drop-don't-invent). Tags are never persisted either.

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

// Model-authored tag labels (known-gap / callback keep them) are clipped
// hard rather than trusted; concept-anchored labels are replaced with the
// curriculum title outright (below), so this cap never clips a title.
const MAX_TAG_LABEL_LENGTH = 30

// Folds case, whitespace, AND the separator characters misconception
// categories actually use (dotted.snake / hyphen-case) to spaces — the
// model writes labels like "sign errors" while the stored category is
// "sign-errors" or "algebra.sign_errors"; without separator folding the
// containment check below never fires and every legitimate known-gap tag
// would be dropped (found by the Task 4 gate test, not hypothetical).
function normalizeTagText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[-_.]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

// Loose bidirectional containment after the folding above — enough to
// accept "sign errors" against a category like "algebra.sign-errors" being
// described as "Sign errors when distributing", without a fuzzy-match
// dependency on this hot path.
function tagTextOverlaps(a: string, b: string): boolean {
  const na = normalizeTagText(a)
  const nb = normalizeTagText(b)
  return na.length > 0 && nb.length > 0 && (na.includes(nb) || nb.includes(na))
}

// The grounding gate (ADR-024): every structurally-valid profile tag is
// verified against the EXACT LearningProfile this request rendered into the
// prompt -- the model cannot surface a "memory" the profile read didn't
// actually contain. Per-kind rules:
//   reviewing/strength -> a listed mastery node
//   known-gap          -> a listed ACTIVE misconception (concept-key match,
//                          or label overlap with its category/description)
//   due-review         -> a listed dueForReview item
//   callback           -> a listed priorWork digest entry (ADR-026)
// An ungrounded tag is dropped with a console.debug -- never rendered, and
// never an error (the reply is unaffected; this mirrors the annotation
// layer's drop-don't-guess). Grounded concept-anchored tags get their label
// replaced by the curriculum title (server-rendered display, ADR-024) so
// the pill always reads cleanly regardless of what the model wrote;
// known-gap/callback keep the model's label (it describes the error or the
// connection -- nothing in the curriculum can generate it), truncated.
function groundProfileTags(tags: ProfileTag[] | undefined, profile: LearningProfile): ProfileTag[] {
  if (!tags || tags.length === 0) return []

  const grounded: ProfileTag[] = []

  for (const tag of tags) {
    let isGrounded = false

    switch (tag.kind) {
      case 'reviewing':
      case 'strength':
        isGrounded =
          tag.conceptKey !== null &&
          profile.masteryNodes.some((n) => n.conceptKey === tag.conceptKey)
        break
      case 'known-gap':
        isGrounded = profile.activeMisconceptions.some(
          (m) =>
            (tag.conceptKey !== null && m.conceptKey === tag.conceptKey) ||
            tagTextOverlaps(tag.label, m.category) ||
            tagTextOverlaps(tag.label, m.description)
        )
        break
      case 'due-review':
        isGrounded =
          tag.conceptKey !== null &&
          (profile.dueForReview ?? []).some((d) => d.conceptKey === tag.conceptKey)
        break
      case 'callback':
        isGrounded =
          tag.conceptKey !== null &&
          (profile.priorWork ?? []).some((p) => p.conceptKey === tag.conceptKey)
        break
    }

    if (!isGrounded) {
      console.debug('[ai/turn] profile tag dropped: not grounded in the injected profile', {
        kind: tag.kind,
        conceptKey: tag.conceptKey,
        label: tag.label,
      })
      continue
    }

    const conceptTitle =
      tag.conceptKey !== null && (tag.kind === 'reviewing' || tag.kind === 'strength' || tag.kind === 'due-review')
        ? getConcept(tag.conceptKey)?.title
        : undefined

    grounded.push({
      kind: tag.kind,
      conceptKey: tag.conceptKey,
      label: conceptTitle ?? tag.label.slice(0, MAX_TAG_LABEL_LENGTH),
    })
  }

  return grounded
}

type InsertedInteraction = { id: string }

// Shared by persistInteraction (below) and the opening scan's
// persistOpeningInteraction (Sprint 14 Task 4): resolves whether `sessionId`
// is a real, non-deleted session this caller owns, and if so, the turn_index
// the next inserted row should carry. Returns null on any ownership failure
// -- the caller decides what "no row this turn" means for its own logging.
// Split out of persistInteraction unchanged (same two-query, RLS-plus-
// explicit-ownership-check shape) so the opening scan doesn't re-derive it.
async function resolveOwnedTurnIndex(
  supabase: SupabaseClient,
  userId: string,
  sessionId: string
): Promise<number | null> {
  const [{ data: sessionRow }, { count }] = await Promise.all([
    supabase
      .from('sessions')
      .select('id')
      .eq('id', sessionId)
      .eq('user_id', userId)
      .is('deleted_at', null)
      .maybeSingle(),
    supabase
      .from('session_interactions')
      .select('id', { count: 'exact', head: true })
      .eq('session_id', sessionId)
      .is('deleted_at', null),
  ])

  if (!sessionRow) {
    return null
  }

  return (count ?? 0) + 1
}

// Persists one session_interactions row for a gradable turn and kicks the
// per-interaction learning-model apply off the critical path via `after()`
// (ADR-019 -- the ADR-013 reversal). Best-effort and silent throughout: a
// missing/foreign sessionId, a missing assessment (the opening turn, or
// any turn the model didn't grade), or any query failure all degrade to
// "no persistence this turn" -- the exact discipline parsePageContext
// already applies to a read, now applied to this write. Never throws, and
// is called after the reply is already computed, never before.
//
// Returns whether the apply was actually SCHEDULED (Sprint 13, ADR-026):
// the ping computation predicts what the apply will write, so a turn whose
// apply never got scheduled -- no sessionId, foreign sessionId, failed
// insert -- must suppress its pings, or the toast would celebrate a write
// that will never land.
async function persistInteraction(
  supabase: SupabaseClient,
  userId: string,
  sessionId: string | undefined,
  lastUserMessage: string,
  envelope: TurnEnvelope,
  responseLatencyMs: number | undefined
): Promise<boolean> {
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
    return false
  }

  try {
    // The ownership check is explicit, not just the FK's existence check:
    // RLS on session_interactions is keyed on user_id (which we set to the
    // caller), not session_id -- without this, a sessionId belonging to a
    // DIFFERENT user would still accept an insert, corrupting that user's
    // session with a row RLS would then hide from everyone (including
    // them). resolveOwnedTurnIndex confirms the caller actually owns the
    // session and runs both reads in parallel (this await sits on the
    // turn's critical path -- the reply is not returned until
    // persistInteraction resolves -- so the sequential ownership-check ->
    // count -> insert chain was three DB round-trips of added voice latency
    // where the plan's own bar, ADR-019 "off the critical path", budgets
    // for one insert).
    const turnIndex = await resolveOwnedTurnIndex(supabase, userId, sessionId)

    if (turnIndex === null) {
      console.warn('[ai/turn] persistInteraction skipped: sessionId does not resolve to a session this caller owns', {
        sessionId,
      })
      return false
    }

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
      return false
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

    return true
  } catch (err) {
    // Never let a persistence failure affect the turn -- but do surface it,
    // unlike before, so a real bug here doesn't read identically to a
    // designed degrade in the server's own logs.
    console.error('[ai/turn] persistInteraction threw', { sessionId }, err)
    return false
  }
}

// Persists the opening scan's row (Sprint 14 Task 4, ADR-030): a genuine
// session_interactions row, same schema, but assessment-less by design --
// there is no student answer to grade yet, so every assessment column
// writes its neutral default rather than a value read off `envelope`. This
// is deliberately NOT persistInteraction: that function's `!envelope.
// assessment` guard means "the model unexpectedly graded nothing," a real
// anomaly for a normal turn worth skipping and logging; here, no assessment
// is the ENTIRE point (an opening turn never has one), so the row is
// written every time ownership resolves -- "found the problem" and "found
// nothing" both produce a row, only `tutor_response` (the "say", possibly
// empty) differs. Never schedules applyInteraction (there is no assessment
// for FSRS to apply) and never computes pings (nothing was learned this
// turn) -- both are exclusively persistInteraction's business.
async function persistOpeningInteraction(
  supabase: SupabaseClient,
  userId: string,
  sessionId: string | undefined,
  envelope: TurnEnvelope
): Promise<void> {
  if (!sessionId) {
    console.warn('[ai/turn] opening scan: no sessionId on the request, nothing persisted')
    return
  }

  try {
    const turnIndex = await resolveOwnedTurnIndex(supabase, userId, sessionId)

    if (turnIndex === null) {
      console.warn('[ai/turn] opening scan: sessionId does not resolve to a session this caller owns', { sessionId })
      return
    }

    const { error } = await supabase.from('session_interactions').insert({
      session_id: sessionId,
      user_id: userId,
      turn_index: turnIndex,
      concept_key: null,
      student_transcript: null,
      tutor_response: envelope.say,
      outcome: 'none',
      self_confidence: 'unknown',
      reasoning_quality: 'none',
      response_latency_ms: null,
      misconception_category: null,
      misconception_description: null,
      applied_to_profile: false,
    })

    if (error) {
      console.warn('[ai/turn] opening scan: session_interactions insert failed', { sessionId, error: error.message })
    }
  } catch (err) {
    console.error('[ai/turn] opening scan: persistOpeningInteraction threw', { sessionId }, err)
  }
}

// A dedicated, minimal Anthropic call for the opening scan. claude.ts's
// runTutorTurn always builds its system prompt with the fixed
// `{ format: 'envelope' }` and requires a non-empty `messages` array ending
// in a user turn -- neither fits the opening scan (no student message
// exists yet, and the call needs `opts.opening` threaded into
// buildSystemPrompt to get the OPENING SCAN MODE block). claude.ts is
// out of scope for this sprint (frozen per the sprint plan), so this
// mirrors its MODEL/createClient shape here rather than changing it; if
// this duplication grows, promoting an opts-aware runTutorTurn in claude.ts
// is the fix, not a third copy.
const OPENING_SCAN_MODEL = 'claude-haiku-4-5-20251001'
const OPENING_SCAN_MAX_TOKENS = 300 // one say line + at most one annotation + optional tag -- well under a normal turn's budget

function createOpeningScanClient(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY

  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY is not set — the Claude proxy cannot run without it.')
  }

  return new Anthropic({ apiKey })
}

// The placeholder "user" turn the Anthropic API requires (messages must be
// non-empty and start with a user role) when there is no real student
// message -- OPENING SCAN MODE in the system prompt is what actually drives
// the model's behavior here; this content is never shown to the student and
// carries no instructions of its own beyond pointing at that block.
const OPENING_SCAN_PLACEHOLDER_MESSAGE: TurnMessage = {
  role: 'user',
  content: '(The panel just opened. No message has been sent yet -- this is the opening scan; follow OPENING SCAN MODE.)',
}

async function runOpeningScanTurn({
  pageContext,
  profile,
}: {
  pageContext: PageContext
  profile: LearningProfile
}): Promise<TurnEnvelope> {
  const response = await createOpeningScanClient().messages.create({
    model: OPENING_SCAN_MODEL,
    max_tokens: OPENING_SCAN_MAX_TOKENS,
    system: buildSystemPrompt(profile, pageContext, { format: 'envelope', opening: true }),
    messages: [OPENING_SCAN_PLACEHOLDER_MESSAGE],
  })

  const textBlock = response.content.find((block) => block.type === 'text')
  const raw = textBlock?.type === 'text' ? textBlock.text : ''

  return parseEnvelope(raw)
}

// Detects the opening-scan request shape: `{ opening: true, pageContext,
// sessionId? }`, no `messages` at all -- distinguished from a normal turn by
// this flag alone, not by the absence of `messages` (a malformed/absent
// `messages` on an ordinary request is still the existing 400, below).
function isOpeningScanBody(body: unknown): boolean {
  if (typeof body !== 'object' || body === null) {
    return false
  }

  return (body as { opening?: unknown }).opening === true
}

// The opening-scan branch (Sprint 14 Task 4, ADR-030): same auth already
// resolved by the caller, same topic-biased loadProfile read Sprint 11
// built, same grounding gate for any profile tag -- only the AI call and
// the response shape differ from a normal turn. Never returns `assessment`,
// `solutionProgress`, or `session`: even if a non-conforming model output
// smuggled one past the OPENING SCAN MODE instructions, this response shape
// drops it rather than relay it, so the caller (the background worker,
// Task 6) never sees those fields from this branch. An empty/whitespace
// `reply` is passed through as-is -- deciding what "nothing found" means to
// the student is the caller's job, not this route's.
async function handleOpeningScan(
  auth: { supabase: SupabaseClient; user: { id: string } },
  body: unknown
): Promise<NextResponse> {
  const pageContext = parsePageContext(body)

  if (!pageContext) {
    return NextResponse.json({ error: 'An opening scan request requires a pageContext.' }, { status: 400 })
  }

  const sessionId = parseSessionId(body)

  // Turn-time topic detection (ADR-021), reused as-is: no transcript yet, so
  // the haystack is PAGE CONTEXT alone (an empty recentMessages array reads
  // identically to how detectTopicKeys already treats a page with no text).
  const topicKeys = detectTopicKeys(pageContext, [])
  const profile = await loadProfile(auth.supabase, { topicKeys })

  try {
    const envelope = await runOpeningScanTurn({ pageContext, profile })

    // Best-effort, off the reply's critical path is unnecessary here (there
    // is no apply/ping work riding on it) -- but it still must never delay
    // the reply on a slow write, so this mirrors persistInteraction's own
    // never-throws discipline instead of gating the response on it.
    await persistOpeningInteraction(auth.supabase, auth.user.id, sessionId, envelope)

    const annotations = envelope.annotations
    const profileTags = groundProfileTags(envelope.profileTags, profile)

    return NextResponse.json({
      reply: envelope.say,
      ...(annotations && annotations.length > 0 ? { annotations } : {}),
      ...(profileTags.length > 0 ? { profileTags } : {}),
    })
  } catch {
    // Never relay the provider's error text or any key material to the client.
    return NextResponse.json({ error: 'Tutor is unavailable right now.' }, { status: 502 })
  }
}

export async function POST(request: Request) {
  const auth = await clientFromBearer(request)

  if ('error' in auth) {
    return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })
  }

  const body = await request.json().catch(() => null)

  // The opening scan (Sprint 14 Task 4, ADR-030) is a distinct request shape
  // -- no `messages` at all -- detected by the explicit `opening: true` flag
  // rather than by absence of `messages`, so a malformed/missing `messages`
  // on an ORDINARY request still hits the existing 400 below, unchanged.
  if (isOpeningScanBody(body)) {
    return handleOpeningScan(auth, body)
  }

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
    // throws). The prospective ping computation (Sprint 13, ADR-026) runs
    // IN PARALLEL with it -- they touch disjoint tables (the insert writes
    // session_interactions; the pings read knowledge_nodes/misconceptions,
    // which only the after() apply writes, and that runs post-response) --
    // so the voice hot path pays for the slower of the two, not the sum.
    // computeTurnPings never throws either (degrades to []).
    const [persisted, prospectivePings] = await Promise.all([
      persistInteraction(
        auth.supabase,
        auth.user.id,
        sessionId,
        messages[messages.length - 1].content,
        envelope,
        responseLatencyMs
      ),
      envelope.assessment
        ? computeTurnPings(auth.supabase, auth.user.id, envelope.assessment, responseLatencyMs ?? null)
        : Promise.resolve<TurnPing[]>([]),
    ])

    // A ping is a claim about what this turn's apply will write -- so it
    // only rides the response when that apply was actually scheduled
    // (ADR-026). A no-session/foreign-session/failed-insert turn keeps its
    // reply and loses only the toast.
    const pings = persisted ? prospectivePings : []

    // ADR-023: annotations ride the wire ADDITIVELY -- the field is OMITTED
    // (not null, not []) when the envelope carried none, so a no-annotation
    // turn's response is byte-identical to Sprint 11's `{ reply }`. This is
    // also the fix for a Sprint 11 gap: envelope.annotations has been parsed
    // and validated since ADR-019, but was silently dropped here instead of
    // ever reaching the client. Never persisted -- session_interactions
    // keeps its Sprint 11 shape regardless of what this turn drew.
    const annotations = envelope.annotations

    // Sprint 13 (ADR-024/025): profile tags ride the wire ADDITIVELY, same
    // omission discipline as annotations -- but only after the grounding
    // gate above has verified each one against the profile this very
    // request injected. Never persisted -- session_interactions keeps its
    // shape regardless of what this turn tagged (ADR-024).
    const profileTags = groundProfileTags(envelope.profileTags, profile)

    // Sprint 14 (ADR-027/028): solutionProgress + session ride the wire the
    // same additive way -- fields OMITTED (not null, not a default) when the
    // envelope didn't carry them, so a turn with neither is byte-identical
    // to Sprint 13's response. Both are thread-through only: envelope.ts
    // already did the clamping/validation (a malformed session field never
    // reaches here at all -- it was dropped at parse time), and neither
    // field is persisted -- persistInteraction above and session_interactions'
    // row shape are completely unaffected by either.
    return NextResponse.json({
      reply: envelope.say,
      ...(annotations && annotations.length > 0 ? { annotations } : {}),
      ...(profileTags.length > 0 ? { profileTags } : {}),
      ...(pings.length > 0 ? { pings } : {}),
      ...(envelope.solutionProgress !== undefined ? { solutionProgress: envelope.solutionProgress } : {}),
      ...(envelope.session ? { session: envelope.session } : {}),
    })
  } catch {
    // Never relay the provider's error text or any key material to the client.
    return NextResponse.json({ error: 'Tutor is unavailable right now.' }, { status: 502 })
  }
}
