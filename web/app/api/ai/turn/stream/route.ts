import { clientFromBearer } from '@/lib/auth/bearer'
// Sprint 24 (ADR-038): tutor model calls go through the TutorProvider seam.
import { getTutorProvider } from '@/lib/ai/provider'
import { loadProfile } from '@/lib/learning/profile-read'
import { detectTopicKeys } from '@/lib/learning/topic'
import { parseMessages, parsePageContext, parseSessionId, parseResponseLatencyMs } from '@/lib/ai/turn-request'
import { completeTurn } from '@/lib/ai/turn-complete'
import { costGuard } from '@/lib/tier/cost-guard'
import { estimateCost } from '@/lib/tier/cost-model'

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
  const topicKeys = detectTopicKeys(pageContext, messages)
  const [{ softExceeded, hardExceeded }, profile] = await Promise.all([
    costGuard(auth.supabase, estimateCost('claude_turn')),
    loadProfile(auth.supabase, { topicKeys, userId: auth.user.id }),
  ])

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
