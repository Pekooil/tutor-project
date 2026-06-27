import { NextResponse } from 'next/server'
import { clientFromBearer } from '@/lib/auth/bearer'
import { synthesize } from '@/lib/voice/elevenlabs'
import { timed } from '@/lib/voice/latency'

// No persistence, no DB write — the synthesized audio stream is relayed
// straight through to the caller.

// A generous cap for a single Socratic reply; bounds abuse, not normal usage.
const MAX_TEXT_LENGTH = 2000

export async function POST(request: Request) {
  const auth = await clientFromBearer(request)

  if ('error' in auth) {
    return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })
  }

  const body = await request.json().catch(() => null)
  const text = typeof body?.text === 'string' ? body.text.trim() : ''

  if (!text || text.length > MAX_TEXT_LENGTH) {
    return NextResponse.json(
      { error: 'text must be a non-empty string up to 2000 characters.' },
      { status: 400 }
    )
  }

  try {
    const { value: audioStream, ms } = await timed(() => synthesize({ text }))
    return new NextResponse(audioStream, {
      status: 200,
      headers: {
        'Content-Type': 'audio/mpeg',
        'x-tts-ms': String(ms),
      },
    })
  } catch (error) {
    // Server-side terminal only — never relay the provider's error text or
    // any key material to the client (the response below stays generic).
    console.error('voice/tts: ElevenLabs call failed', error)
    return NextResponse.json({ error: 'Could not generate audio right now.' }, { status: 502 })
  }
}
