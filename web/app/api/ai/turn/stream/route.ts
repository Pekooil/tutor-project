import { clientFromBearer } from '@/lib/auth/bearer'
// Sprint 24 (ADR-038): tutor model calls go through the TutorProvider seam.
import { getTutorProvider } from '@/lib/ai/provider'
import { loadProfile } from '@/lib/learning/profile-read'
import { detectTopicKeys } from '@/lib/learning/topic'
import { courseFromUserMetadata } from '@/lib/curriculum/courses'
import { parseMessages, parsePageContext, parseSessionId, parseResponseLatencyMs } from '@/lib/ai/turn-request'
import { completeTurn } from '@/lib/ai/turn-complete'
import { costGuard } from '@/lib/tier/cost-guard'
import { estimateCost } from '@/lib/tier/cost-model'
import { MESSAGE_LIMIT_CLOSE_MESSAGE, MESSAGE_LIMIT_CLOSE_REASON } from '@/lib/ai/envelope'
import {
  endSession,
  sessionInteractionCount,
  sessionOverFreeCap,
  SESSION_STUDENT_MESSAGE_LIMIT,
  FREE_LIMIT_MESSAGE,
} from '@/lib/tier/session-gate'

// Sprint 16 / Task 3 (ADR-041): same friendly hard-cap refusal as
// /api/ai/turn, verbatim — the two turn-taking paths must show the same
// text regardless of which one the client happened to use.
const COST_RESTING_MESSAGE = 'Calyxa is resting for today — the tutor is back tomorrow.'

