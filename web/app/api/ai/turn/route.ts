import { NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getConcept } from '@calyxa/curriculum'
import { clientFromBearer } from '@/lib/auth/bearer'
import { runTutorTurn, type TurnEnvelope, type TurnMessage } from '@/lib/ai/claude'
import { parseEnvelope } from '@/lib/ai/envelope'
import { buildSystemPrompt } from '@/lib/ai/system-prompt'
import type { LearningProfile } from '@/lib/ai/profile'
import type { PageContext } from '@/lib/ai/page-context'
import { loadProfile } from '@/lib/learning/profile-read'
import { predictLikelyStruggle } from '@/lib/learning/predict'
import { detectTopicKeys } from '@/lib/learning/topic'
import { parseMessages, parsePageContext, parseSessionId, parseResponseLatencyMs } from '@/lib/ai/turn-request'
import { completeTurn, groundProfileTags, persistOpeningInteraction } from '@/lib/ai/turn-complete'

// This route reads the live learning profile (ADR-014) and WRITES one
// session_interactions row per gradable turn (text only, no audio -- ADR-011).
// pageContext + profile are rendered into the prompt for this turn only and
// discarded. The response carries the envelope's validated annotations /
// profileTags / solutionProgress / session ADDITIVELY (ADR-023/024/027);
// none of those are persisted -- session_interactions keeps its Sprint 11
// shape. As of the Sprint 15 voice follow-on, the request parsers live in
// turn-request.ts and the persistence + grounding + ping tail lives in
// turn-complete.ts (completeTurn) -- both shared with /api/ai/turn/stream so
// the streamed and non-streamed turns behave identically past the model call.

// A dedicated, minimal Anthropic call for the opening scan. claude.ts's
// runTutorTurn always builds its system prompt with the fixed
// `{ format: 'envelope' }` and requires a non-empty `messages` array ending
// in a user turn -- neither fits the opening scan (no student message exists
// yet, and the call needs `opts.opening` threaded into buildSystemPrompt to
// get the OPENING SCAN MODE block). claude.ts is out of scope for this
// sprint, so this mirrors its MODEL/createClient shape here rather than
// changing it.
const OPENING_SCAN_MODEL = 'claude-haiku-4-5-20251001'
const OPENING_SCAN_MAX_TOKENS = 300 // one say line + at most one annotation + optional tag

function createOpeningScanClient(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY

  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY is not set — the Claude proxy cannot run without it.')
  }

  return new Anthropic({ apiKey })
}

// The placeholder "user" turn the Anthropic API requires when there is no
// real student message -- OPENING SCAN MODE in the system prompt drives the
// model's behavior; this content is never shown to the student.
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
// sessionId? }`, no `messages` -- distinguished by this flag alone.
function isOpeningScanBody(body: unknown): boolean {
  if (typeof body !== 'object' || body === null) {
    return false
  }

  return (body as { opening?: unknown }).opening === true
}

// The curriculum-title fallback the overview route already uses: a stale
// concept key must never 500 the scan -- a raw key beats a broken reply.
function titleFor(conceptKey: string): string {
  return getConcept(conceptKey)?.title ?? conceptKey
}

// The opening-scan branch (ADR-030): same auth, same topic-biased loadProfile
// read, same grounding gate for any profile tag -- only the AI call and the
// response shape differ from a normal turn. Never returns assessment /
// solutionProgress / session. The session-kickoff feature adds `prediction`
// (predictLikelyStruggle -- grounded in the profile's active misconceptions,
// no model involvement), additively: absent, not null, when the profile
// carries nothing to predict from.
async function handleOpeningScan(
  auth: { supabase: SupabaseClient; user: { id: string } },
  body: unknown
): Promise<NextResponse> {
  const pageContext = parsePageContext(body)

  if (!pageContext) {
    return NextResponse.json({ error: 'An opening scan request requires a pageContext.' }, { status: 400 })
  }

  const sessionId = parseSessionId(body)

  const topicKeys = detectTopicKeys(pageContext, [])
  const profile = await loadProfile(auth.supabase, { topicKeys })

  try {
    const envelope = await runOpeningScanTurn({ pageContext, profile })

    await persistOpeningInteraction(auth.supabase, auth.user.id, sessionId, envelope)

    const annotations = envelope.annotations
    const profileTags = groundProfileTags(envelope.profileTags, profile)
    const prediction = predictLikelyStruggle(profile, topicKeys)

    return NextResponse.json({
      reply: envelope.say,
      ...(annotations && annotations.length > 0 ? { annotations } : {}),
      ...(profileTags.length > 0 ? { profileTags } : {}),
      // The check-in's page-detected topic (design state 5a's "spotted on
      // this page" suggestion card): the first topicKey detectTopicKeys
      // already resolved above -- deterministic keyword match, no model
      // involvement, title-resolved with the same stale-key fallback as
      // `prediction`. Additive: absent when the page named no known concept.
      ...(topicKeys.length > 0 ? { topic: { conceptKey: topicKeys[0], title: titleFor(topicKeys[0]) } } : {}),
      ...(prediction
        ? {
            prediction: {
              conceptKey: prediction.conceptKey,
              title: titleFor(prediction.conceptKey),
              category: prediction.category,
              description: prediction.description,
            },
          }
        : {}),
    })
  } catch {
    return NextResponse.json({ error: 'Tutor is unavailable right now.' }, { status: 502 })
  }
}

export async function POST(request: Request) {
  const auth = await clientFromBearer(request)

  if ('error' in auth) {
    return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })
  }

  const body = await request.json().catch(() => null)

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

  const pageContext = parsePageContext(body)
  const sessionId = parseSessionId(body)
  const responseLatencyMs = parseResponseLatencyMs(body)

  // Turn-time topic detection (ADR-021): deterministic keyword match, no model
  // call, [] on any miss -- so the profile read below degrades to its
  // pre-Sprint-11 behaviour.
  const topicKeys = detectTopicKeys(pageContext, messages)

  // The live profile (ADR-014), biased to page-relevant topicKeys. A read,
  // not a write -- loadProfile never throws, so it sits outside the try/catch
  // reserved for the Anthropic call.
  const profile = await loadProfile(auth.supabase, { topicKeys })

  try {
    const envelope = await runTutorTurn({ messages, pageContext, profile })

    // The shared persistence + grounding + ping tail (turn-complete.ts) --
    // identical to the streamed route's terminal event, so the two turn paths
    // never drift.
    const payload = await completeTurn(
      auth.supabase,
      auth.user.id,
      sessionId,
      messages[messages.length - 1].content,
      envelope,
      responseLatencyMs,
      profile
    )

    return NextResponse.json(payload)
  } catch {
    // Never relay the provider's error text or any key material to the client.
    return NextResponse.json({ error: 'Tutor is unavailable right now.' }, { status: 502 })
  }
}
