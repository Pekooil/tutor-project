import { clientFromBearer } from '@/lib/auth/bearer'
import { runTutorTurnEnvelopeStream } from '@/lib/ai/claude'
import { loadProfile } from '@/lib/learning/profile-read'
import { detectTopicKeys } from '@/lib/learning/topic'
import { parseMessages, parsePageContext, parseSessionId, parseResponseLatencyMs } from '@/lib/ai/turn-request'
import { completeTurn } from '@/lib/ai/turn-complete'

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

  // Same topic-biased profile read as /api/ai/turn (ADR-021). A read, not a
  // write; never throws.
  const topicKeys = detectTopicKeys(pageContext, messages)
  const profile = await loadProfile(auth.supabase, { topicKeys })

  const lastUserMessage = messages[messages.length - 1].content

  const stream = new ReadableStream({
    async start(controller) {
      try {
        for await (const event of runTutorTurnEnvelopeStream({ messages, pageContext, profile })) {
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
          controller.enqueue(sseChunk({ envelope: payload }))
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