// Streamed-envelope tutor turn (Sprint 15 voice follow-on, ADR-033 amendment).
// Same request shape and same learning writes as /api/ai/turn, but SSE: it
// emits `{ sayDelta }` events as the spoken text streams (so the client can
// start per-sentence TTS before the turn finishes -- the ~4-5s leg the latency
// probe found), then ONE terminal `{ envelope }` event whose payload is exactly
// what /api/ai/turn returns as JSON (completeTurn, shared). This is the voice
// path only; the text path keeps /api/ai/stream and the buffered /api/ai/turn
// stays as the fallback. Audio is never involved here (ADR-011); the STT/TTS
// routes are untouched.

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
      JSON.stringify({
        error:
          'messages must be a non-empty array of { role: "user" | "assistant", content: string }, ending with a user turn.',
      }),
      { status: 400 }
    )
  }

  const pageContext = parsePageContext(body)
  const sessionId = parseSessionId(body)
  const responseLatencyMs = parseResponseLatencyMs(body)

  // Sprint 16 / Task 3 (ADR-041): the global cost guard — same hard/soft
  // split as /api/ai/turn's main branch. Hard cap skips straight to a
  // synthetic terminal envelope carrying the resting message, never touching
  // runTutorTurnEnvelopeStream or completeTurn (no provider call, nothing to
  // persist). Soft cap lets the turn proceed but flags `degraded: true` on
  // the terminal envelope.
  //
  // Latency fix (2026-07-16), mirroring /api/ai/turn: the guard and the
  // topic-biased profile read (ADR-021; a read, never throws) run in
  // PARALLEL instead of back-to-back, and `userId` skips loadProfile's
  // redundant auth.getUser() round trip — this route is the extension's
  // main turn path (text AND voice), so these serialized DB hops sat on
  // every turn's time-to-first-token.
  const courseKey = courseFromUserMetadata(auth.user.user_metadata)
  const topicKeys = detectTopicKeys(pageContext, messages, courseKey)
  // The per-session student-message cap's count rides the same parallel round
  // trip as /api/ai/turn's (public launch, 2026-07-18); null fails open.
  // The free monthly cap's verdict rides the same parallel round trip as
  // /api/ai/turn's (public launch, 2026-07-18); false fails open (uncapped).
  const [{ softExceeded, hardExceeded }, profile, interactionCount, overFreeCap] = await Promise.all([
    costGuard(auth.supabase, estimateCost('claude_turn')),
    loadProfile(auth.supabase, { topicKeys, userId: auth.user.id, courseKey }),
    sessionId ? sessionInteractionCount(auth.supabase, sessionId) : Promise.resolve(null),
    sessionId ? sessionOverFreeCap(auth.supabase, sessionId) : Promise.resolve(false),
  ])

  // Session message cap — the streamed twin of /api/ai/turn's branch: end the
  // session server-side, then a synthetic terminal envelope (the hard-cap
  // shape below) carrying the close signal. No provider call, nothing to
  // persist. Checked before the cost caps so a capped session reads as
  // "session over", never "Calyxa is resting".
  if (interactionCount !== null && interactionCount >= SESSION_STUDENT_MESSAGE_LIMIT) {
    await endSession(auth.supabase, sessionId!)
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(sseChunk({ sayDelta: MESSAGE_LIMIT_CLOSE_MESSAGE }))
        controller.enqueue(
          sseChunk({
            envelope: {
              reply: MESSAGE_LIMIT_CLOSE_MESSAGE,
              session: { complete: true, reason: MESSAGE_LIMIT_CLOSE_REASON },
            },
          })
        )
        controller.enqueue(encoder.encode('data: [DONE]\n\n'))
        controller.close()
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

  // Free monthly session cap (public launch, 2026-07-18): the streamed twin of
  // /api/ai/turn's branch — a free user whose session was started over
  // FREE_SESSION_LIMIT (start_session flagged it `degraded`) gets the upgrade
  // prompt as a synthetic terminal envelope, no provider call, nothing
  // persisted. `degraded: true` (no `degradedCap`) skips the voice legs
  // without emitting a cost-cap `degraded_hit`. Pro users never reach here.
  // Checked before the cost cap so a per-user free block reads as the upgrade
  // prompt, never "Calyxa is resting".
  if (overFreeCap) {
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(sseChunk({ sayDelta: FREE_LIMIT_MESSAGE }))
        controller.enqueue(sseChunk({ envelope: { reply: FREE_LIMIT_MESSAGE, degraded: true } }))
        controller.enqueue(encoder.encode('data: [DONE]\n\n'))
        controller.close()
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

  if (hardExceeded) {
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(sseChunk({ sayDelta: COST_RESTING_MESSAGE }))
        // `degradedCap` (Sprint 18 Task 8, ADR-043): same telemetry-support
        // annotation as /api/ai/turn — lets the extension emit an accurate
        // `degraded_hit.cap`. No change to the reply/`degraded` behavior.
        controller.enqueue(sseChunk({ envelope: { reply: COST_RESTING_MESSAGE, degraded: true, degradedCap: 'hard' } }))
        controller.enqueue(encoder.encode('data: [DONE]\n\n'))
        controller.close()
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

  const lastUserMessage = messages[messages.length - 1].content

  const stream = new ReadableStream({
    async start(controller) {
      try {
        for await (const event of getTutorProvider().runTurnEnvelopeStream({ messages, pageContext, profile })) {
          if (event.type === 'sayDelta') {
            controller.enqueue(sseChunk({ sayDelta: event.text }))
            continue
          }

          // Terminal envelope: run the SAME persistence + grounding + ping tail
          // /api/ai/turn runs, and emit its payload as the final event. The
          // insert is awaited here (before the terminal event) exactly as the
          // JSON route awaits it before responding; applyInteraction still runs
          // off the critical path via after().
          const payload = await completeTurn(
            auth.supabase,
            auth.user.id,
            sessionId,
            lastUserMessage,
            event.envelope,
            responseLatencyMs,
            profile
          )
          controller.enqueue(sseChunk({ envelope: { ...payload, ...(softExceeded ? { degraded: true, degradedCap: 'soft' } : {}) } }))
        }
        controller.enqueue(encoder.encode('data: [DONE]\n\n'))
      } catch {
        // Never relay the provider's error text or any key material.
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
