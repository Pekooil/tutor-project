import { NextResponse } from 'next/server'
import { clientFromBearer } from '@/lib/auth/bearer'
import { transcribe } from '@/lib/voice/whisper'
import { timed } from '@/lib/voice/latency'

// No storage/Blob/DB import in this module (ADR-011) — the request body is
// held only as an in-memory ArrayBuffer and handed straight to Whisper. This
// route writes nothing to disk or the database and returns only the
// transcript, never the audio.

// Push-to-talk utterances are short; this just bounds abuse/budget, not a
// realistic recording length.
const MAX_AUDIO_BYTES = 10 * 1024 * 1024

export async function POST(request: Request) {
  const auth = await clientFromBearer(request)

  if ('error' in auth) {
    return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })
  }

  const mimeType = request.headers.get('content-type')

  if (!mimeType || !mimeType.startsWith('audio/')) {
    return NextResponse.json({ error: 'An audio/* Content-Type is required.' }, { status: 400 })
  }

  const audio = await request.arrayBuffer().catch(() => null)

  if (!audio || audio.byteLength === 0) {
    return NextResponse.json({ error: 'Audio body must not be empty.' }, { status: 400 })
  }

  if (audio.byteLength > MAX_AUDIO_BYTES) {
    return NextResponse.json({ error: 'Audio body is too large.' }, { status: 400 })
  }

  try {
    const { value, ms } = await timed(() => transcribe({ audio, mimeType }))
    return NextResponse.json({ transcript: value.transcript, sttMs: ms })
  } catch {
    // Never relay the provider's error text or any key material to the client.
    return NextResponse.json({ error: 'Could not transcribe audio right now.' }, { status: 502 })
  }
}
